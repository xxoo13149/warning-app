import { DEFAULT_CLOB_BASE_URL } from './constants';
import { chunkArray, requestJson } from './http';
import { buildUndiciDispatcher } from './network';
import type {
  BookResponseItem,
  ClobRestClientOptions,
  PriceRequest,
  PriceResponseItem,
  PriceSnapshot,
  Side,
} from './types';
import type { Dispatcher } from 'undici';

function normalizeSide(value: string): Side {
  return value.toUpperCase() === 'SELL' ? 'SELL' : 'BUY';
}

function parsePrice(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export class ClobRestClient {
  private readonly clobBaseUrl: string;
  private readonly fetchTimeoutMs: number;
  private readonly maxBatchSize: number;
  private readonly dispatcher: Dispatcher | undefined;

  public constructor(options: ClobRestClientOptions = {}) {
    this.clobBaseUrl = options.clobBaseUrl ?? DEFAULT_CLOB_BASE_URL;
    this.fetchTimeoutMs = options.fetchTimeoutMs ?? 15_000;
    this.maxBatchSize = options.maxBatchSize ?? 500;
    this.dispatcher = buildUndiciDispatcher(options.proxyUrl);
  }

  public async getPrices(requests: PriceRequest[]): Promise<PriceResponseItem[]> {
    if (requests.length === 0) {
      return [];
    }

    const chunks = chunkArray(requests, this.maxBatchSize);
    const result: PriceResponseItem[] = [];

    for (const chunk of chunks) {
      const url = `${this.clobBaseUrl}/prices`;
      const data = await requestJson<unknown>(url, {
        method: 'POST',
        body: chunk,
        timeoutMs: this.fetchTimeoutMs,
        dispatcher: this.dispatcher,
      });

      if (!Array.isArray(data)) {
        continue;
      }

      for (const item of data) {
        if (!item || typeof item !== 'object') {
          continue;
        }
        const candidate = item as PriceResponseItem;
        if (!candidate.token_id || !candidate.side) {
          continue;
        }
        result.push({
          token_id: String(candidate.token_id),
          side: normalizeSide(candidate.side),
          price: String(candidate.price),
        });
      }
    }

    return result;
  }

  public async getTwoSidedPrices(tokenIds: string[]): Promise<PriceSnapshot[]> {
    if (tokenIds.length === 0) {
      return [];
    }

    const requests: PriceRequest[] = [];
    for (const tokenId of tokenIds) {
      requests.push({ token_id: tokenId, side: 'BUY' });
      requests.push({ token_id: tokenId, side: 'SELL' });
    }

    const items = await this.getPrices(requests);
    const byTokenId = new Map<string, PriceSnapshot>();

    for (const item of items) {
      const tokenId = String(item.token_id);
      const price = parsePrice(item.price);
      if (price === undefined) {
        continue;
      }

      const snapshot = byTokenId.get(tokenId) ?? {
        tokenId,
        updatedAt: Date.now(),
      };

      if (item.side === 'BUY') {
        snapshot.buyPrice = price;
      } else {
        snapshot.sellPrice = price;
      }

      snapshot.updatedAt = Date.now();
      byTokenId.set(tokenId, snapshot);
    }

    return Array.from(byTokenId.values());
  }

  public async getBooks(requests: PriceRequest[]): Promise<BookResponseItem[]> {
    if (requests.length === 0) {
      return [];
    }

    const chunks = chunkArray(requests, this.maxBatchSize);
    const result: BookResponseItem[] = [];

    for (const chunk of chunks) {
      const url = `${this.clobBaseUrl}/books`;
      const data = await requestJson<unknown>(url, {
        method: 'POST',
        body: chunk,
        timeoutMs: this.fetchTimeoutMs,
        dispatcher: this.dispatcher,
      });

      if (!Array.isArray(data)) {
        continue;
      }

      for (const item of data) {
        if (!item || typeof item !== 'object') {
          continue;
        }
        const candidate = item as BookResponseItem;
        if (!candidate.asset_id) {
          continue;
        }
        result.push({
          market: String(candidate.market ?? ''),
          asset_id: String(candidate.asset_id),
          hash:
            typeof candidate.hash === 'string' ? candidate.hash : undefined,
          bids: Array.isArray(candidate.bids) ? candidate.bids : [],
          asks: Array.isArray(candidate.asks) ? candidate.asks : [],
          timestamp:
            typeof candidate.timestamp === 'string'
              ? candidate.timestamp
              : undefined,
        });
      }
    }

    return result;
  }

  public async getWatchlistBooks(tokenIds: string[]): Promise<BookResponseItem[]> {
    if (tokenIds.length === 0) {
      return [];
    }

    const requests: PriceRequest[] = [];
    for (const tokenId of tokenIds) {
      requests.push({ token_id: tokenId, side: 'BUY' });
    }
    return this.getBooks(requests);
  }
}
