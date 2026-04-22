import { memo, startTransition, useDeferredValue, useEffect, useMemo, useState } from 'react';

import { useI18n } from '../i18n';
import { cn } from '../lib/tailwind-utils';
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
  selected: boolean;
  onSelect: (marketId: string) => void;
}

interface MarketBandProps {
  row: MarketRow;
  formatTime: (value: string) => string;
  language: AppLanguage;
  selected: boolean;
  onSelect: (marketId: string) => void;
}

type MarketExplorerMode = 'overview' | 'precise';

const MARKET_STATUS_LABELS: Record<MarketRow['status'], string> = {
  active: '交易中',
  halted: '已暂停',
  resolved: '已结算',
};

const MARKET_SEVERITY_LABELS: Record<MarketRow['bubbleSeverity'], string> = {
  none: '稳定',
  info: '提示',
  warning: '预警',
  critical: '高风险',
};

const DEFAULT_SORT_BY: NonNullable<MarketQuery['sortBy']> = 'volume24h';
const DEFAULT_SORT_DIR: NonNullable<MarketQuery['sortDir']> = 'desc';

const marketHasWideSpread = (row: MarketRow) => (row.spread ?? 0) >= 0.05;

const getMarketBandClassName = (row: MarketRow, selected: boolean) =>
  cn(
    'market-band',
    `market-band--${row.bubbleSeverity}`,
    marketHasWideSpread(row) && 'market-band--wide-spread',
    selected && 'is-selected',
  );

const getMarketRowClassName = (selected: boolean) =>
  cn('market-table-row', selected && 'is-selected');

const groupMarketsByCity = (rows: MarketRow[]) => {
  const groups = new Map<string, { key: string; cityName: string; rows: MarketRow[] }>();

  rows.forEach((row) => {
    const key = row.cityKey || row.cityName;
    const current = groups.get(key);
    if (current) {
      current.rows.push(row);
      return;
    }

    groups.set(key, {
      key,
      cityName: row.cityName || row.cityKey,
      rows: [row],
    });
  });

  return [...groups.values()];
};

