// Live countdown to an event, updating every second. Shows "Past event" once the
// target time has passed. A standalone sub-component so it can be reused (e.g. on
// a future detail page) and so its per-second re-render doesn't re-render the
// whole modal.

import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Palette } from '@/constants/tokens';

function formatRemaining(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days} day${days === 1 ? '' : 's'}`);
  if (hours > 0 || days > 0) parts.push(`${hours} hour${hours === 1 ? '' : 's'}`);
  // Show minutes always; show seconds only when under an hour out (keeps far-off
  // countdowns calm while making the final hour feel live).
  parts.push(`${minutes} min`);
  if (days === 0 && hours === 0) parts.push(`${seconds} sec`);

  return `in ${parts.join(', ')}`;
}

export function EventCountdown({ date }: { date: string | null }) {
  const target = date ? new Date(date).getTime() : NaN;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (Number.isNaN(target)) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [target]);

  if (Number.isNaN(target)) return null;

  const remaining = target - now;
  const isPast = remaining <= 0;

  return (
    <View style={[styles.pill, isPast && styles.pillPast]}>
      {!isPast && <View style={styles.dot} />}
      <Text style={[styles.text, isPast && styles.textPast]}>
        {isPast ? 'Past event' : formatRemaining(remaining)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 8,
    backgroundColor: Palette.accent + '14',
    borderWidth: 1,
    borderColor: Palette.accent + '40',
    borderRadius: 100,
    paddingVertical: 7,
    paddingHorizontal: 14,
  },
  pillPast: {
    backgroundColor: Palette.surfaceRaised,
    borderColor: Palette.borderSoft,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: Palette.accentGreen,
  },
  text: {
    fontSize: 13,
    fontWeight: '700',
    color: Palette.accent,
  },
  textPast: {
    color: Palette.textTertiary,
  },
});
