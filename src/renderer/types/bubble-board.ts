import type { SimulationNodeDatum } from 'd3-force';

import type { CityBubbleSummary } from './contracts';

export interface CityBubbleTooltipSnapshot {
  cityName: string;
  eventDate: string;
  temperatureBand: string;
  yesPrice: number | null;
  bestBid: number | null;
  bestAsk: number | null;
  spread: number | null;
  change5m: number;
  dominantRuleName: string | null;
  updatedAt: string;
}

export interface CityBubbleVisualRow extends CityBubbleSummary {
  flashActive: boolean;
  flashUntil: string | null;
  latestAlertAt: string | null;
  ringSeverity: CityBubbleSummary['cityBubbleSeverity'];
  colorSeed: number;
  tooltipSnapshot: CityBubbleTooltipSnapshot;
}

export interface BubbleRuntimeNode extends SimulationNodeDatum {
  cityKey: string;
  row: CityBubbleVisualRow;
  radius: number;
  homeX: number;
  homeY: number;
  dragOriginX: number;
  dragOriginY: number;
  isDragging: boolean;
}

export interface BubbleBurstState {
  x: number;
  y: number;
  radius: number;
  startedAt: number;
  sourceCityKey?: string | null;
}
