import React from 'react';
import { Settings, X } from 'lucide-react';

import { useSettingsStore, type ColorScheme } from '../../store/useBubblePageSettingsStore';

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  highlightAlertTitle?: string;
  highlightAlertMessage?: string;
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  isOpen,
  onClose,
  highlightAlertTitle,
  highlightAlertMessage,
}) => {
  const {
    floatSpeed,
    setFloatSpeed,
    colorScheme,
    setColorScheme,
    bubblePadding,
    setBubblePadding,
    showLabels,
    setShowLabels,
  } = useSettingsStore();

  if (!isOpen) {
    return null;
  }

  return (
    <div className="absolute top-0 right-0 h-full w-[280px] bg-[#16161E] border-l border-[#2D2D3A] shadow-2xl z-40 flex flex-col transform transition-transform duration-300 ease-in-out">
      <div className="p-6 border-b border-[#2D2D3A] flex justify-between items-center">
        <div className="flex items-center gap-2 text-[#E4E4E7]">
          <Settings className="w-5 h-5" />
          <h2 className="font-semibold">显示设置</h2>
        </div>
        <button onClick={onClose} className="text-[#71717A] hover:text-[#E4E4E7] transition-colors">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="p-6 space-y-8 overflow-y-auto flex-1 text-[#E4E4E7]">
        <div className="setting-group mb-8">
          <span className="block text-[11px] uppercase tracking-[0.1em] text-[#71717A] mb-4 font-semibold">
            物理动力学
          </span>

          <div className="mb-5">
            <label className="flex justify-between text-[13px] mb-2">
              <span>漂浮速度</span>
              <span className="text-[#71717A]">{floatSpeed.toFixed(1)}x</span>
            </label>
            <input
              type="range"
              min="0"
              max="2"
              step="0.1"
              value={floatSpeed}
              onChange={(event) => setFloatSpeed(parseFloat(event.target.value))}
              className="w-full h-1 bg-[#2D2D3A] rounded-full appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-[#3B82F6] [&::-webkit-slider-thumb]:rounded-full cursor-pointer"
            />
          </div>

          <div className="mb-5">
            <label className="flex justify-between text-[13px] mb-2">
              <span>碰撞间距</span>
              <span className="text-[#71717A]">{bubblePadding}px</span>
            </label>
            <input
              type="range"
              min="0"
              max="10"
              step="1"
              value={bubblePadding}
              onChange={(event) => setBubblePadding(parseInt(event.target.value, 10))}
              className="w-full h-1 bg-[#2D2D3A] rounded-full appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-[#3B82F6] [&::-webkit-slider-thumb]:rounded-full cursor-pointer"
            />
          </div>
        </div>

        <div className="setting-group mb-8">
          <span className="block text-[11px] uppercase tracking-[0.1em] text-[#71717A] mb-4 font-semibold">
            视觉权重
          </span>

          <div className="mb-5">
            <label className="block text-[13px] mb-2">色彩方案</label>
            <div className="grid grid-cols-1 gap-2">
              {(['default', 'heatmap', 'neon'] as ColorScheme[]).map((scheme) => (
                <button
                  key={scheme}
                  onClick={() => setColorScheme(scheme)}
                  className={`px-4 py-2 rounded text-[13px] font-medium capitalize transition-colors border ${
                    colorScheme === scheme
                      ? 'bg-[#3B82F6]/10 border-[#3B82F6] text-[#3B82F6]'
                      : 'bg-[#0A0A0C] border-[#2D2D3A] text-[#71717A] hover:text-[#E4E4E7]'
                  }`}
                >
                  {scheme}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <label className="text-[13px]">显示城市标签</label>
            <button
              onClick={() => setShowLabels(!showLabels)}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                showLabels ? 'bg-[#3B82F6]' : 'bg-[#2D2D3A]'
              }`}
            >
              <span
                className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                  showLabels ? 'translate-x-5' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>

        <div className="setting-group">
          <span className="block text-[11px] uppercase tracking-[0.1em] text-[#71717A] mb-4 font-semibold">
            最近重点告警
          </span>
          <div className="text-xs bg-[#0A0A0C] p-3 rounded border-l-2 border-[#EF4444]">
            <strong className="text-[#E4E4E7]">{highlightAlertTitle || '暂无高优先级告警'}</strong>
            <br />
            <span className="text-[#71717A] mt-1 inline-block">
              {highlightAlertMessage || '当前没有需要优先处理的异常。'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
