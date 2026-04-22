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

export const formatMarketCentsLabel = (
  value: number | null | undefined,
  options?: {
    compact?: boolean;
    treatZeroAsUnknown?: boolean;
  },
  language: AppLanguage = 'zh-CN',
) => {
  const formatted = formatMarketCents(value, options);
  if (language !== 'zh-CN') {
    return formatted;
  }

  return formatted.replace(/¢/g, ' 美分');
};

export const formatMarketPercent = (value: number | null | undefined) => {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '--';
  }

  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
};

export const normalizeBandText = (value: string) => normalizeTemperatureBand(value) || value;

export const formatTemperatureBandLabel = (value: string, language: AppLanguage = 'zh-CN') => {
  const normalized = normalizeBandText(value);
  if (language !== 'zh-CN') {
    return normalized;
  }

  return normalized
    .replace(/\bless than\s+/gi, '低于 ')
    .replace(/\bmore than\s+/gi, '高于 ')
    .replace(/\bat least\s+/gi, '不低于 ')
    .replace(/\bat most\s+/gi, '不高于 ')
    .replace(/\bbetween\s+/gi, '')
    .replace(/\bfrom\s+/gi, '')
    .replace(/\s+(?:to|through|and)\s+/gi, ' 至 ')
    .replace(/\s+or\s+(?:higher|above|more)\b/gi, ' 以上')
    .replace(/\s+or\s+(?:lower|below|less)\b/gi, ' 以下')
    .replace(/\babove\s+/gi, '高于 ')
    .replace(/\bbelow\s+/gi, '低于 ')
    .replace(/\bover\s+/gi, '高于 ')
    .replace(/\bunder\s+/gi, '低于 ')
    .replace(/\s*°F\b/gi, ' 华氏度')
    .replace(/\s*°C\b/gi, ' 摄氏度')
    .replace(/\s+/g, ' ')
    .trim();
};

export const shortenTemperatureBand = (value: string, language: AppLanguage) => {
  const normalized = formatTemperatureBandLabel(value, language)
    .replace(/\s+to\s+/gi, '–')
    .replace(/\s+through\s+/gi, '–')
    .replace(/\s+至\s+/g, '–')
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
  const price = formatMarketCentsLabel(
    market.yesPrice,
    {
      compact: true,
      treatZeroAsUnknown: !hasMarketQuoteSignal(market),
    },
    language,
  );

  return `${shortBand} · ${price}`;
};
