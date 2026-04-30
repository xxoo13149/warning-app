export interface MarketTickSnapshot {
  tokenId: string;
  marketId?: string;
  cityKey?: string;
  seriesSlug?: string;
  eventDate?: string;
  temperatureBand?: string;
  side?: 'yes' | 'no';
  timestamp: number;
  lastTradePrice?: number;
  lastTradeSide?: 'buy' | 'sell';
  lastTradeSize?: number;
  lastTradeAt?: number;
  bestBid?: number;
  bestBidSize?: number;
  bestAsk?: number;
  bestAskSize?: number;
  bidLevelCount?: number;
  askLevelCount?: number;
  bidVisibleSize?: number;
  askVisibleSize?: number;
  removedBidEdge?: {
    previousPrice: number;
    previousSize: number | null;
    currentPrice: number | null;
    currentSize: number | null;
    levelCountAfter: number;
    visibleSizeAfter: number;
    source: 'price_change' | 'book' | 'fallback';
  };
  removedAskEdge?: {
    previousPrice: number;
    previousSize: number | null;
    currentPrice: number | null;
    currentSize: number | null;
    levelCountAfter: number;
    visibleSizeAfter: number;
    source: 'price_change' | 'book' | 'fallback';
  };
  spread?: number;
  lastMessageAt?: number;
}

export interface FeedSnapshot {
  feedKey: string;
  status: 'ok' | 'degraded' | 'down';
  lastMessageAt: number;
  lastOkAt?: number;
  reconnectCount?: number;
  latencyMs?: number;
  updatedAt: number;
}

export class MarketStateStore {
  private readonly latestByToken = new Map<string, MarketTickSnapshot>();
  private readonly historyByToken = new Map<string, MarketTickSnapshot[]>();
  private historyWindowMs: number;

  constructor(historyWindowMs = 24 * 60 * 60 * 1000) {
    this.historyWindowMs = normalizeHistoryWindowMs(historyWindowMs);
  }

  setHistoryWindow(historyWindowMs: number): void {
    const nextWindowMs = normalizeHistoryWindowMs(historyWindowMs);
    if (nextWindowMs === this.historyWindowMs) {
      return;
    }

    this.historyWindowMs = nextWindowMs;
    for (const tokenId of this.historyByToken.keys()) {
      this.pruneTokenHistory(tokenId);
    }
  }

  recordTick(snapshot: MarketTickSnapshot): void {
    this.latestByToken.set(snapshot.tokenId, snapshot);

    if (this.historyWindowMs <= 0) {
      this.historyByToken.set(snapshot.tokenId, [snapshot]);
      return;
    }

    const history = this.historyByToken.get(snapshot.tokenId) ?? [];
    history.push(snapshot);
    this.historyByToken.set(snapshot.tokenId, history);
    this.pruneTokenHistory(snapshot.tokenId, snapshot.timestamp - this.historyWindowMs);
  }

  getLatest(tokenId: string): MarketTickSnapshot | undefined {
    return this.latestByToken.get(tokenId);
  }

  getHistory(tokenId: string, windowMs: number, nowMs = Date.now()): MarketTickSnapshot[] {
    const history = this.historyByToken.get(tokenId) ?? [];
    const fromTs = nowMs - windowMs;
    return history.filter((item) => item.timestamp >= fromTs);
  }

  pruneOlderThan(cutoffMs: number): void {
    for (const tokenId of this.historyByToken.keys()) {
      this.pruneTokenHistory(tokenId, cutoffMs);
    }
  }

  clear(): void {
    this.latestByToken.clear();
    this.historyByToken.clear();
  }

  private pruneTokenHistory(tokenId: string, cutoffMs?: number): void {
    const history = this.historyByToken.get(tokenId);
    if (!history || history.length === 0) {
      return;
    }

    const latest = this.latestByToken.get(tokenId);
    if (!latest) {
      this.historyByToken.delete(tokenId);
      return;
    }

    if (this.historyWindowMs <= 0) {
      this.historyByToken.set(tokenId, [latest]);
      return;
    }

    const effectiveCutoffMs = cutoffMs ?? latest.timestamp - this.historyWindowMs;
    let firstKeepIndex = 0;
    while (
      firstKeepIndex < history.length &&
      history[firstKeepIndex].timestamp < effectiveCutoffMs
    ) {
      firstKeepIndex += 1;
    }

    if (firstKeepIndex > 0) {
      const nextHistory = history.slice(firstKeepIndex);
      if (nextHistory.length === 0) {
        this.historyByToken.set(tokenId, [latest]);
        return;
      }
      this.historyByToken.set(tokenId, nextHistory);
    }
  }
}

const normalizeHistoryWindowMs = (value: number): number =>
  Number.isFinite(value) && value > 0 ? Math.max(0, Math.trunc(value)) : 0;

export class FeedStateStore {
  private readonly feeds = new Map<string, FeedSnapshot>();

  upsert(snapshot: FeedSnapshot): void {
    this.feeds.set(snapshot.feedKey, snapshot);
  }

  get(feedKey: string): FeedSnapshot | undefined {
    return this.feeds.get(feedKey);
  }

  list(): FeedSnapshot[] {
    return Array.from(this.feeds.values());
  }
}