const MarketExplorerRow = memo(
  ({ row, formatTime, language, selected, onSelect }: MarketExplorerRowProps) => {
    const spreadClass = marketHasWideSpread(row) ? 'value-down' : '';
    const changeClass = row.change5m >= 0 ? 'value-up' : 'value-down';
    const hasQuotes = hasMarketQuoteSignal(row);

    return (
      <tr className={getMarketRowClassName(selected)} onClick={() => onSelect(row.marketId)}>
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
  },
);

const MarketBand = memo(
  ({ row, formatTime, language, selected, onSelect }: MarketBandProps) => {
    const hasQuotes = hasMarketQuoteSignal(row);
    const changeClass = row.change5m >= 0 ? 'value-up' : 'value-down';

    return (
      <button
        type="button"
        className={getMarketBandClassName(row, selected)}
        onClick={() => onSelect(row.marketId)}
      >
        <span className="market-band__accent" />
        <span className="market-band__head">
          <strong>{formatTemperatureBandLabel(row.temperatureBand, language)}</strong>
          <span>{MARKET_SEVERITY_LABELS[row.bubbleSeverity]}</span>
        </span>
        <span className="market-band__meta">
          {row.airportCode} · {row.eventDate} · {MARKET_STATUS_LABELS[row.status]}
        </span>
        <span className="market-band__price">
          {formatMarketCentsLabel(row.yesPrice, { treatZeroAsUnknown: !hasQuotes }, language)}
        </span>
        <span className="market-band__metrics">
          <span>
            <em>价差</em>
            <strong className={marketHasWideSpread(row) ? 'value-down' : undefined}>
              {formatMarketCentsLabel(row.spread, { treatZeroAsUnknown: !hasQuotes }, language)}
            </strong>
          </span>
          <span>
            <em>5分钟</em>
            <strong className={changeClass}>{formatMarketPercent(row.change5m)}</strong>
          </span>
          <span>
            <em>更新</em>
            <strong>{formatTime(row.updatedAt)}</strong>
          </span>
        </span>
        <span className="market-band__badges">
          {row.watchlisted ? <span>已关注</span> : null}
          {marketHasWideSpread(row) ? <span>价差偏高</span> : null}
        </span>
      </button>
    );
  },
);

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
  const [viewMode, setViewMode] = useState<MarketExplorerMode>('overview');
  const [selectedMarketId, setSelectedMarketId] = useState<string | null>(null);

  const deferredCityKey = useDeferredValue(cityKey);
  const cityGroups = useMemo(() => groupMarketsByCity(rows), [rows]);
  const selectedMarket = useMemo(
    () => rows.find((row) => row.marketId === selectedMarketId) ?? rows[0] ?? null,
    [rows, selectedMarketId],
  );
  const selectedMarketHasQuotes = hasMarketQuoteSignal(selectedMarket);
  const visibleCityCount = cityGroups.length;
  const watchlistedCount = rows.filter((row) => row.watchlisted).length;
  const riskCount = rows.filter(
    (row) => row.bubbleSeverity === 'critical' || row.bubbleSeverity === 'warning',
  ).length;
  const activeFilterLabels = [
    cityKey.trim() ? `城市：${cityKey.trim()}` : '城市：全部',
    eventDate ? `日期：${eventDate}` : '日期：全部',
    watchlistOnly ? '仅关注盘口' : '全部盘口',
    `排序：${sortByLabel(query.sortBy ?? DEFAULT_SORT_BY)} / ${
      (query.sortDir ?? DEFAULT_SORT_DIR) === 'desc' ? '降序' : '升序'
    }`,
  ];

  useEffect(() => {
    setCityKey(query.cityKey ?? '');
  }, [query.cityKey]);

  useEffect(() => {
    setEventDate(query.eventDate ?? '');
  }, [query.eventDate]);

  useEffect(() => {
    setWatchlistOnly(Boolean(query.watchlistedOnly));
  }, [query.watchlistedOnly]);

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

  useEffect(() => {
    if (rows.length === 0) {
      setSelectedMarketId(null);
      return;
    }

    if (!selectedMarketId || !rows.some((row) => row.marketId === selectedMarketId)) {
      setSelectedMarketId(rows[0].marketId);
    }
  }, [rows, selectedMarketId]);

  const clearFilters = () => {
    setCityKey('');
    setEventDate('');
    setWatchlistOnly(false);
    onQueryChange({
      cityKey: undefined,
      eventDate: undefined,
      watchlistedOnly: undefined,
    });
  };

  const focusSelectedCity = () => {
    if (!selectedMarket) {
      return;
    }

    setCityKey(selectedMarket.cityKey);
    setEventDate(selectedMarket.eventDate);
  };

  return (
    <section className="workspace market-explorer-workspace">
      <section className="panel panel--full market-explorer-shell">
        <header className="panel__header panel__header--stacked market-explorer-shell__header">
          <div>
            <h2>市场总览</h2>
            <span>先按城市和温度区间定位重点盘口，再进入单个市场细节。</span>
          </div>
          <div className="market-explorer-shell__actions">
            <button type="button" className="ghost-button" onClick={clearFilters}>
              清空筛选
            </button>
            <button type="button" className="ghost-button" onClick={onRefresh}>
              {copy.explorer.requery}
            </button>
          </div>
        </header>

        <div className="market-explorer-toolbar">
          <div className="market-explorer-filters">
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
                value={query.sortBy ?? DEFAULT_SORT_BY}
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
                value={query.sortDir ?? DEFAULT_SORT_DIR}
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

          <div className="market-explorer-toolbar__footer">
            <div className="market-explorer-filter-tags">
              {activeFilterLabels.map((label) => (
                <span key={label}>{label}</span>
              ))}
              <span>{copy.explorer.summary(rows.length, total)}</span>
            </div>
            <div className="market-explorer-view-toggle" role="group" aria-label="视图模式">
              <button
                type="button"
                className={viewMode === 'overview' ? 'is-active' : undefined}
                onClick={() => setViewMode('overview')}
              >
                总览模式
              </button>
              <button
                type="button"
                className={viewMode === 'precise' ? 'is-active' : undefined}
                onClick={() => setViewMode('precise')}
              >
                精确模式
              </button>
            </div>
          </div>
        </div>

        <div className="market-explorer-body">
          <main className="market-explorer-main">
            <div className="market-explorer-summary">
              <div>
                <span>当前结果</span>
                <strong>{rows.length}</strong>
                <em>共 {total} 个盘口</em>
              </div>
              <div>
                <span>覆盖城市</span>
                <strong>{visibleCityCount}</strong>
                <em>按城市分组展示</em>
              </div>
              <div>
                <span>重点风险</span>
                <strong>{riskCount}</strong>
                <em>预警或高风险盘口</em>
              </div>
              <div>
                <span>关注盘口</span>
                <strong>{watchlistedCount}</strong>
                <em>已加入关注列表</em>
              </div>
            </div>

            {viewMode === 'overview' ? (
              <div className="market-city-groups">
                {cityGroups.length > 0 ? (
                  cityGroups.map((group) => (
                    <section className="market-city-group" key={group.key}>
                      <header className="market-city-group__header">
                        <div>
                          <strong>{group.cityName}</strong>
                          <span>
                            {group.rows.length} 个盘口 · 最新更新 {formatTime(group.rows[0].updatedAt)}
                          </span>
                        </div>
                        <span>{group.rows.filter((row) => row.watchlisted).length} 个关注</span>
                      </header>
                      <div className="market-band-grid">
                        {group.rows.map((row) => (
                          <MarketBand
                            key={row.marketId}
                            row={row}
                            formatTime={formatTime}
                            language={language}
                            selected={row.marketId === selectedMarket?.marketId}
                            onSelect={setSelectedMarketId}
                          />
                        ))}
                      </div>
                    </section>
                  ))
                ) : (
                  <div className="market-explorer-empty">{copy.explorer.noRows}</div>
                )}
              </div>
            ) : (
              rows.length > 0 ? (
                <div className="table-wrapper market-precision-table">
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
                          selected={row.marketId === selectedMarket?.marketId}
                          onSelect={setSelectedMarketId}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="market-explorer-empty">{copy.explorer.noRows}</div>
              )
            )}
          </main>

          <aside className="market-inspector">
            {selectedMarket ? (
              <>
                <div className="market-inspector__header">
                  <span>选中盘口</span>
                  <strong>{selectedMarket.cityName}</strong>
                  <em>
                    {selectedMarket.eventDate} · {formatTemperatureBandLabel(selectedMarket.temperatureBand, language)}
                  </em>
                </div>

                <div className="market-inspector__hero">
                  <div>
                    <span>“是”价格</span>
                    <strong>
                      {formatMarketCentsLabel(
                        selectedMarket.yesPrice,
                        { treatZeroAsUnknown: !selectedMarketHasQuotes },
                        language,
                      )}
                    </strong>
                    <p>市场当前主价格，优先用于快速判断方向。</p>
                  </div>
                  <div>
                    <span>“否”价格</span>
                    <strong>
                      {formatMarketCentsLabel(
                        selectedMarket.noPrice,
                        { treatZeroAsUnknown: !selectedMarketHasQuotes },
                        language,
                      )}
                    </strong>
                    <p>和“是”价格配合判断盘口是否平衡。</p>
                  </div>
                </div>

                <div className="market-inspector__metrics">
                  <div>
                    <span>买一</span>
                    <strong>
                      {formatMarketCentsLabel(
                        selectedMarket.bestBid,
                        { treatZeroAsUnknown: !selectedMarketHasQuotes },
                        language,
                      )}
                    </strong>
                  </div>
                  <div>
                    <span>卖一</span>
                    <strong>
                      {formatMarketCentsLabel(
                        selectedMarket.bestAsk,
                        { treatZeroAsUnknown: !selectedMarketHasQuotes },
                        language,
                      )}
                    </strong>
                  </div>
                  <div>
                    <span>价差</span>
                    <strong className={marketHasWideSpread(selectedMarket) ? 'value-down' : undefined}>
                      {formatMarketCentsLabel(
                        selectedMarket.spread,
                        { treatZeroAsUnknown: !selectedMarketHasQuotes },
                        language,
                      )}
                    </strong>
                  </div>
                  <div>
                    <span>5分钟变化</span>
                    <strong className={selectedMarket.change5m >= 0 ? 'value-up' : 'value-down'}>
                      {formatMarketPercent(selectedMarket.change5m)}
                    </strong>
                  </div>
                  <div>
                    <span>状态</span>
                    <strong>{MARKET_STATUS_LABELS[selectedMarket.status]}</strong>
                  </div>
                  <div>
                    <span>风险</span>
                    <strong>{MARKET_SEVERITY_LABELS[selectedMarket.bubbleSeverity]}</strong>
                  </div>
                </div>

                <div className="market-inspector__footer">
                  <span>最近更新：{formatTime(selectedMarket.updatedAt)}</span>
                  <span>机场代码：{selectedMarket.airportCode}</span>
                  <span>{selectedMarket.watchlisted ? '已加入关注盘口' : '未加入关注盘口'}</span>
                </div>

                <div className="market-inspector__actions">
                  <button type="button" className="ghost-button" onClick={focusSelectedCity}>
                    只看这个城市
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => setViewMode('precise')}
                  >
                    查看精确数值
                  </button>
                </div>
              </>
            ) : (
              <div className="market-inspector__empty">
                <strong>还没有可检视的盘口</strong>
                <span>调整筛选条件后，点击任意市场带即可查看详细价格和状态。</span>
              </div>
            )}
          </aside>
        </div>
      </section>
    </section>
  );
};
