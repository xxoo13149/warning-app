import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

import {
  formatBuiltinRuleDescription,
  formatBuiltinRuleName,
  formatMetricLabel,
  formatOperatorLabel,
  formatSideLabel,
  type BuiltinRuleKey,
} from '../shared/alert-display';
import type { AppLanguage, FeedMode, OrderSide, Severity } from './types/contracts';

const messages = {
  'zh-CN': {
    appLoading: '正在加载本地监控状态...',
    brandTitle: '天气预警台',
    brandSubtitle: '盘口监控',
    workspaceAria: '工作区导航',
    nav: {
      dashboard: { label: '监控总览', hint: '总览首页' },
      explorer: { label: '市场探索', hint: '完整工作台' },
      alerts: { label: '告警中心', hint: '事件与处理' },
      rules: { label: '规则设置', hint: '系统与运行控制' },
    },
    topbar: {
      headline: '天气盘口监控台',
      shards: '分片',
      tokens: '订阅数',
      latency: '延迟',
      markets: '盘口',
      alerts: '未确认告警',
      lastSync: '最近同步',
      refresh: '刷新',
      language: '语言',
    },
    common: {
      live: '实时',
      mock: '模拟',
      degraded: '降级',
      connected: '已连接',
      disconnected: '未连接',
      enabled: '已启用',
      disabled: '已关闭',
      yes: '是',
      no: '否',
      all: '全部',
      time: '时间',
      city: '城市',
      date: '日期',
      severity: '级别',
      message: '摘要',
      market: '盘口',
      status: '状态',
      updated: '更新时间',
      acknowledgement: '确认',
      noData: '暂无数据',
      details: '详情',
      close: '关闭',
      system: '系统',
      rule: '规则',
      value: '数值',
      hint: '说明',
      temperatureBand: '温度区间',
    },
    dashboard: {
      title: '气泡监控总览',
      subtitle: '把同一天的全部监控盘口放进一张稳定的实时画布，优先看真正有风险的点。',
      dateLabel: '预测日期',
      scopeLabel: '展示范围',
      scopeAll: '全部盘口',
      scopeWatchlist: '仅关注盘口',
      scopeActive: '仅异常盘口',
      boardTitle: '实时气泡画布',
      boardHint: '单击查看右侧详情，双击跳到市场探索。',
      sideTitle: '盘口侧栏',
      sideHint: '当前选中盘口、相关告警与服务摘要。',
      serviceTitle: '服务摘要',
      serviceHint: '连接状态和数据新鲜度保留在右侧，首页主体专注盘口本身。',
      alertsTitle: '关键告警',
      alertsHint: '这里只保留最近且最重要的相关告警。',
      emptyDate: '当前日期下没有可展示的盘口。',
      noSelection: '点击一个泡泡后，这里会显示该盘口的核心信息。',
      latestAlertsEmpty: '当前没有需要优先处理的告警。',
      selectedMarket: '选中盘口',
      openExplorer: '查看完整详情',
      yesPrice: '“是”价格',
      bid: '买一',
      ask: '卖一',
      spread: '价差',
      change5m: '5分钟变化',
      updatedAt: '最近更新',
      eventDate: '预测日期',
      temperatureBand: '温度区间',
      bubbleLegendTitle: '编码说明',
      bubbleLegendSize: '大小表示风险分数',
      bubbleLegendColor: '颜色表示风险级别',
      bubbleLegendMotion: '动画表示当前活跃度与交互反馈',
      bubbleScore: '风险分数',
      bubbleSeverity: '主导风险',
      bubbleUpdatedAt: '分数更新时间',
      relatedAlerts: '相关告警',
      scoreHint: '最近 15 分钟告警强度聚合',
      serviceMini: '连接摘要',
    },
    explorer: {
      title: '市场探索',
      summary: (rows: number, total: number) => `当前展示 ${rows} / ${total} 个盘口`,
      cityKey: '城市筛选',
      cityPlaceholder: '输入城市标识或城市名',
      eventDate: '预测日期',
      sortBy: '排序字段',
      order: '排序方向',
      watchlistOnly: '仅关注盘口',
      requery: '重新查询',
      airport: '机场',
      noPrice: '“否”价格',
      desc: '降序',
      asc: '升序',
      advanced: '高级信息',
      noRows: '当前筛选条件下没有盘口。',
    },
    alerts: {
      title: '告警中心',
      rowsInFilter: (count: number) => `当前筛选结果 ${count} 条`,
      severity: '告警级别',
      acknowledgement: '确认状态',
      unackedOnly: '仅看未确认',
      rule: '触发规则',
      acknowledged: '已确认',
      acknowledge: '确认告警',
      copyDetails: '复制详情',
      hiddenIds: '原始 ID 已下沉到详情，不在主表直接显示。',
    },
    settings: {
      rulesTitle: '规则管理',
      rulesHint: (count: number) => `当前共 ${count} 条规则`,
      settingsTitle: '应用设置',
      settingsHint: '声音、重连、静音时段与后台运行控制。',
      builtinRules: '系统规则',
      customRules: '自定义规则',
      builtinRulesHint: '系统内置规则优先显示中文自然语言说明。',
      customRulesHint: '自定义规则保留你自己命名的标题。',
      enabled: '启用',
      name: '规则名称',
      metric: '指标',
      threshold: '阈值',
      cooldown: '冷却',
      bubbleWeight: '风险权重',
      saveRules: '保存规则',
      startOnBoot: '开机自启',
      backgroundAudio: '后台播放提示音',
      reconnectPolicy: '重连策略',
      pollInterval: '轮询间隔（秒）',
      quietStart: '静音开始',
      quietEnd: '静音结束',
      soundProfile: '提示音',
      applySound: '应用提示音',
      cityImport: '城市 / 机场映射导入',
      cityImportPlaceholder: '每行一条：城市标识,机场代码',
      importCityMapping: '导入映射',
      saveSettings: '保存设置',
      processStoppedHint: '监控进程未运行，部分设置变更会在后台恢复后生效。',
      runtimeControl: '运行控制',
      runtimeControlHint: '可以关闭通知、停止监控，或完全退出应用。',
      notifications: '通知',
      process: '监控进程',
      notificationsOff: '关闭通知',
      notificationsOn: '开启通知',
      processStop: '停止监控',
      processStart: '启动监控',
      quitAll: '完全退出',
      stopProcessConfirm: '确认停止后台监控？停止后将不再抓取实时盘口。',
      startProcessConfirm: '确认启动后台监控？',
      quitAllConfirm: '确认完全退出应用？这会关闭窗口、托盘和后台进程。',
      notificationsHint: '关闭后不再接收系统通知和自定义提示音。',
      processHint: '窗口仍可打开，但后台将停止抓取最新盘口。',
      actionStarting: '正在启动监控...',
      actionStartingCheck: '监控已启动，正在等待数据流接入...',
      actionStarted: '监控已启动，实时数据已经恢复。',
      actionStartedPending: '监控已就绪，但数据流仍在连接或重连中。',
      actionStopping: '正在停止监控...',
      actionStopped: '监控已停止。',
      actionNotificationsOn: '正在开启通知...',
      actionNotificationsOff: '正在关闭通知...',
      actionNotificationsOnDone: '通知已开启。',
      actionNotificationsOffDone: '通知已关闭。',
      actionQuitting: '正在退出应用...',
      actionUnknownError: '操作失败，请稍后重试。',
      actionStatusTitle: '执行状态',
      processButtonStarting: '启动中...',
      processButtonStopping: '停止中...',
      quickControlTitle: '快速控制',
      quickControlHint: '把运行开关、通知和退出操作集中在一个地方。',
    },
    policies: {
      aggressive: '积极',
      balanced: '均衡',
      conservative: '保守',
    },
    sortBy: {
      volume24h: '24小时成交量',
      change5m: '5分钟变化',
      spread: '价差',
      updatedAt: '更新时间',
    },
    status: {
      active: '活跃',
      halted: '暂停',
      resolved: '已结算',
    },
    severity: {
      critical: '关键',
      warning: '警告',
      info: '提示',
    },
  },
  'en-US': {
    appLoading: 'Loading local monitor state...',
    brandTitle: 'Polymarket',
    brandSubtitle: 'Weather Monitor',
    workspaceAria: 'workspace navigation',
    nav: {
      dashboard: { label: 'Bubble Board', hint: 'Live overview' },
      explorer: { label: 'Market Explorer', hint: 'Full workspace' },
      alerts: { label: 'Alert Center', hint: 'Events & handling' },
      rules: { label: 'Rules & Settings', hint: 'System & runtime' },
    },
    topbar: {
      headline: 'Weather Market Monitor',
      shards: 'Shards',
      tokens: 'Tokens',
      latency: 'Latency',
      markets: 'Markets',
      alerts: 'Unacked Alerts',
      lastSync: 'Last Sync',
      refresh: 'Refresh',
      language: 'Language',
    },
    common: {
      live: 'Live',
      mock: 'Mock',
      degraded: 'Degraded',
      connected: 'Connected',
      disconnected: 'Disconnected',
      enabled: 'Enabled',
      disabled: 'Disabled',
      yes: 'YES',
      no: 'NO',
      all: 'All',
      time: 'Time',
      city: 'City',
      date: 'Date',
      severity: 'Severity',
      message: 'Summary',
      market: 'Market',
      status: 'Status',
      updated: 'Updated',
      acknowledgement: 'Ack',
      noData: 'No data',
      details: 'Details',
      close: 'Close',
      system: 'System',
      rule: 'Rule',
      value: 'Value',
      hint: 'Hint',
      temperatureBand: 'Temperature Band',
    },
    dashboard: {
      title: 'Bubble Monitor Board',
      subtitle: 'Show every monitored market for the selected date on a stable live canvas.',
      dateLabel: 'Target Date',
      scopeLabel: 'Scope',
      scopeAll: 'All Markets',
      scopeWatchlist: 'Watchlist Only',
      scopeActive: 'Alerts Only',
      boardTitle: 'Live Bubble Canvas',
      boardHint: 'Single-click to inspect, double-click to open the full explorer.',
      sideTitle: 'Market Sidebar',
      sideHint: 'Selected market, related alerts, and service summary.',
      serviceTitle: 'Service Summary',
      serviceHint: 'Connection and freshness stay secondary to the main canvas.',
      alertsTitle: 'Key Alerts',
      alertsHint: 'Only the most important recent alerts are shown here.',
      emptyDate: 'No markets are available for the selected date.',
      noSelection: 'Select a bubble to inspect the market.',
      latestAlertsEmpty: 'No priority alerts right now.',
      selectedMarket: 'Selected Market',
      openExplorer: 'Open Full Details',
      yesPrice: 'YES Price',
      bid: 'Bid',
      ask: 'Ask',
      spread: 'Spread',
      change5m: '5m Change',
      updatedAt: 'Updated',
      eventDate: 'Target Date',
      temperatureBand: 'Temperature Band',
      bubbleLegendTitle: 'Encoding',
      bubbleLegendSize: 'Size shows risk score',
      bubbleLegendColor: 'Color shows risk level',
      bubbleLegendMotion: 'Motion shows activity and interaction feedback',
      bubbleScore: 'Risk Score',
      bubbleSeverity: 'Dominant Risk',
      bubbleUpdatedAt: 'Score Updated',
      relatedAlerts: 'Related Alerts',
      scoreHint: 'Aggregated from alerts in the last 15 minutes',
      serviceMini: 'Connection Summary',
    },
    explorer: {
      title: 'Market Explorer',
      summary: (rows: number, total: number) => `Showing ${rows} / ${total} markets`,
      cityKey: 'City Filter',
      cityPlaceholder: 'e.g. new-york',
      eventDate: 'Target Date',
      sortBy: 'Sort By',
      order: 'Order',
      watchlistOnly: 'Watchlist Only',
      requery: 'Refresh',
      airport: 'Airport',
      noPrice: 'NO Price',
      desc: 'Desc',
      asc: 'Asc',
      advanced: 'Advanced',
      noRows: 'No markets match the current filter.',
    },
    alerts: {
      title: 'Alert Center',
      rowsInFilter: (count: number) => `${count} rows in current filter`,
      severity: 'Severity',
      acknowledgement: 'Ack Status',
      unackedOnly: 'Unacked Only',
      rule: 'Rule',
      acknowledged: 'Acknowledged',
      acknowledge: 'Acknowledge',
      copyDetails: 'Copy Details',
      hiddenIds: 'Raw ids are hidden from the main table and moved into details.',
    },
    settings: {
      rulesTitle: 'Rule Management',
      rulesHint: (count: number) => `${count} configured rules`,
      settingsTitle: 'App Settings',
      settingsHint: 'Sound, reconnect, quiet hours, and runtime controls.',
      builtinRules: 'Built-in Rules',
      customRules: 'Custom Rules',
      builtinRulesHint: 'Built-in rules are shown in natural language first.',
      customRulesHint: 'Custom rules keep the user-defined name.',
      enabled: 'Enabled',
      name: 'Rule Name',
      metric: 'Metric',
      threshold: 'Threshold',
      cooldown: 'Cooldown',
      bubbleWeight: 'Bubble Weight',
      saveRules: 'Save Rules',
      startOnBoot: 'Start on Boot',
      backgroundAudio: 'Play Audio in Background',
      reconnectPolicy: 'Reconnect Policy',
      pollInterval: 'Poll Interval (sec)',
      quietStart: 'Quiet Start',
      quietEnd: 'Quiet End',
      soundProfile: 'Sound Profile',
      applySound: 'Apply Sound',
      cityImport: 'City / Airport Import',
      cityImportPlaceholder: 'new-york,KJFK\nlos-angeles,KLAX',
      importCityMapping: 'Import Mapping',
      saveSettings: 'Save Settings',
      processStoppedHint: 'The monitor process is stopped, so some changes will wait until it restarts.',
      runtimeControl: 'Runtime Control',
      runtimeControlHint: 'Disable notifications, stop monitoring, or fully exit the app.',
      notifications: 'Notifications',
      process: 'Monitor Process',
      notificationsOff: 'Disable Notifications',
      notificationsOn: 'Enable Notifications',
      processStop: 'Stop Monitor',
      processStart: 'Start Monitor',
      quitAll: 'Quit App',
      stopProcessConfirm: 'Stop the background monitor?',
      startProcessConfirm: 'Start the background monitor?',
      quitAllConfirm: 'Quit the app completely?',
      notificationsHint: 'Stops Windows notifications and custom sound playback.',
      processHint: 'The window stays open, but live market ingestion stops.',
      actionStarting: 'Starting monitor...',
      actionStartingCheck: 'Monitor started, waiting for the live feed...',
      actionStarted: 'Monitor started and live data is back.',
      actionStartedPending: 'Monitor is ready, but the feed is still connecting or retrying.',
      actionStopping: 'Stopping monitor...',
      actionStopped: 'Monitor stopped.',
      actionNotificationsOn: 'Enabling notifications...',
      actionNotificationsOff: 'Disabling notifications...',
      actionNotificationsOnDone: 'Notifications enabled.',
      actionNotificationsOffDone: 'Notifications disabled.',
      actionQuitting: 'Closing app...',
      actionUnknownError: 'Operation failed. Please retry.',
      actionStatusTitle: 'Execution Status',
      processButtonStarting: 'Starting...',
      processButtonStopping: 'Stopping...',
      quickControlTitle: 'Quick Controls',
      quickControlHint: 'Keep runtime toggles and exit controls in one focused area.',
    },
    policies: {
      aggressive: 'Aggressive',
      balanced: 'Balanced',
      conservative: 'Conservative',
    },
    sortBy: {
      volume24h: '24h Volume',
      change5m: '5m Change',
      spread: 'Spread',
      updatedAt: 'Updated',
    },
    status: {
      active: 'Active',
      halted: 'Halted',
      resolved: 'Resolved',
    },
    severity: {
      critical: 'Critical',
      warning: 'Warning',
      info: 'Info',
    },
  },
};

