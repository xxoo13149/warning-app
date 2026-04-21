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
  CityConfig,
  DailyWeatherUniverse,
  MarketWsMessage,
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

    const existing = this.tokenStates.get(tokenId) ?? {
      tokenId,
      updatedAt: Date.now(),
    };
    existing.lastEventType = eventType;
    existing.updatedAt = Date.now();

    if (eventType === 'best_bid_ask') {
      existing.bestBid = toNumberOrUndefined(event.best_bid);
      existing.bestAsk = toNumberOrUndefined(event.best_ask);
      existing.spread = toNumberOrUndefined(event.spread);
    } else if (eventType === 'last_trade_price' || eventType === 'price_change') {
      existing.lastTradePrice = toNumberOrUndefined(
        (event as Record<string, unknown>).price ??
          (event as Record<string, unknown>).last_trade_price,
      );

      const bestBid = toNumberOrUndefined(event.best_bid);
      const bestAsk = toNumberOrUndefined(event.best_ask);
      if (bestBid !== undefined) {
        existing.bestBid = bestBid;
      }
      if (bestAsk !== undefined) {
        existing.bestAsk = bestAsk;
      }
      if (existing.bestBid !== undefined && existing.bestAsk !== undefined) {
        existing.spread = existing.bestAsk - existing.bestBid;
      }
    } else if (eventType === 'book') {
      const bids = (event as Record<string, unknown>).bids;
      const asks = (event as Record<string, unknown>).asks;
      existing.bookBestBid = this.pickBookEdge(bids, true);
      existing.bookBestAsk = this.pickBookEdge(asks, false);
    }

    this.tokenStates.set(tokenId, existing);
    this.emit('token_state', existing);
  }

  private pickBookEdge(levels: unknown, isBid: boolean): number | undefined {
    if (!Array.isArray(levels) || levels.length === 0) {
      return undefined;
    }
    let edge: number | undefined;

    for (const level of levels) {
      if (!level || typeof level !== 'object') {
        continue;
      }
      const price = toNumberOrUndefined((level as Record<string, unknown>).price);
      if (price === undefined) {
        continue;
      }
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
