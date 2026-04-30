import { EventEmitter } from 'node:events';
import {
  DEFAULT_DISCOVERY_RECONCILE_MS,
  DEFAULT_FEED_STALE_MS,
} from '../polymarket/constants';
import { toNumberOrUndefined, uniqueStrings } from '../polymarket/http';
import { ClobRestClient } from '../polymarket/clob-rest-client';
import { GammaDiscoveryClient } from '../polymarket/gamma-discovery';
import { TokenShardWsManager } from '../polymarket/token-shard-ws-manager';
import type {
  BookResponseItem,
  BookLevel,
  CityConfig,
  DailyWeatherUniverse,
  MarketWsMessage,
  OrderBookEdgeSnapshot,
  PriceSnapshot,
  ShardMarketEvent,
  ShardStatusEvent,
  TokenRuntimeState,
  TokenShardState,
  TokenShardWsManagerOptions,
} from '../polymarket/types';

export interface PolymarketDataServiceOptions {
  gamma?: ConstructorParameters<typeof GammaDiscoveryClient>[0];
  clobRest?: ConstructorParameters<typeof ClobRestClient>[0];
  ws?: TokenShardWsManagerOptions;
  discoveryReconcileMs?: number;
  feedStaleMs?: number;
  staleCheckMs?: number;
}

export interface PolymarketDataServiceState {
  running: boolean;
  universe: DailyWeatherUniverse | null;
  shardStates: TokenShardState[];
  watchlistTokenIds: string[];
  latestTokenStates: TokenRuntimeState[];
}

export declare interface PolymarketDataService {
  on(event: 'discovery', listener: (universe: DailyWeatherUniverse) => void): this;
  on(event: 'market_event', listener: (payload: ShardMarketEvent) => void): this;
  on(event: 'token_state', listener: (payload: TokenRuntimeState) => void): this;
  on(event: 'ws_status', listener: (status: ShardStatusEvent) => void): this;
  on(event: 'price_snapshot', listener: (items: PriceSnapshot[]) => void): this;
  on(event: 'watchlist_books', listener: (items: BookResponseItem[]) => void): this;
  on(event: 'feed_stale', listener: (status: ShardStatusEvent) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
}

interface LocalOrderBookState {
  bids: Map<number, number>;
  asks: Map<number, number>;
}

interface OrderBookSummary {
  bestBid?: number;
  bestBidSize?: number;
  bestAsk?: number;
  bestAskSize?: number;
  bidLevelCount: number;
  askLevelCount: number;
  bidVisibleSize: number;
  askVisibleSize: number;
}

interface OrderBookDelta {
  side: 'BUY' | 'SELL';
  price: number;
  size: number;
}

export class PolymarketDataService extends EventEmitter {
  private readonly gammaClient: GammaDiscoveryClient;
  private readonly clobRestClient: ClobRestClient;
  private readonly wsManager: TokenShardWsManager;
  private readonly discoveryReconcileMs: number;
  private readonly feedStaleMs: number;
  private readonly staleCheckMs: number;

  private running = false;
  private cityConfigs: CityConfig[] = [];
  private universe: DailyWeatherUniverse | null = null;
  private watchlistTokenIds: string[] = [];
  private tokenStates = new Map<string, TokenRuntimeState>();
  private readonly orderBooks = new Map<string, LocalOrderBookState>();
  private lastStaleActionAtByShard = new Map<string, number>();
  private connectingSinceByShard = new Map<string, number>();
  private reconcileTimer?: ReturnType<typeof setInterval>;
  private staleTimer?: ReturnType<typeof setInterval>;

  public constructor(options: PolymarketDataServiceOptions = {}) {
    super();
    this.gammaClient = new GammaDiscoveryClient(options.gamma);
    this.clobRestClient = new ClobRestClient(options.clobRest);
    this.wsManager = new TokenShardWsManager(options.ws);
    this.discoveryReconcileMs =
      options.discoveryReconcileMs ?? DEFAULT_DISCOVERY_RECONCILE_MS;
    this.feedStaleMs = options.feedStaleMs ?? DEFAULT_FEED_STALE_MS;
    this.staleCheckMs = options.staleCheckMs ?? 5_000;
    this.bindWsEvents();
  }

  public setCityConfigs(cityConfigs: CityConfig[]): void {
    this.cityConfigs = [...cityConfigs];
  }

