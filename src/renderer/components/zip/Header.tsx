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
    <header className="h-[88px] bg-[#16161E] border-b border-[#2D2D3A] flex items-center justify-between px-6 z-20 relative">
      <div className="flex flex-col justify-center">
        <div className="flex items-center gap-2 font-bold text-[18px] text-[#3B82F6] tracking-[-0.5px]">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
          </svg>
          WEATHER ORACLE
        </div>
        <div className="text-[10px] text-[#71717A] mt-1 tracking-[0.1em] uppercase font-semibold">
          Polymarket Weather Triage · {selectedDate || 'Latest Session'}
        </div>
      </div>

      <div className="flex items-center gap-6">
        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-2 bg-[#0A0A0C] px-3 py-1.5 rounded border border-[#2D2D3A]">
            <Activity className="w-4 h-4 text-[#F59E0B]" />
            <span className="text-[#71717A]">High Risk:</span>
            <span className="text-[#E4E4E7] font-bold">{highRiskCount}</span>
          </div>
          <div className="flex items-center gap-2 bg-[#EF4444]/10 px-3 py-1.5 rounded border border-[#EF4444]/20">
            <div className="w-2 h-2 rounded-full bg-[#EF4444] animate-pulse" />
            <span className="text-[#EF4444] opacity-80">Active Alerts:</span>
            <span className="text-[#EF4444] font-bold">{totalAlerts}</span>
          </div>
        </div>

        <button
          onClick={onOpenSettings}
          className="p-2 text-[#71717A] hover:text-[#E4E4E7] hover:bg-[#2D2D3A] rounded transition-colors"
          title="Display Settings"
        >
          <Settings className="w-5 h-5" />
        </button>
      </div>
    </header>
  );
};
