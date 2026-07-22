import React, { memo, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MonthGrid } from '@/components/calendar/month-grid';
import { ShootingStar } from '@/components/shooting-star';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Palette, Radius, Spacing } from '@/constants/tokens';
import { useCalendarEvents } from '@/hooks/use-calendar-events';
import { getEventIconByType } from '@/lib/event-icons';
import { getCalendarEventsForDate, getCalendarEventsForMonth } from '@/utilities/events-api';
import { getOrRequestUserLocation } from '@/utilities/user-location-service';
import { dvw, dvh } from '@/utilities/responsive-dimensions';

const categories = ['Meteor Showers', 'Rocket Launches', 'Alignments', 'More Filters'];
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

function formatDateForApi(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getMonthIndex(year: number, month: number) {
  return year * 12 + month;
}

function getCalendarFetchWindow(year: number, month: number) {
  const from = new Date(year, month - MONTHS_BEHIND_TO_FETCH, 1);
  const to = new Date(year, month + MONTHS_AHEAD_TO_FETCH + 1, 0);

  return getCalendarFetchWindowFromIndexes(
    getMonthIndex(from.getFullYear(), from.getMonth()),
    getMonthIndex(to.getFullYear(), to.getMonth())
  );
}

function getCalendarFetchWindowFromIndexes(startMonthIndex: number, endMonthIndex: number) {
  const from = new Date(Math.floor(startMonthIndex / 12), startMonthIndex % 12, 1);
  const to = new Date(Math.floor(endMonthIndex / 12), (endMonthIndex % 12) + 1, 0);

  return {
    fromDate: formatDateForApi(from),
    toDate: formatDateForApi(to),
    startMonthIndex,
    endMonthIndex,
  };
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

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const location = await getOrRequestUserLocation();
        if (cancelled) return;
        if (!location) {
          setBrowserCoords(null);
          setLocationNotice('Location is required for visible sky events. Enable location in browser site settings and reload.');
          return;
        }

        setBrowserCoords(location);
        setLocationNotice(
          location.source === 'ip'
            ? 'Visible sky events use your approximate IP-based location.'
            : 'Visible sky events use your current browser location.'
        );
      } catch {
        if (cancelled) return;
        setBrowserCoords(null);
        setLocationNotice("Couldn't get your location. Check browser and system location settings, then reload.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const calendarQuery = useMemo(() => {
    return {
      fromDate: loadedWindow.fromDate,
      toDate: loadedWindow.toDate,
      includeVisibleBodies: true,
      ...(browserCoords ?? {}),
    };
  }, [browserCoords, loadedWindow.fromDate, loadedWindow.toDate]);
  const { events, isLoading, error } = useCalendarEvents(calendarQuery);

  const selectedDayEvents = useMemo(
    () => getCalendarEventsForDate(events, selectedDate),
    [events, selectedDate]
  );
  const currentMonthEvents = useMemo(
    () => getCalendarEventsForMonth(events, currentYear, currentMonth),
    [events, currentYear, currentMonth]
  );

  const isVertical = width < 900;
  const monthName = useMemo(
    () => new Date(currentYear, currentMonth).toLocaleDateString('en-US', {
      month: 'long',
      year: 'numeric',
    }),
    [currentMonth, currentYear]
  );

  function setDisplayedMonth(year: number, month: number) {
    const monthIndex = getMonthIndex(year, month);

    setCurrentYear(year);
    setCurrentMonth(month);
    setLoadedWindow((currentWindow) => {
      if (monthIndex <= currentWindow.startMonthIndex) {
        return getCalendarFetchWindowFromIndexes(currentWindow.startMonthIndex - 1, currentWindow.endMonthIndex);
      }

      if (monthIndex >= currentWindow.endMonthIndex) {
        return getCalendarFetchWindowFromIndexes(currentWindow.startMonthIndex, currentWindow.endMonthIndex + 1);
      }

      return currentWindow;
    });
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

  return (
    <SafeAreaView style={styles.safeArea}>
      <CalendarBackdrop />

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollViewContent}>
        <View style={styles.filterButtonsContainer}>
          {categories.map((category) => (
            <ThemedView key={category} style={styles.categoryPill}>
              <ThemedText type="small" style={styles.categoryText}>
                {category}
              </ThemedText>
            </ThemedView>
          ))}
        </View>
        <ThemedText type="small" themeColor="textSecondary" style={styles.locationNotice}>
          {locationNotice}
        </ThemedText>

        <ThemedView style={styles.calendarContainer}>
          <View style={isVertical ? styles.layoutVertical : styles.layoutHorizontal}>
            <ThemedView style={[styles.calendarSection, !isVertical && { flex: 0.7 }]}>
              <View style={styles.monthHeader}>
                <Pressable
                  onPress={handlePreviousMonth}
                  style={({ pressed }) => [pressed && styles.pressed, styles.headerButton]}>
                  <ThemedText type="small">&lt; Prev</ThemedText>
                </Pressable>
                <View style={styles.monthHeaderContent} pointerEvents="none">
                  <ThemedText type="title" style={styles.monthTitle}>
                    {monthName}
                  </ThemedText>
                </View>
                <Pressable
                  onPress={handleNextMonth}
                  style={({ pressed }) => [pressed && styles.pressed, styles.headerButton]}>
                  <ThemedText type="small">Next &gt;</ThemedText>
                </Pressable>
              </View>

              <MonthGrid
                year={currentYear}
                month={currentMonth}
                events={currentMonthEvents}
                selectedDate={selectedDate}
                onSelectDate={setSelectedDate}
              />
            </ThemedView>

            <ThemedView style={[styles.selectedDayPanel, !isVertical && styles.selectedDayPanelDesktop, !isVertical && { flex: 0.3 }]}>
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
                    style={styles.eventListScroll}
                    showsVerticalScrollIndicator
                    contentContainerStyle={styles.eventList}>
                    {selectedDayEvents.map((event) => (
                      <ThemedView key={event.id} style={styles.eventCard}>
                        <View style={styles.eventCardIconBox}>
                          <ThemedText style={styles.eventCardIcon}>{event.icon ?? getEventIconByType(event.type)}</ThemedText>
                        </View>
                        <View style={styles.eventContent}>
                          <ThemedText type="smallBold" style={styles.eventTitle}>
                            {event.title}
                          </ThemedText>
                          {event.time ? (
                            <ThemedText type="small" themeColor="textSecondary" style={styles.eventTime}>
                              {event.time}
                            </ThemedText>
                          ) : null}
                          <ThemedText type="small" style={styles.eventDetail}>
                            {event.detail}
                          </ThemedText>
                        </View>
                      </ThemedView>
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
    padding: Spacing.md,
    gap: Spacing.xs,
    paddingTop: 60,
  },
  filterButtonsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    marginTop: Spacing.md,
  },
  categoryPill: {
    backgroundColor: Palette.bgDeep,
    borderWidth: 1,
    borderColor: Palette.borderSoft,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
  },
  categoryText: {
    color: Palette.accent,
    fontWeight: '700',
    letterSpacing: 0.4,
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
  monthHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.xs,
    paddingBottom: Spacing.xs,
    borderBottomWidth: 2,
    borderBottomColor: Palette.borderSoft,
    backgroundColor: Palette.bgDeep,
    borderRadius: Radius.md,
    padding: Spacing.sm,
  },
  monthHeaderContent: {
    flex: 1,
    justifyContent: 'center',
    position: 'absolute',
    left: Spacing.sm,
    right: Spacing.sm,
    alignItems: 'center',
  },
  monthTitle: {
    fontWeight: '400',
    color: Palette.textPrimary,
    letterSpacing: 1,
    marginBottom: Spacing.sm,
    fontSize: 30,
    paddingBottom: Spacing.xs,
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
    fontWeight: '400',
    color: Palette.textPrimary,
    letterSpacing: 2,
    marginTop: Spacing.md,
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
  eventList: {
    gap: Spacing.sm,
  },
  eventCard: {
    backgroundColor: Palette.border,
    padding: Spacing.md,
    borderRadius: Radius.md,
    flexDirection: 'row',
    gap: Spacing.md,
  },
  eventCardIconBox: {
    width: 40,
    height: 40,
    backgroundColor: Palette.accentMuted,
    borderRadius: Radius.sm,
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
    cursor: 'pointer',
  },
});
