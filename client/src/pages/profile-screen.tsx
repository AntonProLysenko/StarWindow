import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { EventCard } from '@/components/events/event-card';
import { EventModal } from '@/components/events/event-modal';
import { Palette, Radius } from '@/constants/tokens';
import { fetchSavedUserEvents, type SavedUserEvent } from '@/lib/events-api';
import * as eventTypesAPI from '@/utilities/event-types-api';
import type { EventType } from '@/utilities/event-types-api';
import { getUserLevelProgressLabel, getUserLevelProgressPercent } from '@/utilities/level-progress';
import { getOrRequestUserLocation } from '@/utilities/user-location-service';
import * as usersService from '@/utilities/users-service';
import { dvw, dvh } from '@/utilities/responsive-dimensions';

const STARS = Array.from({ length: 110 }, (_, i) => ({
  top: (i * 29.3) % 100,
  left: (i * 37.1) % 100,
  size: (i % 4) + 0.5,
  opacity: (i % 6) * 0.07 + 0.12,
}));

const PROFILE_TABS = [
  { id: 'saved-events', label: 'My Saved Events' },
  { id: 'edit-profile', label: 'Edit Profile' },
] as const;

type ProfileTab = (typeof PROFILE_TABS)[number]['id'];

function getDisplayName(user: usersService.AuthUser | null) {
  return [user?.f_name, user?.l_name].filter(Boolean).join(' ').trim() || user?.email || 'Profile';
}

function getInitials(user: usersService.AuthUser | null) {
  const first = user?.f_name?.trim()?.[0] ?? '';
  const last = user?.l_name?.trim()?.[0] ?? '';
  return `${first}${last}`.toUpperCase() || 'SW';
}

function getProfileLevel(user: usersService.AuthUser | null) {
  if (user?.status_id != null && user?.status) return `Lvl ${user.status_id} ${user.status}`;
  if (user?.status_id != null) return `Lvl ${user.status_id}`;
  return user?.status ?? 'Status unavailable';
}

function sameIds(a: number[], b: number[]) {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort((left, right) => left - right);
  const sortedB = [...b].sort((left, right) => left - right);
  return sortedA.every((id, index) => id === sortedB[index]);
}

