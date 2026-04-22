import type { AppControlState, StartupStatus } from '@/shared/contracts';
import type {
  AlertEvent,
  AlertRule,
  AppHealth,
  AppSettings,
  DashboardSnapshot,
  MarketQuery,
  MarketQueryResult,
  MarketRow,
  RegisterSoundPayload,
  RulePreviewResult,
  SettingsPayload,
  SoundProfile,
} from '../types/contracts';
import type { WarningApiBridge, BridgeListener } from '../types/bridge';
import { BUILTIN_DEFAULT_SOUND_ID, BUILTIN_SOUND_LIBRARY } from '../../shared/sound-library';
import {
  createBuiltinRuleTemplateMap,
  createCustomRule,
  normalizeRuleDrafts,
  serializeRuleDrafts,
} from '../utils/rules-settings';

type ListenerMap = Map<string, Set<BridgeListener<unknown>>>;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const createId = () => globalThis.crypto?.randomUUID?.() ?? `mock-${Date.now().toString(36)}`;

const nowIso = () => new Date().toISOString();
const today = () => nowIso().slice(0, 10);

const MOCK_TEMPERATURE_BANDS = {
  tokyoMorning: '18℃ 至 20℃',
  tokyoNoon: '20℃ 至 22℃',
  newYorkCool: '15℃ 至 17℃',
  sydneyWarm: '23℃ 至 25℃',
} as const;

const MOCK_SOUND_NAME_LABELS: Record<string, string> = {
  'builtin-tick-soft': '轻柔滴答',
  'builtin-sonar-soft': '柔和声呐',
  'builtin-chime-short': '短铃提示',
  'builtin-double-ding': '双声叮咚',
  'builtin-high-bell': '高频铃声',
  'builtin-critical-siren': '紧急警报',
};

const getMockSoundName = (soundId: string, fallbackName: string) =>
  MOCK_SOUND_NAME_LABELS[soundId] ?? fallbackName;

const MOCK_MARKETS: MarketRow[] = [
  {
    marketId: 'market-tokyo-1',
    cityKey: 'tokyo',
    cityName: '东京',
    airportCode: 'RJTT',
    eventDate: today(),
    temperatureBand: MOCK_TEMPERATURE_BANDS.tokyoMorning,
    side: 'BOTH',
    yesPrice: 0.46,
    noPrice: 0.54,
    bestBid: 0.45,
    bestAsk: 0.47,
    spread: 0.02,
    change5m: 4.2,
    volume24h: 9800,
    status: 'active',
    bubbleScore: 72,
    bubbleSeverity: 'warning',
    bubbleUpdatedAt: nowIso(),
    updatedAt: nowIso(),
    watchlisted: true,
  },
  {
    marketId: 'market-tokyo-2',
    cityKey: 'tokyo',
    cityName: '东京',
    airportCode: 'RJTT',
    eventDate: today(),
    temperatureBand: MOCK_TEMPERATURE_BANDS.tokyoNoon,
    side: 'BOTH',
    yesPrice: 0.31,
    noPrice: 0.69,
    bestBid: 0.3,
    bestAsk: 0.32,
    spread: 0.02,
    change5m: -2.7,
    volume24h: 7600,
    status: 'active',
    bubbleScore: 41,
    bubbleSeverity: 'info',
    bubbleUpdatedAt: nowIso(),
    updatedAt: nowIso(),
    watchlisted: false,
  },
  {
    marketId: 'market-nyc-1',
    cityKey: 'new-york',
    cityName: '纽约',
    airportCode: 'KJFK',
    eventDate: today(),
    temperatureBand: MOCK_TEMPERATURE_BANDS.newYorkCool,
    side: 'BOTH',
    yesPrice: 0.64,
    noPrice: 0.36,
    bestBid: 0.62,
    bestAsk: 0.65,
    spread: 0.03,
    change5m: 6.9,
    volume24h: 12900,
    status: 'active',
    bubbleScore: 88,
    bubbleSeverity: 'critical',
    bubbleUpdatedAt: nowIso(),
    updatedAt: nowIso(),
    watchlisted: true,
  },
  {
    marketId: 'market-sydney-1',
    cityKey: 'sydney',
    cityName: '悉尼',
    airportCode: 'YSSY',
    eventDate: today(),
    temperatureBand: MOCK_TEMPERATURE_BANDS.sydneyWarm,
    side: 'BOTH',
    yesPrice: 0.52,
    noPrice: 0.48,
    bestBid: 0.5,
    bestAsk: 0.53,
    spread: 0.03,
    change5m: 1.8,
    volume24h: 6400,
    status: 'active',
    bubbleScore: 29,
    bubbleSeverity: 'none',
    bubbleUpdatedAt: nowIso(),
    updatedAt: nowIso(),
    watchlisted: false,
  },
];

