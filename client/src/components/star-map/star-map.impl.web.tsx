import { Asset } from 'expo-asset';
import { router } from 'expo-router';
import { divIcon } from 'leaflet';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  CircleMarker,
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
} from 'react-leaflet';

import { Palette, Radius } from '@/constants/tokens';
import type { RocketLaunch, StarMapProps, StargazingSpot } from './types';
import { ViewingScoreGauge } from './viewing-score-gauge.web';

import 'leaflet/dist/leaflet.css';
import classes from './star-map.module.css';
import { dvw, dvh } from '@/utilities/responsive-dimensions';

// Radius slider bounds (miles) — mirrors bestSpotService on the server.
const MIN_RADIUS = 5;
const MAX_RADIUS = 100;
const DEFAULT_RADIUS = 25;

// NOTE: This module statically imports `leaflet`, which touches `window`/
// `document` at evaluation time. It must only ever be loaded in the browser —
// it is reached exclusively via the lazy `import()` in star-map.web.tsx, never
// during static (SSR) prerendering.

const DEFAULT_CENTER: [number, number] = [39.5, -98.35]; // continental US
const DEFAULT_ZOOM = 4;

// Resolve the rocket art to a URL we can drop into the Leaflet divIcon HTML.
const ROCKET_URI = Asset.fromModule(require('@/assets/images/icon_rocket.png')).uri;

/** Toggleable map layers. Add a future API layer here + a render branch below
 *  and a LAYER_DEFS entry — the panel picks it up automatically. */
interface LayerState {
  lightBasemap: boolean;
  lightPollution: boolean;
  launches: boolean;
}

const LAYER_DEFS: { key: keyof LayerState; label: string }[] = [
  { key: 'lightBasemap', label: 'Light basemap' },
  { key: 'lightPollution', label: 'Light pollution' },
  { key: 'launches', label: 'Rocket launches' },
];

/** Bortle rating → marker color (lower = darker sky = better for stargazing). */
function bortleColor(bortle?: number): string {
  if (bortle == null) return Palette.accent;
  if (bortle <= 3) return Palette.accent; // pristine / rural — brand cyan
  if (bortle <= 5) return Palette.accentAmber; // suburban transition
  return Palette.accentRed; // bright sky
}

function formatNet(net?: string): string | null {
  if (!net) return null;
  const d = new Date(net);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString();
}

function goToLaunch(launchName: string) {
  router.push({ pathname: '/events', params: { launch: launchName } });
}

function isValidLatLng(lat: number, lng: number) {
  return Number.isFinite(lat) && Number.isFinite(lng);
}

/** Smoothly flies the map to `center`/`zoom` when they change (e.g. once the
 *  user's location resolves). */
function Recenter({ center, zoom }: { center: [number, number]; zoom: number }) {
  const map = useMap();
  useEffect(() => {
    map.flyTo(center, zoom, { duration: 1.2 });
  }, [map, center[0], center[1], zoom]);
  return null;
}

/** Slide-out layers menu, overlaid on the top-right of the map. Lives outside
 *  Leaflet's container DOM, so interacting with it never pans the map. */
