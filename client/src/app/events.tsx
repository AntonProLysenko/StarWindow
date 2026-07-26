// app/events.tsx
// StarWindow — Events overview (phase 1: list only).
// Fetches the unified upcoming-events list once on mount, renders it as a
// vertical card list with a client-side type filter. Rocket launches are
// visually distinct (see EventCard). Clicking a card is a placeholder for now —
// phase 2 will route to a per-event detail page.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import { EventCard } from '@/components/events/event-card';
import { EventModal } from '@/components/events/event-modal';
import { Palette, Radius } from '@/constants/tokens';
import { useSharedEvents } from '@/context/events-context';
import { getEventEmoji } from '@/lib/event-colors';
import type { EventListItem } from '@/lib/events-api';
import { getOrRequestUserLocation } from '@/utilities/user-location-service';
import { getUser } from '@/utilities/users-service';
import { dvw } from '@/utilities/responsive-dimensions';

const ALL = 'All';
const FILTER_OPTIONS = [
  ALL,
  'Rocket Launch',
  'Meteor Shower',
  'Asteroid Flyby',
  'Comet Flyby',
  'Near-Earth Object',
  'Celestial Events',
  'Spacecraft Event',
  'Spacewalk',
  'Press Event',
];
const PRIMARY_FILTERS = new Set(FILTER_OPTIONS);
const CELESTIAL_TYPE_KEYWORDS = [
  'eclipse',
  'occultation',
  'conjunction',
  'opposition',
  'transit',
  'alignment',
  'lunar',
  'solar',
  'moon',
  'comet',
  'asteroid',
];

type EventRouteParams = {
  eventId?: string | string[];
  category?: string | string[];
  type?: string | string[];
  name?: string | string[];
  date?: string | string[];
  datePrecision?: string | string[];
  description?: string | string[];
  imageUrl?: string | string[];
  location?: string | string[];
  videoUrl?: string | string[];
  videoUrls?: string | string[];
  externalUrl?: string | string[];
  externalUrls?: string | string[];
  synthetic?: string | string[];
};

function firstParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

function urlArrayParam(value?: string | string[], fallback?: string | null) {
  const raw = firstParam(value);
  const urls: string[] = [];
  const seen = new Set<string>();

  function add(url?: string | null) {
    const next = String(url ?? '').trim();
    if (!next || seen.has(next)) return;
    seen.add(next);
    urls.push(next);
  }

  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        parsed.forEach((url) => add(typeof url === 'string' ? url : null));
      } else {
        add(raw);
      }
    } catch {
      add(raw);
    }
  }
  add(fallback);

  return urls;
}

