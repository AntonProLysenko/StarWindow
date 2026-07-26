import type { StyleProp, ViewStyle } from 'react-native';

import type { BestSpot } from '@/lib/map-api';

/**
 * A stargazing location shown on the map. `bortle` is the Bortle dark-sky
 * scale (1 = pristine dark sky, 9 = inner-city light pollution) and drives the
 * marker color. This shape is intentionally backend-agnostic so a future feed
 * can populate it without touching the map components.
 */
export interface StargazingSpot {
  id: string;
  name: string;
  lat: number;
  lng: number;
  /** Bortle dark-sky rating, 1 (best) – 9 (worst). */
  bortle?: number;
  description?: string;
}

/**
 * A rocket launch site, normalized from the server's `/api/astronomy/launches`
 * feed (one entry per pad; `upcoming` lists that pad's next launches). Off by
 * default on the map — the user opts in via the layers panel.
 */
export interface RocketLaunch {
  /** Stable id, derived from the pad. */
  id: string;
  /** Pad name (the map marker label). */
  name: string;
  lat: number;
  lng: number;
  location?: string;
  /** Next launches scheduled at this pad. */
  upcoming?: {
    id?: string | number;
    eventId?: string | number | null;
    name: string;
    net?: string;
    netPrecision?: string | null;
    status?: string;
    provider?: string;
    rocket?: string;
    imageUrl?: string;
    missionName?: string | null;
    missionType?: string | null;
    missionDescription?: string | null;
  }[];
}

/**
 * Shared contract satisfied by both the web (`star-map.web.tsx`) and native
 * (`star-map.tsx`) implementations. Callers import from `@/components/star-map`
 * and get the right platform variant automatically.
 */
export interface StarMapProps {
  spots?: StargazingSpot[];
  /** Rocket launch sites. Hidden until the user enables the layer. */
  launches?: RocketLaunch[];
  /** Initial map center as [latitude, longitude]. */
  center?: [number, number];
  zoom?: number;
  userLocation?: { lat: number; lng: number } | null;
  onSelectSpot?: (spot: StargazingSpot) => void;
  /**
   * Fired once, the first time the user switches the rocket-launches layer on.
   * Lets the screen lazy-load `launches` instead of fetching on every map view.
   */
  onLaunchesEnable?: () => void;
  /** Viewing score (0–100) at the user's location; renders a gauge over their pin. */
  userScore?: number | null;
  /** Best nearby stargazing spot; renders a pin + gauge with a distance label. */
  bestSpot?: BestSpot | null;
  /** Current best-spot search radius (miles) shown on the slider. */
  radiusMiles?: number;
  /** Fired as the radius slider moves; presence also toggles the slider on. */
  onRadiusChange?: (miles: number) => void;
  /** Toggle the light-pollution overlay (web). Defaults to on. */
  showLightPollution?: boolean;
  /** Render a compact, non-interactive map for dashboard previews. */
  preview?: boolean;
  /** Make the full web map occupy most of the viewport. */
  immersive?: boolean;
  style?: StyleProp<ViewStyle>;
}
