import { memo, startTransition, useDeferredValue, useEffect, useMemo, useState } from 'react';

import { useI18n } from '../i18n';
import { cn } from '../lib/tailwind-utils';
import type { AppLanguage, MarketQuery, MarketRow, OrderSide } from '../types/contracts';
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
type MarketSideFilter = '' | Extract<OrderSide, 'YES' | 'NO'>;
type MarketExplorerPreset = 'all' | 'lottery' | 'watchlist';

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

const MARKET_SIDE_LABELS: Record<MarketSideFilter, string> = {
  '': '全部方向',
  YES: '是',
  NO: '否',
};

const DEFAULT_SORT_BY: NonNullable<MarketQuery['sortBy']> = 'updatedAt';
const DEFAULT_SORT_DIR: NonNullable<MarketQuery['sortDir']> = 'desc';
const OVERVIEW_CITY_GROUP_LIMIT = 8;
const OVERVIEW_MARKETS_PER_CITY_LIMIT = 6;
const PRECISION_TABLE_ROW_LIMIT = 80;
const SEVERITY_WEIGHT: Record<MarketRow['bubbleSeverity'], number> = {
  critical: 3,
  warning: 2,
  info: 1,
  none: 0,
};

const marketHasWideSpread = (row: MarketRow) => (row.spread ?? 0) >= 0.05;
const marketHasLotterySignal = (row: MarketRow) => row.lotteryCandidate === true && (row.lotteryLift ?? 0) > 0;

const LOTTERY_SOURCE_LABELS: Record<
  NonNullable<MarketRow['lotteryConfirmationSource']>,
  { zh: string; en: string }
> = {
  edge_volume: {
    zh: '卖一旧档被吃掉',
    en: 'Edge volume lifted',
  },
  trade_confirmed: {
    zh: '成交确认',
    en: 'Trade confirmed',
  },
  book_depth: {
    zh: '盘口深度确认',
    en: 'Book depth',
  },
};

const formatSortOptionLabel = (
  sortBy: NonNullable<MarketQuery['sortBy']>,
  language: AppLanguage,
  sortByLabel: (key: 'volume24h' | 'change5m' | 'spread' | 'updatedAt') => string,
) => {
  if (sortBy === 'lotteryLift') {
    return language === 'zh-CN' ? '异常彩票优先' : 'Lottery Lift';
  }

  return sortByLabel(sortBy);
};

const formatLotteryLiftLabel = (value: number | null | undefined, language: AppLanguage) => {
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) {
    return '--';
  }

  return `+${formatMarketCentsLabel(value, { compact: true }, language)}`;
};

const formatLotteryRouteLabel = (row: MarketRow, language: AppLanguage) => {
  if (
    row.lotteryReferenceAsk === null ||
    row.lotteryReferenceAsk === undefined ||
    row.lotteryCurrentAsk === null ||
    row.lotteryCurrentAsk === undefined
  ) {
    return null;
  }

  return `${formatMarketCentsLabel(row.lotteryReferenceAsk, { compact: true }, language)} -> ${formatMarketCentsLabel(
    row.lotteryCurrentAsk,
    { compact: true },
    language,
  )}`;
};

const formatLotterySourceLabel = (
  source: MarketRow['lotteryConfirmationSource'],
  language: AppLanguage,
) => {
  if (!source) {
    return language === 'zh-CN' ? '待确认' : 'Pending';
  }

  const meta = LOTTERY_SOURCE_LABELS[source];
  if (!meta) {
    return source;
  }

  return language === 'zh-CN' ? meta.zh : meta.en;
};

const formatLotterySizeLabel = (value: number | null | undefined, language: AppLanguage) => {
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) {
    return '--';
  }

  const displayValue =
    value >= 1000 ? Math.round(value).toLocaleString(language) : Number(value.toFixed(2)).toLocaleString(language);
  return language === 'zh-CN' ? `${displayValue} 份` : `${displayValue} shares`;
};

