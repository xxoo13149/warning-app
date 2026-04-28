import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ipcBridge } from '../api/ipcBridge';
import { BubbleChart } from '../components/zip/BubbleChart';
import { Header } from '../components/zip/Header';
import { SettingsPanel } from '../components/zip/SettingsPanel';
import { useIpcSubscription } from '../hooks/useIpc';
import type {
  AlertEvent,
  AppHealth,
  DashboardQuery,
  DashboardSnapshot,
  DashboardTickPayload,
} from '../types/contracts';
import {
  buildBubblePhysicsSignature,
  buildDashboardBubbleData,
  buildDashboardBubblePhysicsData,
  buildDashboardBubbleStats,
  type PhysicsBubbleCityData,
} from '../utils/dashboard-bubble-adapter';
import { buildAlertPresentation } from '../utils/alert-summary';

interface DashboardViewProps {
  health: AppHealth;
  alerts: AlertEvent[];
  onOpenExplorer: (cityKey: string, eventDate: string) => void;
}

const EMPTY_SNAPSHOT: DashboardSnapshot = {
  rows: [],
  coveredMarketCount: 0,
  visibleCityCount: 0,
  totalCityCount: 0,
  hiddenCityCount: 0,
  selectedDate: '',
  scope: 'risk',
  availableDates: [],
  updatedAt: new Date(0).toISOString(),
};

const sortAlerts = (alerts: AlertEvent[]) =>
  [...alerts].sort((left, right) => {
    const acknowledgementDelta = Number(left.acknowledged) - Number(right.acknowledged);
    if (acknowledgementDelta !== 0) {
      return acknowledgementDelta;
    }

    return Date.parse(right.triggeredAt) - Date.parse(left.triggeredAt);
  });

const BUBBLE_ALERT_SAMPLE_INTERVAL_MS = 5_000;
const BUBBLE_ALERT_LOOKBACK_MS = 180_000;
const BUBBLE_ALERT_MAX_CITIES = 96;

const selectDashboardBubbleAlerts = (
  alerts: AlertEvent[],
  rows: DashboardSnapshot['rows'],
  nowMs: number,
) => {
  if (alerts.length === 0 || rows.length === 0) {
    return [];
  }

  const cityKeys = new Set(rows.map((row) => row.cityKey).filter(Boolean));
  const cutoffMs = nowMs - BUBBLE_ALERT_LOOKBACK_MS;
  const latestByCity = new Map<string, AlertEvent>();

  for (const alert of alerts) {
    if (!alert.cityKey || !cityKeys.has(alert.cityKey)) {
      continue;
    }

    const triggeredAtMs = Date.parse(alert.triggeredAt);
    if (!Number.isFinite(triggeredAtMs) || triggeredAtMs < cutoffMs) {
      continue;
    }

    const current = latestByCity.get(alert.cityKey);
    if (!current || triggeredAtMs > Date.parse(current.triggeredAt)) {
      latestByCity.set(alert.cityKey, alert);
    }
  }

  return [...latestByCity.values()]
    .sort((left, right) => Date.parse(right.triggeredAt) - Date.parse(left.triggeredAt))
    .slice(0, BUBBLE_ALERT_MAX_CITIES);
};

const isReadableChineseText = (value?: string | null) => {
  const text = value?.trim() ?? '';
  return /[\u3400-\u9fff]/.test(text) && !/[A-Za-z]/.test(text);
};

const toReadableDashboardError = (cause: unknown) => {
  const message = cause instanceof Error ? cause.message.trim() : '';
  if (!message) {
    return '监控总览加载失败，请稍后重试。';
  }

  if (isReadableChineseText(message)) {
    return message;
  }

  const normalized = message.toLowerCase();
  if (
    normalized.includes('cannot find module') ||
    normalized.includes('packaged resources') ||
    normalized.includes('err_module_not_found')
  ) {
    return '监控总览加载失败，运行资源缺失。';
  }

  if (normalized.includes('websocket') || normalized.includes(' ws ')) {
    return '监控总览加载失败，实时连接异常。';
  }

  if (
    normalized.includes('sqlite') ||
    normalized.includes('better-sqlite3') ||
    normalized.includes('database')
  ) {
    return '监控总览加载失败，本地数据服务异常。';
  }

  if (
    normalized.includes('network') ||
    normalized.includes('proxy') ||
    normalized.includes('tls') ||
    normalized.includes('econn') ||
    normalized.includes('enotfound') ||
    normalized.includes('etimedout')
  ) {
    return '监控总览加载失败，网络连接异常。';
  }

  if (normalized.includes('timeout')) {
    return '监控总览加载失败，请求超时。';
  }

  return '监控总览加载失败，请检查后台服务后重试。';
};

