import React, { memo, useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { getEventIconByType } from '@/lib/event-icons';
import { Palette, Radius, Spacing, alpha } from '@/constants/tokens';
import { dvw, dvh } from '@/utilities/responsive-dimensions';

export type CalendarEvent = {
  id: string;
  date: number;
  type?: string;
  eventType?: string;
  icon?: string;
  imageUrl?: string | null;
};

type CalendarDay = {
  key: string;
  date: number;
  currentMonth: boolean;
};

type MonthGridProps = {
  year: number;
  month: number;
  events?: CalendarEvent[];
  selectedDate?: Date;
  onSelectDate?: (date: Date) => void;
  compact?: boolean;
  thumbnail?: boolean;
};

const weekdays = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

function getCalendarWeeks(year: number, month: number): CalendarDay[][] {
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const previousMonthDays = new Date(year, month, 0).getDate();
  const cells: CalendarDay[] = [];

  for (let offset = firstDay.getDay() - 1; offset >= 0; offset -= 1) {
    const date = previousMonthDays - offset;
    cells.push({ key: `prev-${date}`, date, currentMonth: false });
  }

  for (let date = 1; date <= daysInMonth; date += 1) {
    cells.push({ key: `current-${date}`, date, currentMonth: true });
  }

  const trailingDays = cells.length <= 35 ? 35 - cells.length : 42 - cells.length;
  for (let date = 1; date <= trailingDays; date += 1) {
    cells.push({ key: `next-${date}`, date, currentMonth: false });
  }

  const weeks: CalendarDay[][] = [];
  for (let index = 0; index < cells.length; index += 7) {
    weeks.push(cells.slice(index, index + 7));
  }

  return weeks;
}

function MonthGridComponent({
  year,
  month,
  events = [],
  selectedDate,
  onSelectDate,
  compact = false,
  thumbnail = false,
}: MonthGridProps) {
  const [brokenImages, setBrokenImages] = useState<Record<string, boolean>>({});
  const weeks = useMemo(() => getCalendarWeeks(year, month), [year, month]);
  const eventsByDate = useMemo(() => {
    const byDate = new Map<number, CalendarEvent[]>();

    for (const event of events) {
      const dateEvents = byDate.get(event.date);
      if (dateEvents) {
        dateEvents.push(event);
      } else {
        byDate.set(event.date, [event]);
      }
    }

    return byDate;
  }, [events]);

  return (
    <View style={[styles.calendarCard, compact && styles.calendarCardCompact, thumbnail && styles.calendarCardThumbnail]}>
      <View style={[styles.calendarRow, compact && styles.calendarRowCompact, thumbnail && styles.calendarRowThumbnail]}>
        {weekdays.map((day) => (
          <View
            key={day}
            style={[
              styles.dayCell,
              styles.dayCellHeader,
              compact && styles.dayCellCompact,
              compact && styles.dayCellHeaderCompact,
              thumbnail && styles.dayCellThumbnail,
              thumbnail && styles.dayCellHeaderThumbnail,
            ]}>
            <Text style={[styles.dayHeaderText, compact && styles.dayHeaderTextCompact, thumbnail && styles.dayHeaderTextThumbnail]}>
              {compact ? day.slice(0, 1) : day}
            </Text>
          </View>
        ))}
      </View>

      {weeks.map((week, weekIndex) => (
        <View key={`week-${weekIndex}`} style={[styles.calendarRow, compact && styles.calendarRowCompact, thumbnail && styles.calendarRowThumbnail]}>
          {week.map((day) => {
            const isSelected =
              day.currentMonth &&
              selectedDate?.getDate() === day.date &&
              selectedDate?.getMonth() === month &&
              selectedDate?.getFullYear() === year;
            const dayEvents = day.currentMonth ? eventsByDate.get(day.date) ?? [] : [];
            const dayContent = (
              <View
                style={[
                  styles.dayCell,
                  compact && styles.dayCellCompact,
                  thumbnail && styles.dayCellThumbnail,
                  isSelected && styles.dayCellSelected,
                  !day.currentMonth && styles.dayCellDisabled,
                ]}>
                <View style={[styles.dayNumberContainer, compact && styles.dayNumberContainerCompact, thumbnail && styles.dayNumberContainerThumbnail]}>
                  <Text
                    style={[
                      styles.dayCellText,
                      compact && styles.dayCellTextCompact,
                      thumbnail && styles.dayCellTextThumbnail,
                      isSelected && styles.dayCellSelectedText,
                      !day.currentMonth && styles.dayCellDisabledText,
                    ]}>
                    {day.date}
                  </Text>
                </View>
                {dayEvents.length > 0 && (
                  <View style={[styles.eventIconsContainer, compact && styles.eventIconsContainerCompact, thumbnail && styles.eventIconsContainerThumbnail]}>
                    {dayEvents.slice(0, compact ? 1 : 3).map((event) => {
                      const iconLabel = event.icon ?? getEventIconByType(event.type ?? event.eventType);
                      const showImage = Boolean(event.imageUrl) && !brokenImages[event.id];

                      return (
                        <View key={event.id} style={[styles.eventIconBox, compact && styles.eventIconBoxCompact, thumbnail && styles.eventIconBoxThumbnail]}>
                          {showImage ? (
                            <Image
                              source={{ uri: event.imageUrl! }}
                              style={[styles.eventImage, compact && styles.eventImageCompact, thumbnail && styles.eventImageThumbnail]}
                              resizeMode="cover"
                              onError={() => setBrokenImages((current) => ({ ...current, [event.id]: true }))}
                            />
                          ) : (
                            <Text style={[styles.eventIcon, compact && styles.eventIconCompact, thumbnail && styles.eventIconThumbnail]}>
                              {compact ? '●' : iconLabel}
                            </Text>
                          )}
                        </View>
                      );
                    })}
                  </View>
                )}
              </View>
            );

            if (!onSelectDate || !day.currentMonth) {
              return <View key={day.key} style={styles.dayPressable}>{dayContent}</View>;
            }

            return (
              <Pressable
                key={day.key}
                onPress={() => onSelectDate(new Date(year, month, day.date))}
                style={({ pressed }) => [styles.dayPressable, pressed && styles.pressed]}>
                {dayContent}
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

export const MonthGrid = memo(MonthGridComponent);

const styles = StyleSheet.create({
  calendarCard: {
    backgroundColor: Palette.bgDeep,
    gap: 0,
    width: '100%',
  },
  calendarCardCompact: {
    padding: 0,
  },
  calendarCardThumbnail: {
    height: '100%',
    justifyContent: 'space-between',
  },
  calendarRow: {
    flexDirection: 'row',
    marginBottom: 1,
    gap: 1,
    justifyContent: 'space-between',
    width: '100%',
  },
  calendarRowCompact: {
    minHeight: 44,
  },
  calendarRowThumbnail: {
    minHeight: 0,
    flex: 1,
  },
  dayPressable: {
    flex: 1,
    minWidth: dvw(0),
  },
  dayCell: {
    flex: 1,
    minHeight: dvh(92),
    minWidth: dvw(0),
    width: '100%',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    backgroundColor: alpha(Palette.surfaceRaised, 0.72),
    borderRadius: Radius.md,
    paddingHorizontal: 10,
    paddingVertical: 10,
    position: 'relative',
  },
  dayCellCompact: {
    minHeight: 44,
    minWidth: dvw(0),
    borderRadius: 6,
    paddingHorizontal: 4,
    paddingVertical: 4,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dayCellThumbnail: {
    minHeight: 0,
    height: '100%',
    borderRadius: 6,
    paddingHorizontal: 3,
    paddingVertical: 3,
  },
  dayCellHeader: {
    backgroundColor: 'transparent',
    minHeight: dvh(36),
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayCellHeaderCompact: {
    minHeight: 28,
  },
  dayCellHeaderThumbnail: {
    minHeight: 0,
    height: 18,
    flex: 0,
  },
  dayCellSelected: {
    backgroundColor: alpha(Palette.accent, 0.18),
    borderWidth: 1,
    borderColor: alpha(Palette.accent, 0.5),
  },
  dayCellDisabled: {
    backgroundColor: alpha(Palette.bgDeep, 0.35),
    opacity: 1,
  },
  dayNumberContainer: {
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
    minHeight: dvh(26),
    width: '100%',
  },
  dayNumberContainerCompact: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 18,
  },
  dayNumberContainerThumbnail: {
    minHeight: 12,
  },
  dayCellText: {
    color: Palette.textSecondary,
  },
  dayCellTextCompact: {
    fontSize: 12,
    lineHeight: 14,
    textAlign: 'center',
    width: '100%',
  },
  dayCellTextThumbnail: {
    fontSize: 10,
    lineHeight: 12,
  },
  dayHeaderText: {
    color: Palette.accentMuted,
    fontWeight: '600',
  },
  dayHeaderTextCompact: {
    fontSize: 10,
    lineHeight: 12,
  },
  dayHeaderTextThumbnail: {
    fontSize: 9,
    lineHeight: 11,
  },
  dayCellSelectedText: {
    color: Palette.textPrimary,
    fontWeight: '600',
  },
  dayCellDisabledText: {
    color: Palette.textMuted,
  },
  eventIconsContainer: {
    position: 'absolute',
    bottom: Spacing.xs,
    left: 0,
    right: 0,
    justifyContent: 'center',
    flexDirection: 'row',
    gap: Spacing.xxs,
  },
  eventIconsContainerCompact: {
    bottom: 5,
  },
  eventIconsContainerThumbnail: {
    bottom: 4,
  },
  eventIconBox: {
    width: 20,
    height: 20,
    backgroundColor: Palette.accentBlue,
    borderRadius: 3,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  eventIconBoxCompact: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  eventIconBoxThumbnail: {
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  eventImage: {
    width: '100%',
    height: '100%',
  },
  eventImageCompact: {
    borderRadius: 2,
  },
  eventImageThumbnail: {
    borderRadius: 2,
  },
  eventIcon: {
    color: Palette.textPrimary,
    fontSize: 11,
    fontWeight: 'bold',
  },
  eventIconCompact: {
    fontSize: 6,
    lineHeight: 6,
  },
  eventIconThumbnail: {
    fontSize: 5,
    lineHeight: 5,
  },
  pressed: {
    opacity: 0.7,
  },
});
