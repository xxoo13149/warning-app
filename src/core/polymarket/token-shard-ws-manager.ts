import { EventEmitter } from 'node:events';
import WebSocket, { type RawData } from 'ws';
import {
  DEFAULT_CLOB_MARKET_WS_URL,
  DEFAULT_WS_HEARTBEAT_INTERVAL_MS,
  DEFAULT_WS_RECONNECT_BASE_MS,
  DEFAULT_WS_RECONNECT_MAX_MS,
  DEFAULT_WS_TOKENS_PER_SHARD,
} from './constants';
import { chunkArray, uniqueStrings } from './http';
import { buildWsAgent } from './network';
import type {
  MarketWsMessage,
  ShardConnectionState,
  ShardMarketEvent,
  ShardStatusEvent,
  TokenShardState,
  TokenShardWsManagerOptions,
} from './types';

interface ManagedShard {
  shardId: string;
  tokenIds: string[];
  state: ShardConnectionState;
  reconnectAttempt: number;
  reconnectTimer?: ReturnType<typeof setTimeout>;
  heartbeatTimer?: ReturnType<typeof setInterval>;
  websocket: WebSocket | null;
  lastMessageAt: number | null;
  connectedAt: number | null;
  closeRequested: boolean;
}

interface SubscribePayload {
  assets_ids: string[];
  type?: 'market';
  event_type?: 'market';
  operation?: 'subscribe' | 'unsubscribe';
  custom_feature_enabled?: boolean;
}

