import {
  DEFAULT_DAILY_WEATHER_SERIES_SUFFIX,
  DEFAULT_GAMMA_BASE_URL,
  DEFAULT_GAMMA_PAGE_SIZE,
  DEFAULT_WEATHER_TAG_ID,
  DEFAULT_WEATHER_TAG_SLUG,
} from './constants';
import { requestJson, toQueryString, uniqueStrings } from './http';
import { buildUndiciDispatcher } from './network';
import type { Dispatcher } from 'undici';
import type {
  CityConfig,
  DailyWeatherUniverse,
  GammaDiscoverInput,
  GammaDiscoveryOptions,
  GammaEvent,
  GammaMarket,
  GammaTag,
  NormalizedEvent,
  NormalizedMarket,
} from './types';

function normalizeSlug(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

const DEGREE = '\u00B0';

const normalizeSpecialTemperatureUnits = (value: string): string =>
  value.replace(/\u2103/g, `${DEGREE}C`).replace(/\u2109/g, `${DEGREE}F`);

const normalizeBrokenTemperatureUnits = (value: string): string =>
  value
    .replace(
      /(?:\u00C2)?(?:\u00B0|\u00BA)\s*([cCfF])(?![a-zA-Z])/g,
      (_, unit: string) => `${DEGREE}${unit.toUpperCase()}`,
    )
    .replace(
      /(?:\u00C2|\uFFFD|\?){1,4}\s*([cCfF])(?![a-zA-Z])/g,
      (_, unit: string) => `${DEGREE}${unit.toUpperCase()}`,
    );

const normalizeTemperatureUnits = (value: string): string =>
  normalizeBrokenTemperatureUnits(normalizeSpecialTemperatureUnits(value))
    .replace(/\s{2,}/g, ' ')
    .trim();

const normalizeOptionalTemperatureText = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  return normalizeTemperatureUnits(value);
};

function parseBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const lowered = value.trim().toLowerCase();
    if (lowered === 'true') {
      return true;
    }
    if (lowered === 'false') {
      return false;
    }
  }
  return fallback;
}

function parseStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).filter((item) => item.length > 0);
  }

  if (typeof value !== 'string') {
    return [];
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed
        .map((item) => String(item))
        .filter((item) => item.length > 0);
    }
  } catch {
    // fallback below
  }

  if (trimmed.includes(',')) {
    return trimmed
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }

  return [trimmed];
}

function pickYesNoTokenIds(outcomes: string[], tokenIds: string[]): {
  yesTokenId?: string;
  noTokenId?: string;
} {
  let yesTokenId: string | undefined;
  let noTokenId: string | undefined;

  if (outcomes.length === tokenIds.length) {
    outcomes.forEach((outcome, index) => {
      const lowered = outcome.trim().toLowerCase();
      if (lowered === 'yes') {
        yesTokenId = tokenIds[index];
      }
      if (lowered === 'no') {
        noTokenId = tokenIds[index];
      }
    });
  }

  if (!yesTokenId && tokenIds.length > 0) {
    yesTokenId = tokenIds[0];
  }
  if (!noTokenId && tokenIds.length > 1) {
    noTokenId = tokenIds[1];
  }

  return { yesTokenId, noTokenId };
}

function deriveEventDate(event: GammaEvent): string {
  const candidate =
    (typeof event.endDate === 'string' && event.endDate) ||
    (typeof event.startDate === 'string' && event.startDate) ||
    '';

  if (candidate) {
    return candidate.slice(0, 10);
  }

  return '';
}

function normalizeMarket(
  event: GammaEvent,
  market: GammaMarket,
  cityKey: string | undefined,
): NormalizedMarket | null {
  const marketId = String(market.id ?? '');
  if (!marketId) {
    return null;
  }

  const tokenIds = uniqueStrings(
    parseStringList(market.clobTokenIds).concat(
      parseStringList((market as Record<string, unknown>).tokenIds),
      parseStringList((market as Record<string, unknown>).outcomeTokenIds),
    ),
  );

  if (tokenIds.length === 0) {
    return null;
  }

  const outcomes = parseStringList(market.outcomes);
  const { yesTokenId, noTokenId } = pickYesNoTokenIds(outcomes, tokenIds);

  return {
    seriesSlug: String(event.seriesSlug ?? ''),
    eventId: String(event.id),
    eventDate: deriveEventDate(event),
    marketId,
    conditionId:
      typeof market.conditionId === 'string' ? market.conditionId : undefined,
    groupItemTitle: normalizeOptionalTemperatureText(market.groupItemTitle),
    question: normalizeOptionalTemperatureText(market.question),
    active: parseBoolean(market.active, true),
    closed: parseBoolean(market.closed, false),
    tokenIds,
    yesTokenId,
    noTokenId,
    outcomes,
    cityKey,
  };
}

export class GammaDiscoveryClient {
  private readonly gammaBaseUrl: string;
  private readonly weatherTagSlug: string;
  private readonly weatherTagId: number;
  private readonly dailyWeatherSeriesSuffix: string;
  private readonly pageSize: number;
  private readonly fetchTimeoutMs: number;
  private readonly dispatcher: Dispatcher | undefined;

  public constructor(options: GammaDiscoveryOptions = {}) {
    this.gammaBaseUrl = options.gammaBaseUrl ?? DEFAULT_GAMMA_BASE_URL;
    this.weatherTagSlug = normalizeSlug(
      options.weatherTagSlug ?? DEFAULT_WEATHER_TAG_SLUG,
    );
    this.weatherTagId = options.weatherTagId ?? DEFAULT_WEATHER_TAG_ID;
    this.dailyWeatherSeriesSuffix =
      options.dailyWeatherSeriesSuffix ?? DEFAULT_DAILY_WEATHER_SERIES_SUFFIX;
    this.pageSize = options.pageSize ?? DEFAULT_GAMMA_PAGE_SIZE;
    this.fetchTimeoutMs = options.fetchTimeoutMs ?? 15_000;
    this.dispatcher = buildUndiciDispatcher(options.proxyUrl);
  }

