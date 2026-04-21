import { useMemo } from 'react';

import { useI18n } from '../i18n';
import type { AppHealth } from '../types/contracts';

interface TopStatusBarProps {
  health: AppHealth;
  mode: 'live' | 'mock';
  marketTotal: number;
  activeAlerts: number;
  onRefresh: () => void;
}

export const TopStatusBar = ({
  health,
  mode,
  marketTotal,
  activeAlerts,
  onRefresh,
}: TopStatusBarProps) => {
  const { language, setLanguage } = useI18n();
  const effectiveMode = health.mode === 'degraded' ? 'degraded' : mode;
  const copy =
    language === 'zh-CN'
      ? {
          headline: '天气盘口监控台',
          connected: '已连接',
          disconnected: '未连接',
          live: '实时',
          mock: '模拟',
          degraded: '降级',
          shards: '分片',
          tokens: 'Token',
          latency: '延迟',
          markets: '盘口',
          alerts: '未确认告警',
          lastSync: '最近同步',
          language: '语言',
          refresh: '刷新',
          zh: '中文',
        }
      : {
          headline: 'Weather Market Monitor',
          connected: 'Connected',
          disconnected: 'Disconnected',
          live: 'Live',
          mock: 'Mock',
          degraded: 'Degraded',
          shards: 'Shards',
          tokens: 'Tokens',
          latency: 'Latency',
          markets: 'Markets',
          alerts: 'Unacked Alerts',
          lastSync: 'Last Sync',
          language: 'Language',
          refresh: 'Refresh',
          zh: '中文',
        };

  const formatTime = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return '--';
    }
    return new Intl.DateTimeFormat(language, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(date);
  };

  const modeLabel =
    effectiveMode === 'live' ? copy.live : effectiveMode === 'mock' ? copy.mock : copy.degraded;

  const statusItems = useMemo(
    () => [
      { label: copy.shards, value: `${health.shardActive}/${health.shardTotal}` },
      { label: copy.tokens, value: String(health.subscribedTokens) },
      { label: copy.latency, value: `${Math.round(health.latencyMs)}ms` },
      { label: copy.markets, value: String(marketTotal) },
      { label: copy.alerts, value: String(activeAlerts) },
      { label: copy.lastSync, value: formatTime(health.lastSyncAt) },
    ],
    [activeAlerts, copy.alerts, copy.lastSync, copy.latency, copy.markets, copy.shards, copy.tokens, formatTime, health, marketTotal],
  );

  return (
    <header className="topbar">
      <div className="topbar__headline">
        <div>
          <p className="topbar__label">{copy.headline}</p>
          <p className="topbar__meta">
            {health.connected ? copy.connected : copy.disconnected}
          </p>
        </div>
        <div className="topbar__mode">
          <span className={`status-dot ${health.connected ? 'status-dot--ok' : 'status-dot--warn'}`} />
          <span>{modeLabel}</span>
        </div>
      </div>

      <div className="topbar__grid">
        {statusItems.map((item) => (
          <div className="topbar__metric" key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </div>
        ))}
      </div>

      <div className="topbar__actions">
        <div className="language-toggle" role="group" aria-label={copy.language}>
          <button
            type="button"
            className={
              language === 'zh-CN'
                ? 'language-toggle__button language-toggle__button--active'
                : 'language-toggle__button'
            }
            onClick={() => setLanguage('zh-CN')}
          >
            {copy.zh}
          </button>
          <button
            type="button"
            className={
              language === 'en-US'
                ? 'language-toggle__button language-toggle__button--active'
                : 'language-toggle__button'
            }
            onClick={() => setLanguage('en-US')}
          >
            EN
          </button>
        </div>
        <button type="button" className="ghost-button" onClick={onRefresh}>
          {copy.refresh}
        </button>
      </div>
    </header>
  );
};
