import React, { memo, useEffect, useMemo, useState } from 'react';
import { SymbolView } from 'expo-symbols';
import { Image, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MonthGrid } from '@/components/calendar/month-grid';
import { EventModal } from '@/components/events/event-modal';
import { ShootingStar } from '@/components/shooting-star';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Breakpoints, Palette, Radius, Spacing } from '@/constants/tokens';
import { useSharedEvents } from '@/context/events-context';
import { useVisibleBodyEvents } from '@/hooks/use-visible-body-events';
import { ALL_EVENT_FILTER, EVENT_FILTER_OPTIONS, filterEvents, getEventIconByType } from '@/lib/event-icons';
import { getEventEmoji } from '@/lib/event-colors';
import { fetchSavedUserEvents, type EventListItem } from '@/lib/events-api';
import * as eventTypesAPI from '@/utilities/event-types-api';
import {
  eventListItemToCalendarEvent,
  getCalendarEventsForDate,
  getCalendarEventsForMonth,
  type CalendarEvent,
} from '@/utilities/events-api';
import { getOrRequestUserLocation } from '@/utilities/user-location-service';
import { getToken, getUser, getUserEventTypes } from '@/utilities/users-service';
import { dvw, dvh } from '@/utilities/responsive-dimensions';

const MONTHS_BEHIND_TO_FETCH = 1;
const MONTHS_AHEAD_TO_FETCH = 1;
const CALENDAR_GRID_MAX_HEIGHT = 840;
const STARS = Array.from({ length: 72 }, (_, i) => ({
  top: (i * 23.7) % 100,
  left: (i * 41.3) % 100,
  size: (i % 4) + 0.5,
  opacity: (i % 6) * 0.08 + 0.15,
}));
const SHOOTING_STAR_DELAYS = [0, 2400];

function calendarEventToEventListItem(event: CalendarEvent): EventListItem {
  const type = event.type ?? 'Event';
  const isLaunch = event.category === 'launch' || type.toLowerCase().includes('launch');

  return {
    id: event.sourceId ?? event.id,
    event_id: event.eventId ?? event.id,
    category: isLaunch ? 'launch' : 'event',
    name: event.title,
    type,
    date: event.startDate,
    date_precision: event.datePrecision ?? null,
    description: event.detail,
    image_url: event.imageUrl ?? null,
    location: event.location ?? null,
    latitude: event.latitude ?? null,
    longitude: event.longitude ?? null,
    webcast_live: event.webcastLive ?? false,
    video_url: event.videoUrl ?? null,
    video_urls: event.videoUrls ?? [],
    external_url: event.externalUrl ?? null,
    external_urls: event.externalUrls ?? [],
    launch_details: event.launchDetails ?? null,
    visible_bodies: event.visibleBodies ?? undefined,
    radiant: event.radiant ?? null,
    radiant_declination_degrees: event.radiantDeclinationDegrees ?? null,
    zhr: event.zhr ?? null,
    active_start: event.activeStart ?? null,
    active_end: event.activeEnd ?? null,
    peak_date: event.peakDate ?? null,
    best_time: event.bestTime ?? null,
    moon_age_days: event.moonAgeDays ?? null,
    radiant_max_altitude_degrees: event.radiantMaxAltitudeDegrees ?? null,
  };
}

