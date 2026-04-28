import { useMemo } from 'react';

import type { MonitorRuntimeIssue } from '../hooks/useMonitorConsole';
import { useI18n } from '../i18n';
import type { AppHealth } from '../types/contracts';

interface TopStatusBarProps {
  health: AppHealth;
  mode: 'live' | 'mock';
  marketTotal: number;
  activeAlerts: number;
  runtimeIssues: MonitorRuntimeIssue[];
  onRefresh: () => void;
}

export const TopStatusBar = ({
  health,
  mode,
  marketTotal,
  activeAlerts,
  runtimeIssues,
  onRefresh,
}: TopStatusBarProps) => {
  const { language } = useI18n();
  const effectiveMode = health.mode === 'degraded' ? 'degraded' : mode;
  const copy =
    language === 'zh-CN'
      ? {
          headline: '天气预警工作台',
          connected: '连接正常',
          disconnected: '连接中断',
          live: '实时监控',
          mock: '模拟演练',
          degraded: '降级运行',
          shards: '运行分片',
          tokens: '订阅标的',
          latency: '响应延迟',
          markets: '监控项',
          alerts: '最新告警',
          lastSync: '最近更新',
          refresh: '刷新数据',
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
          alerts: 'Recent Alerts',
          lastSync: 'Last Sync',
          refresh: 'Refresh',
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
  const primaryRuntimeIssue = runtimeIssues[0] ?? null;

  const statusItems = useMemo(
    () => [
      { label: copy.shards, value: `${health.shardActive}/${health.shardTotal}` },
      { label: copy.tokens, value: String(health.subscribedTokens) },
      {
        label: copy.latency,
        value:
          language === 'zh-CN'
            ? `${Math.round(health.latencyMs)} 毫秒`
            : `${Math.round(health.latencyMs)}ms`,
      },
      { label: copy.markets, value: String(marketTotal) },
      { label: copy.alerts, value: String(activeAlerts) },
      { label: copy.lastSync, value: formatTime(health.lastSyncAt) },
    ],
    [
      activeAlerts,
      copy.alerts,
      copy.lastSync,
      copy.latency,
      copy.markets,
      copy.shards,
      copy.tokens,
      formatTime,
      health,
      language,
      marketTotal,
    ],
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

      {primaryRuntimeIssue ? (
        <div className={`topbar__alert topbar__alert--${primaryRuntimeIssue.tone}`} role="alert">
          <strong>{primaryRuntimeIssue.title}</strong>
          <span>{primaryRuntimeIssue.detail}</span>
          {runtimeIssues.length > 1 ? (
            <em>{`另有 ${runtimeIssues.length - 1} 项问题待处理`}</em>
          ) : null}
        </div>
      ) : null}

      <div className="topbar__actions">
        {language === 'zh-CN' ? (
          <div className="status-chip">
            <span>中文界面</span>
          </div>
        ) : null}
        <button type="button" className="ghost-button" onClick={onRefresh}>
          {copy.refresh}
        </button>
      </div>
    </header>
  );
};
