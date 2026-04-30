import type { MarketTickSnapshot } from '../state';
import type { LotteryConfirmationSource } from '../../shared/monitor-contracts';

const EPSILON = 1e-9;

export const ABNORMAL_LOTTERY_DEFAULT_WINDOW_MS = 60 * 1000;
export const ABNORMAL_LOTTERY_DEFAULT_MIN_LIFT = 0.05;
export const ABNORMAL_LOTTERY_REFERENCE_ASK_MAX = 0.04;
export const ABNORMAL_LOTTERY_CURRENT_ASK_MAX = 0.18;
export const ABNORMAL_LOTTERY_MAX_SPREAD = 0.1;
export const ABNORMAL_LOTTERY_FRESH_MS = 30_000;
export const ABNORMAL_LOTTERY_MIN_NOTIONAL = 5;
export const ABNORMAL_LOTTERY_MIN_SIZE = 100;
export const ABNORMAL_LOTTERY_TRADE_TOLERANCE = 0.02;

export interface AbnormalLotterySignalSnapshot {
  referenceAsk: number;
  currentAsk: number;
  lift: number;
  minimumLift: number;
  confirmationSource: LotteryConfirmationSource;
  effectiveSize: number;
  effectiveNotional: number;
  updatedAt: string;
}

export interface AbnormalLotterySignalOptions {
  asOfTimestamp?: number;
  windowMs?: number;
  baseMinLift?: number;
  referenceAskMax?: number;
  currentAskMax?: number;
  maxSpread?: number;
  freshMs?: number;
  minSize?: number;
  minNotional?: number;
  tradeTolerance?: number;
  requireSide?: 'yes' | 'no';
}

export function resolveAbnormalLotteryMinLift(
  referenceAsk: number,
  baseMinLift = ABNORMAL_LOTTERY_DEFAULT_MIN_LIFT,
): number {
  if (referenceAsk <= 0.02) {
    return Math.min(baseMinLift, 0.03);
  }

  if (referenceAsk <= ABNORMAL_LOTTERY_REFERENCE_ASK_MAX) {
    return Math.min(baseMinLift, 0.04);
  }

  return baseMinLift;
}

export function resolveAbnormalLotterySignal(
  current: MarketTickSnapshot,
  history: MarketTickSnapshot[],
  options: AbnormalLotterySignalOptions = {},
): AbnormalLotterySignalSnapshot | null {
  const asOfTimestamp = options.asOfTimestamp ?? current.timestamp ?? Date.now();
  const requireSide = options.requireSide;
  if (requireSide && current.side !== requireSide) {
    return null;
  }

  const currentAskMax = options.currentAskMax ?? ABNORMAL_LOTTERY_CURRENT_ASK_MAX;
  const currentAsk = normalizeFiniteNumber(current.bestAsk);
  if (currentAsk === undefined || currentAsk <= 0 || currentAsk > currentAskMax + EPSILON) {
    return null;
  }

  const freshMs = options.freshMs ?? ABNORMAL_LOTTERY_FRESH_MS;
  if (
    current.lastMessageAt !== undefined &&
    asOfTimestamp - current.lastMessageAt > freshMs
  ) {
    return null;
  }

  const spread = normalizeFiniteNumber(current.spread);
  const maxSpread = options.maxSpread ?? ABNORMAL_LOTTERY_MAX_SPREAD;
  if (spread !== undefined && spread > maxSpread + EPSILON) {
    return null;
  }

  const referenceAskMax = options.referenceAskMax ?? ABNORMAL_LOTTERY_REFERENCE_ASK_MAX;
  const baseMinLift = options.baseMinLift ?? ABNORMAL_LOTTERY_DEFAULT_MIN_LIFT;
  const reference = resolveAbnormalLotteryReference(
    current,
    history,
    currentAsk,
    baseMinLift,
    referenceAskMax,
  );
  if (!reference) {
    return null;
  }

  const confirmation = resolveAbnormalLotteryConfirmation(
    current,
    reference.referenceAsk,
    currentAsk,
    asOfTimestamp,
    {
      windowMs: options.windowMs ?? ABNORMAL_LOTTERY_DEFAULT_WINDOW_MS,
      minSize: options.minSize ?? ABNORMAL_LOTTERY_MIN_SIZE,
      minNotional: options.minNotional ?? ABNORMAL_LOTTERY_MIN_NOTIONAL,
      tradeTolerance: options.tradeTolerance ?? ABNORMAL_LOTTERY_TRADE_TOLERANCE,
    },
  );
  if (!confirmation) {
    return null;
  }

  return {
    referenceAsk: reference.referenceAsk,
    currentAsk,
    lift: Number((currentAsk - reference.referenceAsk).toFixed(6)),
    minimumLift: reference.minimumLift,
    confirmationSource: confirmation.source,
    effectiveSize: confirmation.effectiveSize,
    effectiveNotional: confirmation.effectiveNotional,
    updatedAt: new Date(current.timestamp).toISOString(),
  };
}

