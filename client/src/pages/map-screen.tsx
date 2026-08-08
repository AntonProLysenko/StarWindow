import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { StarMap, type RocketLaunch, type StargazingSpot } from '@/components/star-map';
import { ThemedText } from '@/components/themed-text';
import { BottomTabInset, Breakpoints, Palette, Radius, Spacing } from '@/constants/tokens';
import { fetchLaunches } from '@/lib/astronomy';
import { fetchBestSpot, type BestSpot } from '@/lib/map-api';
import { getOrRequestUserLocation } from '@/utilities/user-location-service';
import * as usersService from '@/utilities/users-service';

// Zoom we drop to once we know the user's location - close enough to see their
// city while the upscaled light-pollution overlay stays readable.
const CITY_ZOOM = 11;

// Default best-nearby-spot search radius (miles) + slider debounce.
const DEFAULT_RADIUS = 25;
const RADIUS_DEBOUNCE_MS = 300;
const MOBILE_WEB_NAV_HEIGHT = 88;
const MOBILE_HEADER_HEIGHT = 92;

// Placeholder data until a backend feed lands. Bortle: 1 = pristine dark sky.
const SAMPLE_SPOTS: StargazingSpot[] = [
  {
    id: 'death-valley',
    name: 'Death Valley National Park',
    lat: 36.5054,
    lng: -117.0794,
    bortle: 1,
    description: 'Gold-tier International Dark Sky Park.',
  },
  {
    id: 'cherry-springs',
    name: 'Cherry Springs State Park',
    lat: 41.6501,
    lng: -77.8164,
    bortle: 2,
    description: 'Dark-sky park with strong Milky Way visibility.',
  },
];

export default function MapScreen() {
  const safeAreaInsets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const isMobile = width < Breakpoints.tablet;
  const [center, setCenter] = useState<[number, number] | undefined>(undefined);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [launches, setLaunches] = useState<RocketLaunch[]>([]);
  const [radiusMiles, setRadiusMiles] = useState(DEFAULT_RADIUS);
  const [userScore, setUserScore] = useState<number | null>(null);
  const [bestSpot, setBestSpot] = useState<BestSpot | null>(null);

  useEffect(() => {
    if (!usersService.getToken()) {
      router.replace('/');
    }
  }, []);

  const loadLaunches = async () => {
    try {
      setLaunches(await fetchLaunches());
    } catch (e) {
      console.warn('Failed to load launches:', e);
    }
  };

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const location = await getOrRequestUserLocation();
        if (cancelled || !location) return;
        const { latitude, longitude } = location;
        setUserLocation({ lat: latitude, lng: longitude });
        setCenter([latitude, longitude]);
      } catch {
        // Keep the map usable with its default center if browser location fails.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Re-query the best nearby spot whenever location or radius changes. Debounced
  // so dragging the slider fires one request ~300ms after the user stops; the
  // previous in-flight request is aborted.
  useEffect(() => {
    if (!userLocation) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetchBestSpot(
          { lat: userLocation.lat, lon: userLocation.lng, radiusMiles },
          controller.signal
        );
        setUserScore(res.user_score);
        setBestSpot(res.best_spot);
      } catch (e) {
        if ((e as Error)?.name !== 'AbortError') {
          console.warn('Failed to load best spot:', e);
        }
      }
    }, RADIUS_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [userLocation, radiusMiles]);

  const mobileBottomClearance =
    Platform.OS === 'web' && isMobile ? MOBILE_WEB_NAV_HEIGHT + safeAreaInsets.bottom : 0;
  const mobileMapHeight = Math.max(
    height - mobileBottomClearance - safeAreaInsets.top - MOBILE_HEADER_HEIGHT,
    320
  );

  const insets = {
    ...safeAreaInsets,
    bottom: safeAreaInsets.bottom + BottomTabInset + mobileBottomClearance + Spacing.md,
  };

  const contentPlatformStyle = Platform.select({
    android: {
      paddingTop: insets.top,
      paddingLeft: insets.left,
      paddingRight: insets.right,
      paddingBottom: insets.bottom,
    },
    web: {
      paddingTop: Spacing.sm,
      paddingBottom: isMobile ? Spacing.md : Spacing.sm,
    },
  });

  return (
    <ScrollView
      style={[styles.scrollView, isMobile && styles.scrollViewMobile]}
      scrollEnabled={Platform.OS !== 'web'}
      contentInset={insets}
      contentContainerStyle={[
        styles.contentContainer,
        isMobile && styles.contentContainerMobile,
        contentPlatformStyle,
      ]}>
      <View style={[styles.container, isMobile && styles.containerMobile]}>
        <View style={[styles.header, isMobile && styles.headerMobile]}>
          <ThemedText type="subtitle" style={isMobile && styles.titleMobile}>
            Stargazing Spots
          </ThemedText>
          <ThemedText
            themeColor="textMuted"
            style={[styles.planningNote, isMobile && styles.planningNoteMobile]}
            numberOfLines={isMobile ? 2 : undefined}>
            Planning scores show a spot&rsquo;s stargazing potential — not the current
            time of day. Check the dashboard for how good viewing is right now.
          </ThemedText>
        </View>

        <StarMap
          spots={SAMPLE_SPOTS}
          launches={launches}
          center={center}
          zoom={center ? CITY_ZOOM : undefined}
          userLocation={userLocation}
          onLaunchesEnable={loadLaunches}
          userScore={userScore}
          bestSpot={bestSpot}
          radiusMiles={radiusMiles}
          onRadiusChange={setRadiusMiles}
          immersive
          style={isMobile ? [styles.mapFrameMobile, { height: mobileMapHeight }] : undefined}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
    backgroundColor: Palette.bgVoid,
  },
  scrollViewMobile: {
    backgroundColor: Palette.bgDeep,
  },
  contentContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  contentContainerMobile: {
    minHeight: '100%' as any,
    alignItems: 'stretch',
  },
  container: {
    flex: 1,
    width: '100%',
    paddingHorizontal: Spacing.sm,
    gap: Spacing.sm,
  },
  containerMobile: {
    paddingHorizontal: 10,
    paddingBottom: Spacing.sm,
    gap: 10,
  },
  header: {
    alignItems: 'center',
  },
  headerMobile: {
    alignItems: 'flex-start',
    paddingHorizontal: 4,
    gap: 2,
  },
  titleMobile: {
    fontSize: 22,
    lineHeight: 27,
  },
  planningNote: {
    marginTop: Spacing.xs,
    fontSize: 12,
    lineHeight: 16,
    textAlign: 'center',
    maxWidth: 520,
  },
  planningNoteMobile: {
    marginTop: 0,
    maxWidth: '100%',
    fontSize: 11,
    lineHeight: 15,
    textAlign: 'left',
  },
  mapFrameMobile: {
    borderRadius: Radius.md,
    borderColor: Palette.border,
    shadowOpacity: 0.08,
    shadowRadius: 14,
  },
});