type MessageShape = (typeof messages)['zh-CN'];

interface I18nContextValue {
  language: AppLanguage;
  setLanguage: (language: AppLanguage) => void;
  copy: MessageShape;
  formatTime: (value: string) => string;
  formatDateTime: (value: string) => string;
  severityLabel: (severity: Severity) => string;
  statusLabel: (status: 'active' | 'halted' | 'resolved') => string;
  modeLabel: (mode: FeedMode) => string;
  policyLabel: (policy: 'aggressive' | 'balanced' | 'conservative') => string;
  sortByLabel: (key: 'volume24h' | 'change5m' | 'spread' | 'updatedAt') => string;
  metricLabel: (metric: string, includeAlias?: boolean) => string;
  operatorLabel: (operator: string, includeAlias?: boolean) => string;
  builtinRuleName: (
    builtinKey?: BuiltinRuleKey | null,
    includeAlias?: boolean,
  ) => string | null;
  builtinRuleDescription: (builtinKey?: BuiltinRuleKey | null) => string | null;
  sideLabel: (side: OrderSide) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

const readInitialLanguage = (): AppLanguage => {
  return 'zh-CN';
};

export const LocaleProvider = ({ children }: { children: ReactNode }) => {
  const [language, setLanguageState] = useState<AppLanguage>(readInitialLanguage);

  const value = useMemo<I18nContextValue>(() => {
    const copy = messages[language];
    const setLanguage = (nextLanguage: AppLanguage) => {
      void nextLanguage;
      setLanguageState('zh-CN');
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem('polymarket-weather-monitor.language.v3');
      }
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

    const formatDateTime = (value: string) => {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) {
        return '--';
      }
      return new Intl.DateTimeFormat(language, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }).format(date);
    };

    return {
      language,
      setLanguage,
      copy,
      formatTime,
      formatDateTime,
      severityLabel: (severity) => copy.severity[severity],
      statusLabel: (status) => copy.status[status],
      modeLabel: (mode) => copy.common[mode],
      policyLabel: (policy) => copy.policies[policy],
      sortByLabel: (key) => copy.sortBy[key],
      metricLabel: (metric, includeAlias = false) =>
        formatMetricLabel(metric, language, includeAlias),
      operatorLabel: (operator, includeAlias = false) =>
        formatOperatorLabel(operator, language, includeAlias),
      builtinRuleName: (builtinKey, includeAlias = false) =>
        formatBuiltinRuleName(builtinKey, language, includeAlias),
      builtinRuleDescription: (builtinKey) =>
        formatBuiltinRuleDescription(builtinKey, language),
      sideLabel: (side) => formatSideLabel(side, language),
    };
  }, [language]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export const useI18n = () => {
  const value = useContext(I18nContext);
  if (!value) {
    throw new Error('useI18n must be used within LocaleProvider');
  }
  return value;
};