function normalizeParam(value?: string | null) {
  return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function getCanonicalFilterOption(option?: string | null) {
  const normalized = normalizeParam(option);
  if (normalized === 'celestial event') return 'Celestial Events';
  if (normalized === 'rocket launch' || normalized === 'launch') return 'Rocket Launch';
  if (normalized === 'eva') return 'Spacewalk';
  return option || ALL;
}

function getFilterLabel(option: string) {
  const canonicalOption = getCanonicalFilterOption(option);
  if (canonicalOption === ALL) return '✦ All';
  return `${getEventEmoji({
    category: canonicalOption === 'Rocket Launch' ? 'launch' : 'event',
    type: canonicalOption,
    name: canonicalOption,
  })} ${canonicalOption}`;
}

function eventMatchesFilter(event: EventListItem, filter: string) {
  const canonicalFilter = getCanonicalFilterOption(filter);
  if (canonicalFilter === ALL) return true;

  const bucket = getEventFilterBucket(event);
  if (canonicalFilter === 'Near-Earth Object') {
    return bucket === 'Near-Earth Object' || bucket === 'Asteroid Flyby' || bucket === 'Comet Flyby';
  }

  if (PRIMARY_FILTERS.has(canonicalFilter)) {
    return bucket === canonicalFilter;
  }

  return getCanonicalFilterOption(event.type) === canonicalFilter;
}

function isPrimaryFilterType(event: EventListItem) {
  const type = normalizeParam(event.type);
  const canonicalType = getCanonicalFilterOption(event.type);
  return (
    event.category === 'launch' ||
    PRIMARY_FILTERS.has(canonicalType) ||
    type === 'celestial event' ||
    type === 'eva'
  );
}

function getEventFilterBucket(event: EventListItem) {
  const type = normalizeParam(event.type);
  const name = normalizeParam(event.name);
  const typeAndName = `${type} ${name}`;

  if (event.category === 'launch') return 'Rocket Launch';
  if (isPressEventType(type)) return 'Press Event';
  if (type.includes('launch')) return 'Rocket Launch';
  if (isSpacewalkEventType(type)) return 'Spacewalk';
  if (isMeteorShowerType(type)) return 'Meteor Shower';
  if (isAsteroidFlybyType(typeAndName)) return 'Asteroid Flyby';
  if (isCometFlybyType(typeAndName)) return 'Comet Flyby';
  if (isNearEarthObjectType(type)) return 'Near-Earth Object';
  if (isSpacecraftEventType(type)) return 'Spacecraft Event';
  if (isCelestialEventType(type, typeAndName)) return 'Celestial Events';

  return getCanonicalFilterOption(event.type);
}

function isPressEventType(type: string) {
  return (
    type.includes('press') ||
    type.includes('briefing') ||
    type.includes('media event') ||
    type.includes('news conference')
  );
}

function isSpacewalkEventType(type: string) {
  return type === 'eva' || type.includes('spacewalk');
}

function isMeteorShowerType(type: string) {
  return type.includes('meteor') && type.includes('shower');
}

function isAsteroidFlybyType(label: string) {
  return label.includes('asteroid') && label.includes('flyby');
}

function isCometFlybyType(label: string) {
  return label.includes('comet') && label.includes('flyby');
}

function isNearEarthObjectType(type: string) {
  return type.includes('near-earth');
}

function isSpacecraftEventType(type: string) {
  return (
    type.includes('spacecraft') ||
    type.includes('docking') ||
    type.includes('undocking') ||
    type.includes('berthing') ||
    type.includes('capture') ||
    type.includes('release') ||
    type.includes('reentry') ||
    type.includes('landing')
  );
}

function isCelestialEventType(type: string, typeAndName: string) {
  return (
    type === 'celestial event' ||
    CELESTIAL_TYPE_KEYWORDS.some((keyword) => typeAndName.includes(keyword))
  );
}

function getEventRouteKey(params: EventRouteParams) {
  return [
    firstParam(params.eventId),
    firstParam(params.category),
    firstParam(params.type),
    firstParam(params.name),
    firstParam(params.date),
    firstParam(params.synthetic),
  ]
    .filter(Boolean)
    .join('|');
}

function sameEventDate(left?: string | null, right?: string | null) {
  if (!left || !right) return true;
  const leftTime = new Date(left).getTime();
  const rightTime = new Date(right).getTime();
  if (Number.isNaN(leftTime) || Number.isNaN(rightTime)) return true;
  return Math.abs(leftTime - rightTime) < 60 * 1000;
}

function getEventTime(event: EventListItem) {
  if (!event.date) return Infinity;
  const time = new Date(event.date).getTime();
  return Number.isNaN(time) ? Infinity : time;
}

function findRequestedEvent(events: EventListItem[], params: EventRouteParams) {
  const eventId = firstParam(params.eventId);
  const category = firstParam(params.category);
  const type = firstParam(params.type);
  const name = firstParam(params.name);
  const date = firstParam(params.date);
  const normalizedName = normalizeParam(name);
  const normalizedType = normalizeParam(type);

  if (eventId) {
    const exact = events.find((event) =>
      String(event.event_id) === eventId ||
      String(event.id) === eventId
    );
    if (exact) return exact;
  }

  if (normalizedName) {
    const named = events.find((event) => {
      const categoryMatches = !category || event.category === category;
      const nameMatches = normalizeParam(event.name) === normalizedName;
      return categoryMatches && nameMatches && sameEventDate(event.date, date);
    });
    if (named) return named;
  }

  if (normalizedType) {
    return events.find((event) => normalizeParam(event.type) === normalizedType) ?? null;
  }

  return null;
}

function buildDashboardPreviewEvent(params: EventRouteParams): EventListItem | null {
  const name = firstParam(params.name);
  const type = firstParam(params.type) ?? 'Dashboard Preview';
  if (!name) return null;

  const category = firstParam(params.category) === 'launch' ? 'launch' : 'event';
  const videoUrl = firstParam(params.videoUrl) ?? null;
  const externalUrl = firstParam(params.externalUrl) ?? null;
  const videoUrls = urlArrayParam(params.videoUrls, videoUrl);
  const externalUrls = urlArrayParam(params.externalUrls, externalUrl);

  return {
    id: `dashboard-${normalizeParam(type)}-${normalizeParam(name)}`,
    event_id: `dashboard-${normalizeParam(type)}-${normalizeParam(name)}`,
    category,
    name,
    type,
    date: firstParam(params.date) ?? null,
    date_precision: firstParam(params.datePrecision) ?? null,
    description: firstParam(params.description) ?? null,
    image_url: firstParam(params.imageUrl) ?? null,
    location: firstParam(params.location) ?? null,
    latitude: null,
    longitude: null,
    webcast_live: false,
    video_url: videoUrls[0] ?? null,
    video_urls: videoUrls,
    external_url: externalUrls[0] ?? null,
    external_urls: externalUrls,
    launch_details: null,
  };
}

export default function EventsScreen() {
  const routeParams = useLocalSearchParams<EventRouteParams>();
  const routeEventKey = getEventRouteKey(routeParams);
  const { events, isLoading: loading, error } = useSharedEvents();
  const [activeType, setActiveType] = useState<string>(ALL);
  const listRef = useRef<ScrollView>(null);
  const [upcomingAnchorY, setUpcomingAnchorY] = useState<number | null>(null);
  const [didAlignToUpcoming, setDidAlignToUpcoming] = useState(false);

  // Modal + user context (location for the viewing score, user_id for saving).
  const [selectedEvent, setSelectedEvent] = useState<EventListItem | null>(null);
  const [openedRouteEventKey, setOpenedRouteEventKey] = useState<string | null>(null);
  const [userLat, setUserLat] = useState<number | null>(null);
  const [userLon, setUserLon] = useState<number | null>(null);
  const userId = getUser()?.user_id ?? null;

  // Resolve the user's location once (best-effort — modal degrades without it).
  useEffect(() => {
    (async () => {
      try {
        const location = await getOrRequestUserLocation();
        if (!location) return;
        setUserLat(location.latitude);
        setUserLon(location.longitude);
      } catch {
        // Location unavailable — score section shows an "enable location" note.
      }
    })();
  }, []);

  // Filter options are derived from the types actually present in the data,
  // with "All" always first. Order preserves first-seen (already chronological).
  // Client-side filtering only — no re-fetch. Data is already sorted soonest-first.
  const filterOptions = useMemo(() => {
    const extraTypes: string[] = [];
    const seen = new Set(PRIMARY_FILTERS);

    for (const event of events) {
      const option = getCanonicalFilterOption(event.type);
      if (!event.type || seen.has(option)) continue;
      if (isPrimaryFilterType(event)) continue;
      seen.add(option);
      extraTypes.push(option);
    }

    return [...FILTER_OPTIONS, ...extraTypes];
  }, [events]);

  useEffect(() => {
    const canonicalActiveType = getCanonicalFilterOption(activeType);
    if (canonicalActiveType !== activeType && filterOptions.includes(canonicalActiveType)) {
      setActiveType(canonicalActiveType);
    }
  }, [activeType, filterOptions]);

  const visibleEvents = useMemo(() => {
    if (activeType === ALL) return events;
    return events.filter((event) => eventMatchesFilter(event, activeType));
  }, [events, activeType]);

  const { pastEvents, upcomingEvents } = useMemo(() => {
    const now = Date.now();
    return {
      pastEvents: visibleEvents.filter((event) => getEventTime(event) < now),
      upcomingEvents: visibleEvents.filter((event) => getEventTime(event) >= now),
    };
  }, [visibleEvents]);

  useEffect(() => {
    setDidAlignToUpcoming(false);
    setUpcomingAnchorY(null);
  }, [activeType]);

  function alignToUpcoming() {
    if (didAlignToUpcoming || upcomingAnchorY == null || loading) return;
    requestAnimationFrame(() => {
      listRef.current?.scrollTo({ y: Math.max(upcomingAnchorY - 4, 0), animated: false });
      setDidAlignToUpcoming(true);
    });
  }

  useEffect(() => {
    alignToUpcoming();
  }, [upcomingAnchorY, loading, didAlignToUpcoming]);

  useEffect(() => {
    if (!routeEventKey || openedRouteEventKey === routeEventKey || loading) return;

    const requestedType = firstParam(routeParams.type);
    const matchedEvent = findRequestedEvent(events, routeParams);
    const eventToOpen = matchedEvent ?? buildDashboardPreviewEvent(routeParams);

    if (eventToOpen) {
      setActiveType(eventToOpen.type);
      setSelectedEvent(eventToOpen);
      setOpenedRouteEventKey(routeEventKey);
    } else if (requestedType) {
      setActiveType(requestedType);
      setOpenedRouteEventKey(routeEventKey);
    }
  }, [events, loading, openedRouteEventKey, routeEventKey, routeParams]);

  // Phase 2: open the detail modal for the clicked event.
  const handleEventClick = (event: EventListItem) => {
    setSelectedEvent(event);
  };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>WHAT&apos;S COMING UP</Text>
        <Text style={styles.title}>Events</Text>
      </View>

      {/* Filter bar — hidden until we have data to derive types from. */}
      {!loading && !error && events.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filterBar}
          contentContainerStyle={styles.filterBarContent}>
          {filterOptions.map((option) => {
            const active = option === activeType;
            return (
              <Pressable
                key={option}
                onPress={() => setActiveType(option)}
                style={[styles.filterPill, active && styles.filterPillActive]}>
                <Text style={[styles.filterPillText, active && styles.filterPillTextActive]}>
                  {getFilterLabel(option)}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={Palette.accent} />
          <Text style={styles.stateText}>Loading events…</Text>
        </View>
      ) : error ? (
        <View style={styles.centerState}>
          <Text style={styles.stateEmoji}>⚠️</Text>
          <Text style={styles.stateText}>{error}</Text>
        </View>
      ) : visibleEvents.length === 0 ? (
        <View style={styles.centerState}>
          <Text style={styles.stateEmoji}>🔭</Text>
          <Text style={styles.stateTitle}>No events to show</Text>
          <Text style={styles.stateText}>
            {events.length === 0
              ? 'There are no upcoming events right now. Check back soon.'
              : `No ${activeType} events coming up. Try a different filter.`}
          </Text>
        </View>
      ) : (
        <ScrollView
          ref={listRef}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={alignToUpcoming}>
          {pastEvents.length > 0 ? (
            <View style={styles.timelineSection}>
              <TimelineSectionLabel text="PAST EVENTS" />
              {pastEvents.map((event) => (
                <EventCard
                  key={`${event.category}-${event.id}`}
                  event={event}
                  onPress={handleEventClick}
                />
              ))}
            </View>
          ) : null}

          <View
            style={styles.timelineSection}
            onLayout={(event) => setUpcomingAnchorY(event.nativeEvent.layout.y)}>
            {pastEvents.length > 0 && upcomingEvents.length > 0 ? (
              <TimelineSectionLabel text="UPCOMING EVENTS" />
            ) : null}
            {upcomingEvents.map((event) => (
            <EventCard
              key={`${event.category}-${event.id}`}
              event={event}
              onPress={handleEventClick}
            />
            ))}
          </View>
        </ScrollView>
      )}

      {/* Detail modal — mounted only while open so its a11y lifecycle is clean. */}
      {selectedEvent && (
        <EventModal
          event={selectedEvent}
          onClose={() => setSelectedEvent(null)}
          userId={userId}
          userLat={userLat}
          userLon={userLon}
        />
      )}
    </View>
  );
}

function TimelineSectionLabel({ text }: { text: string }) {
  return (
    <View style={styles.timelineSectionLabelRow}>
      <Text style={styles.timelineSectionLabel}>{text}</Text>
      <View style={styles.timelineSectionLine} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Palette.bgVoid,
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 12,
  },
  eyebrow: {
    fontSize: 11,
    color: Palette.accent,
    letterSpacing: 1,
    fontWeight: '600',
    marginBottom: 6,
  },
  title: {
    fontSize: 26,
    lineHeight: 32,
    fontWeight: '700',
    color: Palette.textPrimary,
  },
  filterBar: {
    flexGrow: 0,
    paddingHorizontal: 24,
  },
  filterBarContent: {
    gap: 8,
    paddingVertical: 12,
  },
  filterPill: {
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Palette.borderSoft,
    backgroundColor: Palette.surface,
  },
  filterPillActive: {
    backgroundColor: Palette.accent + '20',
    borderColor: Palette.accent,
  },
  filterPillText: {
    fontSize: 12,
    fontWeight: '600',
    color: Palette.textSecondary,
  },
  filterPillTextActive: {
    color: Palette.accent,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 24,
    paddingTop: 4,
    paddingBottom: 48,
    gap: 12,
    width: '100%',
    maxWidth: dvw(800),
    alignSelf: 'center',
  },
  timelineSection: {
    gap: 12,
  },
  timelineSectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingTop: 6,
    paddingBottom: 2,
  },
  timelineSectionLabel: {
    color: Palette.accent,
    fontSize: 12,
    lineHeight: 14,
    fontWeight: '800',
    letterSpacing: 1,
  },
  timelineSectionLine: {
    flex: 1,
    height: 1,
    backgroundColor: Palette.border,
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 40,
  },
  stateEmoji: {
    fontSize: 34,
  },
  stateTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: Palette.textPrimary,
  },
  stateText: {
    fontSize: 13,
    lineHeight: 18,
    color: Palette.textSecondary,
    textAlign: 'center',
  },
});
