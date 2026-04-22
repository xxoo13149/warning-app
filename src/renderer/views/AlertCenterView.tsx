import { useEffect, useMemo, useState } from 'react';

import { useI18n } from '../i18n';
import type { AlertEvent } from '../types/contracts';
import { buildAlertPresentation, type AlertPresentation } from '../utils/alert-summary';

interface AlertCenterViewProps {
  alerts: AlertEvent[];
}

interface AlertViewModel {
  alert: AlertEvent;
  presentation: AlertPresentation;
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
  rowsInFilter: (count: number) => `当前显示 ${count} 条`,
  eyebrow: '告警工作台',
  headline: '按城市和规则看清触发点',
  hint: '这里不展示无关状态，只保留城市、规则、温度区间和盘口数值，方便快速判断是否需要行动。',
  total: '告警记录',
  cityCount: '涉及城市',
  ruleCount: '规则类型',
  latest: '最近触发',
  all: '全部',
  currentScope: '当前范围',
  allAlerts: '全部告警',
  clearFilters: '清空筛选',
  clearSearch: '清空搜索',
  currentSelected: '当前',
  sortLabel: '排序方式',
  sortLatest: '最近触发',
  sortCity: '按城市',
  sortRule: '按规则',
  ruleFilter: '按规则查看',
  cityFilter: '按城市查看',
  citySearchPlaceholder: '搜索城市',
  ruleSearchPlaceholder: '搜索规则',
  noMatches: '没有匹配项',
  facts: '当前盘口',
  context: '快速定位',
  happenedAt: '触发时间',
  city: '城市',
  rule: '规则',
  band: '温度区间',
  marketId: '盘口编号',
  empty: '当前筛选下没有告警。',
  noLatest: '暂无',
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
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, 'zh-CN'));

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
      const byCity = left.presentation.cityLabel.localeCompare(right.presentation.cityLabel, 'zh-CN');
      if (byCity !== 0) {
        return byCity;
      }
      const byRule = left.presentation.ruleLabel.localeCompare(right.presentation.ruleLabel, 'zh-CN');
      if (byRule !== 0) {
        return byRule;
      }
      return compareAlertTime(left, right);
    }

    if (sortBy === 'rule') {
      const byRule = left.presentation.ruleLabel.localeCompare(right.presentation.ruleLabel, 'zh-CN');
      if (byRule !== 0) {
        return byRule;
      }
      const byCity = left.presentation.cityLabel.localeCompare(right.presentation.cityLabel, 'zh-CN');
      if (byCity !== 0) {
        return byCity;
      }
      return compareAlertTime(left, right);
    }

    return compareAlertTime(left, right);
  });

const getPresentationContextValue = (presentation: AlertPresentation, label: string) =>
  presentation.context.find((item) => item.label === label)?.value ?? '';

const sanitizeCardDetail = (detail: string | null) => {
  if (!detail) {
    return null;
  }

  const parts = detail
    .split(' · ')
    .map((part) => part.trim())
    .filter(
      (part) =>
        part.length > 0 &&
        !part.startsWith(`${pageText.band}：`) &&
        !part.startsWith(`${pageText.marketId}：`),
    );

  return parts.length > 0 ? parts.join(' · ') : null;
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
      <span>{label}</span>
      <strong>
        {pageText.currentSelected}：{selectedValue === 'all' ? pageText.all : selectedLabel}
      </strong>
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
        <span>{pageText.all}</span>
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
        {searchPlaceholder}：{pageText.noMatches}
      </div>
    ) : null}
  </div>
);