  public setWatchlistTokens(tokenIds: string[]): void {
    this.watchlistTokenIds = uniqueStrings(tokenIds);
  }

  public async start(params: {
    cityConfigs?: CityConfig[];
    watchlistTokenIds?: string[];
  } = {}): Promise<void> {
    if (params.cityConfigs) {
      this.setCityConfigs(params.cityConfigs);
    }
    if (params.watchlistTokenIds) {
      this.setWatchlistTokens(params.watchlistTokenIds);
    }

    if (this.running) {
      return;
    }
    this.running = true;

    const universe = await this.refreshDiscovery();
    this.wsManager.start(universe.tokenIds);

    this.reconcileTimer = setInterval(() => {
      void this.refreshDiscovery().catch((error) => this.emitError(error));
    }, this.discoveryReconcileMs);

    this.staleTimer = setInterval(() => {
      void this.checkFeedHealth().catch((error) => this.emitError(error));
    }, this.staleCheckMs);
  }

  public async stop(): Promise<void> {
    this.running = false;
    this.connectingSinceByShard.clear();
    if (this.reconcileTimer) {
      clearInterval(this.reconcileTimer);
      this.reconcileTimer = undefined;
    }
    if (this.staleTimer) {
      clearInterval(this.staleTimer);
      this.staleTimer = undefined;
    }
    this.wsManager.stop();
  }

  public async refreshDiscovery(): Promise<DailyWeatherUniverse> {
    let universe = await this.gammaClient.discoverDailyWeatherUniverse({
      cityConfigs: this.cityConfigs,
      includeDisabledCities: false,
      active: true,
      closed: false,
    });
    if (universe.tokenIds.length === 0) {
      const fallbackUniverse = await this.gammaClient.discoverDailyWeatherUniverse({
        cityConfigs: this.cityConfigs,
        includeDisabledCities: false,
        active: false,
        closed: false,
      });
      if (fallbackUniverse.tokenIds.length > 0) {
        universe = fallbackUniverse;
      }
    }
    this.universe = universe;
    this.wsManager.setTokenIds(universe.tokenIds);
    this.emit('discovery', universe);
    return universe;
  }

  public async backfillPrices(tokenIds?: string[]): Promise<PriceSnapshot[]> {
    const targetTokenIds = uniqueStrings(tokenIds ?? this.wsManager.getAllTokenIds());
    if (targetTokenIds.length === 0) {
      return [];
    }
    const snapshots = await this.clobRestClient.getTwoSidedPrices(targetTokenIds);
    this.applyPriceSnapshots(snapshots);
    this.emit('price_snapshot', snapshots);
    return snapshots;
  }

  public async backfillShardPrices(shardId: string): Promise<PriceSnapshot[]> {
    const shard = this.wsManager
      .getShardStates()
      .find((item) => item.shardId === shardId);
    if (!shard || shard.tokenIds.length === 0) {
      return [];
    }
    return this.backfillPrices(shard.tokenIds);
  }

  public async fetchWatchlistBooks(): Promise<BookResponseItem[]> {
    const tokenIds = uniqueStrings(this.watchlistTokenIds);
    const books = await this.clobRestClient.getWatchlistBooks(tokenIds);
    this.emit('watchlist_books', books);
    return books;
  }

  public getState(): PolymarketDataServiceState {
    return {
      running: this.running,
      universe: this.universe,
      shardStates: this.wsManager.getShardStates(),
      watchlistTokenIds: [...this.watchlistTokenIds],
      latestTokenStates: Array.from(this.tokenStates.values()),
    };
  }

  private bindWsEvents(): void {
    this.wsManager.on('market_event', (payload) => {
      this.applyWsEvent(payload.event);
      this.emit('market_event', payload);
    });

    this.wsManager.on('status', (status) => {
      if (status.state === 'connecting') {
        if (!this.connectingSinceByShard.has(status.shardId)) {
          this.connectingSinceByShard.set(status.shardId, status.at);
        }
      } else {
        this.connectingSinceByShard.delete(status.shardId);
      }

      this.emit('ws_status', status);
      if (status.state === 'open') {
        void this.backfillShardPrices(status.shardId).catch((error) =>
          this.emitError(error),
        );
      }
    });

    this.wsManager.on('error', (error) => this.emitError(error));
  }

