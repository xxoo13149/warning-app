import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useI18n } from '../i18n';
import type { AlertEvent } from '../types/contracts';
import {
  buildAlertNotificationContent,
  buildAlertPresentation,
  type AlertPresentation,
} from '../utils/alert-summary';

interface AlertCenterViewProps {
  alerts: AlertEvent[];
  focusAlertId?: string | null;
  total: number;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  loadMoreError?: string | null;
}

interface AlertViewModel {
  alert: AlertEvent;
  presentation: AlertPresentation;
}

interface AlertModelCacheEntry {
  source: AlertEvent;
  model: AlertViewModel;
}

interface FilterOption {
  value: string;
  label: string;
  count: number;
}

type AlertSortKey = 'latest' | 'city' | 'rule';

interface AlertCenterPersistedState {
  ruleFilter: string;
  cityFilter: string;
  ruleSearch: string;
  citySearch: string;
  sortBy: AlertSortKey;
}

const pageText = {
  title: '告警中心',
  rowsInFilter: (count: number) => `当前筛选 ${count} 条`,
  eyebrow: '统一告警流',
  headline: '先看地点，再看规则，再看盘面上下文',
  hint:
    '这里展示最新告警时间线。支持按城市、规则和排序方式快速筛选，并可以逐页继续加载更早的历史。',
  total: '告警总数',
  cityCount: '已载入城市',
  ruleCount: '已载入规则',
  latest: '最新触发',
  all: '全部',
  any: '不限',
  currentScope: '当前范围',
  allAlerts: '全部告警',
  clearFilters: '恢复全部',
  clearSearch: '清空',
  selected: '已选',
  unlimited: '未限制',
  resultBadge: (count: number) => `结果 ${count} 条`,
  sortLabel: '排序方式',
  sortLatest: '最近触发',
  sortCity: '按城市',
  sortRule: '按规则',
  ruleFilter: '按规则筛选',
  cityFilter: '按城市筛选',
  citySearchPlaceholder: '搜索城市',
  ruleSearchPlaceholder: '搜索规则',
  noMatches: '没有匹配项',
  facts: '关键数值',
  context: '定位信息',
  city: '城市',
  rule: '规则',
  band: '温度区间',
  marketId: '盘口编号',
  empty: '当前筛选下没有告警。',
  emptyCanLoadMore: '当前筛选下还没有命中已加载告警，可以继续加载更早历史。',
  emptyCanLoadMoreUnfiltered: '当前还没有载入告警，可以继续加载更早历史。',
  noLatest: '暂无',
  loadedSummary: (loaded: number, total: number) =>
    total > loaded ? `已载入 ${loaded} / ${total}` : `已载入 ${loaded}`,
  loadMore: '加载更多',
  loadingMore: '加载中...',
  allLoaded: '已加载全部',
};

const MAX_FILTER_OPTIONS = 8;
const ALERT_CENTER_STORAGE_KEY = 'polymarket-weather-monitor.alert-center.v1';
const DEFAULT_ALERT_CENTER_STATE: AlertCenterPersistedState = {
  ruleFilter: 'all',
  cityFilter: 'all',
  ruleSearch: '',
  citySearch: '',
  sortBy: 'latest',
};
const ALERT_SORT_OPTIONS: Array<{ value: AlertSortKey; label: string }> = [
  { value: 'latest', label: pageText.sortLatest },
  { value: 'city', label: pageText.sortCity },
  { value: 'rule', label: pageText.sortRule },
];
const ALERT_CARD_ESTIMATED_HEIGHT = 286;
const ALERT_CARD_GAP = 10;
const ALERT_CARD_OVERSCAN = 4;
const ALERT_LIST_VIEWPORT_HEIGHT_FALLBACK = 760;

