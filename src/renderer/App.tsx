import { useState } from 'react';
import { NavRail } from './components/NavRail';
import { TopStatusBar } from './components/TopStatusBar';
import { useMonitorConsole } from './hooks/useMonitorConsole';
import { useI18n } from './i18n';
import type { WorkspaceId } from './types/contracts';
import { AlertCenterView } from './views/AlertCenterView';
import { DashboardView } from './views/DashboardView';
import { MarketExplorerView } from './views/MarketExplorerView';
import { RulesSettingsView } from './views/RulesSettingsView';

export const App = () => {
  const [workspace, setWorkspace] = useState<WorkspaceId>('dashboard');
  const monitor = useMonitorConsole();
  const { copy } = useI18n();
  const isDashboard = workspace === 'dashboard';
  const activeAlertCount = monitor.alerts.filter((row) => !row.acknowledged).length;
  const openMarketInExplorer = (eventDate?: string, cityKey?: string) => {
    setWorkspace('explorer');
    monitor.setMarketQuery({
      eventDate: eventDate || undefined,
      cityKey: cityKey || undefined,
      limit: 2000,
      sortBy: 'change5m',
      sortDir: 'desc',
    });
  };

  let content;
  if (workspace === 'explorer') {
    content = (
      <MarketExplorerView
        rows={monitor.markets}
        total={monitor.marketTotal}
        query={monitor.marketQuery}
        onQueryChange={monitor.setMarketQuery}
        onRefresh={monitor.refreshMarkets}
      />
    );
  } else if (workspace === 'alerts') {
    content = <AlertCenterView alerts={monitor.alerts} />;
  } else if (workspace === 'rules') {
    content = (
      <RulesSettingsView
        rules={monitor.rules}
        marketRows={monitor.markets}
        alerts={monitor.alerts}
        health={monitor.health}
        settings={monitor.settings}
        controlState={monitor.controlState}
        runtimeAction={monitor.runtimeAction}
        soundProfiles={monitor.soundProfiles}
        onPreviewRule={(rule) => monitor.previewRule(rule)}
        onSaveRules={(nextRules) => void monitor.saveRules(nextRules)}
        onUpdateSettings={(patch) => monitor.updateSettings(patch)}
        onPickSound={(id) => monitor.pickSound(id)}
        onRegisterSound={(payload) => monitor.registerSound(payload)}
        onPreviewSound={(payload) => monitor.previewSound(payload)}
        onImportCityMap={(lines) => monitor.importCityMap(lines)}
        onSetNotificationsEnabled={(enabled) => void monitor.setNotificationsEnabled(enabled)}
        onStopMonitor={() => void monitor.stopMonitor()}
        onStartMonitor={() => void monitor.startMonitor()}
        onQuitApp={() => void monitor.quitApp()}
      />
    );
  } else {
    content = (
      <DashboardView
        health={monitor.health}
        alerts={monitor.alerts}
        onOpenExplorer={(cityKey, eventDate) => openMarketInExplorer(eventDate, cityKey)}
      />
    );
  }

  return (
    <div className="console-shell">
      <NavRail active={workspace} onChange={setWorkspace} alertCount={activeAlertCount} />
      <main className={isDashboard ? 'console-main console-main--dashboard' : 'console-main'}>
        {!isDashboard ? (
          <TopStatusBar
            health={monitor.health}
            mode={monitor.mode}
            marketTotal={monitor.marketTotal}
            activeAlerts={activeAlertCount}
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
