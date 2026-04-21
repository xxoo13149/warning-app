import type { FeedSnapshot, MarketTickSnapshot } from '../state';
import type {
  AlertMessageKey,
  AlertMessageParams,
  AlertMarketSnapshot,
  BuiltinRuleKey,
} from '../../shared/alert-display';

export type AlertMetric = 'price_threshold' | 'price_change_pct' | 'spread_threshold' | 'feed_stale' | 'liquidity_kill';

export type AlertOperator =
  | '>'
  | '>='
  | '<'
  | '<='
  | '=='
  | 'crosses_above'
  | 'crosses_below';

export type AlertSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface AlertScope {
  cityKey?: string;
  seriesSlug?: string;
  eventDate?: string;
  temperatureBand?: string;
  marketId?: string;
  tokenId?: string;
  side?: 'yes' | 'no';
}

export interface QuietHours {
  startMinute: number;
  endMinute: number;
}

export interface AlertRule {
  id: string;
  name: string;
  isBuiltin?: boolean;
  builtinKey?: BuiltinRuleKey;
  enabled: boolean;
  metric: AlertMetric;
  operator: AlertOperator;
  threshold: number;
  windowSec: number;
  cooldownSec: number;
  dedupeWindowSec: number;
  bubbleWeight?: number;
  severity: AlertSeverity;
  soundProfileId?: string;
  scope?: AlertScope;
  quietHours?: QuietHours;
}

export interface AlertTrigger {
  id: string;
  ruleId: string;
  triggeredAt: number;
  builtinKey?: BuiltinRuleKey;
  message: string;
  messageKey?: AlertMessageKey;
  messageParams?: AlertMessageParams;
  marketSnapshot?: AlertMarketSnapshot;
  severity: AlertSeverity;
  dedupeKey: string;
  cityKey?: string;
  eventId?: string;
  marketId?: string;
  tokenId?: string;
}

export interface MarketEvaluationInput extends MarketTickSnapshot {
  eventId?: string;
}

export interface FeedEvaluationInput extends FeedSnapshot {
  cityKey?: string;
  eventId?: string;
  marketId?: string;
  tokenId?: string;
}