  private applyWsEvent(event: MarketWsMessage): void {
    const eventType = String(event.event_type ?? '').toLowerCase();
    const tokenId = typeof event.asset_id === 'string' ? event.asset_id : undefined;
    if (!tokenId) {
      return;
    }

    const now = Date.now();
    const existing = this.tokenStates.get(tokenId) ?? {
      tokenId,
      updatedAt: now,
    };
    existing.removedBidEdge = undefined;
    existing.removedAskEdge = undefined;
    existing.lastEventType = eventType;
    existing.updatedAt = now;

    if (eventType === 'best_bid_ask') {
      existing.bestBid = toNumberOrUndefined(event.best_bid);
      existing.bestAsk = toNumberOrUndefined(event.best_ask);
      existing.spread = toNumberOrUndefined(event.spread);
    } else if (eventType === 'last_trade_price') {
      this.applyTradeEvent(existing, event, now);
    } else if (eventType === 'price_change') {
      this.applyPriceChangeEvent(tokenId, existing, event, now);
    } else if (eventType === 'book') {
      const applied = this.applyBookEvent(tokenId, existing, event);
      if (!applied) {
        return;
      }
    } else {
      return;
    }

    this.tokenStates.set(tokenId, existing);
    this.emit('token_state', existing);
  }

  private applyTradeEvent(
    existing: TokenRuntimeState,
    event: MarketWsMessage,
    now: number,
  ): void {
    existing.lastTradePrice = toNumberOrUndefined(
      (event as Record<string, unknown>).price ??
        (event as Record<string, unknown>).last_trade_price,
    );
    const side = String((event as Record<string, unknown>).side ?? '').toUpperCase();
    if (side === 'BUY' || side === 'SELL') {
      existing.lastTradeSide = side === 'BUY' ? 'buy' : 'sell';
    }
    const tradeSize = toNumberOrUndefined((event as Record<string, unknown>).size);
    if (tradeSize !== undefined) {
      existing.lastTradeSize = tradeSize;
    }
    existing.lastTradeAt = now;
    this.applyBestBidAskSnapshot(existing, event);
  }

  private applyPriceChangeEvent(
    tokenId: string,
    existing: TokenRuntimeState,
    event: MarketWsMessage,
    now: number,
  ): void {
    const orderBook = this.getOrCreateOrderBook(tokenId);
    const before = this.summarizeOrderBook(orderBook);
    const changes = this.parsePriceChanges((event as Record<string, unknown>).price_changes);

    if (changes.length > 0) {
      this.applyOrderBookDeltas(orderBook, changes);
      const after = this.summarizeOrderBook(orderBook);
      this.applyOrderBookSummary(existing, after);
      existing.removedBidEdge = this.resolveRemovedEdge(before, after, changes, 'BUY', 'price_change');
      existing.removedAskEdge = this.resolveRemovedEdge(before, after, changes, 'SELL', 'price_change');
    } else {
      this.applyBestBidAskSnapshot(existing, event);
    }
    this.applyBestBidAskSnapshot(existing, event);
  }

  private applyBookEvent(
    tokenId: string,
    existing: TokenRuntimeState,
    event: MarketWsMessage,
  ): boolean {
    const bids = this.parseBookLevels((event as Record<string, unknown>).bids);
    const asks = this.parseBookLevels((event as Record<string, unknown>).asks);
    const orderBook = this.getOrCreateOrderBook(tokenId);
    const before = this.summarizeOrderBook(orderBook);
    orderBook.bids = bids;
    orderBook.asks = asks;
    const after = this.summarizeOrderBook(orderBook);

    if (
      after.bestBid === undefined &&
      after.bestAsk === undefined &&
      existing.bestBid === undefined &&
      existing.bestAsk === undefined &&
      existing.bookBestBid === undefined &&
      existing.bookBestAsk === undefined &&
      existing.lastTradePrice === undefined
    ) {
      return false;
    }

    this.applyOrderBookSummary(existing, after);
    existing.removedBidEdge = this.resolveRemovedEdge(before, after, [], 'BUY', 'book');
    existing.removedAskEdge = this.resolveRemovedEdge(before, after, [], 'SELL', 'book');
    return true;
  }

  private getOrCreateOrderBook(tokenId: string): LocalOrderBookState {
    const existing = this.orderBooks.get(tokenId);
    if (existing) {
      return existing;
    }
    const created: LocalOrderBookState = {
      bids: new Map<number, number>(),
      asks: new Map<number, number>(),
    };
    this.orderBooks.set(tokenId, created);
    return created;
  }