const MOCK_ALERTS: AlertEvent[] = [
  {
    id: 'alert-critical-1',
    ruleId: 'spread-threshold',
    builtinKey: 'spread_threshold',
    triggeredAt: nowIso(),
    cityKey: 'new-york',
    marketId: 'market-nyc-1',
    tokenId: 'token-mock-1',
    message: '纽约 15℃ 至 17℃ 市场买卖价差快速扩大',
    severity: 'critical',
    acknowledged: false,
    soundProfileId: 'builtin-critical-siren',
  },
  {
    id: 'alert-warning-1',
    ruleId: 'price-change-5m',
    builtinKey: 'price_change_5m',
    triggeredAt: nowIso(),
    cityKey: 'tokyo',
    marketId: 'market-tokyo-1',
    tokenId: 'token-mock-2',
    message: '东京 18℃ 至 20℃ 市场 5 分钟价格快速上行',
    severity: 'warning',
    acknowledged: false,
    soundProfileId: 'builtin-double-ding',
  },
];

const DEFAULT_SETTINGS: AppSettings = {
  startOnBoot: false,
  backgroundAudio: true,
  reconnectPolicy: 'balanced',
  pollIntervalSec: 60,
  selectedSoundProfileId: BUILTIN_DEFAULT_SOUND_ID,
  quietHoursStart: '23:00',
  quietHoursEnd: '06:00',
};

const DEFAULT_HEALTH: AppHealth = {
  connected: true,
  mode: 'mock',
  shardActive: 1,
  shardTotal: 1,
  subscribedTokens: 24,
  reconnects: 0,
  latencyMs: 180,
  droppedEvents: 0,
  lastSyncAt: nowIso(),
  workerRunning: true,
  startupPhase: 'running',
  diagnostic: null,
  errorSource: null,
  serviceStatus: {
    coreWorker: 'running',
    discovery: 'ready',
    websocket: 'connected',
    dataFreshness: 'realtime',
    activeShards: 1,
    totalShards: 1,
    lagMs: 180,
    lastUpdateAt: nowIso(),
    lastError: null,
    lastErrorSource: null,
  },
};

const DEFAULT_STARTUP_STATUS: StartupStatus = {
  phase: 'ready',
  attempts: 1,
  maxAttempts: 3,
  startedAt: nowIso(),
  updatedAt: nowIso(),
  healthReason: null,
  lastError: null,
};

const DEFAULT_CONTROL_STATE: AppControlState = {
  notificationsEnabled: true,
  coreProcessRunning: true,
  startupStatus: DEFAULT_STARTUP_STATUS,
};

const createMockSoundProfiles = (): SoundProfile[] =>
  BUILTIN_SOUND_LIBRARY.map((sound) => ({
    id: sound.id,
    name: getMockSoundName(sound.id, sound.nameZh || sound.nameEn),
    filePath: `C:\\mock-sounds\\${sound.fileName}`,
    gain: sound.gain,
    enabled: true,
    isBuiltin: true,
    isDefault: sound.id === BUILTIN_DEFAULT_SOUND_ID,
  }));

const createMockRules = (): AlertRule[] => {
  const builtinMap = createBuiltinRuleTemplateMap('');
  const builtins = Array.from(builtinMap.values());
  const customRule = createCustomRule(
    {
      cityKey: 'tokyo',
      eventDate: today(),
      temperatureBand: MOCK_TEMPERATURE_BANDS.tokyoMorning,
      side: 'YES',
      marketId: '',
    },
    'builtin-double-ding',
  );

  customRule.name = '东京早盘价格突破';
  customRule.metric = 'price';
  customRule.operator = '>=';
  customRule.threshold = 0.55;
  customRule.windowSec = 180;
  customRule.cooldownSec = 240;
  customRule.dedupeWindowSec = 120;
  customRule.scope.seriesSlug = '东京天气早盘';
  customRule.quietHours = {
    startMinute: 60,
    endMinute: 360,
  };

  return normalizeRuleDrafts([...builtins, customRule]);
};

const matchesMarketQuery = (row: MarketRow, query: MarketQuery | undefined) => {
  if (!query) {
    return true;
  }
  if (query.cityKey && row.cityKey !== query.cityKey) {
    return false;
  }
  if (query.eventDate && row.eventDate !== query.eventDate) {
    return false;
  }
  if (query.side && query.side !== 'BOTH' && row.side !== query.side && row.side !== 'BOTH') {
    return false;
  }
  if (query.watchlistedOnly && !row.watchlisted) {
    return false;
  }
  return true;
};