const formatLotteryNotionalLabel = (value: number | null | undefined, language: AppLanguage) => {
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) {
    return '--';
  }

  return new Intl.NumberFormat(language, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(value);
};

const getMarketBandClassName = (row: MarketRow, selected: boolean) =>
  cn(
    'market-band',
    `market-band--${row.bubbleSeverity}`,
    marketHasLotterySignal(row) && 'market-band--lottery',
    marketHasWideSpread(row) && 'market-band--wide-spread',
    selected && 'is-selected',
  );

const getMarketRowClassName = (row: MarketRow, selected: boolean) =>
  cn('market-table-row', marketHasLotterySignal(row) && 'market-table-row--lottery', selected && 'is-selected');

const groupMarketsByCity = (rows: MarketRow[]) => {
  const groups = new Map<
    string,
    {
      key: string;
      cityName: string;
      rows: MarketRow[];
      riskCount: number;
      watchlistedCount: number;
      lotteryCount: number;
      maxLotteryLift: number;
      maxSeverityWeight: number;
      latestUpdatedAt: string;
    }
  >();

  rows.forEach((row) => {
    const key = row.cityKey || row.cityName;
    const current = groups.get(key);
    if (current) {
      current.rows.push(row);
      current.watchlistedCount += row.watchlisted ? 1 : 0;
      current.lotteryCount += marketHasLotterySignal(row) ? 1 : 0;
      current.maxLotteryLift = Math.max(current.maxLotteryLift, row.lotteryLift ?? 0);
      current.riskCount +=
        row.bubbleSeverity === 'critical' || row.bubbleSeverity === 'warning' ? 1 : 0;
      current.maxSeverityWeight = Math.max(
        current.maxSeverityWeight,
        SEVERITY_WEIGHT[row.bubbleSeverity],
      );
      if (Date.parse(row.updatedAt) > Date.parse(current.latestUpdatedAt)) {
        current.latestUpdatedAt = row.updatedAt;
      }
      return;
    }

    groups.set(key, {
      key,
      cityName: row.cityName || row.cityKey,
      rows: [row],
      riskCount: row.bubbleSeverity === 'critical' || row.bubbleSeverity === 'warning' ? 1 : 0,
      watchlistedCount: row.watchlisted ? 1 : 0,
      lotteryCount: marketHasLotterySignal(row) ? 1 : 0,
      maxLotteryLift: row.lotteryLift ?? 0,
      maxSeverityWeight: SEVERITY_WEIGHT[row.bubbleSeverity],
      latestUpdatedAt: row.updatedAt,
    });
  });

  return [...groups.values()].sort((left, right) => {
    if (left.lotteryCount !== right.lotteryCount) {
      return right.lotteryCount - left.lotteryCount;
    }

    if (left.maxLotteryLift !== right.maxLotteryLift) {
      return right.maxLotteryLift - left.maxLotteryLift;
    }

    if (left.maxSeverityWeight !== right.maxSeverityWeight) {
      return right.maxSeverityWeight - left.maxSeverityWeight;
    }

    if (left.watchlistedCount !== right.watchlistedCount) {
      return right.watchlistedCount - left.watchlistedCount;
    }

    if (left.riskCount !== right.riskCount) {
      return right.riskCount - left.riskCount;
    }

    if (left.rows.length !== right.rows.length) {
      return right.rows.length - left.rows.length;
    }

    return left.cityName.localeCompare(right.cityName, 'zh-CN');
  });
};

