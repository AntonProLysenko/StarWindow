// app/events.tsx
// StarWindow — Events overview (phase 1: list only).
// Fetches the unified upcoming-events list once on mount, renders it as a
// vertical card list with a client-side type filter. Rocket launches are
// visually distinct (see EventCard). Clicking a card is a placeholder for now —
// phase 2 will route to a per-event detail page.

import { useEffect, useMemo, useState } from 'react';
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
import { fetchEventsList, type EventListItem } from '@/lib/events-api';
import { getOrRequestUserLocation } from '@/utilities/user-location-service';
import { getUser } from '@/utilities/users-service';
import { dvw } from '@/utilities/responsive-dimensions';

const ALL = 'All';

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
  synthetic?: string | string[];
};

function firstParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

function normalizeParam(value?: string | null) {
  return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
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
    video_url: null,
    launch_details: null,
  };
}

export default function EventsScreen() {
  const routeParams = useLocalSearchParams<EventRouteParams>();
  const routeEventKey = getEventRouteKey(routeParams);
  const [events, setEvents] = useState<EventListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeType, setActiveType] = useState<string>(ALL);

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

  // Fetch once on mount. AbortController cancels the request if we unmount first.
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await fetchEventsList(controller.signal);
        setEvents(data);
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setError('Could not load events. Please try again.');
        }
      } finally {
        setLoading(false);
      }
    })();
    return () => controller.abort();
  }, []);

  // Filter options are derived from the types actually present in the data,
  // with "All" always first. Order preserves first-seen (already chronological).
  const filterOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const e of events) {
      if (e.type) seen.add(e.type);
    }
    return [ALL, ...seen];
  }, [events]);

  // Client-side filtering only — no re-fetch. Data is already sorted soonest-first.
  const visibleEvents = useMemo(() => {
    if (activeType === ALL) return events;
    return events.filter((e) => e.type === activeType);
  }, [events, activeType]);

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
                  {option}
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
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}>
          {visibleEvents.map((event) => (
            <EventCard
              key={`${event.category}-${event.id}`}
              event={event}
              onPress={handleEventClick}
            />
          ))}
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
