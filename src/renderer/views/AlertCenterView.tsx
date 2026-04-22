import { useMemo, useState } from 'react';

import { useI18n } from '../i18n';
import type { AlertEvent, Severity } from '../types/contracts';
import { ALERT_SEVERITY_LABELS, buildAlertPresentation } from '../utils/alert-summary';

interface AlertCenterViewProps {
  alerts: AlertEvent[];
  onAcknowledge: (id: string) => void;
}

const severityOrder: Severity[] = ['critical', 'warning', 'info'];

const pageText = {
  title: '告警中心',
  rowsInFilter: (count: number) => `当前显示 ${count} 条`,
  hint: '只展示能帮助判断影响的信息，优先处理未确认和紧急告警。',
  severity: '告警级别',
  acknowledgement: '确认状态',
  all: '全部',
  allSeverity: '全部级别',
  allAck: '全部状态',
  unackedOnly: '仅看未确认',
  total: '全部告警',
  unacknowledged: '待确认',
  critical: '紧急告警',
  happenedAt: '触发时间',
  target: '影响对象',
  reason: '触发原因',
  empty: '当前筛选下没有告警。',
  acknowledge: '确认告警',
};

export const AlertCenterView = ({ alerts, onAcknowledge }: AlertCenterViewProps) => {
  const { formatDateTime } = useI18n();
  const [severityFilter, setSeverityFilter] = useState<'all' | Severity>('all');
  const [ackFilter, setAckFilter] = useState<'all' | 'unacked'>('all');

  const visibleAlerts = useMemo(
    () =>
      [...alerts]
        .filter((alert) => severityFilter === 'all' || alert.severity === severityFilter)
        .filter((alert) => (ackFilter === 'unacked' ? !alert.acknowledged : true))
        .sort((left, right) => {
          const severityDiff =
            severityOrder.indexOf(left.severity) - severityOrder.indexOf(right.severity);
          if (severityDiff !== 0) {
            return severityDiff;
          }
          return new Date(right.triggeredAt).getTime() - new Date(left.triggeredAt).getTime();
        }),
    [ackFilter, alerts, severityFilter],
  );
  const alertStats = useMemo(
    () => ({
      total: alerts.length,
      unacknowledged: alerts.filter((alert) => !alert.acknowledged).length,
      critical: alerts.filter((alert) => alert.severity === 'critical').length,
    }),
    [alerts],
  );

  return (
    <section className="workspace">
      <section className="panel panel--full">
        <header className="panel__header">
          <div>
            <h2>{pageText.title}</h2>
            <span>{pageText.rowsInFilter(visibleAlerts.length)}</span>
          </div>
        </header>

        <section className="alert-center-panel">
          <div className="alert-center-panel__head">
            <div>
              <h3>先处理关键告警</h3>
              <p>{pageText.hint}</p>
            </div>
            <div className="alert-center-stats">
              <div>
                <span>{pageText.total}</span>
                <strong>{alertStats.total}</strong>
              </div>
              <div>
                <span>{pageText.unacknowledged}</span>
                <strong>{alertStats.unacknowledged}</strong>
              </div>
              <div>
                <span>{pageText.critical}</span>
                <strong>{alertStats.critical}</strong>
              </div>
            </div>
          </div>

          <div className="alert-center-filters">
            <div className="alert-center-filter-group">
              <span>{pageText.severity}</span>
              <div className="alert-center-chip-row">
                {[
                  { value: 'all', label: pageText.allSeverity },
                  { value: 'critical', label: ALERT_SEVERITY_LABELS.critical },
                  { value: 'warning', label: ALERT_SEVERITY_LABELS.warning },
                  { value: 'info', label: ALERT_SEVERITY_LABELS.info },
                ].map((option) => (
                  <button
                    type="button"
                    key={option.value}
                    className={`alert-center-chip ${
                      severityFilter === option.value ? 'is-active' : ''
                    }`}
                    aria-pressed={severityFilter === option.value}
                    onClick={() => setSeverityFilter(option.value as typeof severityFilter)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="alert-center-filter-group">
              <span>{pageText.acknowledgement}</span>
              <div className="alert-center-chip-row">
                {[
                  { value: 'all', label: pageText.allAck },
                  { value: 'unacked', label: pageText.unackedOnly },
                ].map((option) => (
                  <button
                    type="button"
                    key={option.value}
                    className={`alert-center-chip ${ackFilter === option.value ? 'is-active' : ''}`}
                    aria-pressed={ackFilter === option.value}
                    onClick={() => setAckFilter(option.value as typeof ackFilter)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {visibleAlerts.length > 0 ? (
            <div className="alert-center-list">
              {visibleAlerts.map((alert) => {
                const alertPresentation = buildAlertPresentation(alert);

                return (
                  <article
                    key={alert.id}
                    className={`alert-center-card alert-center-card--${alert.severity} ${
                      alert.acknowledged ? 'is-acknowledged' : ''
                    }`}
                  >
                    <div className="alert-center-card__main">
                      <div className="alert-center-card__top">
                        <div>
                          <span className="alert-center-card__label">
                            {pageText.target}
                          </span>
                          <h3>{alertPresentation.title}</h3>
                        </div>
                        <div className="alert-center-card__badges">
                          <span className={`severity severity--${alert.severity}`}>
                            {alertPresentation.severityLabel}
                          </span>
                          <span className="alert-center-card__status">
                            {alertPresentation.acknowledgementLabel}
                          </span>
                        </div>
                      </div>

                      <div className="alert-center-card__reason">
                        <span>{pageText.reason}</span>
                        <strong>{alertPresentation.summary}</strong>
                      </div>

                      {alertPresentation.detail ? (
                        <p className="alert-center-card__detail">{alertPresentation.detail}</p>
                      ) : null}
                    </div>

                    <div className="alert-center-card__side">
                      <div>
                        <span>{pageText.happenedAt}</span>
                        <strong>{formatDateTime(alert.triggeredAt)}</strong>
                      </div>
                      {alert.acknowledged ? null : (
                        <button
                          type="button"
                          className="ghost-button ghost-button--small"
                          onClick={() => onAcknowledge(alert.id)}
                        >
                          {pageText.acknowledge}
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="alert-center-empty">{pageText.empty}</div>
          )}
        </section>
      </section>
    </section>
  );
};
