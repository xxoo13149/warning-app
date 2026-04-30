import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { ipcBridge } from './api/ipcBridge';
import { NavRail } from './components/NavRail';
import { TopStatusBar } from './components/TopStatusBar';
import { useMonitorConsole } from './hooks/useMonitorConsole';
import { useI18n } from './i18n';
import type { WorkspaceId } from './types/contracts';
import { AlertCenterView } from './views/AlertCenterView';
import { DashboardView } from './views/DashboardView';
import { MarketExplorerView } from './views/MarketExplorerView';
import { RulesSettingsView } from './views/RulesSettingsView';

type AppNavigatePayload =
  | WorkspaceId
  | {
      target?: WorkspaceId;
      workspace?: WorkspaceId;
      view?: WorkspaceId;
      route?: WorkspaceId;
      alertId?: string;
      id?: string;
    };

const WORKSPACES = new Set<WorkspaceId>(['dashboard', 'alerts', 'explorer', 'rules']);
const DASHBOARD_ALERT_LIMIT = 120;
const RULES_ALERT_LIMIT = 240;

const isWorkspaceId = (value: unknown): value is WorkspaceId =>
  typeof value === 'string' && WORKSPACES.has(value as WorkspaceId);

const normalizeNavigationPayload = (
  payload: AppNavigatePayload,
): { workspace: WorkspaceId; alertId: string | null } | null => {
  if (isWorkspaceId(payload)) {
    return { workspace: payload, alertId: null };
  }

  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const workspace = payload.target ?? payload.workspace ?? payload.view ?? payload.route;
  if (!isWorkspaceId(workspace)) {
    return null;
  }

  const alertId = payload.alertId ?? payload.id ?? null;
  return {
    workspace,
    alertId: typeof alertId === 'string' && alertId.trim() ? alertId : null,
  };
};