  private parseBookLevels(levels: unknown): Map<number, number> {
    const next = new Map<number, number>();
    if (!Array.isArray(levels)) {
      return next;
    }
    for (const level of levels as BookLevel[]) {
      const price = toNumberOrUndefined(level.price);
      const size = toNumberOrUndefined(level.size);
      if (price === undefined || size === undefined || size <= 0) {
        continue;
      }
      next.set(price, size);
    }
    return next;
  }

  private parsePriceChanges(changes: unknown): OrderBookDelta[] {
    if (!Array.isArray(changes)) {
      return [];
    }
    const next: OrderBookDelta[] = [];
    for (const item of changes) {
      if (!item || typeof item !== 'object') {
        continue;
      }
      const price = toNumberOrUndefined((item as Record<string, unknown>).price);
      const size = toNumberOrUndefined((item as Record<string, unknown>).size);
      const side = String((item as Record<string, unknown>).side ?? '').toUpperCase();
      if (price === undefined || size === undefined || (side !== 'BUY' && side !== 'SELL')) {
        continue;
      }
      next.push({
        side: side as OrderBookDelta['side'],
        price,
        size,
      });
    }
    return next;
  }

  private applyOrderBookDeltas(orderBook: LocalOrderBookState, changes: readonly OrderBookDelta[]): void {
    for (const change of changes) {
      const target = change.side === 'BUY' ? orderBook.bids : orderBook.asks;
      if (change.size <= 0) {
        target.delete(change.price);
      } else {
        target.set(change.price, change.size);
      }
    }
  }

  private summarizeOrderBook(orderBook: LocalOrderBookState): OrderBookSummary {
    const bestBid = this.pickBookEdge(orderBook.bids, true);
    const bestAsk = this.pickBookEdge(orderBook.asks, false);
    return {
      bestBid,
      bestBidSize: bestBid !== undefined ? orderBook.bids.get(bestBid) : undefined,
      bestAsk,
      bestAskSize: bestAsk !== undefined ? orderBook.asks.get(bestAsk) : undefined,
      bidLevelCount: orderBook.bids.size,
      askLevelCount: orderBook.asks.size,
      bidVisibleSize: this.sumBookSize(orderBook.bids),
      askVisibleSize: this.sumBookSize(orderBook.asks),
    };
  }

  private pickBookEdge(levels: Map<number, number>, isBid: boolean): number | undefined {
    const iterator = levels.keys();
    let edge = iterator.next().value as number | undefined;
    for (const price of levels.keys()) {
      if (edge === undefined) {
        edge = price;
      } else if (isBid) {
        edge = Math.max(edge, price);
      } else {
        edge = Math.min(edge, price);
      }
    }
    return edge;
  }

  private sumBookSize(levels: Map<number, number>): number {
    let total = 0;
    for (const size of levels.values()) {
      total += size;
    }
    return Number(total.toFixed(6));
  }

  private applyOrderBookSummary(existing: TokenRuntimeState, summary: OrderBookSummary): void {
    existing.bookBestBid = summary.bestBid;
    existing.bookBestAsk = summary.bestAsk;
    existing.bestBid = summary.bestBid;
    existing.bestBidSize = summary.bestBidSize;
    existing.bestAsk = summary.bestAsk;
    existing.bestAskSize = summary.bestAskSize;
    existing.bidLevelCount = summary.bidLevelCount;
    existing.askLevelCount = summary.askLevelCount;
    existing.bidVisibleSize = summary.bidVisibleSize;
    existing.askVisibleSize = summary.askVisibleSize;
    existing.spread =
      summary.bestBid !== undefined && summary.bestAsk !== undefined
        ? Number((summary.bestAsk - summary.bestBid).toFixed(6))
        : undefined;
  }

  private applyBestBidAskSnapshot(existing: TokenRuntimeState, event: MarketWsMessage): void {
    const bestBid = toNumberOrUndefined(event.best_bid);
    const bestAsk = toNumberOrUndefined(event.best_ask);
    if (bestBid !== undefined) {
      existing.bestBid = bestBid;
    }
    if (bestAsk !== undefined) {
      existing.bestAsk = bestAsk;
    }
    if (existing.bestBid !== undefined && existing.bestAsk !== undefined) {
      existing.spread = Number((existing.bestAsk - existing.bestBid).toFixed(6));
    }
  }

