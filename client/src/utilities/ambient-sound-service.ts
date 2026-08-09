// Global looping space ambience, shared across screens (same module-singleton
// pattern as user-location-service). Screens call ensureAmbientSound() on
// mount and render <SoundToggle /> to control it. Non-sign-up screens keep it
// muted by default until the user explicitly unmutes it.

import { Audio } from 'expo-av';

const VOLUME = 0.4;

let sound: Audio.Sound | null = null;
let loading: Promise<void> | null = null;
let muted = true;
const listeners = new Set<() => void>();

export function isMuted() {
  return muted;
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify() {
  listeners.forEach((listener) => listener());
}

/**
 * Load the ambience if it isn't already loaded. Safe to call from every
 * screen; muted screens stay paused until the first toggleMuted() press.
 */
export function ensureAmbientSound(): Promise<void> {
  if (sound || loading) return loading ?? Promise.resolve();

  loading = Audio.Sound.createAsync(require('@/assets/sounds/space.mp3'), {
    shouldPlay: !muted,
    isLooping: true,
    isMuted: muted,
    volume: muted ? 0 : VOLUME,
  })
    .then(({ sound: created }) => {
      sound = created;
    })
    .catch((err) => {
      console.error('[ambient-sound] load failed:', err);
    })
    .finally(() => {
      loading = null;
    });

  return loading;
}

/**
 * Flip mute for every listening screen. Unmuting happens from a user gesture,
 * so this can also start playback when autoplay policy blocked initial audio.
 */
export async function toggleMuted() {
  muted = !muted;
  notify();

  try {
    if (!sound) await ensureAmbientSound();
    await sound?.setStatusAsync({
      isMuted: muted,
      volume: muted ? 0 : VOLUME,
      shouldPlay: !muted,
    });
  } catch (err) {
    console.error('[ambient-sound] toggle failed:', err);
  }
}
