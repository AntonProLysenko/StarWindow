// Global looping space ambience, shared across screens (same module-singleton
// pattern as user-location-service). Screens call ensureAmbientSound() on
// mount and render <SoundToggle /> to control it; the sound keeps playing
// across navigation instead of being tied to one screen's lifecycle.

import { Audio } from 'expo-av';

const VOLUME = 0.4;

let sound: Audio.Sound | null = null;
let loading: Promise<void> | null = null;
let muted = false;
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
 * Start the ambience if it isn't already playing. Safe to call from every
 * screen. Browser autoplay policy may keep it paused until the first
 * toggleMuted() press (a user gesture) resumes it.
 */
export function ensureAmbientSound(): Promise<void> {
  if (sound || loading) return loading ?? Promise.resolve();

  loading = Audio.Sound.createAsync(require('@/assets/sounds/space.mp3'), {
    shouldPlay: true,
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
 * Flip mute for every listening screen. Also re-issues shouldPlay: the press
 * is a user gesture, so this recovers playback when the browser's autoplay
 * policy blocked the initial play() at load time.
 */
export async function toggleMuted() {
  muted = !muted;
  notify();

  try {
    if (!sound) await ensureAmbientSound();
    await sound?.setStatusAsync({
      isMuted: muted,
      volume: muted ? 0 : VOLUME,
      shouldPlay: true,
    });
  } catch (err) {
    console.error('[ambient-sound] toggle failed:', err);
  }
}
