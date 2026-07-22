/**
 * Design tokens for the StarWindow UI — the single source of truth for colors,
 * spacing, radii, and fonts. Referenced from `StyleSheet.create` so the same
 * values work on native (iOS/Android) and web.
 *
 * Rules (see context/CODING_STANDARDS.md):
 * - No hardcoded hex/spacing/radius values in components — add a token first.
 * - `client/src/global.css` mirrors the palette for web-only CSS; keep in sync.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Palette = {
  /** Backgrounds, darkest → lightest */
  bgVoid: '#000008',
  bgDeep: '#01030a',
  surface: '#020810',
  surfaceRaised: '#00111f',

  /** Borders: `border` is visible, `borderSoft` is a subtle divider */
  border: '#0d1e30',
  borderSoft: '#0a1828',

  /** Text hierarchy, brightest → faintest */
  textPrimary: '#ffffff',
  textSecondary: '#aabbcc',
  textMuted: '#677d92',
  textTertiary: '#2a4055',

  /** Brand cyan accent (logo glow) */
  accent: '#00d4ff',
  accentMuted: '#0387a2',
  accentGlow: '#66e5ff',

  /** Status / secondary accents */
  accentBlue: '#5B9FFF',
  accentGreen: '#4ADEC4',
  accentAmber: '#E0A82E',
  accentRed: '#FF6B5B',

  /** Moon-phase graphic (dashboard hero fallback) */
  moonLit: '#E7ECF2',
  moonShadow: '#29445E',

  /** Shadows are pure black regardless of theme */
  shadow: '#000000',

  /** Must match `expo-splash-screen` backgroundColor in client/app.json */
  splashBackground: '#208AEF',
} as const;

/**
 * A Palette hex token at reduced opacity, as an `rgba()` string — for
 * translucent overlays/selections. Keeps components off raw rgba literals.
 */
export function alpha(hex: string, opacity: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

export const Radius = {
  sm: 10,
  md: 14,
  lg: 20,
  pill: 100,
} as const;

export const Spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 44,
  xxxl: 64,
} as const;

/** Width breakpoints for responsive layout (useWindowDimensions().width). */
export const Breakpoints = {
  /** Below this: phone layout (sidebar collapses, single column). */
  tablet: 768,
  /** At or above this: full desktop layout. */
  desktop: 1024,
} as const;

export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

/** Extra bottom inset so scroll content clears the native tab bar. */
export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
