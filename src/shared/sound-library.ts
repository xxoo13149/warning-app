export interface BuiltinSoundSeed {
  id: string;
  nameZh: string;
  nameEn: string;
  fileName: string;
  gain: number;
}

export const BUILTIN_SOUND_PATH_PREFIX = 'builtin:';

export const toBuiltinSoundPath = (id: string): string => `${BUILTIN_SOUND_PATH_PREFIX}${id}`;

export const BUILTIN_SOUND_LIBRARY: BuiltinSoundSeed[] = [
  {
    id: 'builtin-tick-soft',
    nameZh: '轻柔滴答',
    nameEn: 'Soft Tick',
    fileName: 'tick-soft.wav',
    gain: 0.5,
  },
  {
    id: 'builtin-sonar-soft',
    nameZh: '柔和回响',
    nameEn: 'Soft Sonar',
    fileName: 'sonar-soft.wav',
    gain: 0.54,
  },
  {
    id: 'builtin-chime-short',
    nameZh: '清脆短铃',
    nameEn: 'Short Chime',
    fileName: 'chime-short.wav',
    gain: 0.62,
  },
  {
    id: 'builtin-double-ding',
    nameZh: '双响提示',
    nameEn: 'Double Ding',
    fileName: 'double-ding.wav',
    gain: 0.66,
  },
  {
    id: 'builtin-high-bell',
    nameZh: '高音铃声',
    nameEn: 'High Bell',
    fileName: 'high-bell.wav',
    gain: 0.74,
  },
  {
    id: 'builtin-critical-siren',
    nameZh: '紧急警报',
    nameEn: 'Critical Siren',
    fileName: 'critical-siren.wav',
    gain: 0.82,
  },
];

export const BUILTIN_DEFAULT_SOUND_ID = BUILTIN_SOUND_LIBRARY[2]?.id ?? '';
