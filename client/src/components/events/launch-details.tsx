// Launch-specific detail section for the event modal (rocket, provider, mission,
// pad, status).
// Standalone so a future detail page can reuse it.

import { StyleSheet, Text, View } from 'react-native';

import { Palette, Radius, alpha } from '@/constants/tokens';
import type { LaunchDetails } from '@/lib/events-api';

const LAUNCH_ACCENT = '#FFB000';

function Row({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

export function LaunchDetailsSection({ details }: { details: LaunchDetails }) {
  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <Text style={styles.headerIcon}>🚀</Text>
        <Text style={styles.headerText}>LAUNCH DETAILS</Text>
      </View>
      <View style={styles.rows}>
        <Row label="Rocket" value={details.rocket_model} />
        <Row label="Provider" value={details.provider} />
        <Row label="Mission" value={details.mission_name} />
        <Row label="Mission type" value={details.mission_type} />
        <Row label="Launch pad" value={details.pad_name} />
        <Row label="Pad location" value={details.pad_location} />
        <Row label="Status" value={details.status} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    backgroundColor: alpha(LAUNCH_ACCENT, 0.08),
    borderWidth: 1,
    borderColor: alpha(LAUNCH_ACCENT, 0.34),
    borderLeftWidth: 3,
    borderLeftColor: LAUNCH_ACCENT,
    borderRadius: Radius.md,
    padding: 16,
    gap: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerIcon: {
    fontSize: 13,
  },
  headerText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    color: LAUNCH_ACCENT,
  },
  rows: {
    gap: 8,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 16,
  },
  rowLabel: {
    fontSize: 12,
    color: Palette.textTertiary,
    fontWeight: '600',
  },
  rowValue: {
    flex: 1,
    fontSize: 13,
    color: Palette.textPrimary,
    textAlign: 'right',
  },
});