const sortMarketRows = (rows: MarketRow[], query: MarketQuery | undefined) => {
  const sortBy = query?.sortBy ?? 'volume24h';
  const sortDir = query?.sortDir ?? 'desc';
  const direction = sortDir === 'asc' ? 1 : -1;

  return [...rows].sort((left, right) => {
    const leftValue = left[sortBy] ?? 0;
    const rightValue = right[sortBy] ?? 0;
    if (leftValue === rightValue) {
      return left.cityName.localeCompare(right.cityName) * direction;
    }
    return leftValue > rightValue ? direction : -direction;
  });
};

const buildDashboardSnapshot = (
  markets: MarketRow[],
  alerts: AlertEvent[],
  query?: { eventDate?: string; scope?: 'risk' | 'watchlist' | 'alerts' },
): DashboardSnapshot => {
  const availableDates = Array.from(new Set(markets.map((row) => row.eventDate))).sort();
  const selectedDate = query?.eventDate ?? availableDates[availableDates.length - 1] ?? today();
  const scopedMarkets = markets.filter((row) => row.eventDate === selectedDate);
  const grouped = new Map<string, MarketRow[]>();

  scopedMarkets.forEach((row) => {
    const key = `${row.cityKey}:${row.eventDate}`;
    const list = grouped.get(key) ?? [];
    list.push(row);
    grouped.set(key, list);
  });

  const rows = Array.from(grouped.values()).flatMap((group) => {
    const ordered = [...group].sort((left, right) => right.bubbleScore - left.bubbleScore);
    const dominant = ordered[0];
    if (!dominant) {
      return [];
    }
    const unackedAlertCount = alerts.filter(
      (alert) => !alert.acknowledged && alert.cityKey === dominant.cityKey,
    ).length;

    return [{
      cityKey: dominant.cityKey,
      cityName: dominant.cityName,
      airportCode: dominant.airportCode,
      eventDate: dominant.eventDate,
      marketCount: group.length,
      watchlisted: group.some((item) => item.watchlisted),
      unackedAlertCount,
      cityBubbleScore: Math.max(...group.map((item) => item.bubbleScore)),
      cityBubbleSeverity: ordered[0]?.bubbleSeverity ?? 'none',
      dominantMarketId: dominant.marketId,
      dominantTemperatureBand: dominant.temperatureBand,
      dominantYesPrice: dominant.yesPrice,
      dominantRuleName: alerts.find((alert) => alert.cityKey === dominant.cityKey)?.message ?? null,
      updatedAt: dominant.updatedAt,
      topMarkets: ordered.slice(0, 3).map((row) => ({
        marketId: row.marketId,
        temperatureBand: row.temperatureBand,
        yesPrice: row.yesPrice,
        bestBid: row.bestBid,
        bestAsk: row.bestAsk,
        spread: row.spread,
        change5m: row.change5m,
        bubbleScore: row.bubbleScore,
        bubbleSeverity: row.bubbleSeverity,
        updatedAt: row.updatedAt,
      })),
    }];
  });

  return {
    rows,
    coveredMarketCount: scopedMarkets.length,
    visibleCityCount: rows.length,
    totalCityCount: rows.length,
    hiddenCityCount: 0,
    selectedDate,
    scope: query?.scope ?? 'risk',
    availableDates,
    updatedAt: nowIso(),
  };
};

const buildPreview = (rule: AlertRule, markets: MarketRow[]): RulePreviewResult => {
  const matched = markets.filter((row) => {
    if (rule.scope?.cityKey && row.cityKey !== rule.scope.cityKey) {
      return false;
    }
    if (rule.scope?.eventDate && row.eventDate !== rule.scope.eventDate) {
      return false;
    }
    if (rule.scope?.temperatureBand && row.temperatureBand !== rule.scope.temperatureBand) {
      return false;
    }
    if (rule.scope?.marketId && row.marketId !== rule.scope.marketId) {
      return false;
    }
    if (
      rule.scope?.side &&
      rule.scope.side !== 'BOTH' &&
      row.side !== 'BOTH' &&
      row.side !== rule.scope.side
    ) {
      return false;
    }
    return true;
  });

  return {
    matchedCityCount: new Set(matched.map((row) => row.cityKey)).size,
    matchedMarketCount: matched.length,
    sampleMarkets: matched.slice(0, 3).map((row) => ({
      marketId: row.marketId,
      cityKey: row.cityKey,
      cityName: row.cityName,
      eventDate: row.eventDate,
      temperatureBand: row.temperatureBand,
      side: rule.scope?.side ?? 'BOTH',
      yesPrice: row.yesPrice,
      bestBid: row.bestBid,
      bestAsk: row.bestAsk,
      spread: row.spread,
      updatedAt: row.updatedAt,
    })),
  };
};

