import { useI18n } from '../i18n';
import type { WorkspaceId } from '../types/contracts';

interface NavRailProps {
  active: WorkspaceId;
  onChange: (next: WorkspaceId) => void;
  alertCount: number;
}

export const NavRail = ({ active, onChange, alertCount }: NavRailProps) => {
  const { language } = useI18n();
  const copy =
    language === 'zh-CN'
      ? {
          brandTitle: '预警中心',
          brandSubtitle: '天气监控',
          workspaceAria: '工作区导航',
          items: {
            dashboard: { label: '监控总览', alias: '风险看板', hint: '集中查看重点风险和最新变化' },
            explorer: { label: '市场总览', alias: '盘口检索', hint: '按条件筛选并查看全部监控项' },
            alerts: { label: '告警中心', alias: '待办处置', hint: '只显示需要人工处理的告警' },
            rules: { label: '规则管理', alias: '条件与通知', hint: '快速调整监控条件、级别和提醒方式' },
          },
        }
      : {
          brandTitle: 'Polymarket',
          brandSubtitle: 'Weather Monitor',
          workspaceAria: 'workspace navigation',
          items: {
            dashboard: { label: 'Bubble Board', alias: '监控总览', hint: 'City risk homepage' },
            explorer: { label: 'Market Explorer', alias: '市场探索', hint: 'Browse full markets' },
            alerts: { label: 'Alert Center', alias: '告警中心', hint: 'Review alerts' },
            rules: { label: 'Rules & Settings', alias: '规则设置', hint: 'Rules, sound, runtime' },
          },
        };

  const items: Array<{
    id: WorkspaceId;
    label: string;
    alias: string;
    hint: string;
  }> = [
    {
      id: 'dashboard',
      label: copy.items.dashboard.label,
      alias: copy.items.dashboard.alias,
      hint: copy.items.dashboard.hint,
    },
    {
      id: 'explorer',
      label: copy.items.explorer.label,
      alias: copy.items.explorer.alias,
      hint: copy.items.explorer.hint,
    },
    {
      id: 'alerts',
      label: copy.items.alerts.label,
      alias: copy.items.alerts.alias,
      hint: copy.items.alerts.hint,
    },
    {
      id: 'rules',
      label: copy.items.rules.label,
      alias: copy.items.rules.alias,
      hint: copy.items.rules.hint,
    },
  ];

  return (
    <aside className="nav-rail">
      <div className="nav-rail__brand">
        <p className="nav-rail__title">{copy.brandTitle}</p>
        <p className="nav-rail__subtitle">{copy.brandSubtitle}</p>
      </div>
      <nav className="nav-rail__menu" aria-label={copy.workspaceAria}>
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className={item.id === active ? 'nav-link nav-link--active' : 'nav-link'}
            onClick={() => onChange(item.id)}
          >
            <span className="nav-link__label">
              <span className="nav-link__primary">{item.label}</span>
              <span className="nav-link__alias">{item.alias}</span>
            </span>
            <span className="nav-link__hint">{item.hint}</span>
            {item.id === 'alerts' && alertCount > 0 ? (
              <span className="nav-link__badge">{alertCount}</span>
            ) : null}
          </button>
        ))}
      </nav>
    </aside>
  );
};
