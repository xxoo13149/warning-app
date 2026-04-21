import { randomUUID } from 'node:crypto';
import type { FeedSnapshot, MarketStateStore, MarketTickSnapshot } from '../state';
import { matchesScope, isInQuietHours } from './scope';
import type {
  AlertOperator,
  AlertRule,
  AlertTrigger,
  FeedEvaluationInput,
  MarketEvaluationInput,
} from './types';
import { formatAlertMessage, type AlertMessageKey, type AlertMessageParams } from '../../shared/alert-display';

interface NumericEvaluation {
  triggered: boolean;
  actual?: number;
  previous?: number;
  side?: 'buy' | 'sell';
}

const EPSILON = 1e-9;

export class AlertEngine {
  private readonly ruleCooldownByKey = new Map<string, number>();
  private readonly dedupeByKey = new Map<string, number>();
  private readonly stateStore: MarketStateStore;

  constructor(stateStore: MarketStateStore) {
    this.stateStore = stateStore;
  }

  evaluateMarketTick(rules: AlertRule[], input: MarketEvaluationInput, nowMs = input.timestamp): AlertTrigger[] {
    const previous = this.stateStore.getLatest(input.tokenId);
    this.stateStore.recordTick(input);

    const results: AlertTrigger[] = [];
    for (const rule of rules) {
      if (!rule.enabled || rule.metric === 'feed_stale') {
        continue;
      }
      if (!matchesScope(rule.scope, input)) {
        continue;
      }
      if (isInQuietHours(rule.quietHours, nowMs)) {
        continue;
      }

      const evaluation = this.evaluateMarketRule(rule, input, previous, nowMs);
      if (!evaluation.triggered) {
        continue;
      }

      const dedupeKey = this.buildDedupeKey(rule.id, input.marketId, input.tokenId);
      if (!this.canTrigger(rule, dedupeKey, nowMs)) {
        continue;
      }

      this.markTriggered(rule, dedupeKey, nowMs);
      const messagePayload = this.buildMarketMessagePayload(rule, evaluation);
      results.push({
        id: randomUUID(),
        ruleId: rule.id,
        builtinKey: rule.builtinKey,
        triggeredAt: nowMs,
        cityKey: input.cityKey,
        eventId: input.eventId,
        marketId: input.marketId,
        tokenId: input.tokenId,
        severity: rule.severity,
        dedupeKey,
        message: formatAlertMessage('zh-CN', messagePayload),
        messageKey: messagePayload.messageKey,
        messageParams: messagePayload.messageParams,
      });
    }

    this.compactMemory(nowMs);
    return results;
  }

  evaluateFeedHealth(rules: AlertRule[], feed: FeedEvaluationInput, nowMs = feed.updatedAt): AlertTrigger[] {
    const results: AlertTrigger[] = [];
    for (const rule of rules) {
      if (!rule.enabled || rule.metric !== 'feed_stale') {
        continue;
      }
      if (!matchesScope(rule.scope, feed)) {
        continue;
      }
      if (isInQuietHours(rule.quietHours, nowMs)) {
        continue;
      }

      const evaluation = this.evaluateFeedRule(rule, feed, nowMs);
      if (!evaluation.triggered) {
        continue;
      }

      const dedupeKey = this.buildDedupeKey(rule.id, feed.marketId ?? feed.feedKey, feed.tokenId ?? feed.feedKey);
      if (!this.canTrigger(rule, dedupeKey, nowMs)) {
        continue;
      }

      this.markTriggered(rule, dedupeKey, nowMs);
      const lagSec = Math.max(0, Math.round((nowMs - feed.lastMessageAt) / 1000));
      const messageParams: AlertMessageParams = {
        feedKey: feed.feedKey,
        lagSec,
        threshold: rule.threshold,
      };
      results.push({
        id: randomUUID(),
        ruleId: rule.id,
        builtinKey: rule.builtinKey,
        triggeredAt: nowMs,
        cityKey: feed.cityKey,
        eventId: feed.eventId,
        marketId: feed.marketId,
        tokenId: feed.tokenId,
        severity: rule.severity,
        dedupeKey,
        message: formatAlertMessage('zh-CN', {
          messageKey: 'feed_stale',
          messageParams,
        }),
        messageKey: 'feed_stale',
        messageParams,
      });
    }

    this.compactMemory(nowMs);
    return results;
  }

