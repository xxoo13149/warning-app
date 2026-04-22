import React from 'react';
import { Settings, X } from 'lucide-react';

import { useSettingsStore, type ColorScheme } from '../../store/useBubblePageSettingsStore';

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  highlightAlertTitle?: string;
  highlightAlertSummary?: string;
  highlightAlertDetail?: string;
}

const COLOR_SCHEME_LABELS: Record<ColorScheme, string> = {
  default: '默认',
  heatmap: '热力',
  neon: '霓虹',
};

export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  isOpen,
  onClose,
  highlightAlertTitle,
  highlightAlertSummary,
  highlightAlertDetail,
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
    <div className="absolute top-0 right-0 z-40 flex h-full w-[280px] flex-col border-l border-[#2D2D3A] bg-[#16161E] shadow-2xl transition-transform duration-300 ease-in-out">
      <div className="flex items-center justify-between border-b border-[#2D2D3A] p-6">
        <div className="flex items-center gap-2 text-[#E4E4E7]">
          <Settings className="h-5 w-5" />
          <h2 className="font-semibold">显示设置</h2>
        </div>
        <button onClick={onClose} className="text-[#71717A] transition-colors hover:text-[#E4E4E7]">
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex-1 space-y-8 overflow-y-auto p-6 text-[#E4E4E7]">
        <div className="setting-group mb-8">
          <span className="mb-4 block text-[11px] font-semibold uppercase tracking-[0.1em] text-[#71717A]">
            漂浮参数
          </span>

          <div className="mb-5">
            <label className="mb-2 flex justify-between text-[13px]">
              <span>漂浮速度</span>
              <span className="text-[#71717A]">{floatSpeed.toFixed(1)} 倍</span>
            </label>
            <input
              type="range"
              min="0"
              max="2"
              step="0.1"
              value={floatSpeed}
              onChange={(event) => setFloatSpeed(parseFloat(event.target.value))}
              className="w-full cursor-pointer appearance-none rounded-full bg-[#2D2D3A] h-1 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#3B82F6]"
            />
          </div>

          <div className="mb-5">
            <label className="mb-2 flex justify-between text-[13px]">
              <span>碰撞间距</span>
              <span className="text-[#71717A]">{bubblePadding} 像素</span>
            </label>
            <input
              type="range"
              min="0"
              max="10"
              step="1"
              value={bubblePadding}
              onChange={(event) => setBubblePadding(parseInt(event.target.value, 10))}
              className="w-full cursor-pointer appearance-none rounded-full bg-[#2D2D3A] h-1 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#3B82F6]"
            />
          </div>
        </div>

        <div className="setting-group mb-8">
          <span className="mb-4 block text-[11px] font-semibold uppercase tracking-[0.1em] text-[#71717A]">
            视觉风格
          </span>

          <div className="mb-5">
            <label className="mb-2 block text-[13px]">配色方案</label>
            <div className="grid grid-cols-1 gap-2">
              {(['default', 'heatmap', 'neon'] as ColorScheme[]).map((scheme) => (
                <button
                  key={scheme}
                  onClick={() => setColorScheme(scheme)}
                  className={`rounded border px-4 py-2 text-[13px] font-medium transition-colors ${
                    colorScheme === scheme
                      ? 'border-[#3B82F6] bg-[#3B82F6]/10 text-[#3B82F6]'
                      : 'border-[#2D2D3A] bg-[#0A0A0C] text-[#71717A] hover:text-[#E4E4E7]'
                  }`}
                >
                  {COLOR_SCHEME_LABELS[scheme]}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <label className="text-[13px]">显示泡泡标签</label>
            <button
              onClick={() => setShowLabels(!showLabels)}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                showLabels ? 'bg-[#3B82F6]' : 'bg-[#2D2D3A]'
              }`}
            >
              <span
                className={`inline-block h-3 w-3 rounded-full bg-white transition-transform ${
                  showLabels ? 'translate-x-5' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>

        <div className="setting-group">
          <span className="mb-4 block text-[11px] font-semibold uppercase tracking-[0.1em] text-[#71717A]">
            最近重点告警
          </span>
          <div className="rounded border-l-2 border-[#EF4444] bg-[#0A0A0C] p-3 text-xs leading-5">
            <strong className="block break-words text-[#E4E4E7]">
              {highlightAlertTitle || '暂无需要优先处理的告警'}
            </strong>
            <span className="mt-2 block break-words text-[#A1A1AA]">
              {highlightAlertSummary || '当前运行正常，还没有新的高优先级异常。'}
            </span>
            {highlightAlertDetail ? (
              <span className="mt-2 block break-words text-[#71717A]">{highlightAlertDetail}</span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
};
