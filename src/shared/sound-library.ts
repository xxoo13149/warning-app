export interface BuiltinSoundSeed {
  id: string;
  nameZh: string;
  nameEn: string;
  fileName: string;
  gain: number;
}

export const BUILTIN_SOUND_LIBRARY: BuiltinSoundSeed[] = [
  {
    id: 'builtin-tick-soft',
    nameZh: 'Soft Tick',
    nameEn: 'Soft Tick',
    fileName: 'tick-soft.wav',
    gain: 0.5,
  },
  {
    id: 'builtin-sonar-soft',
    nameZh: 'Soft Sonar',
    nameEn: 'Soft Sonar',
    fileName: 'sonar-soft.wav',
    gain: 0.54,
  },
  {
    id: 'builtin-chime-short',
    nameZh: 'Short Chime',
    nameEn: 'Short Chime',
    fileName: 'chime-short.wav',
    gain: 0.62,
  },
  {
    id: 'builtin-double-ding',
    nameZh: 'Double Ding',
    nameEn: 'Double Ding',
    fileName: 'double-ding.wav',
    gain: 0.66,
  },
  {
    id: 'builtin-high-bell',
    nameZh: 'High Bell',
    nameEn: 'High Bell',
    fileName: 'high-bell.wav',
    gain: 0.74,
  },
  {
    id: 'builtin-critical-siren',
    nameZh: 'Critical Siren',
    nameEn: 'Critical Siren',
    fileName: 'critical-siren.wav',
    gain: 0.82,
  },
];

export const BUILTIN_DEFAULT_SOUND_ID = BUILTIN_SOUND_LIBRARY[2]?.id ?? '';