  private evaluateMarketRule(
    rule: AlertRule,
    current: MarketEvaluationInput,
    previous: MarketTickSnapshot | undefined,
    nowMs: number,
  ): NumericEvaluation {
    switch (rule.metric) {
      case 'price_threshold':
        return compareWithOperator(current.lastTradePrice, rule.operator, rule.threshold, previous?.lastTradePrice);
      case 'spread_threshold':
        return compareWithOperator(current.spread, rule.operator, rule.threshold, previous?.spread);
      case 'price_change_pct':
        return this.evaluatePriceChange(rule, current, nowMs);
      case 'liquidity_kill':
        return this.evaluateLiquidityKill(rule, current, nowMs);
      default:
        return { triggered: false };
    }
  }

  private evaluatePriceChange(rule: AlertRule, current: MarketEvaluationInput, nowMs: number): NumericEvaluation {
    if (current.lastTradePrice === undefined || current.lastTradePrice === null) {
      return { triggered: false };
    }

    const history = this.stateStore.getHistory(current.tokenId, rule.windowSec * 1000, nowMs);
    if (history.length === 0) {
      return { triggered: false };
    }

    const base = history[0]?.lastTradePrice;
    if (base === undefined || base === null || Math.abs(base) < EPSILON) {
      return { triggered: false };
    }

    const changePct = ((current.lastTradePrice - base) / base) * 100;
    const compare = compareWithOperator(changePct, rule.operator, rule.threshold);
    return {
      triggered: compare.triggered,
      actual: changePct,
      previous: base,
    };
  }

  private evaluateLiquidityKill(rule: AlertRule, current: MarketEvaluationInput, nowMs: number): NumericEvaluation {
    const windowMs = rule.windowSec * 1000;
    const history = this.stateStore.getHistory(current.tokenId, windowMs, nowMs);
    const priorHistory = history.filter((entry) => entry.timestamp < nowMs);
    const threshold = rule.threshold;

    const bidSnapshot = findLastHistoryEntry(priorHistory, 'bestBid', (value) => value > threshold + EPSILON);
    const askSnapshot = findLastHistoryEntry(priorHistory, 'bestAsk', (value) => value > threshold + EPSILON);

    const currentBid = normalizeFiniteNumber(current.bestBid);
    const currentAsk = normalizeFiniteNumber(current.bestAsk);

    // Missing bid/ask is treated as liquidity disappearing, same as collapsing to 0.
    const bidProbeValue = currentBid ?? 0;
    const askProbeValue = currentAsk ?? 0;

    const dropBid = bidProbeValue <= threshold + EPSILON && Boolean(bidSnapshot);
    const dropAsk = askProbeValue <= threshold + EPSILON && Boolean(askSnapshot);

    if (!dropBid && !dropAsk) {
      return { triggered: false };
    }

    const evaluateSide = (
      side: 'buy' | 'sell',
      currentValue: number | undefined,
      previousValue: number | undefined,
    ): NumericEvaluation | null => {
      if (currentValue === undefined || !Number.isFinite(currentValue) || previousValue === undefined) {
        return null;
      }
      const comparison = compareWithOperator(currentValue, rule.operator, threshold, previousValue);
      if (!comparison.triggered) {
        return null;
      }
      return {
        triggered: true,
        actual: currentValue,
        previous: previousValue,
        side,
      };
    };

    const candidates: NumericEvaluation[] = [];
    if (dropBid && bidSnapshot?.bestBid !== undefined && Number.isFinite(bidSnapshot.bestBid)) {
      const bidEval = evaluateSide('buy', bidProbeValue, bidSnapshot.bestBid);
      if (bidEval) {
        candidates.push(bidEval);
      }
    }
    if (dropAsk && askSnapshot?.bestAsk !== undefined && Number.isFinite(askSnapshot.bestAsk)) {
      const askEval = evaluateSide('sell', askProbeValue, askSnapshot.bestAsk);
      if (askEval) {
        candidates.push(askEval);
      }
    }

    if (candidates.length === 0) {
      return { triggered: false };
    }

    return candidates.reduce((best, next) => {
      if (!best) {
        return next;
      }
      if (best.actual === undefined) {
        return next;
      }
      if (next.actual === undefined) {
        return best;
      }
      return next.actual < best.actual ? next : best;
    }, candidates[0]);
  }

  private evaluateFeedRule(rule: AlertRule, feed: FeedSnapshot, nowMs: number): NumericEvaluation {
    const lagSec = (nowMs - feed.lastMessageAt) / 1000;
    return compareWithOperator(lagSec, rule.operator, rule.threshold);
  }