export default function ProfileScreen() {
  const router = useRouter();
  const [user, setUser] = useState<usersService.AuthUser | null>(() => usersService.getUser());
  const [activeTab, setActiveTab] = useState<ProfileTab>('saved-events');

  useEffect(() => {
    if (!usersService.getToken()) router.replace('/');
  }, [router]);

  useEffect(() => {
    if (!usersService.getToken()) return;
    let cancelled = false;
    usersService
      .getCurrentUser()
      .then((currentUser) => {
        if (!cancelled) setUser(currentUser);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const progressLabel = getUserLevelProgressLabel(user);
  const progressPercent = getUserLevelProgressPercent(user);

  return (
    <SafeAreaView style={styles.app}>
      <View style={styles.starField}>
        {STARS.map((star, index) => (
          <View
            key={index}
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

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{getInitials(user)}</Text>
          </View>
          <View style={styles.headerText}>
            <Text style={styles.eyebrow}>PROFILE</Text>
            <Text style={styles.title}>{getDisplayName(user)}</Text>
            <Text style={styles.subtitle}>{getProfileLevel(user)}</Text>
            {progressLabel ? (
              <View style={styles.levelProgress}>
                <View style={styles.levelTrack}>
                  <View style={[styles.levelFill, { width: `${progressPercent}%` as any }]} />
                </View>
                <Text style={styles.levelMeta}>{progressLabel}</Text>
              </View>
            ) : null}
          </View>
        </View>

        <View style={styles.tabBar}>
          {PROFILE_TABS.map((tab) => {
            const selected = activeTab === tab.id;
            return (
              <Pressable
                key={tab.id}
                onPress={() => setActiveTab(tab.id)}
                style={[styles.tabButton, selected && styles.tabButtonSelected]}>
                <Text style={[styles.tabButtonText, selected && styles.tabButtonTextSelected]}>
                  {tab.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {activeTab === 'edit-profile' ? (
          <EditProfile user={user} onUserChange={setUser} />
        ) : (
          <MySavedEvents user={user} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function EditProfile({
  user,
  onUserChange,
}: {
  user: usersService.AuthUser | null;
  onUserChange: (user: usersService.AuthUser | null) => void;
}) {
  const router = useRouter();
  const [firstName, setFirstName] = useState(user?.f_name ?? '');
  const [lastName, setLastName] = useState(user?.l_name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [eventTypes, setEventTypes] = useState<EventType[]>([]);
  const [selectedEventTypeIds, setSelectedEventTypeIds] = useState<number[]>([]);
  const [savedEventTypeIds, setSavedEventTypeIds] = useState<number[]>([]);
  const [isSavingPreferences, setIsSavingPreferences] = useState(false);
  const [preferencesMessage, setPreferencesMessage] = useState('');
  const [preferencesError, setPreferencesError] = useState('');

  useEffect(() => {
    let cancelled = false;

    if (!usersService.getToken()) {
      router.replace('/');
      return;
    }

    Promise.all([
      usersService.getCurrentUser(),
      eventTypesAPI.getEventTypes(),
      usersService.getUserEventTypes(),
    ])
      .then(([currentUser, availableEventTypes, userEventTypes]) => {
        if (cancelled) return;
        onUserChange(currentUser);
        setFirstName(currentUser.f_name ?? '');
        setLastName(currentUser.l_name ?? '');
        setEmail(currentUser.email ?? '');
        setEventTypes(availableEventTypes);
        setSelectedEventTypeIds(userEventTypes.eventTypeIds ?? []);
        setSavedEventTypeIds(userEventTypes.eventTypeIds ?? []);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Could not load profile.');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [onUserChange, router]);

  const hasChanges =
    firstName.trim() !== (user?.f_name ?? '') ||
    lastName.trim() !== (user?.l_name ?? '') ||
    email.trim().toLowerCase() !== (user?.email ?? '').toLowerCase();
  const hasPreferenceChanges = !sameIds(selectedEventTypeIds, savedEventTypeIds);

  const handleSave = async () => {
    if (!firstName.trim() || !lastName.trim() || !email.trim()) {
      setError('First name, last name, and email are required.');
      setMessage('');
      return;
    }

    setIsSaving(true);
    setError('');
    setMessage('');

    try {
      const updatedUser = await usersService.updateCurrentUser({
        f_name: firstName.trim(),
        l_name: lastName.trim(),
        email: email.trim(),
      });
      onUserChange(updatedUser);
      setMessage('Profile updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update profile.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    setFirstName(user?.f_name ?? '');
    setLastName(user?.l_name ?? '');
    setEmail(user?.email ?? '');
    setError('');
    setMessage('');
  };

  const toggleEventType = (eventTypeId: number) => {
    setPreferencesError('');
    setPreferencesMessage('');
    setSelectedEventTypeIds((current) =>
      current.includes(eventTypeId)
        ? current.filter((id) => id !== eventTypeId)
        : [...current, eventTypeId]
    );
  };

  const handleSavePreferences = async () => {
    if (selectedEventTypeIds.length === 0) {
      setPreferencesError('Select at least one event type.');
      setPreferencesMessage('');
      return;
    }

    setIsSavingPreferences(true);
    setPreferencesError('');
    setPreferencesMessage('');

    try {
      const result = await usersService.saveEventTypes(selectedEventTypeIds);
      setSelectedEventTypeIds(result.eventTypeIds);
      setSavedEventTypeIds(result.eventTypeIds);
      setPreferencesMessage('Preferences updated.');
    } catch (err) {
      setPreferencesError(err instanceof Error ? err.message : 'Could not update preferences.');
    } finally {
      setIsSavingPreferences(false);
    }
  };

  return (
    <View style={styles.grid}>
      <View style={styles.panel}>
        <Text style={styles.panelEyebrow}>ACCOUNT DETAILS</Text>
        {isLoading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={Palette.accent} />
            <Text style={styles.loadingText}>Loading profile...</Text>
          </View>
        ) : (
          <>
            <ProfileField label="First Name" value={firstName} onChangeText={setFirstName} autoCapitalize="words" />
            <ProfileField label="Last Name" value={lastName} onChangeText={setLastName} autoCapitalize="words" />
            <ProfileField
              label="Email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
            />

            {!!error && <Text style={styles.errorText}>{error}</Text>}
            {!!message && <Text style={styles.successText}>{message}</Text>}

            <View style={styles.actionRow}>
              <Pressable
                onPress={handleSave}
                disabled={isSaving || !hasChanges}
                style={[styles.primaryButton, (isSaving || !hasChanges) && styles.disabledButton]}>
                <Text style={styles.primaryButtonText}>{isSaving ? 'SAVING...' : 'SAVE CHANGES'}</Text>
              </Pressable>
              <Pressable onPress={handleReset} disabled={isSaving || !hasChanges} style={styles.secondaryButton}>
                <Text style={styles.secondaryButtonText}>RESET</Text>
              </Pressable>
            </View>
          </>
        )}
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelEyebrow}>READ ONLY</Text>
        <InfoRow label="User ID" value={user?.user_id != null ? String(user.user_id) : '--'} />
        <InfoRow label="Status" value={user?.status ?? 'Unavailable'} />
        <InfoRow label="Status ID" value={user?.status_id != null ? String(user.status_id) : '--'} />
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelEyebrow}>EVENT PREFERENCES</Text>
        <Text style={styles.panelCopy}>Choose which sky events should shape your calendar and feed.</Text>
        {isLoading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={Palette.accent} />
            <Text style={styles.loadingText}>Loading preferences...</Text>
          </View>
        ) : (
          <>
            <View style={styles.preferenceGrid}>
              {eventTypes.map((eventType) => {
                const selected = selectedEventTypeIds.includes(eventType.event_type_id);
                return (
                  <Pressable
                    key={eventType.event_type_id}
                    onPress={() => toggleEventType(eventType.event_type_id)}
                    style={[styles.preferencePill, selected && styles.preferencePillSelected]}>
                    <Text style={[styles.preferenceText, selected && styles.preferenceTextSelected]}>
                      {eventType.event_type}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {!!preferencesError && <Text style={styles.errorText}>{preferencesError}</Text>}
            {!!preferencesMessage && <Text style={styles.successText}>{preferencesMessage}</Text>}

            <View style={styles.actionRow}>
              <Pressable
                onPress={handleSavePreferences}
                disabled={isSavingPreferences || !hasPreferenceChanges}
                style={[styles.primaryButton, (isSavingPreferences || !hasPreferenceChanges) && styles.disabledButton]}>
                <Text style={styles.primaryButtonText}>
                  {isSavingPreferences ? 'SAVING...' : 'SAVE PREFERENCES'}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setSelectedEventTypeIds(savedEventTypeIds);
                  setPreferencesError('');
                  setPreferencesMessage('');
                }}
                disabled={isSavingPreferences || !hasPreferenceChanges}
                style={styles.secondaryButton}>
                <Text style={styles.secondaryButtonText}>RESET</Text>
              </Pressable>
            </View>
          </>
        )}
      </View>
    </View>
  );
}

function MySavedEvents({ user }: { user: usersService.AuthUser | null }) {
  const [events, setEvents] = useState<SavedUserEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedEvent, setSelectedEvent] = useState<SavedUserEvent | null>(null);
  const [userLat, setUserLat] = useState<number | null>(null);
  const [userLon, setUserLon] = useState<number | null>(null);
  const hasToken = Boolean(usersService.getToken());

  const handleSavedEventUpdated = (updates: { event_comment?: string | null; event_rating?: number | null }) => {
    if (!selectedEvent) return;
    setSelectedEvent((current) => (current ? { ...current, ...updates } : current));
    setEvents((current) =>
      current.map((event) =>
        event.user_event_id === selectedEvent.user_event_id ? { ...event, ...updates } : event
      )
    );
  };

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const location = await getOrRequestUserLocation();
        if (cancelled || !location) return;
        if (cancelled) return;
        setUserLat(location.latitude);
        setUserLon(location.longitude);
      } catch {
        if (cancelled) return;
        setUserLat(null);
        setUserLon(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    if (!hasToken) return () => controller.abort();

    fetchSavedUserEvents(controller.signal)
      .then((savedEvents) => {
        if (!cancelled) setEvents(savedEvents);
      })
      .catch((err) => {
        if (cancelled || (err instanceof Error && err.name === 'AbortError')) return;
        setError(err instanceof Error ? err.message : 'Could not load saved events.');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [hasToken, user?.user_id]);

  return (
    <>
      <View style={styles.grid}>
        <View style={[styles.panel, styles.fullPanel]}>
          <Text style={styles.panelEyebrow}>MY SAVED EVENTS</Text>
          <Text style={styles.panelCopy}>Events you saved from the events list.</Text>

          {!hasToken ? (
            <Text style={styles.errorText}>Log in to see your saved events.</Text>
          ) : isLoading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color={Palette.accent} />
              <Text style={styles.loadingText}>Loading saved events...</Text>
            </View>
          ) : error ? (
            <Text style={styles.errorText}>{error}</Text>
          ) : events.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>No saved events yet.</Text>
              <Text style={styles.emptyCopy}>Save events from the Events page and they will appear here.</Text>
            </View>
          ) : (
            <View style={styles.savedEventsList}>
              {events.map((event) => (
                <EventCard
                  key={String(event.user_event_id)}
                  event={event}
                  onPress={(pressedEvent) => setSelectedEvent(pressedEvent as SavedUserEvent)}
                />
              ))}
            </View>
          )}
        </View>
      </View>

      {selectedEvent ? (
        <EventModal
          event={selectedEvent}
          onClose={() => setSelectedEvent(null)}
          onSavedEventUpdated={handleSavedEventUpdated}
          userId={user?.user_id ?? null}
          userLat={userLat}
          userLon={userLon}
        />
      ) : null}
    </>
  );
}

function ProfileField({
  label,
  value,
  onChangeText,
  autoCapitalize,
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  keyboardType?: 'default' | 'email-address';
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholderTextColor={Palette.textTertiary}
        autoCapitalize={autoCapitalize}
        keyboardType={keyboardType}
        autoCorrect={false}
      />
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  app: {
    flex: 1,
    backgroundColor: Palette.bgVoid,
    overflow: 'hidden',
  },
  starField: {
    position: 'absolute',
    width: '100%',
    height: '100%',
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: 24,
    gap: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
    backgroundColor: Palette.bgDeep,
    borderWidth: 1,
    borderColor: Palette.borderSoft,
    borderRadius: Radius.lg,
    padding: 20,
  },
  avatar: {
    width: 78,
    height: 78,
    borderRadius: 39,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Palette.surfaceRaised,
    borderWidth: 1,
    borderColor: Palette.accent,
  },
  avatarText: {
    color: Palette.textPrimary,
    fontSize: 24,
    fontWeight: '900',
  },
  headerText: {
    flex: 1,
    minWidth: dvw(0),
  },
  eyebrow: {
    color: Palette.accentMuted,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0,
  },
  title: {
    color: Palette.textPrimary,
    fontSize: 32,
    fontWeight: '900',
    marginTop: 6,
  },
  subtitle: {
    color: Palette.textSecondary,
    fontSize: 15,
    marginTop: 6,
  },
  levelProgress: {
    marginTop: 10,
    gap: 6,
    width: '24dvw' as any,
  },
  levelTrack: {
    height: '0.8dvh' as any,
    borderRadius: Radius.pill,
    backgroundColor: Palette.surfaceRaised,
    borderWidth: 1,
    borderColor: Palette.borderSoft,
    overflow: 'hidden',
  },
  levelFill: {
    height: '100%',
    backgroundColor: Palette.accent,
  },
  levelMeta: {
    color: Palette.textTertiary,
    fontSize: 12,
    fontWeight: '800',
  },
  tabBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    backgroundColor: Palette.bgDeep,
    borderWidth: 1,
    borderColor: Palette.borderSoft,
    borderRadius: Radius.lg,
    padding: 8,
  },
  tabButton: {
    minHeight: dvh(42),
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: 'transparent',
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabButtonSelected: {
    borderColor: Palette.accent,
    backgroundColor: Palette.accent + '1A',
  },
  tabButtonText: {
    color: Palette.textSecondary,
    fontSize: 12,
    fontWeight: '900',
  },
  tabButtonTextSelected: {
    color: Palette.accent,
  },
  grid: {
    flexDirection: 'row',
    gap: 16,
    flexWrap: 'wrap',
  },
  panel: {
    flexGrow: 1,
    flexBasis: 360,
    backgroundColor: Palette.bgDeep,
    borderWidth: 1,
    borderColor: Palette.borderSoft,
    borderRadius: Radius.lg,
    padding: 20,
    gap: 14,
  },
  fullPanel: {
    flexBasis: '100%',
  },
  panelEyebrow: {
    color: Palette.accentMuted,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0,
  },
  panelCopy: {
    color: Palette.textSecondary,
    fontSize: 14,
    lineHeight: 20,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: dvh(120),
  },
  loadingText: {
    color: Palette.textSecondary,
    fontWeight: '700',
  },
  field: {
    gap: 8,
  },
  fieldLabel: {
    color: Palette.textSecondary,
    fontSize: 13,
    fontWeight: '700',
  },
  input: {
    minHeight: dvh(46),
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: Radius.sm,
    backgroundColor: Palette.surface,
    color: Palette.textPrimary,
    paddingHorizontal: 14,
    fontSize: 15,
    outlineStyle: 'none' as any,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    flexWrap: 'wrap',
    marginTop: 4,
  },
  primaryButton: {
    minHeight: dvh(44),
    borderRadius: Radius.md,
    backgroundColor: Palette.accent,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    color: Palette.bgVoid,
    fontSize: 12,
    fontWeight: '900',
  },
  secondaryButton: {
    minHeight: dvh(44),
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Palette.border,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    color: Palette.textSecondary,
    fontSize: 12,
    fontWeight: '900',
  },
  disabledButton: {
    opacity: 0.45,
  },
  errorText: {
    color: Palette.accentRed,
    fontWeight: '700',
  },
  successText: {
    color: Palette.accentGreen,
    fontWeight: '700',
  },
  preferenceGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  preferencePill: {
    minHeight: dvh(38),
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Palette.border,
    backgroundColor: Palette.surface,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  preferencePillSelected: {
    borderColor: Palette.accent,
    backgroundColor: Palette.accent + '20',
  },
  preferenceText: {
    color: Palette.textSecondary,
    fontSize: 12,
    fontWeight: '800',
  },
  preferenceTextSelected: {
    color: Palette.accent,
  },
  savedEventsList: {
    gap: 12,
  },
  emptyState: {
    minHeight: dvh(120),
    alignItems: 'flex-start',
    justifyContent: 'center',
    gap: 6,
  },
  emptyTitle: {
    color: Palette.textPrimary,
    fontSize: 18,
    fontWeight: '800',
  },
  emptyCopy: {
    color: Palette.textSecondary,
    fontSize: 14,
    lineHeight: 20,
  },
  infoRow: {
    borderBottomWidth: 1,
    borderBottomColor: Palette.borderSoft,
    paddingVertical: 10,
    gap: 4,
  },
  infoLabel: {
    color: Palette.textTertiary,
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  infoValue: {
    color: Palette.textPrimary,
    fontSize: 16,
    fontWeight: '700',
  },
});
