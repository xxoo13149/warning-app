import type { AlertEvent, CityBubbleSummary } from '../types/contracts';
import type {
  CityBubbleTooltipSnapshot,
  CityBubbleVisualRow,
} from '../types/bubble-board';

export const BUBBLE_FLASH_WINDOW_MS = 120_000;
export const BUBBLE_SCENE_PADDING = 44;
export const BUBBLE_MIN_RADIUS = 18;
export const BUBBLE_MAX_RADIUS = 56;

interface BubblePointOptions {
  count: number;
  width: number;
  height: number;
  padding?: number;
  seed?: number;
  candidateCount?: number;
}

interface FlashWindowState {
  latestAlertAtMs: number | null;
  flashUntilMs: number | null;
  flashActive: boolean;
}

interface BurstImpulseOptions {
  nodeX: number;
  nodeY: number;
  centerX: number;
  centerY: number;
  radius: number;
  strength: number;
  minKick?: number;
}

interface BubbleRadiusOptions {
  score: number;
  width: number;
  height: number;
  count: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export const stableHash = (value: string): number => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
};

export const createSeededRandom = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
};

export const buildBubbleRadius = ({
  score,
  width,
  height,
  count,
}: BubbleRadiusOptions): number => {
  const normalizedScore = clamp(score, 0, 100) / 100;
  const areaDrivenMax = Math.sqrt((width * height) / Math.max(count, 1)) / 4.2;
  const cap = clamp(areaDrivenMax, BUBBLE_MIN_RADIUS + 8, BUBBLE_MAX_RADIUS);
  return Number(
    (
      BUBBLE_MIN_RADIUS +
      Math.sqrt(normalizedScore) * (cap - BUBBLE_MIN_RADIUS)
    ).toFixed(2),
  );
};

export const generateBubblePoints = ({
  count,
  width,
  height,
  padding = BUBBLE_SCENE_PADDING,
  seed = 1,
  candidateCount = 18,
}: BubblePointOptions): Array<{ x: number; y: number }> => {
  if (count <= 0 || width <= padding * 2 || height <= padding * 2) {
    return [];
  }

  const random = createSeededRandom(seed);
  const points: Array<{ x: number; y: number }> = [];
  const minX = padding;
  const maxX = Math.max(padding, width - padding);
  const minY = padding;
  const maxY = Math.max(padding, height - padding);

  const nextPoint = () => ({
    x: minX + random() * (maxX - minX),
    y: minY + random() * (maxY - minY),
  });

  points.push(nextPoint());

  while (points.length < count) {
    let bestCandidate = nextPoint();
    let bestDistance = -1;

    for (let candidateIndex = 0; candidateIndex < candidateCount; candidateIndex += 1) {
      const candidate = nextPoint();
      let nearestDistance = Number.POSITIVE_INFINITY;
      for (const point of points) {
        const distance = Math.hypot(point.x - candidate.x, point.y - candidate.y);
        if (distance < nearestDistance) {
          nearestDistance = distance;
        }
      }

      const edgeDistance = Math.min(
        candidate.x - minX,
        maxX - candidate.x,
        candidate.y - minY,
        maxY - candidate.y,
      );
      const score = nearestDistance + edgeDistance * 0.18;
      if (score > bestDistance) {
        bestDistance = score;
        bestCandidate = candidate;
      }
    }

    points.push(bestCandidate);
  }

  return points;
};

export const computeFlashWindow = (
  alerts: AlertEvent[],
  cityKey: string,
  nowMs: number,
): FlashWindowState => {
  let latestAlertAtMs: number | null = null;

  for (const alert of alerts) {
    if (alert.cityKey !== cityKey) {
      continue;
    }

    const triggeredAtMs = Date.parse(alert.triggeredAt);
    if (!Number.isFinite(triggeredAtMs)) {
      continue;
    }

    if (latestAlertAtMs === null || triggeredAtMs > latestAlertAtMs) {
      latestAlertAtMs = triggeredAtMs;
    }
  }

  if (latestAlertAtMs === null) {
    return {
      latestAlertAtMs: null,
      flashUntilMs: null,
      flashActive: false,
    };
  }

  const flashUntilMs = latestAlertAtMs + BUBBLE_FLASH_WINDOW_MS;
  return {
    latestAlertAtMs,
    flashUntilMs,
    flashActive: nowMs < flashUntilMs,
  };
};

export const buildTooltipSnapshot = (
  row: CityBubbleSummary,
): CityBubbleTooltipSnapshot => {
  const dominantMarket = row.topMarkets[0];
  return {
    cityName: row.cityName,
    eventDate: row.eventDate,
    temperatureBand: row.dominantTemperatureBand,
    yesPrice: row.dominantYesPrice,
    bestBid: dominantMarket?.bestBid ?? null,
    bestAsk: dominantMarket?.bestAsk ?? null,
    spread: dominantMarket?.spread ?? null,
    change5m: dominantMarket?.change5m ?? 0,
    dominantRuleName: row.dominantRuleName ?? null,
    updatedAt: row.updatedAt,
  };
};

export const buildCityBubbleVisualRows = (
  rows: CityBubbleSummary[],
  alerts: AlertEvent[],
  nowMs: number,
): CityBubbleVisualRow[] =>
  rows.map((row) => {
    const flash = computeFlashWindow(alerts, row.cityKey, nowMs);
    return {
      ...row,
      flashActive: flash.flashActive,
      flashUntil:
        flash.flashUntilMs === null ? null : new Date(flash.flashUntilMs).toISOString(),
      latestAlertAt:
        flash.latestAlertAtMs === null ? null : new Date(flash.latestAlertAtMs).toISOString(),
      ringSeverity: row.cityBubbleSeverity,
      colorSeed: stableHash(row.cityKey),
      tooltipSnapshot: buildTooltipSnapshot(row),
    };
  });

export const pickVisibleBubbleLabels = (
  rows: Array<Pick<CityBubbleVisualRow, 'cityKey'>>,
  limit: number,
  selectedCityKey?: string | null,
  hoveredCityKey?: string | null,
): Set<string> => {
  const labels = new Set<string>();
  rows.slice(0, limit).forEach((row) => labels.add(row.cityKey));
  if (selectedCityKey) {
    labels.add(selectedCityKey);
  }
  if (hoveredCityKey) {
    labels.add(hoveredCityKey);
  }
  return labels;
};

export const computeBurstImpulse = ({
  nodeX,
  nodeY,
  centerX,
  centerY,
  radius,
  strength,
  minKick = 0.045,
}: BurstImpulseOptions): { vx: number; vy: number; affected: boolean } => {
  const dx = nodeX - centerX;
  const dy = nodeY - centerY;
  const distance = Math.hypot(dx, dy);
  if (distance >= radius) {
    return { vx: 0, vy: 0, affected: false };
  }

  const safeDistance = distance > 0.0001 ? distance : 0.0001;
  const weight = 1 - distance / radius;
  const kick = minKick + weight * strength;
  return {
    vx: Number(((dx / safeDistance) * kick).toFixed(4)),
    vy: Number(((dy / safeDistance) * kick).toFixed(4)),
    affected: true,
  };
};

export const deriveBubbleHue = (seed: number): number => {
  const random = createSeededRandom(seed);
  return Math.round(190 + random() * 42);
};