  private canTrigger(rule: AlertRule, dedupeKey: string, nowMs: number): boolean {
    const lastByCooldown = this.ruleCooldownByKey.get(dedupeKey);
    if (lastByCooldown !== undefined && nowMs - lastByCooldown < rule.cooldownSec * 1000) {
      return false;
    }

    const lastByDedupe = this.dedupeByKey.get(dedupeKey);
    if (lastByDedupe !== undefined && nowMs - lastByDedupe < rule.dedupeWindowSec * 1000) {
      return false;
    }

    return true;
  }

  private markTriggered(rule: AlertRule, dedupeKey: string, nowMs: number): void {
    this.ruleCooldownByKey.set(dedupeKey, nowMs);
    this.dedupeByKey.set(dedupeKey, nowMs);
  }

  private buildDedupeKey(ruleId: string, marketId: string | undefined, tokenId: string | undefined): string {
    const market = marketId ?? 'global';
    const token = tokenId ?? 'global';
    return `${ruleId}:${market}:${token}`;
  }

  private buildMarketMessagePayload(
    rule: AlertRule,
    evaluation: NumericEvaluation,
  ): {
    messageKey: AlertMessageKey;
    messageParams: AlertMessageParams;
  } {
    switch (rule.metric) {
      case 'price_threshold': {
        return {
          messageKey: 'price_threshold',
          messageParams: {
            operator: rule.operator,
            threshold: rule.threshold,
            actual: evaluation.actual,
          },
        };
      }
      case 'spread_threshold': {
        return {
          messageKey: 'spread_threshold',
          messageParams: {
            operator: rule.operator,
            threshold: rule.threshold,
            actual: evaluation.actual,
          },
        };
      }
      case 'price_change_pct': {
        return {
          messageKey: 'price_change_pct',
          messageParams: {
            actual: evaluation.actual,
            threshold: rule.threshold,
            windowSec: rule.windowSec,
          },
        };
      }
      case 'liquidity_kill': {
        return {
          messageKey: 'liquidity_kill',
          messageParams: {
            side: evaluation.side,
            threshold: rule.threshold,
            actual: evaluation.actual,
            previous: evaluation.previous,
          },
        };
      }
      default:
        return {
          messageKey: 'system_error',
          messageParams: {
            reason: `${rule.name} triggered`,
          },
        };
    }
  }

  private compactMemory(nowMs: number): void {
    const maxAgeMs = 24 * 60 * 60 * 1000;
    for (const [key, value] of this.ruleCooldownByKey.entries()) {
      if (nowMs - value > maxAgeMs) {
        this.ruleCooldownByKey.delete(key);
      }
    }
    for (const [key, value] of this.dedupeByKey.entries()) {
      if (nowMs - value > maxAgeMs) {
        this.dedupeByKey.delete(key);
      }
    }
  }
}

function compareWithOperator(
  value: number | undefined,
  operator: AlertOperator,
  threshold: number,
  previous?: number,
): NumericEvaluation {
  if (value === undefined || value === null) {
    return { triggered: false };
  }

  switch (operator) {
    case '>':
      return { triggered: value > threshold, actual: value, previous };
    case '>=':
      return { triggered: value >= threshold, actual: value, previous };
    case '<':
      return { triggered: value < threshold, actual: value, previous };
    case '<=':
      return { triggered: value <= threshold, actual: value, previous };
    case '==':
      return { triggered: Math.abs(value - threshold) < EPSILON, actual: value, previous };
    case 'crosses_above':
      return {
        triggered: previous !== undefined && previous < threshold && value >= threshold,
        actual: value,
        previous,
      };
    case 'crosses_below':
      return {
        triggered: previous !== undefined && previous > threshold && value <= threshold,
        actual: value,
        previous,
      };
    default:
      return { triggered: false };
  }
}

function normalizeFiniteNumber(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function findLastHistoryEntry(
  history: MarketTickSnapshot[],
  field: 'bestBid' | 'bestAsk',
  predicate: (value: number) => boolean,
): MarketTickSnapshot | undefined {
  for (let idx = history.length - 1; idx >= 0; idx -= 1) {
    const entry = history[idx];
    const value = entry[field];
    if (value === undefined || value === null || !Number.isFinite(value)) {
      continue;
    }
    if (predicate(value)) {
      return entry;
    }
  }
  return undefined;
}