function stableTokenEquals(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

export declare interface TokenShardWsManager {
  on(event: 'market_event', listener: (payload: ShardMarketEvent) => void): this;
  on(event: 'status', listener: (payload: ShardStatusEvent) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
}

export class TokenShardWsManager extends EventEmitter {
  private readonly marketWsUrl: string;
  private readonly tokensPerShard: number;
  private readonly heartbeatIntervalMs: number;
  private readonly reconnectBaseMs: number;
  private readonly reconnectMaxMs: number;
  private readonly wsAgent: ReturnType<typeof buildWsAgent>;
  private readonly shards = new Map<string, ManagedShard>();
  private running = false;

  public constructor(options: TokenShardWsManagerOptions = {}) {
    super();
    this.marketWsUrl = options.marketWsUrl ?? DEFAULT_CLOB_MARKET_WS_URL;
    this.tokensPerShard = options.tokensPerShard ?? DEFAULT_WS_TOKENS_PER_SHARD;
    this.heartbeatIntervalMs =
      options.heartbeatIntervalMs ?? DEFAULT_WS_HEARTBEAT_INTERVAL_MS;
    this.reconnectBaseMs =
      options.reconnectBaseMs ?? DEFAULT_WS_RECONNECT_BASE_MS;
    this.reconnectMaxMs = options.reconnectMaxMs ?? DEFAULT_WS_RECONNECT_MAX_MS;
    this.wsAgent = buildWsAgent(options.proxyUrl);
  }

  public start(tokenIds: string[]): void {
    if (this.running) {
      this.setTokenIds(tokenIds);
      return;
    }

    this.running = true;
    this.reconcileShards(tokenIds);
  }

  public stop(): void {
    this.running = false;
    for (const shard of this.shards.values()) {
      this.teardownShard(shard, 'manager-stop', false);
    }
    this.shards.clear();
  }

  public setTokenIds(tokenIds: string[]): void {
    if (!this.running) {
      this.start(tokenIds);
      return;
    }

    this.reconcileShards(tokenIds);
  }

  public reconnectShard(shardId: string, reason = 'manual-reconnect'): void {
    const shard = this.shards.get(shardId);
    if (!shard) {
      return;
    }

    this.teardownShard(shard, reason, true);
    this.connectShard(shard);
  }

  public getShardStates(): TokenShardState[] {
    const result: TokenShardState[] = [];
    for (const shard of this.shards.values()) {
      result.push({
        shardId: shard.shardId,
        tokenIds: [...shard.tokenIds],
        state: shard.state,
        reconnectAttempt: shard.reconnectAttempt,
        lastMessageAt: shard.lastMessageAt,
        connectedAt: shard.connectedAt,
      });
    }
    return result;
  }

  public getAllTokenIds(): string[] {
    const all: string[] = [];
    for (const shard of this.shards.values()) {
      all.push(...shard.tokenIds);
    }
    return uniqueStrings(all);
  }

  private reconcileShards(tokenIds: string[]): void {
    const deduped = uniqueStrings(tokenIds);
    const chunks = chunkArray(deduped, this.tokensPerShard);
    const targetIds = new Set<string>();

    for (let index = 0; index < chunks.length; index += 1) {
      const shardId = `shard-${index + 1}`;
      targetIds.add(shardId);
      const nextTokens = chunks[index];
      const existing = this.shards.get(shardId);

      if (!existing) {
        const shard: ManagedShard = {
          shardId,
          tokenIds: nextTokens,
          state: 'idle',
          reconnectAttempt: 0,
          websocket: null,
          lastMessageAt: null,
          connectedAt: null,
          closeRequested: false,
        };
        this.shards.set(shardId, shard);
        this.connectShard(shard);
        continue;
      }

      this.updateShardTokens(existing, nextTokens);
    }

    for (const [shardId, shard] of this.shards.entries()) {
      if (targetIds.has(shardId)) {
        continue;
      }
      this.teardownShard(shard, 'shard-removed', false);
      this.shards.delete(shardId);
    }
  }

  private updateShardTokens(shard: ManagedShard, tokenIds: string[]): void {
    const next = uniqueStrings(tokenIds);
    if (stableTokenEquals(shard.tokenIds, next)) {
      return;
    }

    const previousSet = new Set(shard.tokenIds);
    const nextSet = new Set(next);
    const toUnsubscribe = shard.tokenIds.filter((tokenId) => !nextSet.has(tokenId));
    const toSubscribe = next.filter((tokenId) => !previousSet.has(tokenId));
    shard.tokenIds = next;

    const socket = shard.websocket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    if (toUnsubscribe.length > 0) {
      this.sendSubscription(socket, {
        assets_ids: toUnsubscribe,
        operation: 'unsubscribe',
        custom_feature_enabled: false,
      });
    }

    if (toSubscribe.length > 0) {
      this.sendSubscription(socket, {
        assets_ids: toSubscribe,
        operation: 'subscribe',
        custom_feature_enabled: true,
      });
    }
  }

  private connectShard(shard: ManagedShard): void {
    if (!this.running) {
      return;
    }

    shard.closeRequested = false;
    shard.state = 'connecting';
    this.emitStatus(shard, 'connecting');

    const socket = new WebSocket(
      this.marketWsUrl,
      this.wsAgent ? { agent: this.wsAgent } : undefined,
    );
    shard.websocket = socket;

    socket.on('open', () => {
      shard.state = 'open';
      shard.reconnectAttempt = 0;
      shard.connectedAt = Date.now();
      shard.lastMessageAt = Date.now();
      this.emitStatus(shard, 'open');
      this.sendSubscription(socket, {
        assets_ids: shard.tokenIds,
        operation: 'subscribe',
        custom_feature_enabled: true,
      });
      this.startHeartbeat(shard);
    });

    socket.on('message', (data: RawData) => {
      shard.lastMessageAt = Date.now();
      const text = this.toMessageText(data);
      if (text === 'PONG') {
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return;
      }

      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          this.emitMarketMessage(shard, item);
        }
        return;
      }

      this.emitMarketMessage(shard, parsed);
    });

    socket.on('error', (error) => {
      this.emit(
        'error',
        new Error(`WebSocket error on ${shard.shardId}: ${error.message}`),
      );
    });

    socket.on('close', () => {
      this.stopHeartbeat(shard);
      shard.websocket = null;
      shard.connectedAt = null;

      if (!this.running || shard.closeRequested) {
        shard.state = 'closed';
        this.emitStatus(shard, 'closed', shard.closeRequested ? 'requested' : 'stopped');
        return;
      }

      this.scheduleReconnect(shard, 'socket-close');
    });
  }

  private toMessageText(data: RawData): string {
    if (Array.isArray(data)) {
      return Buffer.concat(data).toString('utf8').trim();
    }

    if (data instanceof ArrayBuffer) {
      return Buffer.from(data).toString('utf8').trim();
    }

    return data.toString('utf8').trim();
  }

  private emitMarketMessage(shard: ManagedShard, payload: unknown): void {
    if (!payload || typeof payload !== 'object') {
      return;
    }

    const event = payload as MarketWsMessage;
    this.emit('market_event', {
      shardId: shard.shardId,
      receivedAt: Date.now(),
      event,
    } satisfies ShardMarketEvent);
  }

  private scheduleReconnect(shard: ManagedShard, reason: string): void {
    if (!this.running) {
      return;
    }

    shard.reconnectAttempt += 1;
    shard.state = 'reconnecting';
    const delay = Math.min(
      this.reconnectBaseMs * 2 ** Math.max(0, shard.reconnectAttempt - 1),
      this.reconnectMaxMs,
    );
    this.emitStatus(shard, 'reconnecting', reason, delay);

    if (shard.reconnectTimer) {
      clearTimeout(shard.reconnectTimer);
    }
    shard.reconnectTimer = setTimeout(() => {
      shard.reconnectTimer = undefined;
      this.connectShard(shard);
    }, delay);
  }

  private emitStatus(
    shard: ManagedShard,
    state: ShardConnectionState,
    reason?: string,
    reconnectInMs?: number,
  ): void {
    this.emit('status', {
      shardId: shard.shardId,
      state,
      reason,
      reconnectAttempt: shard.reconnectAttempt,
      reconnectInMs,
      tokenCount: shard.tokenIds.length,
      at: Date.now(),
    } satisfies ShardStatusEvent);
  }

  private startHeartbeat(shard: ManagedShard): void {
    this.stopHeartbeat(shard);
    if (!shard.websocket) {
      return;
    }

    shard.heartbeatTimer = setInterval(() => {
      if (!shard.websocket || shard.websocket.readyState !== WebSocket.OPEN) {
        return;
      }
      shard.websocket.send('PING');
    }, this.heartbeatIntervalMs);
  }

  private stopHeartbeat(shard: ManagedShard): void {
    if (shard.heartbeatTimer) {
      clearInterval(shard.heartbeatTimer);
      shard.heartbeatTimer = undefined;
    }
  }

  private teardownShard(
    shard: ManagedShard,
    reason: string,
    reconnectAfterClose: boolean,
  ): void {
    if (shard.reconnectTimer) {
      clearTimeout(shard.reconnectTimer);
      shard.reconnectTimer = undefined;
    }
    this.stopHeartbeat(shard);

    const socket = shard.websocket;
    if (!socket) {
      shard.state = 'closed';
      this.emitStatus(shard, 'closed', reason);
      return;
    }

    shard.closeRequested = !reconnectAfterClose;
    shard.state = 'closing';
    this.emitStatus(shard, 'closing', reason);
    try {
      socket.close();
    } catch {
      // ignore close exceptions
    }
  }

  private sendSubscription(socket: WebSocket, payload: SubscribePayload): void {
    if (payload.assets_ids.length === 0) {
      return;
    }

    const message: SubscribePayload = {
      event_type: 'market',
      assets_ids: payload.assets_ids,
      operation: payload.operation ?? 'subscribe',
      custom_feature_enabled: payload.custom_feature_enabled ?? true,
    };

    socket.send(JSON.stringify(message));
  }
}
