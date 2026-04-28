import type { AlertTriggeredEvent, RuntimeState } from '../contracts/ipc';
import {
  BUILTIN_DEFAULT_SOUND_ID,
  BUILTIN_SOUND_LIBRARY,
  toBuiltinSoundPath,
} from '../../shared/sound-library';

export interface AlertSoundPlan {
  shouldAttemptPlayback: boolean;
  filePath: string;
  gain: number;
  notificationSilentByDefault: boolean;
}

const DEFAULT_BUILTIN_GAIN =
  BUILTIN_SOUND_LIBRARY.find((sound) => sound.id === BUILTIN_DEFAULT_SOUND_ID)?.gain ?? 0.62;

export const resolveAlertSoundPlan = (
  runtime: RuntimeState,
  alert: AlertTriggeredEvent,
): AlertSoundPlan => {
  const backgroundAudioEnabled = runtime.settingsPayload.settings.backgroundAudio;
  const preferredSoundId =
    alert.soundProfileId?.trim() ||
    runtime.settingsPayload.settings.selectedSoundProfileId ||
    BUILTIN_DEFAULT_SOUND_ID;

  const preferredProfile = runtime.settingsPayload.soundProfiles.find(
    (profile) => profile.id === preferredSoundId && profile.enabled,
  );
  const builtinFallbackProfile = runtime.settingsPayload.soundProfiles.find(
    (profile) => profile.id === BUILTIN_DEFAULT_SOUND_ID && profile.enabled,
  );
  const resolvedProfile = preferredProfile ?? builtinFallbackProfile;

  return {
    shouldAttemptPlayback: backgroundAudioEnabled,
    filePath: resolvedProfile?.filePath ?? toBuiltinSoundPath(BUILTIN_DEFAULT_SOUND_ID),
    gain: resolvedProfile?.gain ?? DEFAULT_BUILTIN_GAIN,
    notificationSilentByDefault: !backgroundAudioEnabled,
  };
};
