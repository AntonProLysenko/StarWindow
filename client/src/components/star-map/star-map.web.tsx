import { lazy, Suspense, useEffect, useState } from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';

import { Palette, Radius } from '@/constants/tokens';
import type { StarMapProps } from './types';

// Loaded only in the browser. The dynamic import keeps `leaflet` (which touches
// `window`/`document` at module-eval time) out of the static-render (SSR) graph,
// so prerendering in Node never evaluates it. See app.json `web.output: static`.
const StarMapImpl = lazy(() => import('./star-map.impl.web'));

export function StarMap(props: StarMapProps) {
  // Responsive height — same Dimensions pattern used across the app so the map
  // adapts from a phone browser to a desktop viewport.
  const [screen, setScreen] = useState(() => Dimensions.get('window'));
  // `mounted` is false during SSR and the first client paint (effects don't run
  // on the server), so the heavy map chunk only loads once we're in the browser.
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const sub = Dimensions.addEventListener('change', ({ window }) => setScreen(window));
    return () => sub.remove();
  }, []);

  const height = props.preview
    ? '100%'
    : props.immersive
    ? Math.max(screen.height - 88, 360)
    : Math.min(Math.max(screen.height * 0.6, 320), 720);

  return (
    <View style={[styles.frame, props.preview && styles.previewFrame, { height }, props.style]}>
      {mounted && (
        <Suspense fallback={null}>
          <StarMapImpl {...props} />
        </Suspense>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    width: '100%',
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Palette.borderSoft,
    backgroundColor: Palette.bgDeep,
    overflow: 'hidden',
    // Cyan glow, matching the login card.
    shadowColor: Palette.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
  },
  previewFrame: {
    borderWidth: 0,
    borderRadius: 0,
    shadowOpacity: 0,
    shadowRadius: 0,
  },
});
