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
  bestBid?: number;
  bestAsk?: number;
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
  private readonly maxHistoryMs: number;

  constructor(maxHistoryMs = 24 * 60 * 60 * 1000) {
    this.maxHistoryMs = maxHistoryMs;
  }

  recordTick(snapshot: MarketTickSnapshot): void {
    this.latestByToken.set(snapshot.tokenId, snapshot);
    const history = this.historyByToken.get(snapshot.tokenId) ?? [];
    history.push(snapshot);
    this.historyByToken.set(snapshot.tokenId, history);
    this.pruneTokenHistory(snapshot.tokenId, snapshot.timestamp - this.maxHistoryMs);
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

  private pruneTokenHistory(tokenId: string, cutoffMs: number): void {
    const history = this.historyByToken.get(tokenId);
    if (!history || history.length === 0) {
      return;
    }

    let firstKeepIndex = 0;
    while (firstKeepIndex < history.length && history[firstKeepIndex].timestamp < cutoffMs) {
      firstKeepIndex += 1;
    }

    if (firstKeepIndex > 0) {
      this.historyByToken.set(tokenId, history.slice(firstKeepIndex));
    }
  }
}

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