export const App = () => {
  const [workspace, setWorkspace] = useState<WorkspaceId>('dashboard');
  const [focusedAlertId, setFocusedAlertId] = useState<string | null>(null);
  const monitor = useMonitorConsole();
  const { copy } = useI18n();
  const deferredMarkets = useDeferredValue(monitor.markets);
  const deferredAlerts = useDeferredValue(monitor.alerts);
  const dashboardAlerts = useMemo(
    () => deferredAlerts.slice(0, DASHBOARD_ALERT_LIMIT),
    [deferredAlerts],
  );
  const rulesAlerts = useMemo(() => deferredAlerts.slice(0, RULES_ALERT_LIMIT), [deferredAlerts]);
  const latestAlertAtByRuleId = useMemo(() => {
    const next: Record<string, string | undefined> = {};
    for (const alert of rulesAlerts) {
      if (!alert.ruleId || next[alert.ruleId]) {
        continue;
      }
      next[alert.ruleId] = alert.triggeredAt;
    }
    return next;
  }, [rulesAlerts]);
  const isDashboard = workspace === 'dashboard';
  const alertCount = monitor.alertsTotal;
  const primaryRuntimeIssue = monitor.runtimeIssues[0] ?? null;
  const openMarketInExplorer = useCallback((eventDate?: string, cityKey?: string) => {
    setFocusedAlertId(null);
    setWorkspace('explorer');
    monitor.setMarketQuery({
      eventDate: eventDate || undefined,
      cityKey: cityKey || undefined,
      limit: 2000,
      sortBy: 'updatedAt',
      sortDir: 'desc',
    });
  }, [monitor.setMarketQuery]);
  const changeWorkspace = useCallback((next: WorkspaceId) => {
    if (next !== 'alerts') {
      setFocusedAlertId(null);
    }
    setWorkspace(next);
  }, []);

  useEffect(() => {
    const dispose = ipcBridge.on<AppNavigatePayload>('app.navigate', (payload) => {
      const navigation = normalizeNavigationPayload(payload);
      if (!navigation) {
        return;
      }

      setWorkspace(navigation.workspace);
      setFocusedAlertId(navigation.workspace === 'alerts' ? navigation.alertId : null);
    });

    return () => {
      if (typeof dispose === 'function') {
        dispose();
      }
    };
  }, []);

  const dashboardContent = useMemo(
    () => (
      <DashboardView
        health={monitor.health}
        alerts={dashboardAlerts}
        onOpenExplorer={(cityKey, eventDate) => openMarketInExplorer(eventDate, cityKey)}
      />
    ),
    [dashboardAlerts, monitor.health, openMarketInExplorer],
  );

  const alertsContent = useMemo(
    () => (
      <AlertCenterView
        alerts={deferredAlerts}
        focusAlertId={focusedAlertId}
        total={monitor.alertsTotal}
        hasMore={monitor.alertsHasMore}
        loadingMore={monitor.alertsLoadingMore}
        loadMoreError={monitor.alertsLoadMoreError}
        onLoadMore={() => monitor.loadMoreAlerts()}
      />
    ),
    [
      deferredAlerts,
      focusedAlertId,
      monitor.alertsHasMore,
      monitor.alertsLoadMoreError,
      monitor.alertsLoadingMore,
      monitor.alertsTotal,
      monitor.loadMoreAlerts,
    ],
  );

  const explorerContent = useMemo(
    () => (
      <MarketExplorerView
        rows={deferredMarkets}
        total={monitor.marketTotal}
        query={monitor.marketQuery}
        onQueryChange={monitor.setMarketQuery}
        onRefresh={monitor.refreshMarkets}
      />
    ),
    [
      deferredMarkets,
      monitor.marketQuery,
      monitor.marketTotal,
      monitor.refreshMarkets,
      monitor.setMarketQuery,
    ],
  );

  let content;
  if (workspace === 'explorer') {
    content = explorerContent;
  } else if (workspace === 'alerts') {
    content = alertsContent;
  } else if (workspace === 'rules') {
    content = (
      <RulesSettingsView
        rules={monitor.rules}
        marketRows={deferredMarkets}
        latestAlertAtByRuleId={latestAlertAtByRuleId}
        health={monitor.health}
        settings={monitor.settings}
        storageSummary={monitor.storageSummary}
        storageMaintenance={monitor.storageMaintenance}
        controlState={monitor.controlState}
        runtimeAction={monitor.runtimeAction}
        runtimeIssues={monitor.runtimeIssues}
        soundProfiles={monitor.soundProfiles}
        onPreviewRule={(rule) => monitor.previewRule(rule)}
        onSaveRules={(nextRules) => void monitor.saveRules(nextRules)}
        onUpdateSettings={(patch) => monitor.updateSettings(patch)}
        onPickSound={(id) => monitor.pickSound(id)}
        onRegisterSound={(payload) => monitor.registerSound(payload)}
        onClearStorageCache={() => monitor.clearStorageCache()}
        onCreateStorageBackup={() => monitor.createStorageBackup()}
        onCreateDiagnosticsPackage={() => monitor.createDiagnosticsPackage()}
        onRunStorageMaintenance={() => monitor.runStorageMaintenance()}
        onPreviewSound={(payload) => monitor.previewSound(payload)}
        onImportCityMap={(lines) => monitor.importCityMap(lines)}
        onSetNotificationsEnabled={(enabled) => void monitor.setNotificationsEnabled(enabled)}
        onStopMonitor={() => void monitor.stopMonitor()}
        onStartMonitor={() => void monitor.startMonitor()}
        onQuitApp={() => void monitor.quitApp()}
      />
    );
  } else {
    content = dashboardContent;
  }

  return (
    <div className="console-shell">
      <NavRail active={workspace} onChange={changeWorkspace} alertCount={alertCount} />
      <main className={isDashboard ? 'console-main console-main--dashboard' : 'console-main'}>
        {primaryRuntimeIssue ? (
          <section
            className={`app-runtime-banner app-runtime-banner--${primaryRuntimeIssue.tone}`}
            role="alert"
          >
            <div className="app-runtime-banner__copy">
              <strong>{primaryRuntimeIssue.title}</strong>
              <span>{primaryRuntimeIssue.detail}</span>
            </div>
            {monitor.runtimeIssues.length > 1 ? (
              <em className="app-runtime-banner__meta">
                另有 {monitor.runtimeIssues.length - 1} 项诊断可在“规则设置”中查看
              </em>
            ) : (
              <em className="app-runtime-banner__meta">
                可前往“规则设置”查看更多运行诊断
              </em>
            )}
          </section>
        ) : null}
        {!isDashboard ? (
          <TopStatusBar
            health={monitor.health}
            mode={monitor.mode}
            marketTotal={monitor.marketTotal}
            activeAlerts={alertCount}
            runtimeIssues={monitor.runtimeIssues}
            onRefresh={() => void monitor.refreshAll()}
          />
        ) : null}
        {monitor.loading && workspace !== 'dashboard' ? (
          <section className="workspace">
            <div className="panel panel--full">
              <p className="loading-state">{copy.appLoading}</p>
            </div>
          </section>
        ) : (
          content
        )}
      </main>
    </div>
  );
};
