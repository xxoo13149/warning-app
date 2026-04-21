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

const severityRank: Record<AlertEvent['severity'], number> = {
  info: 1,
  warning: 2,
  critical: 3,
};

const sortAlerts = (alerts: AlertEvent[]) =>
  [...alerts].sort((left, right) => {
    const severityDelta = severityRank[right.severity] - severityRank[left.severity];
    if (severityDelta !== 0) {
      return severityDelta;
    }
    return Date.parse(right.triggeredAt) - Date.parse(left.triggeredAt);
  });

export const DashboardView = ({ health, alerts, onOpenExplorer }: DashboardViewProps) => {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot>(EMPTY_SNAPSHOT);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [lockedPhysicsData, setLockedPhysicsData] = useState<PhysicsBubbleCityData[]>([]);
  const [lockedPhysicsSignature, setLockedPhysicsSignature] = useState('');
  const requestSerialRef = useRef(0);
  const tickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

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

      const message =
        cause instanceof Error && cause.message.trim()
          ? cause.message
          : '首页数据加载失败';
      setError(message);
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

  const visualData = useMemo(
    () => buildDashboardBubbleData(snapshot.rows, alerts, nowMs),
    [alerts, nowMs, snapshot.rows],
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
    if (incomingPhysicsSignature === lockedPhysicsSignature) {
      return;
    }

    setLockedPhysicsData(incomingPhysicsData);
    setLockedPhysicsSignature(incomingPhysicsSignature);
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
              {loading ? '正在加载泡泡监控首页...' : error || '当前没有可展示的城市数据。'}
            </div>
          )}

          <SettingsPanel
            isOpen={isSettingsOpen}
            onClose={() => setIsSettingsOpen(false)}
            highlightAlertTitle={highlightAlert ? `${highlightAlert.cityKey} / ${highlightAlert.severity}` : undefined}
            highlightAlertMessage={highlightAlert?.message}
          />

          <div className="absolute bottom-0 left-0 right-0 z-10 flex h-12 items-center gap-6 border-t border-[#2D2D3A] bg-[#0A0A0C]/80 px-6 text-xs text-[#71717A] backdrop-blur-md">
            <div>
              <span
                className={`mr-2 inline-block h-2 w-2 rounded-full ${
                  health.connected ? 'bg-[#10B981]' : 'bg-[#F59E0B]'
                }`}
              />
              运行状态: {stats.monitorStatusText}
            </div>
            <div className="font-mono">
              城市: {stats.visibleCityCount} | 覆盖盘口: {stats.coveredMarketCount} | 延迟: {stats.latencyMs}
              ms
            </div>
            <div className="ml-auto flex gap-4">
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-[#EF4444]" />
                高风险 / 告警
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-[#F59E0B]" />
                中风险 / 波动
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-[#3B82F6]" />
                低风险 / 稳定
              </div>
            </div>
          </div>
        </main>
      </div>
    </section>
  );
};
