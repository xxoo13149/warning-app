import { useMemo, useState } from 'react';

import { useI18n } from '../i18n';
import type { AlertEvent, Severity } from '../types/contracts';
import { formatMarketCents, formatMarketPercent, normalizeBandText } from '../utils/market-display';

interface AlertCenterViewProps {
  alerts: AlertEvent[];
  onAcknowledge: (id: string) => void;
}

const severityOrder: Severity[] = ['critical', 'warning', 'info'];

export const AlertCenterView = ({ alerts, onAcknowledge }: AlertCenterViewProps) => {
  const { copy, formatDateTime, severityLabel, builtinRuleName } = useI18n();
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

  return (
    <section className="workspace">
      <section className="panel panel--full">
        <header className="panel__header">
          <div>
            <h2>{copy.alerts.title}</h2>
            <span>{copy.alerts.rowsInFilter(visibleAlerts.length)}</span>
          </div>
        </header>

        <div className="filter-row">
          <label className="field field--small">
            <span>{copy.alerts.severity}</span>
            <select
              value={severityFilter}
              onChange={(event) => setSeverityFilter(event.target.value as typeof severityFilter)}
            >
              <option value="all">{copy.common.all}</option>
              <option value="critical">{severityLabel('critical')}</option>
              <option value="warning">{severityLabel('warning')}</option>
              <option value="info">{severityLabel('info')}</option>
            </select>
          </label>

          <label className="field field--small">
            <span>{copy.alerts.acknowledgement}</span>
            <select
              value={ackFilter}
              onChange={(event) => setAckFilter(event.target.value as typeof ackFilter)}
            >
              <option value="all">{copy.common.all}</option>
              <option value="unacked">{copy.alerts.unackedOnly}</option>
            </select>
          </label>
        </div>

        <div className="table-wrapper table-wrapper--alerts">
          <table className="dense-table dense-table--scrollable dense-table--alerts">
            <thead>
              <tr>
                <th>{copy.common.time}</th>
                <th>{copy.common.city}</th>
                <th>{copy.alerts.rule}</th>
                <th>{copy.common.message}</th>
                <th>{copy.common.severity}</th>
                <th>{copy.common.acknowledgement}</th>
              </tr>
            </thead>
            <tbody>
              {visibleAlerts.map((alert) => {
                const ruleLabel =
                  builtinRuleName(alert.builtinKey, true) || alert.ruleId || copy.common.rule;
                const snapshot = alert.marketSnapshot;

                return (
                  <tr key={alert.id}>
                    <td>{formatDateTime(alert.triggeredAt)}</td>
                    <td>{snapshot?.cityName ?? alert.cityKey ?? '--'}</td>
                    <td>{ruleLabel}</td>
                    <td className="table-cell table-cell--message">
                      <div className="table-cell__content">
                        <p className="alert-center__summary">{alert.message}</p>
                        {snapshot ? (
                          <p className="alert-center__detail">
                            {normalizeBandText(snapshot.temperatureBand ?? '--')} ·{' '}
                            {copy.dashboard.yesPrice}{' '}
                            {formatMarketCents(snapshot.yesPrice, {
                              treatZeroAsUnknown:
                                !snapshot.yesPrice &&
                                !snapshot.bestBid &&
                                !snapshot.bestAsk &&
                                !snapshot.spread,
                            })}{' '}
                            · {copy.dashboard.spread}{' '}
                            {formatMarketCents(snapshot.spread, {
                              treatZeroAsUnknown:
                                !snapshot.yesPrice &&
                                !snapshot.bestBid &&
                                !snapshot.bestAsk &&
                                !snapshot.spread,
                            })}{' '}
                            · 5m {formatMarketPercent(snapshot.change5m)}
                          </p>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      <span className={`severity severity--${alert.severity}`}>
                        {severityLabel(alert.severity)}
                      </span>
                    </td>
                    <td>
                      {alert.acknowledged ? (
                        <span className="status-text">{copy.alerts.acknowledged}</span>
                      ) : (
                        <button
                          type="button"
                          className="ghost-button ghost-button--small"
                          onClick={() => onAcknowledge(alert.id)}
                        >
                          {copy.alerts.acknowledge}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
};
