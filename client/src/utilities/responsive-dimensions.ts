import { Platform } from 'react-native';

const BASE_WIDTH = 1440;
const BASE_HEIGHT = 900;
const MIN_SCALE = 0.82;
const MAX_SCALE = 1.35;

function trim(value: number) {
  return Number(value.toFixed(3));
}

export function dvw(value: number) {
  if (value === 0 || Platform.OS !== 'web') return value as any;

  return `clamp(${trim(value * MIN_SCALE)}px, ${trim((value / BASE_WIDTH) * 100)}dvw, ${trim(value * MAX_SCALE)}px)` as any;
}

export function dvh(value: number) {
  if (value === 0 || Platform.OS !== 'web') return value as any;

  return `clamp(${trim(value * MIN_SCALE)}px, ${trim((value / BASE_HEIGHT) * 100)}dvh, ${trim(value * MAX_SCALE)}px)` as any;
}
