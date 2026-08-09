import { useEffect, useState } from 'react';
import { Platform, useWindowDimensions } from 'react-native';

function getBrowserViewportWidth() {
  if (typeof window === 'undefined') return null;

  return Math.max(
    window.innerWidth || 0,
    typeof document === 'undefined' ? 0 : document.documentElement?.clientWidth || 0,
    window.visualViewport?.width || 0
  );
}

export function useReliableWindowWidth() {
  const { width } = useWindowDimensions();
  const [browserWidth, setBrowserWidth] = useState<number | null>(() =>
    Platform.OS === 'web' ? getBrowserViewportWidth() : null
  );

  useEffect(() => {
    if (Platform.OS !== 'web') return;

    const updateBrowserWidth = () => {
      setBrowserWidth(getBrowserViewportWidth());
    };
    const visualViewport = window.visualViewport;

    updateBrowserWidth();
    window.addEventListener('resize', updateBrowserWidth);
    visualViewport?.addEventListener('resize', updateBrowserWidth);

    return () => {
      window.removeEventListener('resize', updateBrowserWidth);
      visualViewport?.removeEventListener('resize', updateBrowserWidth);
    };
  }, []);

  return Math.max(width || 0, browserWidth || 0);
}
