import type { AppLanguage, MarketRow } from '../types/contracts';
import { normalizeTemperatureBand } from './temperature';

const CENT = '\u00A2';

type QuoteFields = Pick<MarketRow, 'yesPrice' | 'bestBid' | 'bestAsk' | 'noPrice' | 'spread'>;

const trimTrailingZero = (value: string) => value.replace(/\.0$/, '');

export const hasMarketQuoteSignal = (market: Partial<QuoteFields> | null | undefined) => {
  if (!market) {
    return false;
  }

  return [market.yesPrice, market.bestBid, market.bestAsk, market.noPrice, market.spread].some(
    (value) => typeof value === 'number' && Number.isFinite(value) && value > 0,
  );
};

export const formatMarketCents = (
  value: number | null | undefined,
  options?: {
    compact?: boolean;
    treatZeroAsUnknown?: boolean;
  },
) => {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '--';
  }

  if (options?.treatZeroAsUnknown && value <= 0) {
    return '--';
  }

  if (value <= 0) {
    return `0${CENT}`;
  }

  const cents = value * 100;
  if (cents < 1) {
    return options?.compact ? `<1${CENT}` : `${trimTrailingZero(cents.toFixed(1))}${CENT}`;
  }

  if (cents < 10) {
    return `${trimTrailingZero(cents.toFixed(1))}${CENT}`;
  }

  return `${Math.round(cents)}${CENT}`;
};

export const formatMarketPercent = (value: number | null | undefined) => {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '--';
  }

  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
};

export const normalizeBandText = (value: string) => normalizeTemperatureBand(value) || value;

export const shortenTemperatureBand = (value: string, language: AppLanguage) => {
  const normalized = normalizeBandText(value)
    .replace(/\s+to\s+/gi, '–')
    .replace(/\s+through\s+/gi, '–')
    .replace(/\s+or higher/gi, '+')
    .replace(/\s+or lower/gi, '-')
    .replace(/\s+/g, ' ')
    .trim();

  if (normalized.length <= 18) {
    return normalized;
  }

  if (language === 'zh-CN') {
    return normalized
      .replace(/以上/g, '+')
      .replace(/以下/g, '-')
      .replace(/\s+/g, '')
      .slice(0, 18);
  }

  return normalized.slice(0, 18);
};

export const buildBubbleSecondaryLabel = (
  market: Pick<MarketRow, 'temperatureBand' | 'yesPrice' | 'bestBid' | 'bestAsk' | 'noPrice' | 'spread'>,
  language: AppLanguage,
) => {
  const shortBand = shortenTemperatureBand(market.temperatureBand, language);
  const price = formatMarketCents(market.yesPrice, {
    compact: true,
    treatZeroAsUnknown: !hasMarketQuoteSignal(market),
  });

  return `${shortBand} · ${price}`;
};