const buildSettingsPayload = (
  settings: AppSettings,
  soundProfiles: SoundProfile[],
): SettingsPayload => ({
  settings: clone(settings),
  soundProfiles: soundProfiles.map((profile) => ({
    ...profile,
    isDefault: profile.id === settings.selectedSoundProfileId,
  })),
});

export const createMockBridge = (): WarningApiBridge => {
  const listeners: ListenerMap = new Map();

  let health = clone(DEFAULT_HEALTH);
  let controlState = clone(DEFAULT_CONTROL_STATE);
  let settings = clone(DEFAULT_SETTINGS);
  let soundProfiles = createMockSoundProfiles();
  const markets = clone(MOCK_MARKETS);
  let alerts = clone(MOCK_ALERTS);
  let rules = createMockRules();

  const emit = (channel: string, payload: unknown) => {
    const bucket = listeners.get(channel);
    if (!bucket) {
      return;
    }
    bucket.forEach((listener) => {
      listener(clone(payload));
    });
  };

  const setDefaultSound = (soundId: string) => {
    settings = {
      ...settings,
      selectedSoundProfileId: soundId,
    };
    soundProfiles = soundProfiles.map((profile) => ({
      ...profile,
      isDefault: profile.id === soundId,
    }));
  };

  const registerSound = (payload?: RegisterSoundPayload): SettingsPayload => {
    const existing = payload?.id
      ? soundProfiles.find((profile) => profile.id === payload.id)
      : undefined;
    const soundId = payload?.id ?? `mock-sound-${createId().slice(0, 8)}`;
    const nextProfile: SoundProfile = {
      id: soundId,
      name:
        payload?.name?.trim() ||
        existing?.name ||
        `导入提示音 ${soundId.slice(-4)}`,
      filePath:
        payload?.filePath ?? existing?.filePath ?? `C:\\mock-sounds\\${soundId}.wav`,
      gain: payload?.gain ?? existing?.gain ?? 0.75,
      enabled: payload?.enabled ?? existing?.enabled ?? true,
      isBuiltin: payload?.isBuiltin ?? existing?.isBuiltin ?? false,
      isDefault:
        payload?.setAsDefault ?? existing?.isDefault ?? soundId === settings.selectedSoundProfileId,
    };

    const existingIndex = soundProfiles.findIndex((profile) => profile.id === soundId);
    if (existingIndex >= 0) {
      soundProfiles = soundProfiles.map((profile) =>
        profile.id === soundId ? nextProfile : profile,
      );
    } else {
      soundProfiles = [...soundProfiles, nextProfile];
    }

    if (nextProfile.isDefault || payload?.setAsDefault) {
      setDefaultSound(soundId);
    }

    return buildSettingsPayload(settings, soundProfiles);
  };

  return {
    async invoke<T>(channel: string, payload?: unknown): Promise<T> {
      switch (channel) {
        case 'app.getHealth':
          return clone(health) as T;
        case 'app.getControlState':
          return clone(controlState) as T;
        case 'app.control': {
          const action = (payload as { action?: string } | undefined)?.action;
          if (action === 'enableNotifications') {
            controlState = { ...controlState, notificationsEnabled: true };
          } else if (action === 'disableNotifications') {
            controlState = { ...controlState, notificationsEnabled: false };
          } else if (action === 'startMonitor') {
            controlState = {
              ...controlState,
              coreProcessRunning: true,
              startupStatus: {
                ...controlState.startupStatus,
                phase: 'ready',
                updatedAt: nowIso(),
              },
            };
            health = {
              ...health,
              workerRunning: true,
              connected: true,
              startupPhase: 'running',
              lastSyncAt: nowIso(),
            };
            emit('app.health', health);
          } else if (action === 'stopMonitor') {
            controlState = {
              ...controlState,
              coreProcessRunning: false,
              startupStatus: {
                ...controlState.startupStatus,
                phase: 'stopped',
                updatedAt: nowIso(),
              },
            };
            health = {
              ...health,
              workerRunning: false,
              connected: false,
              startupPhase: 'stopped',
              mode: 'degraded',
              lastSyncAt: nowIso(),
            };
            emit('app.health', health);
          }

          emit('app.controlState', controlState);
          return {
            ok: true,
            ...clone(controlState),
          } as T;
        }
        case 'dashboard.query':
          return buildDashboardSnapshot(
            markets,
            alerts,
            payload as { eventDate?: string; scope?: 'risk' | 'watchlist' | 'alerts' } | undefined,
          ) as T;
        case 'markets.query': {
          const query = payload as MarketQuery | undefined;
          const filtered = sortMarketRows(
            markets.filter((row) => matchesMarketQuery(row, query)),
            query,
          );
          const limit = query?.limit ?? filtered.length;
          const result: MarketQueryResult = {
            rows: filtered.slice(0, limit),
            total: filtered.length,
          };
          return result as T;
        }
        case 'alerts.list': {
          const query = payload as { limit?: number; acknowledged?: boolean } | undefined;
          const filtered = alerts.filter((alert) =>
            query?.acknowledged === undefined
              ? true
              : alert.acknowledged === query.acknowledged,
          );
          return {
            rows: clone(filtered.slice(0, query?.limit ?? 200)),
            total: filtered.length,
          } as T;
        }
        case 'alerts.ack': {
          const ids = Array.isArray((payload as { ids?: string[] } | undefined)?.ids)
            ? (payload as { ids: string[] }).ids
            : (payload as { id?: string } | undefined)?.id
              ? [(payload as { id: string }).id]
              : [];
          alerts = alerts.map((alert) =>
            ids.includes(alert.id) ? { ...alert, acknowledged: true } : alert,
          );
          return { ok: true, updated: ids.length } as T;
        }
        case 'rules.list':
          return { rows: clone(rules) } as T;
        case 'rules.preview':
          return buildPreview(payload as AlertRule, markets) as T;
        case 'rules.save': {
          const incomingRules = Array.isArray(payload)
            ? (payload as AlertRule[])
            : ((payload as { rules?: AlertRule[] } | undefined)?.rules ?? []);
          rules = normalizeRuleDrafts(incomingRules);
          return { rows: clone(rules) } as T;
        }
        case 'settings.get':
          return buildSettingsPayload(settings, soundProfiles) as T;
        case 'settings.update': {
          settings = {
            ...settings,
            ...(payload as Partial<AppSettings> | undefined),
          };
          if (
            !soundProfiles.some((profile) => profile.id === settings.selectedSoundProfileId)
          ) {
            setDefaultSound(BUILTIN_DEFAULT_SOUND_ID);
          } else {
            setDefaultSound(settings.selectedSoundProfileId);
          }
          return buildSettingsPayload(settings, soundProfiles) as T;
        }
        case 'settings.pickSound': {
          const soundId = (payload as { id?: string } | undefined)?.id;
          if (soundId && soundProfiles.some((profile) => profile.id === soundId)) {
            setDefaultSound(soundId);
            return buildSettingsPayload(settings, soundProfiles) as T;
          }
          return registerSound({
            name: '导入提示音',
            filePath: `C:\\mock-sounds\\imported-${createId().slice(0, 6)}.wav`,
            setAsDefault: true,
          }) as T;
        }
        case 'settings.registerSound':
          return registerSound(payload as RegisterSoundPayload | undefined) as T;
        case 'settings.previewSound':
          return { ok: true, played: true } as T;
        case 'settings.importCityMap':
          return { ok: true, imported: 0 } as T;
        default:
          throw new Error(`Unsupported mock channel: ${channel}`);
      }
    },
    on<T>(channel: string, listener: BridgeListener<T>) {
      const bucket = listeners.get(channel) ?? new Set<BridgeListener<unknown>>();
      bucket.add(listener as BridgeListener<unknown>);
      listeners.set(channel, bucket);

      if (channel === 'app.health') {
        listener(clone(health) as T);
      }
      if (channel === 'app.controlState') {
        listener(clone(controlState) as T);
      }

      return () => {
        bucket.delete(listener as BridgeListener<unknown>);
        if (bucket.size === 0) {
          listeners.delete(channel);
        }
      };
    },
    off<T>(channel: string, listener: BridgeListener<T>) {
      const bucket = listeners.get(channel);
      if (!bucket) {
        return;
      }
      bucket.delete(listener as BridgeListener<unknown>);
      if (bucket.size === 0) {
        listeners.delete(channel);
      }
    },
  };
};

export const createMockBridgeStateSignature = () => ({
  markets: clone(MOCK_MARKETS),
  alerts: clone(MOCK_ALERTS),
  rulesSignature: serializeRuleDrafts(createMockRules()),
  settings: clone(DEFAULT_SETTINGS),
});