function LayersPanel({
  layers,
  onToggle,
}: {
  layers: LayerState;
  onToggle: (key: keyof LayerState) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <View style={styles.panelWrap}>
      <Pressable
        style={styles.panelButton}
        onPress={() => setOpen((o) => !o)}
        accessibilityLabel="Map layers">
        <Text style={styles.panelButtonIcon}>{open ? '›' : '‹'}</Text>
      </Pressable>

      {open && (
        <View style={styles.panelCard}>
          <Text style={styles.panelTitle}>LAYERS</Text>
          {LAYER_DEFS.map(({ key, label }) => {
            const on = layers[key];
            return (
              <Pressable key={key} style={styles.row} onPress={() => onToggle(key)}>
                <Text style={styles.rowLabel}>{label}</Text>
                <View style={[styles.pill, on && styles.pillOn]}>
                  <View style={[styles.knob, on && styles.knobOn]} />
                </View>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

/** Search-radius slider, overlaid bottom-left. Uses a raw range input (web
 *  only) since react-native has no equivalent primitive. Fires `onChange` on
 *  every drag — debouncing the resulting query is the caller's responsibility. */
function RadiusSlider({
  miles,
  onChange,
}: {
  miles: number;
  onChange: (miles: number) => void;
}) {
  return (
    <View style={styles.sliderWrap}>
      <View style={styles.sliderHeader}>
        <Text style={styles.sliderTitle}>SEARCH RADIUS</Text>
        <Text style={styles.sliderValue}>{Math.round(miles)} mi</Text>
      </View>
      <input
        type="range"
        min={MIN_RADIUS}
        max={MAX_RADIUS}
        step={1}
        value={miles}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label="Search radius in miles"
        style={{ width: '100%', accentColor: Palette.accent, cursor: 'pointer' }}
      />
    </View>
  );
}

export default function StarMapImpl({
  spots = [],
  launches = [],
  center = DEFAULT_CENTER,
  zoom = DEFAULT_ZOOM,
  userLocation,
  onSelectSpot,
  onLaunchesEnable,
  userScore,
  bestSpot,
  radiusMiles = DEFAULT_RADIUS,
  onRadiusChange,
  showLightPollution = true,
  preview = false,
}: StarMapProps) {
  const mapCenter = isValidLatLng(center[0], center[1]) ? center : DEFAULT_CENTER;
  const safeUserLocation =
    userLocation && isValidLatLng(userLocation.lat, userLocation.lng) ? userLocation : null;
  const safeSpots = spots.filter((spot) => isValidLatLng(spot.lat, spot.lng));
  const safeLaunches = launches.filter((site) => isValidLatLng(site.lat, site.lng));
  const [layers, setLayers] = useState<LayerState>({
    lightBasemap: false,
    lightPollution: showLightPollution,
    launches: false,
  });
  // Fire onLaunchesEnable only the first time the layer is switched on.
  const launchesRequested = useRef(false);

  const toggle = (key: keyof LayerState) => {
    setLayers((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      if (key === 'launches' && next.launches && !launchesRequested.current) {
        launchesRequested.current = true;
        onLaunchesEnable?.();
      }
      return next;
    });
  };

  const rocketIcon = useMemo(
    () =>
      divIcon({
        className: '', // suppress Leaflet's default white box
        html: `<div class="${classes.rocketMarker}"><img src="${ROCKET_URI}" alt="" /></div>`,
        iconSize: [26, 26],
        iconAnchor: [13, 13],
        popupAnchor: [0, -13],
      }),
    []
  );

  return (
    <>
      <MapContainer
        center={mapCenter}
        zoom={zoom}
        scrollWheelZoom={!preview}
        wheelPxPerZoomLevel={180}
        wheelDebounceTime={80}
        dragging={!preview}
        doubleClickZoom={!preview}
        touchZoom={!preview}
        boxZoom={!preview}
        keyboard={!preview}
        zoomControl={!preview}
        attributionControl={!preview}
        style={{ height: '100%', width: '100%' }}
        className={`${classes.mapContainer} ${preview ? classes.previewMapContainer : ''}`}>
        <Recenter center={mapCenter} zoom={zoom} />

        {/* Base map — key forces a clean swap between providers. Explicit
            zIndex keeps it *below* the light-pollution overlay: swapping the
            base layer re-adds it last, and without a fixed zIndex Leaflet would
            stack the fresh tiles on top and hide the overlay. */}
        {layers.lightBasemap ? (
          <TileLayer
            key="light"
            zIndex={1}
            url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
            subdomains="abcd"
            maxZoom={20}
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
          />
        ) : (
          <TileLayer
            key="dark"
            zIndex={1}
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            subdomains="abcd"
            maxZoom={20}
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
          />
        )}

        {layers.lightPollution && (
          <TileLayer
            zIndex={10}
            url="https://djlorenz.github.io/astronomy/image_tiles/tiles2024/tile_{z}_{x}_{y}.png"
            errorTileUrl="https://djlorenz.github.io/astronomy/image_tiles/tiles2024/black.png"
            // These are 1024px tiles offset by -2 zoom levels; without
            // tileSize/zoomOffset the requested coordinates 404. Values mirror
            // Lorenz's own overlay (djlorenz.github.io/astronomy/lp/).
            //
            // Resolution ceiling: native data stops at tile-zoom 8 (~map zoom
            // 10). maxNativeZoom upscales it deeper, but zoom far enough into a
            // low-pollution area and the faint tint washes out — it can look
            // like the overlay "disappeared". The user normally lands at
            // CITY_ZOOM (11) over their location, where there's ample data; this
            // only surfaces if location is denied and they manually zoom way in.
            tileSize={1024}
            zoomOffset={-2}
            minZoom={2}
            maxNativeZoom={8}
            maxZoom={20}
            opacity={0.5}
            attribution='Light pollution data &copy; <a href="https://djlorenz.github.io/astronomy/lp/">David J. Lorenz</a>'
          />
        )}

        {safeSpots.map((spot: StargazingSpot) => {
          const color = bortleColor(spot.bortle);
          return (
            <CircleMarker
              key={spot.id}
              center={[spot.lat, spot.lng]}
              radius={7}
              pathOptions={{ color, fillColor: color, fillOpacity: 0.7, weight: 2 }}
              eventHandlers={{ click: () => onSelectSpot?.(spot) }}>
              <Tooltip direction="top" offset={[0, -6]}>
                {spot.name}
              </Tooltip>
              <Popup>
                <strong>{spot.name}</strong>
                {spot.bortle != null && <div>Bortle {spot.bortle}</div>}
                {spot.description && <div>{spot.description}</div>}
              </Popup>
            </CircleMarker>
          );
        })}

        {layers.launches &&
          safeLaunches.map((site: RocketLaunch) => (
            <Marker key={site.id} position={[site.lat, site.lng]} icon={rocketIcon}>
              <Tooltip direction="top" offset={[0, -10]}>
                {site.name}
              </Tooltip>
              <Popup>
                <strong>{site.name}</strong>
                {site.location && <div>{site.location}</div>}
                {site.upcoming?.map((u, i) => (
                  <div key={i} style={{ marginTop: 6 }}>
                    <div>
                      🚀 {u.rocket ? `${u.rocket} — ` : ''}
                      {u.name}
                    </div>
                    {formatNet(u.net) && <div>{formatNet(u.net)}</div>}
                    <a
                      href={`/explore?launch=${encodeURIComponent(u.name)}`}
                      className={classes.launchPopupLink}
                      onClick={(event) => {
                        event.preventDefault();
                        goToLaunch(u.name);
                      }}>
                      Go to launch
                    </a>
                  </div>
                ))}
              </Popup>
            </Marker>
          ))}

        {safeUserLocation && (
          <CircleMarker
            center={[safeUserLocation.lat, safeUserLocation.lng]}
            radius={6}
            pathOptions={{
              color: Palette.textPrimary,
              fillColor: Palette.accent,
              fillOpacity: 1,
              weight: 3,
            }}>
            <Tooltip direction="top" offset={[0, -6]}>
              You are here
            </Tooltip>
          </CircleMarker>
        )}

        {/* Viewing-score gauge above the user's pin. Use the *validated*
            location so a bad coord never reaches Leaflet. */}
        {safeUserLocation && userScore != null && (
          <ViewingScoreGauge
            position={[safeUserLocation.lat, safeUserLocation.lng]}
            score={userScore}
          />
        )}

        {/* Best nearby spot: a pin + its own gauge with a distance label. */}
        {bestSpot && isValidLatLng(bestSpot.lat, bestSpot.lon) && (
          <>
            <CircleMarker
              center={[bestSpot.lat, bestSpot.lon]}
              radius={6}
              pathOptions={{
                color: Palette.textPrimary,
                fillColor: Palette.accentGreen,
                fillOpacity: 1,
                weight: 2,
              }}>
              <Tooltip direction="top" offset={[0, -6]}>
                Best nearby spot
              </Tooltip>
            </CircleMarker>
            <ViewingScoreGauge
              position={[bestSpot.lat, bestSpot.lon]}
              score={bestSpot.score}
              label={`${Math.round(bestSpot.distance_miles)} mi ${bestSpot.bearing}`}
              subLabel={`${bestSpot.drive_minutes} min away`}
            />
          </>
        )}
      </MapContainer>

      {!preview && <LayersPanel layers={layers} onToggle={toggle} />}
      {!preview && onRadiusChange && (
        <RadiusSlider miles={radiusMiles} onChange={onRadiusChange} />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  panelWrap: {
    position: 'absolute',
    top: 12,
    right: 12,
    alignItems: 'flex-end',
    zIndex: 1100,
    gap: 8,
  },
  panelButton: {
    width: 34,
    height: 34,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Palette.borderSoft,
    backgroundColor: Palette.bgDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  panelButtonIcon: {
    color: Palette.accent,
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 18,
  },
  panelCard: {
    minWidth: dvw(190),
    backgroundColor: Palette.bgDeep,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Palette.borderSoft,
    padding: 12,
    gap: 4,
    shadowColor: Palette.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
  },
  panelTitle: {
    color: Palette.textMuted,
    fontSize: 10,
    letterSpacing: 2,
    marginBottom: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    gap: 12,
  },
  rowLabel: {
    color: Palette.textSecondary,
    fontSize: 13,
  },
  pill: {
    width: dvw(34),
    height: dvh(18),
    borderRadius: 9,
    backgroundColor: Palette.surface,
    borderWidth: 1,
    borderColor: Palette.border,
    padding: 2,
    justifyContent: 'center',
  },
  pillOn: {
    backgroundColor: Palette.accentMuted,
    borderColor: Palette.accent,
  },
  knob: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: Palette.textMuted,
  },
  knobOn: {
    backgroundColor: Palette.accent,
    alignSelf: 'flex-end',
  },
  sliderWrap: {
    position: 'absolute',
    bottom: 24,
    left: 12,
    width: dvw(200),
    backgroundColor: Palette.bgDeep,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Palette.borderSoft,
    padding: 12,
    gap: 8,
    zIndex: 1100,
    shadowColor: Palette.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
  },
  sliderHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sliderTitle: {
    color: Palette.textMuted,
    fontSize: 10,
    letterSpacing: 2,
  },
  sliderValue: {
    color: Palette.accent,
    fontSize: 12,
    fontWeight: '700',
  },
});