const MarketExplorerRow = memo(
  ({ row, formatTime, language, selected, onSelect }: MarketExplorerRowProps) => {
    const spreadClass = marketHasWideSpread(row) ? 'value-down' : '';
    const changeClass = row.change5m >= 0 ? 'value-up' : 'value-down';
    const hasQuotes = hasMarketQuoteSignal(row);
    const lotteryLift = marketHasLotterySignal(row) ? formatLotteryLiftLabel(row.lotteryLift, language) : '--';
    const lotteryRoute = formatLotteryRouteLabel(row, language);

    return (
      <tr className={getMarketRowClassName(row, selected)} onClick={() => onSelect(row.marketId)}>
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
        <td
          className={marketHasLotterySignal(row) ? 'value-up market-table-cell--lottery' : 'market-table-cell--lottery'}
          title={lotteryRoute ?? undefined}
        >
          {lotteryLift}
        </td>
        <td>{formatTime(row.updatedAt)}</td>
      </tr>
    );
  },
);

const MarketBand = memo(
  ({ row, formatTime, language, selected, onSelect }: MarketBandProps) => {
    const hasQuotes = hasMarketQuoteSignal(row);
    const changeClass = row.change5m >= 0 ? 'value-up' : 'value-down';
    const lotteryRoute = formatLotteryRouteLabel(row, language);
    const lotterySource = marketHasLotterySignal(row)
      ? formatLotterySourceLabel(row.lotteryConfirmationSource, language)
      : null;
    const lotteryBadge = marketHasLotterySignal(row)
      ? `${language === 'zh-CN' ? '异常彩票' : 'Lottery'} ${formatLotteryLiftLabel(row.lotteryLift, language)}`
      : null;

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
          {lotteryBadge ? (
            <span className="market-band__badge market-band__badge--lottery">{lotteryBadge}</span>
          ) : null}
          {lotterySource ? (
            <span className="market-band__badge market-band__badge--source">{lotterySource}</span>
          ) : null}
          {lotteryRoute ? (
            <span className="market-band__badge market-band__badge--route">{lotteryRoute}</span>
          ) : null}
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
  const [sideFilter, setSideFilter] = useState<MarketSideFilter>(
    query.side === 'YES' || query.side === 'NO' ? query.side : '',
  );
  const [watchlistOnly, setWatchlistOnly] = useState(Boolean(query.watchlistedOnly));
  const [lotteryOnly, setLotteryOnly] = useState(Boolean(query.lotteryOnly));
  const [viewMode, setViewMode] = useState<MarketExplorerMode>('overview');
  const [selectedMarketId, setSelectedMarketId] = useState<string | null>(null);

  const deferredCityKey = useDeferredValue(cityKey);
  const cityGroups = useMemo(() => groupMarketsByCity(rows), [rows]);
  const visibleCityGroups = useMemo(
    () => cityGroups.slice(0, OVERVIEW_CITY_GROUP_LIMIT),
    [cityGroups],
  );
  const visiblePrecisionRows = useMemo(
    () => rows.slice(0, PRECISION_TABLE_ROW_LIMIT),
    [rows],
  );
  const selectedMarket = useMemo(
    () => rows.find((row) => row.marketId === selectedMarketId) ?? rows[0] ?? null,
    [rows, selectedMarketId],
  );
  const selectedMarketHasQuotes = hasMarketQuoteSignal(selectedMarket);
  const selectedLotteryRoute = selectedMarket ? formatLotteryRouteLabel(selectedMarket, language) : null;
  const selectedLotterySource = selectedMarket
    ? formatLotterySourceLabel(selectedMarket.lotteryConfirmationSource, language)
    : null;
  const lotteryFocused = lotteryOnly;
  const lotteryRows = useMemo(
    () => rows.filter((row) => marketHasLotterySignal(row)),
    [rows],
  );
  const visibleCityCount = cityGroups.length;
  const watchlistedCount = rows.filter((row) => row.watchlisted).length;
  const riskCount = rows.filter(
    (row) => row.bubbleSeverity === 'critical' || row.bubbleSeverity === 'warning',
  ).length;
  const lotteryCityCount = new Set(lotteryRows.map((row) => row.cityKey)).size;
  const confirmedLotteryCount = lotteryRows.filter((row) => Boolean(row.lotteryConfirmationSource)).length;
  const averageLotteryLift =
    lotteryRows.length > 0
      ? lotteryRows.reduce((sum, row) => sum + (row.lotteryLift ?? 0), 0) / lotteryRows.length
      : null;
  const bestLotteryLift = lotteryRows.reduce((best, row) => Math.max(best, row.lotteryLift ?? 0), 0);
  const visibleOverviewMarketCount = visibleCityGroups.reduce(
    (sum, group) => sum + Math.min(group.rows.length, OVERVIEW_MARKETS_PER_CITY_LIMIT),
    0,
  );
  const hiddenOverviewMarketCount = Math.max(0, rows.length - visibleOverviewMarketCount);
  const hiddenPrecisionRowCount = Math.max(0, rows.length - visiblePrecisionRows.length);
  const hasSearchTerm = cityKey.trim().length > 0;
  const activePreset: MarketExplorerPreset = lotteryOnly
    ? 'lottery'
    : watchlistOnly
      ? 'watchlist'
      : 'all';
  const activeSortBy = query.sortBy ?? DEFAULT_SORT_BY;
  const activeSortDir = query.sortDir ?? DEFAULT_SORT_DIR;
  const describeSort = (sortBy: NonNullable<MarketQuery['sortBy']>) =>
    formatSortOptionLabel(sortBy, language, sortByLabel);
  const activeFilterLabels = [
    hasSearchTerm ? `搜索：${cityKey.trim()}` : '搜索：全部城市/机场',
    eventDate ? `日期：${eventDate}` : '日期：全部',
    lotteryOnly
      ? '模式：异常彩票（超低价更敏感）'
      : watchlistOnly
        ? '模式：仅看关注盘口'
        : '模式：全部盘口',
    lotteryOnly ? '方向：已锁定超低价盘口' : `方向：${MARKET_SIDE_LABELS[sideFilter]}`,
    `排序：${describeSort(activeSortBy)} / ${activeSortDir === 'desc' ? '降序' : '升序'}`,
  ];

  useEffect(() => {
    setCityKey(query.cityKey ?? '');
  }, [query.cityKey]);

  useEffect(() => {
    setEventDate(query.eventDate ?? '');
  }, [query.eventDate]);

  useEffect(() => {
    setSideFilter(query.side === 'YES' || query.side === 'NO' ? query.side : '');
  }, [query.side]);

  useEffect(() => {
    setWatchlistOnly(Boolean(query.watchlistedOnly));
  }, [query.watchlistedOnly]);

  useEffect(() => {
    setLotteryOnly(Boolean(query.lotteryOnly));
  }, [query.lotteryOnly]);

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
      side: lotteryOnly ? undefined : sideFilter || undefined,
      watchlistedOnly: watchlistOnly || undefined,
      lotteryOnly: lotteryOnly || undefined,
    });
  }, [eventDate, lotteryOnly, onQueryChange, sideFilter, watchlistOnly]);

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
    setSideFilter('');
    setWatchlistOnly(false);
    setLotteryOnly(false);
    onQueryChange({
      cityKey: undefined,
      eventDate: undefined,
      side: undefined,
      watchlistedOnly: undefined,
      lotteryOnly: undefined,
      sortBy: DEFAULT_SORT_BY,
      sortDir: DEFAULT_SORT_DIR,
    });
  };

  const focusSelectedCity = () => {
    if (!selectedMarket) {
      return;
    }

    setCityKey(selectedMarket.cityKey);
    setEventDate(selectedMarket.eventDate);
    setSideFilter(selectedMarket.side === 'YES' || selectedMarket.side === 'NO' ? selectedMarket.side : '');
  };

  const applyPreset = (preset: MarketExplorerPreset) => {
    if (preset === 'lottery') {
      setLotteryOnly(true);
      setWatchlistOnly(false);
      setSideFilter('');
      onQueryChange({
        lotteryOnly: true,
        watchlistedOnly: undefined,
        side: undefined,
        sortBy: 'lotteryLift',
        sortDir: 'desc',
      });
      return;
    }

    if (preset === 'watchlist') {
      setLotteryOnly(false);
      setWatchlistOnly(true);
      setSideFilter('');
      onQueryChange({
        lotteryOnly: undefined,
        watchlistedOnly: true,
        side: undefined,
        sortBy: 'updatedAt',
        sortDir: 'desc',
      });
      return;
    }

    setLotteryOnly(false);
    setWatchlistOnly(false);
    setSideFilter('');
    onQueryChange({
      lotteryOnly: undefined,
      watchlistedOnly: undefined,
      side: undefined,
      sortBy: DEFAULT_SORT_BY,
      sortDir: DEFAULT_SORT_DIR,
    });
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
          <div className="market-explorer-presets" role="group" aria-label="运营预设">
            <button
              type="button"
              className={cn('market-explorer-preset', activePreset === 'all' && 'is-active')}
              onClick={() => applyPreset('all')}
            >
              全部盘口
            </button>
            <button
              type="button"
              className={cn('market-explorer-preset', activePreset === 'lottery' && 'is-active')}
              onClick={() => applyPreset('lottery')}
            >
              异常彩票
            </button>
            <button
              type="button"
              className={cn('market-explorer-preset', activePreset === 'watchlist' && 'is-active')}
              onClick={() => applyPreset('watchlist')}
            >
              关注队列
            </button>
          </div>

          {lotteryFocused ? (
            <div className="market-explorer-mode-note">
              <strong>异常彩票模式</strong>
              <span>低价越低越敏感：1-2c 推高 3c 即触发，3-4c 推高 4c 即触发。</span>
            </div>
          ) : null}

          <div className="market-explorer-filters">
            <label className="field field--grow">
              <span>{copy.explorer.cityKey}</span>
              <input
                value={cityKey}
                onChange={(event) => setCityKey(event.target.value)}
                placeholder="输入城市、机场代码或中文名"
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
              <span>方向</span>
              <select
                value={sideFilter}
                disabled={lotteryFocused}
                onChange={(event) => setSideFilter(event.target.value as MarketSideFilter)}
              >
                <option value="">全部方向</option>
                <option value="YES">是</option>
                <option value="NO">否</option>
              </select>
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
                <option value="lotteryLift">{describeSort('lotteryLift')}</option>
                <option value="volume24h">{describeSort('volume24h')}</option>
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
              {lotteryFocused ? <span>阈值：1-2c 看 +3c，3-4c 看 +4c</span> : null}
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
            <div className={cn('market-explorer-summary', lotteryFocused && 'market-explorer-summary--lottery')}>
              {lotteryFocused ? (
                <>
                  <div>
                    <span>异常候选</span>
                    <strong>{rows.length}</strong>
                    <em>覆盖 {lotteryCityCount} 座城市</em>
                  </div>
                  <div>
                    <span>确认路径</span>
                    <strong>{confirmedLotteryCount}</strong>
                    <em>已确认成交、旧档或盘口深度</em>
                  </div>
                  <div>
                    <span>平均推高</span>
                    <strong>{formatLotteryLiftLabel(averageLotteryLift, language)}</strong>
                    <em>超低价盘口采用更敏感阈值</em>
                  </div>
                  <div>
                    <span>最大推高</span>
                    <strong>{formatLotteryLiftLabel(bestLotteryLift || null, language)}</strong>
                    <em>当前排序：{describeSort(activeSortBy)}</em>
                  </div>
                </>
              ) : (
                <>
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
                    <span>异常彩票</span>
                    <strong>{lotteryRows.length}</strong>
                    <em>超低价盘口异动候选</em>
                  </div>
                </>
              )}
            </div>

            {viewMode === 'overview' ? (
              <div className="market-city-groups">
                {cityGroups.length > 0 ? (
                  <>
                    {visibleCityGroups.map((group) => {
                      const visibleRows = group.rows.slice(0, OVERVIEW_MARKETS_PER_CITY_LIMIT);
                      const hiddenGroupRowCount = group.rows.length - visibleRows.length;
                      return (
                        <section className="market-city-group" key={group.key}>
                          <header className="market-city-group__header">
                            <div>
                              <strong>{group.cityName}</strong>
                              <span>
                                {group.rows.length} 个盘口 · 最新更新 {formatTime(group.latestUpdatedAt)}
                              </span>
                            </div>
                            <div className="market-city-group__stats">
                              {group.lotteryCount > 0 ? (
                                <span>异常彩票 {group.lotteryCount}</span>
                              ) : null}
                              {group.maxLotteryLift > 0 ? (
                                <span>最大推高 {formatLotteryLiftLabel(group.maxLotteryLift, language)}</span>
                              ) : null}
                              <span>{group.riskCount} 个重点风险</span>
                              <span>{group.watchlistedCount} 个关注</span>
                            </div>
                          </header>
                          <div className="market-band-grid">
                            {visibleRows.map((row) => (
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
                          {hiddenGroupRowCount > 0 ? (
                            <div className="market-explorer-limit-hint">
                              该城市还有 {hiddenGroupRowCount} 个盘口，输入日期或温度区间可继续收窄。
                            </div>
                          ) : null}
                        </section>
                      );
                    })}
                    {hiddenOverviewMarketCount > 0 ? (
                      <div className="market-explorer-limit-hint" role="note">
                        首屏仅展示 {visibleCityGroups.length} 个城市、{visibleOverviewMarketCount}{' '}
                        个最有决策价值的盘口；输入城市、机场代码或中文名继续筛选。
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div className="market-explorer-empty">{copy.explorer.noRows}</div>
                )}
              </div>
            ) : (
              rows.length > 0 ? (
                <>
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
                          <th>异常彩票</th>
                          <th>{copy.common.updated}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visiblePrecisionRows.map((row) => (
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
                  {hiddenPrecisionRowCount > 0 ? (
                    <div className="market-explorer-limit-hint" role="note">
                      精确列表已限制展示前 {visiblePrecisionRows.length} 行；请用城市、机场、日期或关注筛选定位。
                    </div>
                  ) : null}
                </>
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

                {marketHasLotterySignal(selectedMarket) ? (
                  <div className="market-inspector__lottery">
                    <div className="market-inspector__lottery-head">
                      <span>异常彩票信号</span>
                      <strong>{formatLotteryLiftLabel(selectedMarket.lotteryLift, language)}</strong>
                      <em>{selectedLotteryRoute ?? '超低价盘口被快速推高'}</em>
                    </div>
                    <div className="market-inspector__metrics market-inspector__metrics--lottery">
                      <div>
                        <span>确认路径</span>
                        <strong>{selectedLotterySource}</strong>
                      </div>
                      <div>
                        <span>有效数量</span>
                        <strong>{formatLotterySizeLabel(selectedMarket.lotteryEffectiveSize, language)}</strong>
                      </div>
                      <div>
                        <span>有效金额</span>
                        <strong>
                          {formatLotteryNotionalLabel(selectedMarket.lotteryEffectiveNotional, language)}
                        </strong>
                      </div>
                      <div>
                        <span>信号时间</span>
                        <strong>
                          {selectedMarket.lotteryUpdatedAt ? formatTime(selectedMarket.lotteryUpdatedAt) : '--'}
                        </strong>
                      </div>
                    </div>
                  </div>
                ) : lotteryFocused ? (
                  <div className="market-inspector__lottery market-inspector__lottery--empty">
                    <strong>当前盘口还未满足异常彩票确认</strong>
                    <span>异常彩票优先关注参考卖一不高于 4c，且被短时间推高的超低价盘口。</span>
                  </div>
                ) : null}

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
