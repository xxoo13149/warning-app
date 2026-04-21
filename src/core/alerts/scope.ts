import type { AlertScope, QuietHours } from './types';

export interface ScopeContext {
  cityKey?: string;
  seriesSlug?: string;
  eventDate?: string;
  temperatureBand?: string;
  marketId?: string;
  tokenId?: string;
  side?: 'yes' | 'no';
}

export function matchesScope(scope: AlertScope | undefined, context: ScopeContext): boolean {
  if (!scope) {
    return true;
  }

  if (scope.cityKey && scope.cityKey !== context.cityKey) {
    return false;
  }
  if (scope.seriesSlug && scope.seriesSlug !== context.seriesSlug) {
    return false;
  }
  if (scope.eventDate && scope.eventDate !== context.eventDate) {
    return false;
  }
  if (scope.temperatureBand && scope.temperatureBand !== context.temperatureBand) {
    return false;
  }
  if (scope.marketId && scope.marketId !== context.marketId) {
    return false;
  }
  if (scope.tokenId && scope.tokenId !== context.tokenId) {
    return false;
  }
  if (scope.side && scope.side !== context.side) {
    return false;
  }

  return true;
}

export function isInQuietHours(
  quietHours: QuietHours | undefined,
  timestampMs: number,
  timezoneOffsetMinutes = new Date(timestampMs).getTimezoneOffset(),
): boolean {
  if (!quietHours) {
    return false;
  }

  const localMinutes = getMinuteOfDay(timestampMs, timezoneOffsetMinutes);
  const start = clampMinute(quietHours.startMinute);
  const end = clampMinute(quietHours.endMinute);

  if (start === end) {
    return true;
  }

  if (start < end) {
    return localMinutes >= start && localMinutes < end;
  }

  return localMinutes >= start || localMinutes < end;
}

function getMinuteOfDay(timestampMs: number, timezoneOffsetMinutes: number): number {
  const localTimestamp = timestampMs - timezoneOffsetMinutes * 60 * 1000;
  const date = new Date(localTimestamp);
  return date.getUTCHours() * 60 + date.getUTCMinutes();
}

function clampMinute(minute: number): number {
  if (minute < 0) {
    return 0;
  }
  if (minute > 1439) {
    return 1439;
  }
  return minute;
}