function resolveAbnormalLotteryReference(
  current: MarketTickSnapshot,
  history: MarketTickSnapshot[],
  currentAsk: number,
  baseMinLift: number,
  referenceAskMax: number,
): { referenceAsk: number; minimumLift: number } | null {
  const edgeReference = normalizeFiniteNumber(current.removedAskEdge?.previousPrice);
  if (edgeReference !== undefined && edgeReference <= referenceAskMax + EPSILON) {
    const minimumLift = resolveAbnormalLotteryMinLift(edgeReference, baseMinLift);
    if (currentAsk - edgeReference >= minimumLift - EPSILON) {
      return {
        referenceAsk: edgeReference,
        minimumLift,
      };
    }
  }

  for (let index = history.length - 1; index >= 0; index -= 1) {
    const candidateAsk = normalizeFiniteNumber(history[index]?.bestAsk);
    if (candidateAsk === undefined || candidateAsk > referenceAskMax + EPSILON) {
      continue;
    }
    const minimumLift = resolveAbnormalLotteryMinLift(candidateAsk, baseMinLift);
    if (currentAsk - candidateAsk >= minimumLift - EPSILON) {
      return {
        referenceAsk: candidateAsk,
        minimumLift,
      };
    }
  }

  return null;
}

function resolveAbnormalLotteryConfirmation(
  current: MarketTickSnapshot,
  referenceAsk: number,
  currentAsk: number,
  nowMs: number,
  options: {
    windowMs: number;
    minSize: number;
    minNotional: number;
    tradeTolerance: number;
  },
): {
  source: LotteryConfirmationSource;
  effectiveSize: number;
  effectiveNotional: number;
} | null {
  const edgeSize = normalizeFiniteNumber(current.removedAskEdge?.previousSize ?? undefined);
  const edgePrice = normalizeFiniteNumber(current.removedAskEdge?.previousPrice);
  if (
    edgeSize !== undefined &&
    edgePrice !== undefined &&
    Math.abs(edgePrice - referenceAsk) <= options.tradeTolerance + EPSILON
  ) {
    const edgeNotional = edgeSize * edgePrice;
    if (edgeSize >= options.minSize || edgeNotional >= options.minNotional) {
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
  if (
    lastTradeSize !== undefined &&
    lastTradePrice !== undefined &&
    lastTradeAt !== undefined &&
    nowMs - lastTradeAt >= 0 &&
    nowMs - lastTradeAt <= options.windowMs &&
    lastTradePrice >= referenceAsk - options.tradeTolerance - EPSILON &&
    lastTradePrice <= currentAsk + options.tradeTolerance + EPSILON
  ) {
    const tradeNotional = lastTradeSize * lastTradePrice;
    if (lastTradeSize >= options.minSize || tradeNotional >= options.minNotional) {
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
    if (askSize >= options.minSize || askNotional >= options.minNotional) {
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
    if (visibleAskSize >= options.minSize || visibleNotional >= options.minNotional) {
      return {
        source: 'book_depth',
        effectiveSize: visibleAskSize,
        effectiveNotional: visibleNotional,
      };
    }
  }

  return null;
}

function normalizeFiniteNumber(value: number | undefined | null): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
