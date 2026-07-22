import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { StarMap, type RocketLaunch, type StargazingSpot } from '@/components/star-map';
import { ThemedText } from '@/components/themed-text';
import { BottomTabInset, Palette, Spacing } from '@/constants/tokens';
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

  const insets = {
    ...safeAreaInsets,
    bottom: safeAreaInsets.bottom + BottomTabInset + Spacing.md,
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
      paddingBottom: Spacing.sm,
    },
  });

  return (
    <ScrollView
      style={styles.scrollView}
      contentInset={insets}
      contentContainerStyle={[styles.contentContainer, contentPlatformStyle]}>
      <View style={styles.container}>
        <View style={styles.header}>
          <ThemedText type="subtitle">Stargazing Spots</ThemedText>
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
  contentContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  container: {
    flex: 1,
    width: '100%',
    paddingHorizontal: Spacing.sm,
    gap: Spacing.sm,
  },
  header: {
    alignItems: 'center',
  },
});
