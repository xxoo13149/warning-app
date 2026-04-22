import { memo, startTransition, useDeferredValue, useEffect, useState } from 'react';

import { useI18n } from '../i18n';
import type { AppLanguage, MarketQuery, MarketRow } from '../types/contracts';
import {
  formatMarketCentsLabel,
  formatMarketPercent,
  formatTemperatureBandLabel,
  hasMarketQuoteSignal,
} from '../utils/market-display';

interface MarketExplorerViewProps {
  rows: MarketRow[];
  total: number;
  query: MarketQuery;
  onQueryChange: (next: Partial<MarketQuery>) => void;
  onRefresh: () => void;
}

interface MarketExplorerRowProps {
  row: MarketRow;
  formatTime: (value: string) => string;
  language: AppLanguage;
}

const MarketExplorerRow = memo(({ row, formatTime, language }: MarketExplorerRowProps) => {
  const spreadClass = (row.spread ?? 0) >= 0.05 ? 'value-down' : '';
  const changeClass = row.change5m >= 0 ? 'value-up' : 'value-down';
  const hasQuotes = hasMarketQuoteSignal(row);

  return (
    <tr>
      <td>{row.cityName}</td>
      <td>{row.eventDate}</td>
      <td>{formatTemperatureBandLabel(row.temperatureBand, language)}</td>
      <td>{formatMarketCentsLabel(row.yesPrice, { treatZeroAsUnknown: !hasQuotes }, language)}</td>
      <td>{formatMarketCentsLabel(row.bestBid, { treatZeroAsUnknown: !hasQuotes }, language)}</td>
      <td>{formatMarketCentsLabel(row.bestAsk, { treatZeroAsUnknown: !hasQuotes }, language)}</td>
      <td className={spreadClass}>
        {formatMarketCentsLabel(row.spread, { treatZeroAsUnknown: !hasQuotes }, language)}
      </td>
      <td className={changeClass}>{formatMarketPercent(row.change5m)}</td>
      <td>{formatTime(row.updatedAt)}</td>
    </tr>
  );
});

export const MarketExplorerView = ({
  rows,
  total,
  query,
  onQueryChange,
  onRefresh,
}: MarketExplorerViewProps) => {
  const { copy, formatTime, language, sortByLabel } = useI18n();
  const [cityKey, setCityKey] = useState(query.cityKey ?? '');
  const [eventDate, setEventDate] = useState(query.eventDate ?? '');
  const [watchlistOnly, setWatchlistOnly] = useState(Boolean(query.watchlistedOnly));

  const deferredCityKey = useDeferredValue(cityKey);

  useEffect(() => {
    startTransition(() => {
      onQueryChange({
        cityKey: deferredCityKey.trim().toLowerCase() || undefined,
      });
    });
  }, [deferredCityKey, onQueryChange]);

  useEffect(() => {
    onQueryChange({
      eventDate: eventDate || undefined,
      watchlistedOnly: watchlistOnly || undefined,
    });
  }, [eventDate, onQueryChange, watchlistOnly]);

  return (
    <section className="workspace">
      <section className="panel panel--full">
        <header className="panel__header panel__header--space-between">
          <div>
            <h2>{copy.explorer.title}</h2>
            <p>{copy.explorer.summary(rows.length, total)}</p>
          </div>
          <button type="button" className="ghost-button" onClick={onRefresh}>
            {copy.explorer.requery}
          </button>
        </header>

        <div className="filter-row filter-row--tight">
          <label className="field field--grow">
            <span>{copy.explorer.cityKey}</span>
            <input
              value={cityKey}
              onChange={(event) => setCityKey(event.target.value)}
              placeholder={copy.explorer.cityPlaceholder}
            />
          </label>

          <label className="field">
            <span>{copy.explorer.eventDate}</span>
            <input
              type="date"
              value={eventDate}
              onChange={(event) => setEventDate(event.target.value)}
            />
          </label>

          <label className="field field--small">
            <span>{copy.explorer.sortBy}</span>
            <select
              value={query.sortBy ?? 'volume24h'}
              onChange={(event) =>
                onQueryChange({
                  sortBy: event.target.value as MarketQuery['sortBy'],
                })
              }
            >
              <option value="volume24h">{sortByLabel('volume24h')}</option>
              <option value="change5m">{sortByLabel('change5m')}</option>
              <option value="spread">{sortByLabel('spread')}</option>
              <option value="updatedAt">{sortByLabel('updatedAt')}</option>
            </select>
          </label>

          <label className="field field--small">
            <span>{copy.explorer.order}</span>
            <select
              value={query.sortDir ?? 'desc'}
              onChange={(event) =>
                onQueryChange({
                  sortDir: event.target.value as MarketQuery['sortDir'],
                })
              }
            >
              <option value="desc">{copy.explorer.desc}</option>
              <option value="asc">{copy.explorer.asc}</option>
            </select>
          </label>

          <label className="field field--checkbox">
            <input
              type="checkbox"
              checked={watchlistOnly}
              onChange={(event) => setWatchlistOnly(event.target.checked)}
            />
            <span>{copy.explorer.watchlistOnly}</span>
          </label>
        </div>

        <div className="table-wrapper">
          <table className="dense-table dense-table--scrollable">
            <thead>
              <tr>
                <th>{copy.common.city}</th>
                <th>{copy.common.date}</th>
                <th>{copy.dashboard.temperatureBand}</th>
                <th>{copy.dashboard.yesPrice}</th>
                <th>{copy.dashboard.bid}</th>
                <th>{copy.dashboard.ask}</th>
                <th>{copy.dashboard.spread}</th>
                <th>{copy.dashboard.change5m}</th>
                <th>{copy.common.updated}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <MarketExplorerRow
                  key={row.marketId}
                  row={row}
                  formatTime={formatTime}
                  language={language}
                />
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
};
