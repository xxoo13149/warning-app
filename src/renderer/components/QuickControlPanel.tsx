import { useMemo } from 'react';

import { useI18n } from '../i18n';
import type { AppControlState, RuntimeActionFeedback } from '../types/contracts';

interface QuickControlPanelProps {
  controlState: AppControlState;
  runtimeAction: RuntimeActionFeedback;
  onToggleNotifications: (enabled: boolean) => void;
  onStopMonitor: () => void;
  onStartMonitor: () => void;
  onQuitApp: () => void;
}

export const QuickControlPanel = ({
  controlState,
  runtimeAction,
  onToggleNotifications,
  onStopMonitor,
  onStartMonitor,
  onQuitApp,
}: QuickControlPanelProps) => {
  const { copy } = useI18n();
  const notificationsLabel = controlState.notificationsEnabled
    ? copy.common.enabled
    : copy.common.disabled;
  const processLabel = controlState.coreProcessRunning
    ? copy.common.enabled
    : copy.common.disabled;

  const actionMessage = runtimeAction.error ?? runtimeAction.message;
  const showStatus = runtimeAction.kind !== 'idle' && Boolean(actionMessage);
  const actionProgress =
    runtimeAction.busy || runtimeAction.kind === 'done' || runtimeAction.kind === 'error'
      ? runtimeAction.progress
      : undefined;

  const notifierLabel = useMemo(
    () =>
      controlState.notificationsEnabled
        ? copy.settings.notificationsOff
        : copy.settings.notificationsOn,
    [controlState.notificationsEnabled, copy],
  );

  const processActionLabel = controlState.coreProcessRunning
    ? copy.settings.processStop
    : copy.settings.processStart;

  const runtimeSummary = controlState.coreProcessRunning
    ? copy.settings.processHint
    : copy.settings.processStoppedHint;

  const handleProcessToggle = () => {
    if (controlState.coreProcessRunning) {
      if (!window.confirm(copy.settings.stopProcessConfirm)) {
        return;
      }
      onStopMonitor();
      return;
    }

    if (!window.confirm(copy.settings.startProcessConfirm)) {
      return;
    }
    onStartMonitor();
  };

  const handleQuit = () => {
    if (!window.confirm(copy.settings.quitAllConfirm)) {
      return;
    }
    onQuitApp();
  };

  return (
    <section className="quick-controls">
      <header className="quick-controls__header">
        <div>
          <h2>{copy.settings.quickControlTitle}</h2>
          <p className="quick-controls__eyebrow">{copy.settings.quickControlHint}</p>
        </div>
        {showStatus ? (
          <div
            className={
              runtimeAction.error
                ? 'quick-controls__status quick-controls__status--error'
                : 'quick-controls__status'
            }
          >
            <span
              className={
                runtimeAction.error
                  ? 'quick-controls__status-dot quick-controls__status-dot--error'
                  : 'quick-controls__status-dot'
              }
            />
            <span>{actionMessage}</span>
            {actionProgress !== undefined ? <strong>{actionProgress}%</strong> : null}
          </div>
        ) : null}
      </header>

      <p className="quick-controls__summary">{runtimeSummary}</p>

      {actionProgress !== undefined ? (
        <div className="quick-controls__progress" aria-hidden="true">
          <div
            className={
              runtimeAction.busy
                ? 'quick-controls__progress-bar quick-controls__progress-bar--active'
                : 'quick-controls__progress-bar'
            }
            style={{ width: `${Math.max(0, Math.min(100, actionProgress))}%` }}
          />
        </div>
      ) : null}

      <div className="quick-controls__grid">
        <div className="quick-controls__card">
          <div className="quick-controls__label">{copy.settings.notifications}</div>
          <strong>{notificationsLabel}</strong>
          <p className="quick-controls__hint">{copy.settings.notificationsHint}</p>
          <button
            type="button"
            className="ghost-button quick-controls__button"
            onClick={() => onToggleNotifications(!controlState.notificationsEnabled)}
            disabled={runtimeAction.busy}
          >
            {notifierLabel}
          </button>
        </div>

        <div className="quick-controls__card">
          <div className="quick-controls__label">{copy.settings.process}</div>
          <strong>{processLabel}</strong>
          <p className="quick-controls__hint">{copy.settings.processHint}</p>
          <button
            type="button"
            className="ghost-button quick-controls__button"
            onClick={handleProcessToggle}
            disabled={runtimeAction.busy}
          >
            {processActionLabel}
          </button>
        </div>

        <div className="quick-controls__card">
          <div className="quick-controls__label">{copy.settings.quitAll}</div>
          <strong>{copy.common.all}</strong>
          <p className="quick-controls__hint">{copy.settings.runtimeControlHint}</p>
          <button
            type="button"
            className="danger-button quick-controls__button"
            onClick={handleQuit}
            disabled={runtimeAction.busy}
          >
            {copy.settings.quitAll}
          </button>
        </div>
      </div>
    </section>
  );
};
