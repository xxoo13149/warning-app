import { create } from 'zustand';

export type ColorScheme = 'default' | 'heatmap' | 'neon';

interface BubblePageSettingsState {
  floatSpeed: number;
  colorScheme: ColorScheme;
  bubblePadding: number;
  showLabels: boolean;
  filterMode: 'ALL' | 'ALERTS';
  regionFilter: 'ALL' | 'NA' | 'EU' | 'ASIA' | 'OTHER';
  setFloatSpeed: (speed: number) => void;
  setColorScheme: (scheme: ColorScheme) => void;
  setBubblePadding: (padding: number) => void;
  setShowLabels: (show: boolean) => void;
  setFilterMode: (mode: 'ALL' | 'ALERTS') => void;
  setRegionFilter: (region: 'ALL' | 'NA' | 'EU' | 'ASIA' | 'OTHER') => void;
}

export const useSettingsStore = create<BubblePageSettingsState>((set) => ({
  floatSpeed: 0.7,
  colorScheme: 'default',
  bubblePadding: 0,
  showLabels: true,
  filterMode: 'ALL',
  regionFilter: 'ALL',
  setFloatSpeed: (speed) => set({ floatSpeed: speed }),
  setColorScheme: (scheme) => set({ colorScheme: scheme }),
  setBubblePadding: (padding) => set({ bubblePadding: padding }),
  setShowLabels: (show) => set({ showLabels: show }),
  setFilterMode: (mode) => set({ filterMode: mode }),
  setRegionFilter: (region) => set({ regionFilter: region }),
}));