  public async getTags(): Promise<GammaTag[]> {
    const url = `${this.gammaBaseUrl}/tags`;
    const data = await requestJson<unknown>(url, {
      timeoutMs: this.fetchTimeoutMs,
      dispatcher: this.dispatcher,
    });

    if (!Array.isArray(data)) {
      return [];
    }

    return data
      .filter((item) => item && typeof item === 'object')
      .map((item) => item as GammaTag);
  }

  public async getWeatherTag(): Promise<GammaTag | null> {
    if (this.weatherTagId > 0) {
      return {
        id: this.weatherTagId,
        slug: this.weatherTagSlug,
        label: this.weatherTagSlug,
      };
    }

    try {
      const tags = await this.getTags();
      for (const tag of tags) {
        const slug = normalizeSlug(
          typeof tag.slug === 'string' ? tag.slug : undefined,
        );
        const label = normalizeSlug(
          typeof tag.label === 'string' ? tag.label : undefined,
        );
        if (slug === this.weatherTagSlug || label === this.weatherTagSlug) {
          return tag;
        }
      }
    } catch {
      // fall through to null when tag discovery is unavailable
    }
    return null;
  }

  public async listEventsByTag(
    tagId: number,
    params: { active?: boolean; closed?: boolean } = {},
  ): Promise<GammaEvent[]> {
    const allEvents: GammaEvent[] = [];
    let offset = 0;
    const pageSize = this.pageSize;
    const active = params.active ?? true;
    const closed = params.closed ?? false;

    let hasMore = true;
    while (hasMore) {
      const query = toQueryString({
        tag_id: tagId,
        active,
        closed,
        limit: pageSize,
        offset,
      });
      const url = `${this.gammaBaseUrl}/events?${query}`;
      const page = await requestJson<unknown>(url, {
        timeoutMs: this.fetchTimeoutMs,
        dispatcher: this.dispatcher,
      });

      if (!Array.isArray(page) || page.length === 0) {
        hasMore = false;
        continue;
      }

      for (const item of page) {
        if (item && typeof item === 'object') {
          allEvents.push(item as GammaEvent);
        }
      }

      if (page.length < pageSize) {
        hasMore = false;
        continue;
      }

      offset += pageSize;
    }

    return allEvents;
  }

  public async discoverDailyWeatherUniverse(
    input: GammaDiscoverInput = {},
  ): Promise<DailyWeatherUniverse> {
    const weatherTag = await this.getWeatherTag();
    if (!weatherTag || typeof weatherTag.id !== 'number') {
      return {
        discoveredAt: new Date().toISOString(),
        weatherTagId: null,
        events: [],
        markets: [],
        tokenIds: [],
        eventCount: 0,
        marketCount: 0,
        tokenCount: 0,
      };
    }

    const events = await this.listEventsByTag(weatherTag.id, {
      active: input.active,
      closed: input.closed,
    });

    const includeDisabledCities = input.includeDisabledCities ?? false;
    const cityConfigs = input.cityConfigs ?? [];
    const cityBySeriesSlug = new Map<string, CityConfig>();
    for (const city of cityConfigs) {
      if (!includeDisabledCities && city.enabled === false) {
        continue;
      }
      cityBySeriesSlug.set(normalizeSlug(city.seriesSlug), city);
    }

    const normalizedEvents: NormalizedEvent[] = [];
    const normalizedMarkets: NormalizedMarket[] = [];
    const allTokenIds: string[] = [];

    for (const event of events) {
      const seriesSlug = normalizeSlug(
        typeof event.seriesSlug === 'string' ? event.seriesSlug : undefined,
      );

      if (!seriesSlug.endsWith(this.dailyWeatherSeriesSuffix)) {
        continue;
      }

      let cityConfig: CityConfig | undefined;
      if (cityBySeriesSlug.size > 0) {
        cityConfig = cityBySeriesSlug.get(seriesSlug);
        if (!cityConfig) {
          continue;
        }
      }

      const marketsRaw = Array.isArray(event.markets) ? event.markets : [];
      const eventMarkets: NormalizedMarket[] = [];

      for (const market of marketsRaw) {
        const normalized = normalizeMarket(event, market, cityConfig?.cityKey);
        if (!normalized) {
          continue;
        }
        eventMarkets.push(normalized);
        normalizedMarkets.push(normalized);
        allTokenIds.push(...normalized.tokenIds);
      }

      if (eventMarkets.length === 0) {
        continue;
      }

      normalizedEvents.push({
        eventId: String(event.id),
        seriesSlug,
        cityKey: cityConfig?.cityKey,
        title: normalizeOptionalTemperatureText(event.title),
        eventDate: deriveEventDate(event),
        active: parseBoolean(event.active, true),
        closed: parseBoolean(event.closed, false),
        markets: eventMarkets,
      });
    }

    const tokenIds = uniqueStrings(allTokenIds);
    return {
      discoveredAt: new Date().toISOString(),
      weatherTagId: weatherTag.id,
      events: normalizedEvents,
      markets: normalizedMarkets,
      tokenIds,
      eventCount: normalizedEvents.length,
      marketCount: normalizedMarkets.length,
      tokenCount: tokenIds.length,
    };
  }
}