const renderSortChips = (selectedValue: AlertSortKey, onSelect: (value: AlertSortKey) => void) => (
  <div className="alert-center-filter-group">
    <div className="alert-center-filter-group__head">
      <span>{pageText.sortLabel}</span>
      <strong>
        {pageText.currentSelected}：
        {ALERT_SORT_OPTIONS.find((option) => option.value === selectedValue)?.label ?? pageText.sortLatest}
      </strong>
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

export const AlertCenterView = ({ alerts }: AlertCenterViewProps) => {
  const { formatDateTime } = useI18n();
  const persistedState = useMemo(readPersistedAlertCenterState, []);
  const [ruleFilter, setRuleFilter] = useState(persistedState.ruleFilter);
  const [cityFilter, setCityFilter] = useState(persistedState.cityFilter);
  const [ruleSearch, setRuleSearch] = useState(persistedState.ruleSearch);
  const [citySearch, setCitySearch] = useState(persistedState.citySearch);
  const [sortBy, setSortBy] = useState<AlertSortKey>(persistedState.sortBy);

  const alertModels = useMemo<AlertViewModel[]>(
    () =>
      [...alerts]
        .map((alert) => ({
          alert,
          presentation: buildAlertPresentation(alert),
        }))
        .sort(compareAlertTime),
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
    () =>
      sortAlertModels(
        alertModels.filter(
        (item) =>
          (ruleFilter === 'all' || item.presentation.ruleLabel === ruleFilter) &&
          (cityFilter === 'all' || item.presentation.cityLabel === cityFilter),
        ),
        sortBy,
      ),
    [alertModels, cityFilter, ruleFilter, sortBy],
  );

  const stats = useMemo(() => {
    const latestTime = getLatestAlertTime(alertModels);
    return {
      total: alertModels.length,
      cityCount: countBy(alertModels, (item) => item.presentation.cityLabel).size,
      ruleCount: countBy(alertModels, (item) => item.presentation.ruleLabel).size,
      latest: latestTime > 0 ? formatDateTime(new Date(latestTime).toISOString()) : pageText.noLatest,
    };
  }, [alertModels, formatDateTime]);

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
    ...(hasActiveFilters ? [`城市 · ${selectedCityLabel}`, `规则 · ${selectedRuleLabel}`] : [pageText.allAlerts]),
    `排序 · ${selectedSortLabel}`,
  ];

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
            {renderSortChips(sortBy, setSortBy)}
          </div>

          {visibleAlerts.length > 0 ? (
            <div className="alert-center-list">
              {visibleAlerts.map(({ alert, presentation }) => (
                (() => {
                  const temperatureBand = getPresentationContextValue(presentation, pageText.band);
                  const marketId = getPresentationContextValue(presentation, pageText.marketId);
                  const detailText = sanitizeCardDetail(presentation.detail);
                  const badges = [
                    `${pageText.city} · ${presentation.cityLabel}`,
                    `${pageText.rule} · ${presentation.ruleLabel}`,
                    ...(temperatureBand ? [`温区 · ${temperatureBand}`] : []),
                  ];
                  const quickFacts = [
                    { label: pageText.city, value: presentation.cityLabel },
                    ...(temperatureBand ? [{ label: pageText.band, value: temperatureBand }] : []),
                    ...(marketId ? [{ label: pageText.marketId, value: marketId }] : []),
                    { label: pageText.happenedAt, value: formatDateTime(alert.triggeredAt) },
                  ];

                  return (
                    <article key={alert.id} className="alert-center-card">
                      <div className="alert-center-card__main">
                        <div className="alert-center-card__top">
                          <div className="alert-center-card__header-copy">
                            <div className="alert-center-card__badges">
                              {badges.map((badge) => (
                                <span
                                  key={`${alert.id}-${badge}`}
                                  className="alert-center-card__status"
                                >
                                  {badge}
                                </span>
                              ))}
                            </div>
                            <h3>{presentation.summary}</h3>
                          </div>
                          <time
                            className="alert-center-card__time"
                            dateTime={alert.triggeredAt}
                          >
                            {formatDateTime(alert.triggeredAt)}
                          </time>
                        </div>

                        {detailText ? (
                          <p className="alert-center-card__detail">{detailText}</p>
                        ) : null}

                        <div className="alert-center-card__facts" aria-label={pageText.facts}>
                          {presentation.facts.map((fact, index) => (
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
                })()
              ))}
            </div>
          ) : (
            <div className="alert-center-empty">{pageText.empty}</div>
          )}
        </section>
      </section>
    </section>
  );
};
