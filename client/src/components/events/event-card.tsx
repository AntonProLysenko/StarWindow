// EventCard — one row in the events list. Kept as its own module so phase 2
// (the event detail page) can reuse the card and the date/description helpers.
//
// Rocket launches are styled distinctly from generic space events: a red left
// accent border, a "🚀 LAUNCH" badge, and a rocket placeholder when they have
// no image — so they stand out in the mixed chronological list.

import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { fallbackIconSource } from '@/components/events/event-fallback-icon';
import { Palette, Radius } from '@/constants/tokens';
import type { EventListItem } from '@/lib/events-api';
import { dvw, dvh } from '@/utilities/responsive-dimensions';

const DESCRIPTION_MAX = 140;

/** Accent used for launch cards (matches the dashboard's "Launches" theming). */
const LAUNCH_ACCENT = Palette.accentRed;
/** Accent used for regular space events. */
const EVENT_ACCENT = Palette.accent;

/**
 * Format an event date honoring its precision, so approximate dates aren't shown
 * as fake exact times:
 *   "Year"        -> "2026"
 *   "Month"       -> "July 2026"
 *   "Day"         -> "Aug 12, 2026"
 *   Hour/Minute/… -> "Aug 12, 2026, 3:35 PM"
 */
export function formatEventDate(date: string | null, precision: string | null): string {
  if (!date) return 'Date TBD';
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return 'Date TBD';

  switch (precision) {
    case 'Year':
      return d.toLocaleDateString(undefined, { year: 'numeric' });
    case 'Month':
      return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    case 'Day':
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    default:
      return d.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
  }
}

/** Truncate to a max length on a word boundary, adding an ellipsis. */
export function truncate(text: string | null, max: number = DESCRIPTION_MAX): string {
  if (!text) return '';
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  const slice = trimmed.slice(0, max);
  const lastSpace = slice.lastIndexOf(' ');
  return `${slice.slice(0, lastSpace > 40 ? lastSpace : max).trimEnd()}…`;
}

export function EventCard({
  event,
  onPress,
}: {
  event: EventListItem;
  onPress: (event: EventListItem) => void;
}) {
  const isLaunch = event.category === 'launch';
  const accent = isLaunch ? LAUNCH_ACCENT : EVENT_ACCENT;
  const description = truncate(event.description);
  const savedNote = getSavedEventNote(event);
  const fallbackIcon = fallbackIconSource(event);

  return (
    <Pressable
      onPress={() => onPress(event)}
      style={({ pressed }) => [
        styles.card,
        isLaunch && { borderLeftColor: LAUNCH_ACCENT, borderLeftWidth: 3 },
        pressed && styles.cardPressed,
      ]}>
      <View style={styles.thumb}>
        {event.image_url ? (
          <Image source={{ uri: event.image_url }} style={styles.thumbImage} resizeMode="cover" />
        ) : fallbackIcon ? (
          <View style={styles.thumbFallback}>
            <Image source={fallbackIcon} style={styles.thumbFallbackImage} resizeMode="contain" />
          </View>
        ) : (
          <View style={styles.thumbFallback}>
            <Text style={styles.thumbFallbackIcon}>{isLaunch ? '🚀' : '✨'}</Text>
          </View>
        )}
      </View>

      <View style={styles.body}>
        <View style={styles.badgeRow}>
          <View style={[styles.badge, { backgroundColor: accent + '20' }]}>
            <Text style={[styles.badgeText, { color: accent }]}>
              {isLaunch ? '🚀 LAUNCH' : event.type.toUpperCase()}
            </Text>
          </View>
        </View>

        <Text style={styles.name} numberOfLines={2}>
          {event.name}
        </Text>

        <Text style={styles.date}>{formatEventDate(event.date, event.date_precision)}</Text>

        {event.location ? (
          <Text style={styles.location} numberOfLines={1}>
            📍 {event.location}
          </Text>
        ) : null}

        {description ? (
          <Text style={styles.description} numberOfLines={3}>
            {description}
          </Text>
        ) : null}

        {savedNote ? (
          <View style={styles.notePreview}>
            <Text style={styles.noteLabel}>NOTE</Text>
            <Text style={styles.noteText} numberOfLines={2}>
              {savedNote}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

function getSavedEventNote(event: EventListItem) {
  if (!('event_comment' in event)) return '';
  const note = event.event_comment;
  return typeof note === 'string' ? note.trim() : '';
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    backgroundColor: Palette.surface,
    borderWidth: 1,
    borderColor: Palette.borderSoft,
    borderRadius: Radius.md,
    overflow: 'hidden',
  },
  cardPressed: {
    opacity: 0.75,
  },
  thumb: {
    width: dvw(120),
    backgroundColor: Palette.bgDeep,
  },
  thumbImage: {
    width: '100%',
    height: '100%',
  },
  thumbFallback: {
    flex: 1,
    minHeight: dvh(120),
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbFallbackIcon: {
    fontSize: 30,
    opacity: 0.7,
  },
  thumbFallbackImage: {
    width: 56,
    height: 56,
  },
  body: {
    flex: 1,
    padding: 14,
    gap: 4,
  },
  badgeRow: {
    flexDirection: 'row',
  },
  badge: {
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: Radius.pill,
  },
  badgeText: {
    fontSize: 9.5,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  name: {
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '600',
    color: Palette.textPrimary,
    marginTop: 2,
  },
  date: {
    fontSize: 12,
    fontWeight: '600',
    color: Palette.accent,
  },
  location: {
    fontSize: 12,
    color: Palette.textSecondary,
  },
  description: {
    fontSize: 12,
    lineHeight: 17,
    color: Palette.textSecondary,
    marginTop: 2,
  },
  notePreview: {
    marginTop: 6,
    borderTopWidth: 1,
    borderTopColor: Palette.borderSoft,
    paddingTop: 7,
    gap: 3,
  },
  noteLabel: {
    color: Palette.accentMuted,
    fontSize: 9,
    fontWeight: '900',
  },
  noteText: {
    color: Palette.textPrimary,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
  },
});
