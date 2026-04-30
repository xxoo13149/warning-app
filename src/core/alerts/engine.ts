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
  source?: string;
  reason?: string;
  effectiveSize?: number;
  effectiveNotional?: number;
  referencePrice?: number;
}

const EPSILON = 1e-9;
const VOLUME_PRICING_MIN_NOTIONAL = 10;
const VOLUME_PRICING_MIN_SIZE = 20;
const VOLUME_PRICING_FRESH_MS = 30_000;
const VOLUME_PRICING_MAX_SPREAD = 0.1;
const VOLUME_PRICING_PRICE_FLOOR = 0.03;
const VOLUME_PRICING_PRICE_CEILING = 0.97;
const VOLUME_PRICING_TRADE_PRICE_TOLERANCE = 0.02;

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
      const messagePayload = this.buildMarketMessagePayload(rule, evaluation, input);
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
        return this.evaluateLiquidityKillV2(rule, current, nowMs);
      case 'volume_pricing':
        return this.evaluateVolumePricing(rule, current, nowMs);
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

  private evaluateLiquidityKillV2(
    rule: AlertRule,
    current: MarketEvaluationInput,
    nowMs: number,
  ): NumericEvaluation {
    const windowMs = rule.windowSec * 1000;
    const history = this.stateStore.getHistory(current.tokenId, windowMs, nowMs);
    const priorHistory = history.filter((entry) => entry.timestamp < nowMs);
    const candidates: NumericEvaluation[] = [];
    const operator = normalizeLiquidityKillOperator(rule.operator);

    if (matchesLiquidityRuleSide(rule, 'buy')) {
      const explicitBid = this.evaluateExplicitLiquidityEdge(
        rule,
        operator,
        current.removedBidEdge,
        current.bestBid,
        current.lastTradeAt,
        nowMs,
        'buy',
      );
      const fallbackBid =
        explicitBid ??
        this.evaluateFallbackLiquidityEdge(
          rule,
          operator,
          findLastHistoryEntry(priorHistory, 'bestBid', (value) =>
            compareWithOperator(value, operator, rule.threshold).triggered,
          )?.bestBid,
          current.bestBid,
          current.bidLevelCount,
          'buy',
        );
      if (fallbackBid) {
        candidates.push(fallbackBid);
      }
    }

    if (matchesLiquidityRuleSide(rule, 'sell')) {
      const explicitAsk = this.evaluateExplicitLiquidityEdge(
        rule,
        operator,
        current.removedAskEdge,
        current.bestAsk,
        current.lastTradeAt,
        nowMs,
        'sell',
      );
      const fallbackAsk =
        explicitAsk ??
        this.evaluateFallbackLiquidityEdge(
          rule,
          operator,
          findLastHistoryEntry(priorHistory, 'bestAsk', (value) =>
            compareWithOperator(value, operator, rule.threshold).triggered,
          )?.bestAsk,
          current.bestAsk,
          current.askLevelCount,
          'sell',
        );
      if (fallbackAsk) {
        candidates.push(fallbackAsk);
      }
    }

    if (candidates.length === 0) {
      return { triggered: false };
    }

    return candidates.reduce((best, next) => {
      const bestPriority = resolveLiquidityCandidatePriority(best);
      const nextPriority = resolveLiquidityCandidatePriority(next);
      if (nextPriority !== bestPriority) {
        return nextPriority > bestPriority ? next : best;
      }
      if (best.actual === undefined || next.actual === undefined) {
        return next;
      }
      return next.actual < best.actual ? next : best;
    }, candidates[0]);
  }

  private evaluateExplicitLiquidityEdge(
    rule: AlertRule,
    operator: AlertOperator,
    edge:
      | {
          previousPrice: number;
          currentPrice: number | null;
          levelCountAfter: number;
          source: 'price_change' | 'book' | 'fallback';
        }
      | undefined,
    currentPrice: number | undefined,
    lastTradeAt: number | undefined,
    nowMs: number,
    side: 'buy' | 'sell',
  ): NumericEvaluation | null {
    if (!edge) {
      return null;
    }

    const thresholdMatch = compareWithOperator(edge.previousPrice, operator, rule.threshold);
    if (!thresholdMatch.triggered) {
      return null;
    }

    return {
      triggered: true,
      actual: currentPrice ?? edge.currentPrice ?? 0,
      previous: edge.previousPrice,
      side,
      source: classifyLiquiditySource(edge.source, lastTradeAt, nowMs),
      reason: edge.levelCountAfter <= 0 ? 'full_empty' : 'top_level',
    };
  }

  private evaluateFallbackLiquidityEdge(
    rule: AlertRule,
    operator: AlertOperator,
    previousPrice: number | undefined,
    currentPrice: number | undefined,
    levelCount: number | undefined,
    side: 'buy' | 'sell',
  ): NumericEvaluation | null {
    if (previousPrice === undefined) {
      return null;
    }

    const thresholdMatch = compareWithOperator(previousPrice, operator, rule.threshold);
    if (!thresholdMatch.triggered) {
      return null;
    }

    const marketSideIsEmpty =
      levelCount !== undefined ? levelCount <= 0 : currentPrice === undefined || currentPrice <= EPSILON;
    if (!marketSideIsEmpty) {
      return null;
    }

    return {
      triggered: true,
      actual: currentPrice ?? 0,
      previous: previousPrice,
      side,
      source: 'fallback',
      reason: 'full_empty',
    };
  }

  private evaluateVolumePricing(
    rule: AlertRule,
    current: MarketEvaluationInput,
    nowMs: number,
  ): NumericEvaluation {
    const currentAsk = normalizeFiniteNumber(current.bestAsk);
    if (
      currentAsk === undefined ||
      currentAsk <= VOLUME_PRICING_PRICE_FLOOR ||
      currentAsk >= VOLUME_PRICING_PRICE_CEILING
    ) {
      return { triggered: false };
    }

    if (
      current.lastMessageAt !== undefined &&
      nowMs - current.lastMessageAt > VOLUME_PRICING_FRESH_MS
    ) {
      return { triggered: false };
    }

    const spread = normalizeFiniteNumber(current.spread);
    const maxSpread = Math.max(VOLUME_PRICING_MAX_SPREAD, rule.threshold);
    if (spread !== undefined && spread > maxSpread + EPSILON) {
      return { triggered: false };
    }

    const reference = resolveVolumePricingReference(
      this.stateStore.getHistory(current.tokenId, rule.windowSec * 1000, nowMs).filter(
        (entry) => entry.timestamp < nowMs,
      ),
      current,
      currentAsk,
      rule.threshold,
    );
    if (!reference) {
      return { triggered: false };
    }

    const move = currentAsk - reference.price;
    if (!compareWithOperator(move, normalizeVolumePricingOperator(rule.operator), rule.threshold).triggered) {
      return { triggered: false };
    }

    const confirmation = resolveVolumePricingConfirmation(current, reference.price, currentAsk, nowMs, rule.windowSec);
    if (!confirmation) {
      return { triggered: false };
    }

    return {
      triggered: true,
      actual: currentAsk,
      previous: reference.price,
      side: 'sell',
      source: confirmation.source,
      reason: 'ask_pushed_up',
      effectiveSize: confirmation.effectiveSize,
      effectiveNotional: confirmation.effectiveNotional,
      referencePrice: reference.price,
    };
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
    input: MarketEvaluationInput,
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
            outcome: input.side ?? null,
            side: evaluation.side,
            threshold: rule.threshold,
            actual: evaluation.actual,
            previous: evaluation.previous,
            source: evaluation.source,
            reason: evaluation.reason,
          },
        };
      }
      case 'volume_pricing': {
        return {
          messageKey: 'volume_pricing',
          messageParams: {
            outcome: input.side ?? null,
            side: evaluation.side,
            threshold: rule.threshold,
            actual: evaluation.actual,
            previous: evaluation.previous,
            source: evaluation.source,
            reason: evaluation.reason,
            effectiveSize: evaluation.effectiveSize,
            effectiveNotional: evaluation.effectiveNotional,
            referencePrice: evaluation.referencePrice,
            windowSec: rule.windowSec,
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

interface VolumePricingReference {
  price: number;
  size?: number;
}

interface VolumePricingConfirmation {
  source: 'trade_confirmed' | 'edge_volume' | 'book_depth';
  effectiveSize: number;
  effectiveNotional: number;
}

function resolveVolumePricingReference(
  history: MarketTickSnapshot[],
  current: MarketEvaluationInput,
  currentAsk: number,
  threshold: number,
): VolumePricingReference | null {
  const edgePrice = normalizeFiniteNumber(current.removedAskEdge?.previousPrice);
  if (edgePrice !== undefined && currentAsk - edgePrice >= threshold - EPSILON) {
    return {
      price: edgePrice,
      size: normalizeFiniteNumber(current.removedAskEdge?.previousSize ?? undefined),
    };
  }

  let bestReference: VolumePricingReference | null = null;
  for (const entry of history) {
    const price = normalizeFiniteNumber(entry.bestAsk);
    if (price === undefined || currentAsk - price < threshold - EPSILON) {
      continue;
    }
    if (!bestReference || price < bestReference.price) {
      bestReference = {
        price,
        size: normalizeFiniteNumber(entry.bestAskSize),
      };
    }
  }
  return bestReference;
}

function resolveVolumePricingConfirmation(
  current: MarketEvaluationInput,
  referencePrice: number,
  currentAsk: number,
  nowMs: number,
  windowSec: number,
): VolumePricingConfirmation | null {
  const edgeSize = normalizeFiniteNumber(current.removedAskEdge?.previousSize ?? undefined);
  const edgePrice = normalizeFiniteNumber(current.removedAskEdge?.previousPrice);
  if (
    edgeSize !== undefined &&
    edgePrice !== undefined &&
    Math.abs(edgePrice - referencePrice) <= VOLUME_PRICING_TRADE_PRICE_TOLERANCE
  ) {
    const edgeNotional = edgeSize * edgePrice;
    if (edgeSize >= VOLUME_PRICING_MIN_SIZE || edgeNotional >= VOLUME_PRICING_MIN_NOTIONAL) {
      return {
        source: 'edge_volume',
        effectiveSize: edgeSize,
        effectiveNotional: edgeNotional,
      };
    }
  }

  const lastTradeSize = normalizeFiniteNumber(current.lastTradeSize);
  const lastTradePrice = normalizeFiniteNumber(current.lastTradePrice);
  const lastTradeAt = current.lastTradeAt;
  const tradeWindowMs = Math.max(1, windowSec) * 1000;
  if (
    lastTradeSize !== undefined &&
    lastTradePrice !== undefined &&
    lastTradeAt !== undefined &&
    nowMs - lastTradeAt >= 0 &&
    nowMs - lastTradeAt <= tradeWindowMs &&
    lastTradePrice >= referencePrice - VOLUME_PRICING_TRADE_PRICE_TOLERANCE &&
    lastTradePrice <= currentAsk + VOLUME_PRICING_TRADE_PRICE_TOLERANCE
  ) {
    const tradeNotional = lastTradeSize * lastTradePrice;
    if (lastTradeSize >= VOLUME_PRICING_MIN_SIZE || tradeNotional >= VOLUME_PRICING_MIN_NOTIONAL) {
      return {
        source: 'trade_confirmed',
        effectiveSize: lastTradeSize,
        effectiveNotional: tradeNotional,
      };
    }
  }

  const askSize = normalizeFiniteNumber(current.bestAskSize);
  if (askSize !== undefined) {
    const askNotional = askSize * currentAsk;
    if (askSize >= VOLUME_PRICING_MIN_SIZE || askNotional >= VOLUME_PRICING_MIN_NOTIONAL) {
      return {
        source: 'book_depth',
        effectiveSize: askSize,
        effectiveNotional: askNotional,
      };
    }
  }

  const visibleAskSize = normalizeFiniteNumber(current.askVisibleSize);
  if (visibleAskSize !== undefined) {
    const visibleNotional = visibleAskSize * currentAsk;
    if (
      visibleAskSize >= VOLUME_PRICING_MIN_SIZE * 2 ||
      visibleNotional >= VOLUME_PRICING_MIN_NOTIONAL
    ) {
      return {
        source: 'book_depth',
        effectiveSize: visibleAskSize,
        effectiveNotional: visibleNotional,
      };
    }
  }

  return null;
}

function normalizeVolumePricingOperator(_operator: AlertOperator): AlertOperator {
  return '>=';
}

function normalizeLiquidityKillOperator(_operator: AlertOperator): AlertOperator {
  return '>=';
}

function matchesLiquidityRuleSide(rule: AlertRule, side: 'buy' | 'sell'): boolean {
  return !rule.liquiditySide || rule.liquiditySide === 'both' || rule.liquiditySide === side;
}

function classifyLiquiditySource(
  edgeSource: 'price_change' | 'book' | 'fallback',
  lastTradeAt: number | undefined,
  nowMs: number,
): string {
  if (lastTradeAt !== undefined && nowMs - lastTradeAt >= 0 && nowMs - lastTradeAt <= 3_000) {
    return 'trade_sweep';
  }
  if (edgeSource === 'price_change') {
    return 'cancel_pull';
  }
  if (edgeSource === 'fallback') {
    return 'fallback';
  }
  return 'unknown';
}

function resolveLiquidityCandidatePriority(candidate: NumericEvaluation): number {
  if (candidate.reason === 'full_empty' && candidate.source === 'trade_sweep') {
    return 4;
  }
  if (candidate.reason === 'full_empty') {
    return 3;
  }
  if (candidate.source === 'trade_sweep') {
    return 2;
  }
  return 1;
}