export const DashboardView = ({ health, alerts, onOpenExplorer }: DashboardViewProps) => {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot>(EMPTY_SNAPSHOT);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [bubbleAlertFrame, setBubbleAlertFrame] = useState<{
    alerts: AlertEvent[];
    nowMs: number;
  }>(() => ({ alerts: [], nowMs: Date.now() }));
  const [lockedPhysicsData, setLockedPhysicsData] = useState<PhysicsBubbleCityData[]>([]);
  const [lockedPhysicsSignature, setLockedPhysicsSignature] = useState('');
  const latestAlertsRef = useRef<AlertEvent[]>(alerts);
  const requestSerialRef = useRef(0);
  const tickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    latestAlertsRef.current = alerts;
  }, [alerts]);

  const loadSnapshot = useCallback(async (override?: Partial<DashboardQuery>) => {
    const serial = requestSerialRef.current + 1;
    requestSerialRef.current = serial;

    setLoading(true);
    try {
      const nextSnapshot = await ipcBridge.invoke<DashboardSnapshot>('dashboard.query', {
        eventDate: override?.eventDate,
        scope: override?.scope ?? 'risk',
      });

      if (requestSerialRef.current !== serial) {
        return;
      }

      setSnapshot(nextSnapshot);
      setError(null);
    } catch (cause) {
      if (requestSerialRef.current !== serial) {
        return;
      }

      setError(toReadableDashboardError(cause));
    } finally {
      if (requestSerialRef.current === serial) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadSnapshot();
  }, [loadSnapshot]);

  useIpcSubscription<DashboardTickPayload>('dashboard.tick', () => {
    if (tickTimerRef.current) {
      clearTimeout(tickTimerRef.current);
    }

    tickTimerRef.current = setTimeout(() => {
      tickTimerRef.current = null;
      void loadSnapshot({
        eventDate: snapshot.selectedDate || undefined,
        scope: 'risk',
      });
    }, 180);
  });

  useEffect(
    () => () => {
      if (tickTimerRef.current) {
        clearTimeout(tickTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    const sampleBubbleAlerts = () => {
      const sampleNowMs = Date.now();
      setBubbleAlertFrame({
        alerts: selectDashboardBubbleAlerts(latestAlertsRef.current, snapshot.rows, sampleNowMs),
        nowMs: sampleNowMs,
      });
    };

    sampleBubbleAlerts();
    const timer = setInterval(sampleBubbleAlerts, BUBBLE_ALERT_SAMPLE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [snapshot.rows]);

  const visualData = useMemo(
    () => buildDashboardBubbleData(snapshot.rows, bubbleAlertFrame.alerts, bubbleAlertFrame.nowMs),
    [bubbleAlertFrame.alerts, bubbleAlertFrame.nowMs, snapshot.rows],
  );

  const incomingPhysicsData = useMemo(
    () => buildDashboardBubblePhysicsData(snapshot.rows),
    [snapshot.rows],
  );

  const incomingPhysicsSignature = useMemo(
    () =>
      buildBubblePhysicsSignature(incomingPhysicsData, {
        layoutKey: snapshot.selectedDate,
      }),
    [incomingPhysicsData, snapshot.selectedDate],
  );

  useEffect(() => {
    setLockedPhysicsData(incomingPhysicsData);
    if (incomingPhysicsSignature !== lockedPhysicsSignature) {
      setLockedPhysicsSignature(incomingPhysicsSignature);
    }
  }, [incomingPhysicsData, incomingPhysicsSignature, lockedPhysicsSignature]);

  const stats = useMemo(
    () =>
      buildDashboardBubbleStats(
        visualData,
        health,
        snapshot.coveredMarketCount,
        snapshot.selectedDate,
      ),
    [visualData, health, snapshot.coveredMarketCount, snapshot.selectedDate],
  );

  const highlightAlert = useMemo(() => sortAlerts(alerts)[0] ?? null, [alerts]);
  const highlightAlertPresentation = useMemo(
    () => (highlightAlert ? buildAlertPresentation(highlightAlert) : null),
    [highlightAlert],
  );

  const handleOpenCity = useCallback(
    (city: { cityKey: string; eventDate: string }) => {
      onOpenExplorer(city.cityKey, city.eventDate);
    },
    [onOpenExplorer],
  );

  const shouldRenderBubbleChart = lockedPhysicsData.length > 0 && visualData.length > 0;

  return (
    <section className="dashboard-zip-shell h-full">
      <div className="flex h-full w-full flex-col overflow-hidden bg-[#0A0A0C] font-sans text-[#E4E4E7]">
        <Header
          onOpenSettings={() => setIsSettingsOpen(true)}
          totalAlerts={stats.totalAlerts}
          highRiskCount={stats.highRiskCount}
          selectedDate={stats.selectedDate}
        />

        <main className="relative min-h-0 flex-1 bg-[radial-gradient(circle_at_center,_#111118_0%,_#0A0A0C_100%)]">
          {shouldRenderBubbleChart ? (
            <BubbleChart
              physicsData={lockedPhysicsData}
              visualData={visualData}
              layoutKey={lockedPhysicsSignature}
              onOpenCity={handleOpenCity}
            />
          ) : (
            <div className="absolute inset-0 z-10 grid place-items-center text-sm text-[#71717A]">
              {loading ? '正在加载泡泡监控总览...' : error || '当前没有可展示的城市数据。'}
            </div>
          )}

          <SettingsPanel
            isOpen={isSettingsOpen}
            onClose={() => setIsSettingsOpen(false)}
            highlightAlertTitle={highlightAlertPresentation?.title}
            highlightAlertSummary={highlightAlertPresentation?.summary}
            highlightAlertDetail={highlightAlertPresentation?.detail ?? undefined}
          />

          <div className="absolute bottom-0 left-0 right-0 z-10 flex h-12 items-center gap-6 border-t border-[#2D2D3A] bg-[#0A0A0C]/80 px-6 text-xs text-[#71717A] backdrop-blur-md">
            <div>
              <span
                className={`mr-2 inline-block h-2 w-2 rounded-full ${
                  health.connected ? 'bg-[#10B981]' : 'bg-[#F59E0B]'
                }`}
              />
              运行状态：{stats.monitorStatusText}
            </div>
            <div className="font-mono">
              城市：{stats.visibleCityCount} · 覆盖盘口：{stats.coveredMarketCount} · 延迟：
              {stats.latencyMs} 毫秒
            </div>
            <div className="ml-auto flex gap-4">
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-[#EF4444]" />
                强告警 / 1 小时内
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-[#F59E0B]" />
                弱告警 / 超过 1 小时
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-[#3B82F6]" />
                无告警 / 稳定
              </div>
            </div>
          </div>
        </main>
      </div>
    </section>
  );
};
