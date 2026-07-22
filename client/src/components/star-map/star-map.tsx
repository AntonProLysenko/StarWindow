import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Palette, Radius } from '@/constants/tokens';
import type { StarMapProps } from './types';
import { dvh } from '@/utilities/responsive-dimensions';

/**
 * Native (iOS/Android) placeholder. Leaflet is DOM-only and cannot run on
 * native, so this renders a themed stub satisfying the same StarMapProps. When
 * we wire up a native map (WebView-hosted Leaflet or react-native-maps), it
 * drops in here with no changes to callers.
 */
export function StarMap({ spots = [], style }: StarMapProps) {
  return (
    <View style={[styles.frame, style]}>
      <ThemedText style={styles.glyph}>✦</ThemedText>
      <ThemedText style={styles.title}>Sky map</ThemedText>
      <ThemedText style={styles.subtitle}>
        Interactive map is available on the web for now.
      </ThemedText>
      {spots.length > 0 && (
        <ThemedText style={styles.count}>
          {spots.length} stargazing {spots.length === 1 ? 'spot' : 'spots'} nearby
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    width: '100%',
    minHeight: dvh(320),
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Palette.borderSoft,
    backgroundColor: Palette.bgDeep,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 8,
  },
  glyph: {
    color: Palette.accent,
    fontSize: 28,
    letterSpacing: 8,
  },
  title: {
    color: Palette.textPrimary,
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 2,
  },
  subtitle: {
    color: Palette.textMuted,
    fontSize: 12,
    textAlign: 'center',
  },
  count: {
    color: Palette.accent,
    fontSize: 12,
    opacity: 0.7,
    marginTop: 4,
  },
});