function formatDateForApi(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function defaultCalendarWindow() {
  const today = new Date();
  const from = new Date(today.getFullYear(), today.getMonth(), 1);
  const to = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  return { fromDate: formatDateForApi(from), toDate: formatDateForApi(to) };
}

function getCalendarFetchWindow(year: number, month: number) {
  const from = new Date(year, month - MONTHS_BEHIND_TO_FETCH, 1);
  const to = new Date(year, month + MONTHS_AHEAD_TO_FETCH + 1, 0);

  const fromStr = formatDateForApi(from);
  const toStr = formatDateForApi(to);

  return {
    fromDate: fromStr,
    toDate: toStr,
  };
}

function getEventListNavigationKey(event: EventListItem) {
  return [
    event.category,
    String(event.id),
    String(event.event_id),
    event.date ?? '',
    event.name,
  ].join('|');
}

function getCalendarNavigationKey(event: CalendarEvent) {
  return getEventListNavigationKey(calendarEventToEventListItem(event));
}

function getCalendarEventTime(event: CalendarEvent) {
  const time = new Date(event.startDate).getTime();
  return Number.isNaN(time) ? Infinity : time;
}

function normalizeEventTypeName(value?: string | null) {
  return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function getEventTypeAliases(typeName: string) {
  const normalized = normalizeEventTypeName(typeName);
  const aliases = new Set([normalized]);

  if (normalized === 'launch') aliases.add('rocket launch');
  if (normalized === 'rocket launch') aliases.add('launch');
  if (normalized === 'eva') aliases.add('spacewalk');
  if (normalized === 'spacewalk') aliases.add('eva');

  return aliases;
}

function eventMatchesSelectedTypes(event: CalendarEvent, selectedTypeNames: string[]) {
  if (normalizeEventTypeName(event.type) === 'visible body') return true;
  if (selectedTypeNames.length === 0) return false;

  const eventType = normalizeEventTypeName(event.type);
  const selectedAliases = selectedTypeNames.flatMap((typeName) => [...getEventTypeAliases(typeName)]);

  return selectedAliases.some((selectedType) => eventType === selectedType);
}

function eventMatchesFilter(event: CalendarEvent, filter: string) {
  return filterEvents([event], filter).length > 0;
}

function getFilterLabel(filter: string) {
  if (filter === ALL_EVENT_FILTER) return '✦ All';
  return `${getEventEmoji({
    category: filter === 'Rocket Launch' ? 'launch' : 'event',
    type: filter,
    name: filter,
  })} ${filter}`;
}

const CalendarBackdrop = memo(function CalendarBackdrop() {
  return (
    <>
      <View style={styles.starField} pointerEvents="none">
        {STARS.map((star, i) => (
          <View
            key={i}
            style={{
              position: 'absolute',
              top: `${star.top}%` as any,
              left: `${star.left}%` as any,
              width: star.size,
              height: star.size,
              borderRadius: star.size,
              backgroundColor: Palette.textPrimary,
              opacity: star.opacity,
            }}
          />
        ))}
      </View>

      {SHOOTING_STAR_DELAYS.map((delay, i) => (
        <ShootingStar key={i} delay={delay} glow={false} />
      ))}
    </>
  );
});

export default function CalendarScreen() {
  const { width } = useWindowDimensions();
  const today = new Date();
  const [selectedDate, setSelectedDate] = useState(new Date(today.getFullYear(), today.getMonth(), today.getDate()));
  const [currentMonth, setCurrentMonth] = useState(today.getMonth());
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [loadedWindow, setLoadedWindow] = useState(() =>
    getCalendarFetchWindow(today.getFullYear(), today.getMonth())
  );
  const [browserCoords, setBrowserCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locationNotice, setLocationNotice] = useState('Requesting browser location for visible sky events.');
  const [selectedEvent, setSelectedEvent] = useState<EventListItem | null>(null);
  const [activeFilters, setActiveFilters] = useState<string[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedProfileEventTypes, setSelectedProfileEventTypes] = useState<string[]>([]);
  const [didLoadProfileEventTypes, setDidLoadProfileEventTypes] = useState(false);
  const [savedEventIds, setSavedEventIds] = useState<Set<string>>(() => new Set());
  const userId = getUser()?.user_id ?? null;
  const { events: sharedEvents, isLoading: sharedEventsLoading, error: sharedEventsError } = useSharedEvents();

  const calendarQuery = useMemo(() => {
    return {
      fromDate: loadedWindow.fromDate,
      toDate: loadedWindow.toDate,
      includeVisibleBodies: true,
      ...(browserCoords ?? {}),
    };
  }, [browserCoords, loadedWindow.fromDate, loadedWindow.toDate]);

  const {
    events: visibleBodyEvents,
    isLoading: visibleBodyEventsLoading,
    error: visibleBodyEventsError,
  } = useVisibleBodyEvents(calendarQuery);

  const events = useMemo(() => {
    const sharedCalendarEvents = sharedEvents
      .map((event, index) => eventListItemToCalendarEvent(event, index))
      .filter((event): event is CalendarEvent => event !== null);
    return [...sharedCalendarEvents, ...visibleBodyEvents];
  }, [sharedEvents, visibleBodyEvents]);

  const userFilteredEvents = useMemo(() => {
    if (!getToken() || !didLoadProfileEventTypes) return events;
    return events.filter((event) => eventMatchesSelectedTypes(event, selectedProfileEventTypes));
  }, [didLoadProfileEventTypes, events, selectedProfileEventTypes]);

  const isLoading = sharedEventsLoading || visibleBodyEventsLoading;
  const error = sharedEventsError ?? (events.length === 0 ? visibleBodyEventsError : null);

  const filterOptions = useMemo(() => {
    const extraTypes: string[] = [];
    const seen = new Set<string>(EVENT_FILTER_OPTIONS);

    for (const event of userFilteredEvents) {
      const type = event.type ?? 'Event';
      if (seen.has(type)) continue;
      seen.add(type);
      extraTypes.push(type);
    }

    return [...EVENT_FILTER_OPTIONS, ...extraTypes];
  }, [userFilteredEvents]);

  useEffect(() => {
    if (!getToken()) {
      setDidLoadProfileEventTypes(true);
      setSelectedProfileEventTypes([]);
      return;
    }

    let cancelled = false;

    Promise.all([
      eventTypesAPI.getEventTypes(),
      getUserEventTypes(),
    ])
      .then(([eventTypes, userEventTypes]) => {
        if (cancelled) return;
        const selectedIds = new Set(userEventTypes.eventTypeIds ?? []);
        setSelectedProfileEventTypes(
          eventTypes
            .filter((eventType) => selectedIds.has(eventType.event_type_id))
            .map((eventType) => eventType.event_type)
        );
      })
      .catch(() => {
        if (!cancelled) setSelectedProfileEventTypes([]);
      })
      .finally(() => {
        if (!cancelled) setDidLoadProfileEventTypes(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let isActive = true;

    if (userId == null) {
      setSavedEventIds(new Set());
      return () => {
        isActive = false;
      };
    }

    const controller = new AbortController();
    fetchSavedUserEvents(controller.signal)
      .then((savedEvents) => {
        if (!isActive || controller.signal.aborted) return;
        setSavedEventIds(new Set(savedEvents.map((event) => String(event.event_id))));
      })
      .catch(() => {});

    return () => {
      isActive = false;
      controller.abort();
    };
  }, [userId]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const location = await getOrRequestUserLocation();
        if (cancelled) return;
        if (!location) {
          setBrowserCoords(null);
          setLocationNotice('Enable location to see event viewing details for your area.');
          return;
        }

        setBrowserCoords(location);
        setLocationNotice(
          location.source === 'ip'
            ? 'Event viewing details use your approximate IP-based location.'
            : 'Event viewing details use your current browser location.'
        );
      } catch {
        if (cancelled) return;
        setBrowserCoords(null);
        setLocationNotice("Couldn't get your location. Event list still works, but viewing details may be limited.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const filteredEvents = useMemo(() => {
    if (activeFilters.length === 0) return userFilteredEvents;
    return userFilteredEvents.filter((event) =>
      activeFilters.some((filter) => eventMatchesFilter(event, filter))
    );
  }, [activeFilters, userFilteredEvents]);
  const hasActiveFilter = activeFilters.length > 0;
  const activeFilterSummary = activeFilters.map(getFilterLabel).join(', ');
  const filterToggleLabel = hasActiveFilter ? `Filters (${activeFilters.length})` : 'Filters';

  const selectedDayEvents = useMemo(
    () => getCalendarEventsForDate(filteredEvents, selectedDate),
    [filteredEvents, selectedDate]
  );
  const currentMonthEvents = useMemo(
    () => getCalendarEventsForMonth(filteredEvents, currentYear, currentMonth),
    [filteredEvents, currentYear, currentMonth]
  );
  const calendarNavigationEvents = useMemo(
    () =>
      [...filteredEvents].sort((left, right) => {
        const timeDiff = getCalendarEventTime(left) - getCalendarEventTime(right);
        if (timeDiff !== 0) return timeDiff;
        return left.title.localeCompare(right.title);
      }),
    [filteredEvents]
  );

  const isMobile = width < Breakpoints.tablet;
  const isVertical = width < 900;
  const monthName = useMemo(
    () => new Date(currentYear, currentMonth).toLocaleDateString('en-US', {
      month: 'long',
      year: 'numeric',
    }),
    [currentMonth, currentYear]
  );

  function setDisplayedMonth(year: number, month: number) {
    setCurrentYear(year);
    setCurrentMonth(month);
    setLoadedWindow(getCalendarFetchWindow(year, month));
  }

  function handleNavigateSelectedEvent(direction: 'next' | 'previous') {
    if (!selectedEvent || calendarNavigationEvents.length === 0) return false;

    const selectedKey = getEventListNavigationKey(selectedEvent);
    const currentIndex = calendarNavigationEvents.findIndex(
      (event) => getCalendarNavigationKey(event) === selectedKey
    );
    if (currentIndex < 0) return false;

    const nextIndex = direction === 'next' ? currentIndex + 1 : currentIndex - 1;
    const nextEvent = calendarNavigationEvents[nextIndex];
    if (!nextEvent) return false;

    const nextDate = new Date(nextEvent.startDate);
    if (!Number.isNaN(nextDate.getTime())) {
      const nextSelectedDate = new Date(nextDate.getFullYear(), nextDate.getMonth(), nextDate.getDate());
      setSelectedDate(nextSelectedDate);
      if (nextDate.getFullYear() !== currentYear || nextDate.getMonth() !== currentMonth) {
        setDisplayedMonth(nextDate.getFullYear(), nextDate.getMonth());
      }
    }

    setSelectedEvent(calendarEventToEventListItem(nextEvent));
    return true;
  }

  function handlePreviousMonth() {
    if (currentMonth === 0) {
      setDisplayedMonth(currentYear - 1, 11);
    } else {
      setDisplayedMonth(currentYear, currentMonth - 1);
    }
  }

  function handleNextMonth() {
    if (currentMonth === 11) {
      setDisplayedMonth(currentYear + 1, 0);
    } else {
      setDisplayedMonth(currentYear, currentMonth + 1);
    }
  }

  function handleSavedStateChange(eventId: number | string, saved: boolean) {
    setSavedEventIds((current) => {
      const next = new Set(current);
      if (saved) {
        next.add(String(eventId));
      } else {
        next.delete(String(eventId));
      }
      return next;
    });
  }

  function isSavedCalendarEvent(event: CalendarEvent) {
    return event.eventId != null && savedEventIds.has(String(event.eventId));
  }

  function handleFilterSelect(filter: string) {
    if (filter === ALL_EVENT_FILTER) {
      clearFilters();
      return;
    }

    setActiveFilters((current) =>
      current.includes(filter)
        ? current.filter((activeFilter) => activeFilter !== filter)
        : [...current, filter]
    );
  }

  function clearFilters() {
    setActiveFilters([]);
    setFiltersOpen(false);
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <CalendarBackdrop />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollViewContent, isMobile && styles.scrollViewContentMobile]}>
        <View style={[styles.pageHeader, isMobile && styles.pageHeaderMobile]}>
          <View style={styles.pageHeaderCopy}>
            <ThemedText type="smallBold" style={styles.pageEyebrow}>SKY SCHEDULE</ThemedText>
            <ThemedText type="title" style={[styles.pageTitle, isMobile && styles.pageTitleMobile]}>
              Calendar
            </ThemedText>
          </View>
          {!isLoading && !error && filterOptions.length > 0 ? (
            <Pressable
              onPress={() => setFiltersOpen((open) => !open)}
              accessibilityLabel={filtersOpen ? 'Hide calendar filters' : 'Show calendar filters'}
              style={({ pressed }) => [
                styles.filterToggle,
                (filtersOpen || hasActiveFilter) && styles.filterToggleActive,
                pressed && styles.pressed,
              ]}>
              <SymbolView
                name={{
                  ios: 'line.3.horizontal.decrease.circle',
                  android: 'filter_list',
                  web: 'filter_list',
                }}
                size={18}
                tintColor={filtersOpen || hasActiveFilter ? Palette.accent : Palette.textSecondary}
              />
              <ThemedText
                type="small"
                style={[styles.filterToggleText, (filtersOpen || hasActiveFilter) && styles.filterToggleTextActive]}>
                {filterToggleLabel}
              </ThemedText>
            </Pressable>
          ) : null}
        </View>

        {!isLoading && !error && filterOptions.length > 0 && filtersOpen ? (
          <View style={styles.filterPanel}>
            <ThemedText type="smallBold" style={styles.filterPanelTitle}>Filter by event type</ThemedText>
            <ScrollView
              style={styles.filterScroll}
              contentContainerStyle={styles.filterButtonsContainer}
              nestedScrollEnabled
              showsVerticalScrollIndicator={false}>
              {filterOptions.map((category) => {
                const active =
                  category === ALL_EVENT_FILTER ? activeFilters.length === 0 : activeFilters.includes(category);
                return (
                  <Pressable
                    key={category}
                    onPress={() => handleFilterSelect(category)}
                  style={({ pressed }) => [
                    styles.categoryPill, 
                    active && styles.categoryPillActive, 
                    pressed && styles.pressed
                  ]}>
                  <ThemedText type="small" style={[styles.categoryText, active && styles.categoryTextActive]}>
                    {category === ALL_EVENT_FILTER 
                      ? `✦ ${category}` 
                      : `${getEventEmoji({
                          category: category === 'Rocket Launch' ? 'launch' : 'event',
                          type: category,
                          name: category,
                        })} ${category}`}
                </ThemedText>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        ) : null}

        {!isLoading && !error && hasActiveFilter ? (
          <View style={styles.appliedFilterBar}>
            <ThemedText type="small" style={styles.appliedFilterText} numberOfLines={1}>
              Showing {activeFilterSummary}
            </ThemedText>
            <Pressable onPress={clearFilters} style={styles.clearFilterButton} accessibilityLabel="Clear calendar filters">
              <ThemedText type="small" style={styles.clearFilterText}>Clear</ThemedText>
            </Pressable>
          </View>
        ) : null}
        <ThemedText type="small" themeColor="textSecondary" style={styles.locationNotice}>
          {locationNotice}
        </ThemedText>

        <ThemedView style={[styles.calendarContainer, isMobile && styles.calendarContainerMobile]}>
          <View style={isVertical ? styles.layoutVertical : styles.layoutHorizontal}>
            <ThemedView style={[styles.calendarSection, isMobile && styles.calendarSectionMobile, !isVertical && { flex: 0.7 }]}>
              <View style={[styles.monthHeader, isMobile && styles.monthHeaderMobile]}>
                <Pressable
                  onPress={handlePreviousMonth}
                  accessibilityLabel="Previous month"
                  style={({ pressed }) => [styles.headerButton, isMobile && styles.headerIconButton, pressed && styles.pressed]}>
                  <SymbolView
                    name={{ ios: 'chevron.left', android: 'chevron_left', web: 'chevron_left' }}
                    size={isMobile ? 22 : 16}
                    tintColor={Palette.textPrimary}
                  />
                </Pressable>
                <View style={styles.monthHeaderContent} pointerEvents="none">
                  <ThemedText type="title" style={[styles.monthTitle, isMobile && styles.monthTitleMobile]}>
                    {monthName}
                  </ThemedText>
                </View>
                <Pressable
                  onPress={handleNextMonth}
                  accessibilityLabel="Next month"
                  style={({ pressed }) => [styles.headerButton, isMobile && styles.headerIconButton, pressed && styles.pressed]}>
                  <SymbolView
                    name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
                    size={isMobile ? 22 : 16}
                    tintColor={Palette.textPrimary}
                  />
                </Pressable>
              </View>

              <MonthGrid
                year={currentYear}
                month={currentMonth}
                events={currentMonthEvents}
                selectedDate={selectedDate}
                onSelectDate={setSelectedDate}
                compact={isMobile}
              />
            </ThemedView>

            <ThemedView style={[styles.selectedDayPanel, isMobile && styles.selectedDayPanelMobile, !isVertical && styles.selectedDayPanelDesktop, !isVertical && { flex: 0.3 }]}>
              <View style={[styles.selectedDayHeader, { zIndex: 99 }]}>
                <ThemedText type="smallBold" style={styles.selectedDateText}>
                  {selectedDate.toLocaleDateString('en-US', {
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </ThemedText>
              </View>

              {selectedDayEvents.length > 0 ? (
                <>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.eventCount}>
                    {selectedDayEvents.length} event{selectedDayEvents.length !== 1 ? 's' : ''} detected.
                  </ThemedText>

                  <ScrollView
                    style={[styles.eventListScroll, isMobile && styles.eventListScrollMobile]}
                    showsVerticalScrollIndicator
                    contentContainerStyle={styles.eventList}>
                    {selectedDayEvents.map((event) => (
                      <Pressable
                        key={event.id}
                        onPress={() => setSelectedEvent(calendarEventToEventListItem(event))}
                        style={({ pressed }) => [
                          styles.eventCard,
                          isMobile && styles.eventCardMobile,
                          isSavedCalendarEvent(event) && styles.eventCardSaved,
                          pressed && styles.pressed,
                        ]}>
                        <View style={[styles.eventCardIconBox, isMobile && styles.eventCardIconBoxMobile]}>
                          {event.imageUrl ? (
                            <Image source={{ uri: event.imageUrl }} style={styles.eventCardImage} resizeMode="cover" />
                          ) : (
                            <ThemedText style={styles.eventCardIcon}>{event.icon ?? getEventIconByType(event.type)}</ThemedText>
                          )}
                        </View>
                        <View style={styles.eventContent}>
                          <ThemedText type="smallBold" style={styles.eventTitle} numberOfLines={2}>
                            {event.title}
                          </ThemedText>
                          {event.time ? (
                            <ThemedText type="small" themeColor="textSecondary" style={styles.eventTime}>
                              {event.time}
                            </ThemedText>
                          ) : null}
                          <ThemedText type="small" style={styles.eventDetail} numberOfLines={isMobile ? 3 : 4}>
                            {event.detail}
                          </ThemedText>
                        </View>
                      </Pressable>
                    ))}
                  </ScrollView>
                </>
              ) : isLoading ? (
                <View style={styles.noEventsContainer}>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.noEventsText}>
                    Loading calendar events...
                  </ThemedText>
                </View>
              ) : error ? (
                <View style={styles.noEventsContainer}>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.noEventsText}>
                    Could not load calendar events.
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.errorText}>
                    {error}
                  </ThemedText>
                </View>
              ) : (
                <View style={styles.noEventsContainer}>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.noEventsText}>
                    No events detected for this day.
                  </ThemedText>
                </View>
              )}
            </ThemedView>
          </View>
        </ThemedView>
      </ScrollView>

      {selectedEvent ? (
        <EventModal
          event={selectedEvent}
          onClose={() => setSelectedEvent(null)}
          onNavigateEvent={handleNavigateSelectedEvent}
          onSavedStateChange={handleSavedStateChange}
          userId={userId}
          userLat={browserCoords?.latitude ?? null}
          userLon={browserCoords?.longitude ?? null}
        />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Palette.bgVoid,
  },
  starField: {
    position: 'absolute',
    width: '100%',
    height: '100%',
  },
  scrollView: {
    flex: 1,
  },
  scrollViewContent: {
    padding: Spacing.lg,
    gap: Spacing.sm,
    paddingTop: 36,
    width: '100%',
    maxWidth: 1840,
    alignSelf: 'center',
  },
  scrollViewContentMobile: {
    paddingHorizontal: 12,
    paddingTop: 16,
    paddingBottom: 96,
    gap: Spacing.sm,
  },
  pageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    paddingHorizontal: Spacing.sm,
  },
  pageHeaderMobile: {
    paddingHorizontal: 0,
  },
  pageHeaderCopy: {
    flex: 1,
    minWidth: dvw(0),
  },
  pageEyebrow: {
    color: Palette.accentMuted,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '900',
    letterSpacing: 1,
  },
  pageTitle: {
    color: Palette.textPrimary,
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '900',
  },
  pageTitleMobile: {
    fontSize: 26,
    lineHeight: 31,
  },
  filterToggle: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 13,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Palette.borderSoft,
    backgroundColor: Palette.surface,
  },
  filterToggleActive: {
    borderColor: Palette.accent,
    backgroundColor: Palette.accent + '12',
  },
  filterToggleText: {
    color: Palette.textSecondary,
    fontSize: 12,
    lineHeight: 15,
    fontWeight: '800',
  },
  filterToggleTextActive: {
    color: Palette.accent,
  },
  filterPanel: {
    padding: Spacing.md,
    maxHeight: 260,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Palette.borderSoft,
    backgroundColor: Palette.bgDeep,
    gap: Spacing.sm,
  },
  filterPanelTitle: {
    color: Palette.textTertiary,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  filterScroll: {
    flexGrow: 0,
  },
  filterButtonsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  appliedFilterBar: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Palette.accent + '40',
    backgroundColor: Palette.accent + '12',
  },
  appliedFilterText: {
    flex: 1,
    minWidth: dvw(0),
    color: Palette.textSecondary,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
  },
  clearFilterButton: {
    minHeight: 28,
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Palette.accent,
  },
  clearFilterText: {
    color: Palette.accent,
    fontSize: 11,
    lineHeight: 13,
    fontWeight: '900',
  },
  categoryPill: {
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Palette.borderSoft,
    backgroundColor: Palette.surface,
  },
  categoryPillActive: {
    backgroundColor: Palette.accent + '20',
    borderColor: Palette.accent,
  },
  categoryText: {
    fontSize: 12,
    fontWeight: '600',
    color: Palette.textSecondary,
  },
  categoryTextActive: {
    color: Palette.accent,
  },
  calendarContainer: {
    marginTop: Spacing.xs,
    paddingTop: Spacing.xs,
    backgroundColor: Palette.bgDeep,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Palette.borderSoft,
  },
  calendarContainerMobile: {
    padding: 10,
    borderRadius: Radius.md,
    marginTop: 0,
  },
  layoutHorizontal: {
    flexDirection: 'row',
    gap: Spacing.lg,
  },
  layoutVertical: {
    flexDirection: 'column',
    gap: Spacing.lg,
  },
  calendarSection: {
    backgroundColor: Palette.bgDeep,
    gap: Spacing.md,
    position: 'relative',
    zIndex: 1,
  },
  calendarSectionMobile: {
    gap: Spacing.sm,
  },
  monthHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: Palette.bgDeep,
    borderRadius: Radius.md,
    padding: Spacing.sm,
    gap: Spacing.sm,
  },
  monthHeaderMobile: {
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  monthHeaderContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  monthTitle: {
    fontWeight: '800',
    color: Palette.textPrimary,
    letterSpacing: 0,
    fontSize: 28,
    lineHeight: 34,
    textAlign: 'center',
  },
  monthTitleMobile: {
    fontSize: 19,
    lineHeight: 24,
  },
  selectedDayPanel: {
    backgroundColor: Palette.bgDeep,
    gap: Spacing.md,
    borderRadius: Radius.md,
    borderColor: Palette.borderSoft,
    borderWidth: 1,
    padding: Spacing.md,
    position: 'relative',
    zIndex: 3,
  },
  selectedDayPanelMobile: {
    padding: 12,
    gap: Spacing.sm,
  },
  selectedDayPanelDesktop: {
    maxHeight: dvh(CALENDAR_GRID_MAX_HEIGHT),
    alignSelf: 'flex-start',
    overflow: 'hidden',
  },
  selectedDayHeader: {
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: Spacing.xs,
    position: 'relative',
    paddingTop: Spacing.xs,
  },
  selectedDateText: {
    fontWeight: '800',
    color: Palette.textPrimary,
    letterSpacing: 0,
    zIndex: 1,
  },
  eventCount: {
    color: Palette.textSecondary,
    marginVertical: Spacing.sm,
  },
  eventListScroll: {
    flex: 1,
    minHeight: dvh(0),
  },
  eventListScrollMobile: {
    maxHeight: 420,
  },
  eventList: {
    gap: Spacing.sm,
  },
  eventCard: {
    backgroundColor: Palette.border,
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: 'transparent',
    flexDirection: 'row',
    gap: Spacing.md,
  },
  eventCardMobile: {
    padding: 10,
    gap: 10,
    borderRadius: Radius.sm,
  },
  eventCardSaved: {
    borderWidth: 2,
    borderColor: Palette.accentBlue,
  },
  eventCardIconBox: {
    width: 40,
    height: 40,
    backgroundColor: Palette.accentMuted,
    borderRadius: Radius.sm,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  eventCardIconBoxMobile: {
    width: 46,
    height: 46,
    borderRadius: Radius.sm,
  },
  eventCardImage: {
    width: '100%',
    height: '100%',
  },
  eventCardIcon: {
    textAlign: 'center',
    lineHeight: 40,
    fontSize: 20,
    color: Palette.textPrimary,
    fontWeight: 'bold',
  },
  eventContent: {
    flex: 1,
    gap: Spacing.xs,
  },
  eventTitle: {
    color: Palette.textPrimary,
  },
  eventTime: {
    color: Palette.accent,
  },
  eventDetail: {
    color: Palette.textSecondary,
  },
  noEventsContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.xxxl,
    gap: Spacing.md,
  },
  noEventsText: {
    color: Palette.textSecondary,
  },
  errorText: {
    color: Palette.textTertiary,
    fontStyle: 'italic',
    textAlign: 'center',
  },
  locationNotice: {
    paddingHorizontal: Spacing.sm,
    lineHeight: 18,
  },
  pressed: {
    opacity: 0.7,
  },
  headerButton: {
    width: 42,
    minHeight: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Palette.borderSoft,
    backgroundColor: Palette.surface,
    cursor: 'pointer',
  },
  headerIconButton: {
    width: 38,
    minHeight: 38,
    borderRadius: Radius.sm,
  },
});