  private resolveRemovedEdge(
    before: OrderBookSummary,
    after: OrderBookSummary,
    changes: readonly OrderBookDelta[],
    side: 'BUY' | 'SELL',
    source: OrderBookEdgeSnapshot['source'],
  ): OrderBookEdgeSnapshot | undefined {
    const previousPrice = side === 'BUY' ? before.bestBid : before.bestAsk;
    const previousSize = side === 'BUY' ? before.bestBidSize : before.bestAskSize;
    if (previousPrice === undefined) {
      return undefined;
    }

    const currentPrice = side === 'BUY' ? after.bestBid : after.bestAsk;
    const currentSize = side === 'BUY' ? after.bestBidSize : after.bestAskSize;
    const levelCountAfter = side === 'BUY' ? after.bidLevelCount : after.askLevelCount;
    const visibleSizeAfter = side === 'BUY' ? after.bidVisibleSize : after.askVisibleSize;
    const changeForPreviousEdge = changes.find(
      (change) => change.side === side && Math.abs(change.price - previousPrice) < Number.EPSILON,
    );
    const removedByDelta = changeForPreviousEdge ? changeForPreviousEdge.size <= 0 : false;
    const removedByBook =
      currentPrice === undefined || Math.abs(currentPrice - previousPrice) >= Number.EPSILON;

    if (!removedByDelta && !removedByBook) {
      return undefined;
    }

    return {
      previousPrice,
      previousSize: previousSize ?? null,
      currentPrice: currentPrice ?? null,
      currentSize: currentSize ?? null,
      levelCountAfter,
      visibleSizeAfter,
      source,
    };
  }

  private applyPriceSnapshots(snapshots: PriceSnapshot[]): void {
    for (const snapshot of snapshots) {
      const existing = this.tokenStates.get(snapshot.tokenId) ?? {
        tokenId: snapshot.tokenId,
        updatedAt: snapshot.updatedAt,
      };
      if (snapshot.buyPrice !== undefined) {
        existing.bestBid = snapshot.buyPrice;
      }
      if (snapshot.sellPrice !== undefined) {
        existing.bestAsk = snapshot.sellPrice;
      }
      if (existing.bestBid !== undefined && existing.bestAsk !== undefined) {
        existing.spread = existing.bestAsk - existing.bestBid;
      }
      existing.updatedAt = snapshot.updatedAt;
      existing.lastEventType = 'snapshot';
      this.tokenStates.set(snapshot.tokenId, existing);
      this.emit('token_state', existing);
    }
  }

  private async checkFeedHealth(): Promise<void> {
    if (!this.running) {
      return;
    }

    const now = Date.now();
    const statuses = this.wsManager.getShardStates();
    for (const status of statuses) {
      if (status.state === 'connecting') {
        const startedAt =
          this.connectingSinceByShard.get(status.shardId) ??
          status.connectedAt ??
          now;
        if (now - startedAt > this.feedStaleMs) {
          const lastActionAt = this.lastStaleActionAtByShard.get(status.shardId) ?? 0;
          if (now - lastActionAt >= this.feedStaleMs) {
            this.lastStaleActionAtByShard.set(status.shardId, now);
            this.emit('feed_stale', {
              ...status,
              reason: 'connect-timeout',
              at: now,
            });
            this.wsManager.reconnectShard(status.shardId, 'connect-timeout-reconnect');
          }
        }
        continue;
      }

      if (status.state !== 'open') {
        continue;
      }
      if (!status.lastMessageAt || now - status.lastMessageAt <= this.feedStaleMs) {
        continue;
      }

      const lastActionAt = this.lastStaleActionAtByShard.get(status.shardId) ?? 0;
      if (now - lastActionAt < this.feedStaleMs) {
        continue;
      }

      this.lastStaleActionAtByShard.set(status.shardId, now);
      this.emit('feed_stale', {
        ...status,
        reason: 'no-message-timeout',
        at: now,
      });

      await this.backfillShardPrices(status.shardId);
      this.wsManager.reconnectShard(status.shardId, 'stale-feed-reconnect');
    }
  }

  private emitError(error: unknown): void {
    if (error instanceof Error) {
      this.emit('error', error);
      return;
    }
    this.emit('error', new Error(String(error)));
  }
}
