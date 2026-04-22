import React from 'react';
import { Activity, Settings } from 'lucide-react';

interface HeaderProps {
  onOpenSettings: () => void;
  totalAlerts: number;
  highRiskCount: number;
  selectedDate: string;
}

export const Header: React.FC<HeaderProps> = ({
  onOpenSettings,
  totalAlerts,
  highRiskCount,
  selectedDate,
}) => {
  return (
    <header className="relative z-20 flex h-[88px] items-center justify-between border-b border-[#2D2D3A] bg-[#16161E] px-6">
      <div className="flex flex-col justify-center">
        <div className="flex items-center gap-2 text-[18px] font-bold tracking-[-0.5px] text-[#3B82F6]">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
          </svg>
          天气告警总览
        </div>
        <div className="mt-1 text-[11px] font-medium tracking-[0.08em] text-[#71717A]">
          重点城市与泡泡告警强弱 · {selectedDate || '最新数据'}
        </div>
      </div>

      <div className="flex items-center gap-6">
        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-2 rounded border border-[#2D2D3A] bg-[#0A0A0C] px-3 py-1.5">
            <Activity className="h-4 w-4 text-[#F59E0B]" />
            <span className="text-[#71717A]">强告警城市</span>
            <span className="font-bold text-[#E4E4E7]">{highRiskCount}</span>
          </div>
          <div className="flex items-center gap-2 rounded border border-[#EF4444]/20 bg-[#EF4444]/10 px-3 py-1.5">
            <div className="h-2 w-2 rounded-full bg-[#EF4444] animate-pulse" />
            <span className="text-[#EF4444] opacity-80">当前告警</span>
            <span className="font-bold text-[#EF4444]">{totalAlerts}</span>
          </div>
        </div>

        <button
          onClick={onOpenSettings}
          className="rounded p-2 text-[#71717A] transition-colors hover:bg-[#2D2D3A] hover:text-[#E4E4E7]"
          title="打开设置"
        >
          <Settings className="h-5 w-5" />
        </button>
      </div>
    </header>
  );
};