const countBy = (items: AlertViewModel[], getKey: (item: AlertViewModel) => string) => {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = getKey(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
};

const toFilterOptions = (counts: Map<string, number>) =>
  Array.from(counts.entries())
    .map(([label, count]) => ({
      value: label,
      label,
      count,
    }))
    .sort(
      (left, right) =>
        right.count - left.count || left.label.localeCompare(right.label, 'zh-CN'),
    );

const normalizeSearchText = (value: string) => value.trim().toLowerCase();

const filterOptionsByQuery = (options: FilterOption[], query: string) => {
  const keyword = normalizeSearchText(query);
  if (!keyword) {
    return options.slice(0, MAX_FILTER_OPTIONS);
  }
  return options.filter((option) => normalizeSearchText(option.label).includes(keyword));
};

const readPersistedAlertCenterState = (): AlertCenterPersistedState => {
  if (typeof window === 'undefined') {
    return DEFAULT_ALERT_CENTER_STATE;
  }

  try {
    const raw = window.localStorage.getItem(ALERT_CENTER_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_ALERT_CENTER_STATE;
    }

    const parsed = JSON.parse(raw) as Partial<AlertCenterPersistedState>;
    return {
      ruleFilter: typeof parsed.ruleFilter === 'string' ? parsed.ruleFilter : 'all',
      cityFilter: typeof parsed.cityFilter === 'string' ? parsed.cityFilter : 'all',
      ruleSearch: typeof parsed.ruleSearch === 'string' ? parsed.ruleSearch : '',
      citySearch: typeof parsed.citySearch === 'string' ? parsed.citySearch : '',
      sortBy:
        parsed.sortBy === 'city' || parsed.sortBy === 'rule' || parsed.sortBy === 'latest'
          ? parsed.sortBy
          : 'latest',
    };
  } catch {
    return DEFAULT_ALERT_CENTER_STATE;
  }
};

const getLatestAlertTime = (items: AlertViewModel[]) =>
  items.reduce((latest, item) => {
    const timestamp = new Date(item.alert.triggeredAt).getTime();
    return Number.isFinite(timestamp) && timestamp > latest ? timestamp : latest;
  }, 0);

const compareAlertTime = (left: AlertViewModel, right: AlertViewModel) =>
  new Date(right.alert.triggeredAt).getTime() - new Date(left.alert.triggeredAt).getTime();

const sortAlertModels = (items: AlertViewModel[], sortBy: AlertSortKey) =>
  [...items].sort((left, right) => {
    if (sortBy === 'city') {
      const byCity = left.presentation.cityLabel.localeCompare(
        right.presentation.cityLabel,
        'zh-CN',
      );
      if (byCity !== 0) {
        return byCity;
      }
      const byRule = left.presentation.ruleLabel.localeCompare(
        right.presentation.ruleLabel,
        'zh-CN',
      );
      if (byRule !== 0) {
        return byRule;
      }
      return compareAlertTime(left, right);
    }

    if (sortBy === 'rule') {
      const byRule = left.presentation.ruleLabel.localeCompare(
        right.presentation.ruleLabel,
        'zh-CN',
      );
      if (byRule !== 0) {
        return byRule;
      }
      const byCity = left.presentation.cityLabel.localeCompare(
        right.presentation.cityLabel,
        'zh-CN',
      );
      if (byCity !== 0) {
        return byCity;
      }
      return compareAlertTime(left, right);
    }

    return compareAlertTime(left, right);
  });

const getPresentationContextValue = (presentation: AlertPresentation, label: string) =>
  presentation.context.find((item) => item.label === label)?.value ?? '';

const sanitizeCardDetail = (detail: string | null, notificationBody: string) => {
  if (!detail) {
    return null;
  }

  const parts = detail
    .split(' · ')
    .map((part) => part.trim())
    .filter(
      (part) =>
        part.length > 0 &&
        !notificationBody.includes(part) &&
        !part.startsWith(`${pageText.band}:`) &&
        !part.startsWith(`${pageText.band}：`) &&
        !part.startsWith(`${pageText.marketId}:`) &&
        !part.startsWith(`${pageText.marketId}：`),
    );

  return parts.length > 0 ? parts.join(' · ') : null;
};

const buildAlertModels = (
  alerts: AlertEvent[],
  cache: Map<string, AlertModelCacheEntry>,
): AlertViewModel[] => {
  const nextIds = new Set<string>();
  const models: AlertViewModel[] = [];

  for (const alert of alerts) {
    nextIds.add(alert.id);
    const cached = cache.get(alert.id);
    if (cached && cached.source === alert) {
      models.push(cached.model);
      continue;
    }

    const model = {
      alert,
      presentation: buildAlertPresentation(alert),
    } satisfies AlertViewModel;
    cache.set(alert.id, { source: alert, model });
    models.push(model);
  }

  for (const id of cache.keys()) {
    if (!nextIds.has(id)) {
      cache.delete(id);
    }
  }

  return models;
};

interface AlertCenterCardProps {
  model: AlertViewModel;
  highlighted: boolean;
  formatDateTime: (value: string) => string;
  registerCard: (id: string, node: HTMLElement | null) => void;
}

const AlertCenterCard = ({
  model,
  highlighted,
  formatDateTime,
  registerCard,
}: AlertCenterCardProps) => {
  const { alert, presentation } = model;
  const notificationContent = buildAlertNotificationContent(alert);
  const temperatureBand = getPresentationContextValue(presentation, pageText.band);
  const marketId = getPresentationContextValue(presentation, pageText.marketId);
  const detailText = sanitizeCardDetail(presentation.detail, notificationContent.body);
  const badges = [
    presentation.alertLabel,
    ...(temperatureBand ? [`温区: ${temperatureBand}`] : []),
  ];
  const visibleFacts = presentation.facts
    .filter((fact) => !notificationContent.body.includes(fact.value))
    .slice(0, 4);
  const quickFacts = [
    { label: pageText.city, value: presentation.cityLabel },
    ...(temperatureBand ? [{ label: pageText.band, value: temperatureBand }] : []),
    { label: pageText.rule, value: presentation.ruleLabel },
    ...(marketId ? [{ label: pageText.marketId, value: marketId }] : []),
  ];

  return (
    <article
      ref={(node) => registerCard(alert.id, node)}
      id={`alert-center-card-${alert.id}`}
      className={`alert-center-card ${
        highlighted ? 'alert-center-card--focused' : ''
      }`}
      tabIndex={highlighted ? -1 : undefined}
    >
      <div className="alert-center-card__main">
        <div className="alert-center-card__top">
          <div className="alert-center-card__header-copy">
            <div className="alert-center-card__badges">
              {badges.map((badge) => (
                <span key={`${alert.id}-${badge}`} className="alert-center-card__status">
                  {badge}
                </span>
              ))}
            </div>
            <h3>{notificationContent.title}</h3>
            <p className="alert-center-card__summary alert-center-card__summary--lead">
              {notificationContent.body}
            </p>
          </div>
          <time className="alert-center-card__time" dateTime={alert.triggeredAt}>
            {formatDateTime(alert.triggeredAt)}
          </time>
        </div>

        {detailText ? <p className="alert-center-card__detail">{detailText}</p> : null}

        {visibleFacts.length > 0 ? (
          <div className="alert-center-card__facts" aria-label={pageText.facts}>
            {visibleFacts.map((fact, index) => (
              <div
                key={`${alert.id}-${fact.label}-${fact.value}`}
                className={`alert-center-fact ${index === 0 ? 'is-primary' : ''} ${
                  fact.tone ? `alert-center-fact--${fact.tone}` : ''
                }`}
              >
                <span>{fact.label}</span>
                <strong>{fact.value}</strong>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <aside className="alert-center-card__context" aria-label={pageText.context}>
        <span>{pageText.context}</span>
        {quickFacts.map((item) => (
          <div key={`${alert.id}-${item.label}`}>
            <small>{item.label}</small>
            <strong>{item.value}</strong>
          </div>
        ))}
      </aside>
    </article>
  );
};

const renderFilterChips = (
  label: string,
  options: FilterOption[],
  selectedValue: string,
  selectedLabel: string,
  allCount: number,
  searchValue: string,
  searchPlaceholder: string,
  onSelect: (value: string) => void,
  onSearchChange: (value: string) => void,
) => (
  <div className="alert-center-filter-group">
    <div className="alert-center-filter-group__head">
      <div className="alert-center-filter-group__title">
        <span>{label}</span>
        <small>
          {selectedValue === 'all'
            ? pageText.unlimited
            : `${pageText.selected}: ${selectedLabel}`}
        </small>
      </div>
    </div>
    <div className="alert-center-filter-group__search">
      <label className="alert-center-filter-search">
        <input
          type="text"
          value={searchValue}
          placeholder={searchPlaceholder}
          onChange={(event) => onSearchChange(event.target.value)}
        />
      </label>
      {searchValue ? (
        <button
          type="button"
          className="alert-center-filter-search__clear"
          onClick={() => onSearchChange('')}
        >
          {pageText.clearSearch}
        </button>
      ) : null}
    </div>
    <div className="alert-center-chip-row">
      <button
        type="button"
        className={`alert-center-chip ${selectedValue === 'all' ? 'is-active' : ''}`}
        aria-pressed={selectedValue === 'all'}
        onClick={() => onSelect('all')}
      >
        <span>{pageText.any}</span>
        <strong>{allCount}</strong>
      </button>
      {options.map((option) => (
        <button
          type="button"
          key={option.value}
          className={`alert-center-chip ${selectedValue === option.value ? 'is-active' : ''}`}
          aria-pressed={selectedValue === option.value}
          onClick={() => onSelect(option.value)}
        >
          <span>{option.label}</span>
          <strong>{option.count}</strong>
        </button>
      ))}
    </div>
    {searchValue && options.length === 0 ? (
      <div className="alert-center-filter-empty">
        {searchPlaceholder}: {pageText.noMatches}
      </div>
    ) : null}
  </div>
);

const renderSortChips = (selectedValue: AlertSortKey, onSelect: (value: AlertSortKey) => void) => (
  <div className="alert-center-filter-group alert-center-filter-group--compact">
    <div className="alert-center-filter-group__head">
      <div className="alert-center-filter-group__title">
        <span>{pageText.sortLabel}</span>
        <small>
          {ALERT_SORT_OPTIONS.find((option) => option.value === selectedValue)?.label ??
            pageText.sortLatest}
        </small>
      </div>
    </div>
    <div className="alert-center-chip-row">
      {ALERT_SORT_OPTIONS.map((option) => (
        <button
          type="button"
          key={option.value}
          className={`alert-center-chip ${selectedValue === option.value ? 'is-active' : ''}`}
          aria-pressed={selectedValue === option.value}
          onClick={() => onSelect(option.value)}
        >
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  </div>
);

export const AlertCenterView = ({
  alerts,
  focusAlertId = null,
  total,
  hasMore,
  loadingMore,
  onLoadMore,
  loadMoreError = null,
}: AlertCenterViewProps) => {
  const { formatDateTime } = useI18n();
  const persistedState = useMemo(readPersistedAlertCenterState, []);
  const alertModelCacheRef = useRef(new Map<string, AlertModelCacheEntry>());
  const listViewportRef = useRef<HTMLDivElement | null>(null);
  const alertCardNodesRef = useRef(new Map<string, HTMLElement>());
  const alertCardHeightsRef = useRef(new Map<string, number>());
  const [ruleFilter, setRuleFilter] = useState(persistedState.ruleFilter);
  const [cityFilter, setCityFilter] = useState(persistedState.cityFilter);
  const [ruleSearch, setRuleSearch] = useState(persistedState.ruleSearch);
  const [citySearch, setCitySearch] = useState(persistedState.citySearch);
  const [sortBy, setSortBy] = useState<AlertSortKey>(persistedState.sortBy);
  const [highlightedAlertId, setHighlightedAlertId] = useState<string | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(ALERT_LIST_VIEWPORT_HEIGHT_FALLBACK);
  const [layoutVersion, setLayoutVersion] = useState(0);

  const alertModels = useMemo<AlertViewModel[]>(
    () => buildAlertModels(alerts, alertModelCacheRef.current),
    [alerts],
  );

  const ruleOptions = useMemo(
    () => toFilterOptions(countBy(alertModels, (item) => item.presentation.ruleLabel)),
    [alertModels],
  );
  const cityOptions = useMemo(
    () => toFilterOptions(countBy(alertModels, (item) => item.presentation.cityLabel)),
    [alertModels],
  );

  const visibleAlerts = useMemo(
    () => {
      const filtered = alertModels.filter(
        (item) =>
          (ruleFilter === 'all' || item.presentation.ruleLabel === ruleFilter) &&
          (cityFilter === 'all' || item.presentation.cityLabel === cityFilter),
      );
      return sortBy === 'latest' ? filtered : sortAlertModels(filtered, sortBy);
    },
    [alertModels, cityFilter, ruleFilter, sortBy],
  );

  const stats = useMemo(() => {
    const latestTime = getLatestAlertTime(alertModels);
    return {
      total,
      cityCount: countBy(alertModels, (item) => item.presentation.cityLabel).size,
      ruleCount: countBy(alertModels, (item) => item.presentation.ruleLabel).size,
      latest:
        latestTime > 0 ? formatDateTime(new Date(latestTime).toISOString()) : pageText.noLatest,
    };
  }, [alertModels, formatDateTime, total]);

  const selectedRuleLabel =
    ruleFilter === 'all'
      ? pageText.all
      : ruleOptions.find((option) => option.value === ruleFilter)?.label ?? ruleFilter;
  const selectedCityLabel =
    cityFilter === 'all'
      ? pageText.all
      : cityOptions.find((option) => option.value === cityFilter)?.label ?? cityFilter;
  const hasActiveFilters = ruleFilter !== 'all' || cityFilter !== 'all';
  const visibleRuleOptions = useMemo(
    () => filterOptionsByQuery(ruleOptions, ruleSearch),
    [ruleOptions, ruleSearch],
  );
  const visibleCityOptions = useMemo(
    () => filterOptionsByQuery(cityOptions, citySearch),
    [cityOptions, citySearch],
  );
  const selectedSortLabel =
    ALERT_SORT_OPTIONS.find((option) => option.value === sortBy)?.label ?? pageText.sortLatest;
  const scopeBadges = [
    pageText.resultBadge(visibleAlerts.length),
    ...(hasActiveFilters ? [] : [`范围: ${pageText.allAlerts}`]),
    ...(cityFilter !== 'all' ? [`城市: ${selectedCityLabel}`] : []),
    ...(ruleFilter !== 'all' ? [`规则: ${selectedRuleLabel}`] : []),
    `排序: ${selectedSortLabel}`,
  ];
  const emptyStateText = hasMore
    ? hasActiveFilters || alerts.length > 0
      ? pageText.emptyCanLoadMore
      : pageText.emptyCanLoadMoreUnfiltered
    : pageText.empty;
  const shouldShowPagination =
    hasMore || alerts.length > 0 || total > 0 || Boolean(loadMoreError);
  const registerAlertCard = useCallback((id: string, node: HTMLElement | null) => {
    if (node) {
      alertCardNodesRef.current.set(id, node);
      return;
    }
    alertCardNodesRef.current.delete(id);
  }, []);

  useEffect(() => {
    const viewport = listViewportRef.current;
    if (!viewport) {
      return;
    }

    const syncViewportHeight = () => {
      const nextHeight = viewport.clientHeight;
      if (nextHeight > 0) {
        setViewportHeight((current) => (current === nextHeight ? current : nextHeight));
      }
    };

    syncViewportHeight();
    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(() => {
      syncViewportHeight();
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const liveIds = new Set(alerts.map((alert) => alert.id));
    for (const id of alertCardHeightsRef.current.keys()) {
      if (!liveIds.has(id)) {
        alertCardHeightsRef.current.delete(id);
      }
    }
    for (const id of alertCardNodesRef.current.keys()) {
      if (!liveIds.has(id)) {
        alertCardNodesRef.current.delete(id);
      }
    }
  }, [alerts]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      let changed = false;
      for (const [id, node] of alertCardNodesRef.current.entries()) {
        const nextHeight = Math.ceil(node.getBoundingClientRect().height);
        if (!nextHeight || alertCardHeightsRef.current.get(id) === nextHeight) {
          continue;
        }
        alertCardHeightsRef.current.set(id, nextHeight);
        changed = true;
      }
      if (changed) {
        setLayoutVersion((current) => current + 1);
      }
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [viewportHeight, visibleAlerts]);

  const virtualLayout = useMemo(() => {
    const offsets: number[] = [];
    const heights: number[] = [];
    let cursor = 0;

    for (const item of visibleAlerts) {
      offsets.push(cursor);
      const height = alertCardHeightsRef.current.get(item.alert.id) ?? ALERT_CARD_ESTIMATED_HEIGHT;
      heights.push(height);
      cursor += height + ALERT_CARD_GAP;
    }

    const totalHeight = cursor > 0 ? cursor - ALERT_CARD_GAP : 0;
    const overscanPx = ALERT_CARD_ESTIMATED_HEIGHT * ALERT_CARD_OVERSCAN;
    const viewportBottom = scrollTop + viewportHeight;
    let startIndex = 0;
    while (startIndex < visibleAlerts.length) {
      const itemBottom = offsets[startIndex] + heights[startIndex];
      if (itemBottom >= scrollTop - overscanPx) {
        break;
      }
      startIndex += 1;
    }

    let endIndex = startIndex;
    while (endIndex < visibleAlerts.length) {
      if (offsets[endIndex] > viewportBottom + overscanPx) {
        break;
      }
      endIndex += 1;
    }

    return {
      offsets,
      heights,
      totalHeight,
      startIndex,
      endIndex,
    };
  }, [layoutVersion, scrollTop, viewportHeight, visibleAlerts]);

  const virtualItems = useMemo(
    () =>
      visibleAlerts.slice(virtualLayout.startIndex, virtualLayout.endIndex).map((item, index) => {
        const itemIndex = virtualLayout.startIndex + index;
        return {
          item,
          top: virtualLayout.offsets[itemIndex] ?? 0,
        };
      }),
    [visibleAlerts, virtualLayout.endIndex, virtualLayout.offsets, virtualLayout.startIndex],
  );

  useEffect(() => {
    if (ruleFilter !== 'all' && !ruleOptions.some((option) => option.value === ruleFilter)) {
      setRuleFilter('all');
    }
  }, [ruleFilter, ruleOptions]);

  useEffect(() => {
    if (cityFilter !== 'all' && !cityOptions.some((option) => option.value === cityFilter)) {
      setCityFilter('all');
    }
  }, [cityFilter, cityOptions]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(
      ALERT_CENTER_STORAGE_KEY,
      JSON.stringify({
        ruleFilter,
        cityFilter,
        ruleSearch,
        citySearch,
        sortBy,
      } satisfies AlertCenterPersistedState),
    );
  }, [cityFilter, citySearch, ruleFilter, ruleSearch, sortBy]);

  useEffect(() => {
    if (!focusAlertId) {
      return;
    }

    setCityFilter('all');
    setRuleFilter('all');
    setCitySearch('');
    setRuleSearch('');
    setSortBy('latest');
    setHighlightedAlertId(focusAlertId);
  }, [focusAlertId]);

  useEffect(() => {
    const viewport = listViewportRef.current;
    if (!viewport) {
      return;
    }

    viewport.scrollTop = 0;
    setScrollTop(0);
  }, [cityFilter, ruleFilter, sortBy]);

  useEffect(() => {
    if (!highlightedAlertId) {
      return;
    }

    const highlightedIndex = visibleAlerts.findIndex((item) => item.alert.id === highlightedAlertId);
    if (highlightedIndex < 0) {
      return;
    }

    const viewport = listViewportRef.current;
    if (viewport) {
      const top = virtualLayout.offsets[highlightedIndex] ?? 0;
      const height =
        virtualLayout.heights[highlightedIndex] ?? ALERT_CARD_ESTIMATED_HEIGHT;
      const bottom = top + height;
      const viewportBottom = viewport.scrollTop + viewportHeight;
      if (top < viewport.scrollTop || bottom > viewportBottom) {
        const nextTop = Math.max(top - 24, 0);
        if (typeof viewport.scrollTo === 'function') {
          viewport.scrollTo({ top: nextTop, behavior: 'smooth' });
        } else {
          viewport.scrollTop = nextTop;
        }
        setScrollTop(nextTop);
      }
    }

    const frame = window.requestAnimationFrame(() => {
      const target = document.getElementById(`alert-center-card-${highlightedAlertId}`);
      target?.focus({ preventScroll: true });
    });
    const timeout = window.setTimeout(() => {
      setHighlightedAlertId((current) => (current === highlightedAlertId ? null : current));
    }, 4_500);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
    };
  }, [highlightedAlertId, viewportHeight, virtualLayout.heights, virtualLayout.offsets, visibleAlerts]);

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
          <div className="alert-center-hero">
            <div className="alert-center-hero__copy">
              <span>{pageText.eyebrow}</span>
              <h3>{pageText.headline}</h3>
              <p>{pageText.hint}</p>
            </div>
            <div className="alert-center-stats">
              <div>
                <span>{pageText.total}</span>
                <strong>{stats.total}</strong>
              </div>
              <div>
                <span>{pageText.cityCount}</span>
                <strong>{stats.cityCount}</strong>
              </div>
              <div>
                <span>{pageText.ruleCount}</span>
                <strong>{stats.ruleCount}</strong>
              </div>
              <div>
                <span>{pageText.latest}</span>
                <strong>{stats.latest}</strong>
              </div>
            </div>
          </div>

          <div className="alert-center-filters">
            <div className="alert-center-filters__head">
              <div className="alert-center-filters__scope">
                <span>{pageText.currentScope}</span>
                <div className="alert-center-filters__scope-badges">
                  {scopeBadges.map((badge) => (
                    <span key={badge} className="alert-center-filters__scope-badge">
                      {badge}
                    </span>
                  ))}
                </div>
              </div>
              {hasActiveFilters ? (
                <button
                  type="button"
                  className="alert-center-filter-reset"
                  onClick={() => {
                    setCityFilter('all');
                    setRuleFilter('all');
                    setCitySearch('');
                    setRuleSearch('');
                  }}
                >
                  {pageText.clearFilters}
                </button>
              ) : null}
            </div>

            <div className="alert-center-filter-layout">
              {renderFilterChips(
                pageText.cityFilter,
                visibleCityOptions,
                cityFilter,
                selectedCityLabel,
                stats.cityCount,
                citySearch,
                pageText.citySearchPlaceholder,
                setCityFilter,
                setCitySearch,
              )}
              {renderFilterChips(
                pageText.ruleFilter,
                visibleRuleOptions,
                ruleFilter,
                selectedRuleLabel,
                stats.ruleCount,
                ruleSearch,
                pageText.ruleSearchPlaceholder,
                setRuleFilter,
                setRuleSearch,
              )}
            </div>

            {renderSortChips(sortBy, setSortBy)}
          </div>

          {visibleAlerts.length > 0 ? (
            <div className="alert-center-list-shell">
              <div
                ref={listViewportRef}
                className="alert-center-list-viewport"
                onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
              >
                <div className="alert-center-list" style={{ height: virtualLayout.totalHeight }}>
                  {virtualItems.map(({ item, top }) => (
                    <div key={item.alert.id} className="alert-center-list__row" style={{ top }}>
                      <AlertCenterCard
                        model={item}
                        highlighted={highlightedAlertId === item.alert.id}
                        formatDateTime={formatDateTime}
                        registerCard={registerAlertCard}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="alert-center-empty">{emptyStateText}</div>
          )}

          {shouldShowPagination ? (
            <div className="alert-center-pagination">
              <span className="alert-center-pagination__summary">
                {pageText.loadedSummary(alerts.length, total)}
              </span>
              {hasMore ? (
                <button
                  type="button"
                  className="ghost-button"
                  disabled={loadingMore}
                  onClick={onLoadMore}
                >
                  {loadingMore ? pageText.loadingMore : pageText.loadMore}
                </button>
              ) : (
                <span className="alert-center-pagination__status">{pageText.allLoaded}</span>
              )}
              {loadMoreError ? (
                <p className="alert-center-pagination__error" role="alert">
                  {loadMoreError}
                </p>
              ) : null}
            </div>
          ) : null}
        </section>
      </section>
    </section>
  );
};
