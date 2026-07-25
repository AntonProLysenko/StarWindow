// Event detail MODAL (phase 2). Rendered by the events page only while open, so
// its mount/unmount cleanly drives the web a11y lifecycle (scroll lock, focus
// trap, return focus). Composed from small sub-components (countdown, launch
// details, score gauge) so a future detail page can reuse the pieces.

import { useEffect, useRef, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import {
  ActivityIndicator,
  Animated,
  Image,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { EventCountdown } from '@/components/events/event-countdown';
import { LaunchDetailsSection } from '@/components/events/launch-details';
import { ScoreGauge } from '@/components/events/score-gauge';
import { fallbackIconSource } from '@/components/events/event-fallback-icon';
import { formatEventDate } from '@/components/events/event-card';
import { Palette, Radius, alpha } from '@/constants/tokens';
import {
  addSavedUserEventImage,
  checkEventSaved,
  deleteSavedUserEventImage,
  deleteUserEvent,
  fetchViewingScore,
  saveUserEvent,
  updateSavedUserEvent,
  type EventListItem,
  type SavedUserEventImage,
} from '@/lib/events-api';
import { describeVisibility } from '@/lib/event-visibility';
import { dvw, dvh } from '@/utilities/responsive-dimensions';

const LAUNCH_ACCENT = Palette.accentRed;
const EVENT_ACCENT = Palette.accent;

// ImgBB upload — reads the key from EXPO_PUBLIC_IMGBB_API_KEY (see .env).
const IMGBB_API_KEY = process.env.EXPO_PUBLIC_IMGBB_API_KEY;

async function uploadImageToImgbb(base64: string): Promise<string> {
  const formData = new FormData();
  formData.append('key', IMGBB_API_KEY ?? '');
  formData.append('image', base64);

  const res = await fetch('https://api.imgbb.com/1/upload', {
    method: 'POST',
    body: formData,
  });

  const json = await res.json();
  if (!json.success) {
    throw new Error(json.error?.message ?? 'Upload failed');
  }
  return json.data.url as string;
}

function openUrl(url: string) {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.open(url, '_blank', 'noopener,noreferrer');
  } else {
    Linking.openURL(url).catch(() => {});
  }
}

export function EventModal({
  event,
  onClose,
  onSavedEventUpdated,
  userId,
  userLat,
  userLon,
}: {
  event: EventListItem;
  onClose: () => void;
  onSavedEventUpdated?: (updates: { event_comment?: string | null; event_rating?: number | null }) => void;
  userId: number | null;
  userLat: number | null;
  userLon: number | null;
}) {
  const isLaunch = event.category === 'launch';
  const accent = isLaunch ? LAUNCH_ACCENT : EVENT_ACCENT;
  const canSaveEvent = /^\d+$/.test(String(event.event_id));
  const fallbackIcon = fallbackIconSource(event);
  const { visible, tooFar, distanceMiles } = describeVisibility(event, userLat, userLon);
  const hasWebcast = Boolean(event.video_url) || event.webcast_live;

  const contentRef = useRef<View>(null);

  // --- viewing score ---
  const [score, setScore] = useState<number | null>(null);
  const [scoreLoading, setScoreLoading] = useState(false);

  // --- saved state ---
  const [saved, setSaved] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [note, setNote] = useState(() => getSavedEventNote(event));
  const [savedNote, setSavedNote] = useState(() => getSavedEventNote(event));
  const [noteBusy, setNoteBusy] = useState(false);
  const [noteMessage, setNoteMessage] = useState<string | null>(null);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [noteEditing, setNoteEditing] = useState(() => !normalizeNote(getSavedEventNote(event)));
  const [noteHovered, setNoteHovered] = useState(false);

  // --- photos ---
  const [images, setImages] = useState<SavedUserEventImage[]>(() => getSavedEventImages(event));
  const [stagedUri, setStagedUri] = useState<string | null>(null); // local preview, not uploaded yet
  const [stagedBase64, setStagedBase64] = useState<string | null>(null);
  const [imageCaption, setImageCaption] = useState('');
  const [imageUploading, setImageUploading] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [imagePickerOpen, setImagePickerOpen] = useState(false);
  const [imageBusyId, setImageBusyId] = useState<string | null>(null);

  // --- enter animation (fade + scale) ---
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, {
      toValue: 1,
      duration: 180,
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }, [anim]);

  // --- web a11y: scroll lock, Escape, focus trap, return focus, aria ---
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const trigger = document.activeElement as HTMLElement | null;
    const node = contentRef.current as unknown as HTMLElement | null;

    document.body.style.overflow = 'hidden';
    if (node) {
      node.setAttribute('role', 'dialog');
      node.setAttribute('aria-modal', 'true');
      node.setAttribute('aria-label', event.name);
      node.setAttribute('tabindex', '-1');
      node.focus();
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'Tab' && node) {
        const focusables = Array.from(
          node.querySelectorAll<HTMLElement>(
            'a[href], button, input, textarea, select, [tabindex]:not([tabindex="-1"])'
          )
        ).filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null);
        if (focusables.length === 0) {
          e.preventDefault();
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      trigger?.focus?.();
    };
  }, [event.name, onClose]);

  // --- fetch viewing score for the user's location (only if visible) ---
  useEffect(() => {
    setScore(null);
    if (!visible || userLat == null || userLon == null) return;

    const controller = new AbortController();
    setScoreLoading(true);
    fetchViewingScore(userLat, userLon, controller.signal)
      .then((r) => setScore(r.viewing_score))
      .catch((err) => {
        if ((err as Error).name !== 'AbortError') setScore(null);
      })
      .finally(() => setScoreLoading(false));
    return () => controller.abort();
  }, [event.event_id, visible, userLat, userLon]);

  // --- seed saved state ---
  useEffect(() => {
    if (userId == null || !canSaveEvent) return;
    const controller = new AbortController();
    checkEventSaved(event.event_id, controller.signal)
      .then((r) => {
        setSaved(r.saved);
        setSavedId(r.user_event_id);
        setNote(r.event_comment ?? '');
        setSavedNote(r.event_comment ?? '');
        setNoteEditing(!normalizeNote(r.event_comment));
        setNoteHovered(false);
        setImages(r.user_event_images ?? []);
 // NOTE: checkEventSaved doesn't currently return existing photos, so
        // the gallery starts empty each time the modal opens. Photos added
        // in this session will still show up immediately below.
        })
      .catch(() => {});
    return () => controller.abort();
  }, [canSaveEvent, userId, event.event_id]);

  useEffect(() => {
    const currentNote = getSavedEventNote(event);
    setNote(currentNote);
    setSavedNote(currentNote);
    setNoteEditing(!normalizeNote(currentNote));
    setNoteHovered(false);
    setNoteMessage(null);
    setNoteError(null);
    setImages(getSavedEventImages(event));
    cancelStagedImage();
  }, [event]);

  async function handleSaveToggle() {
    if (!canSaveEvent || userId == null || saveBusy) return;
    setSaveError(null);

    if (!saved) {
      // Optimistic save.
      setSaved(true);
      setSaveBusy(true);
      try {
        const res = await saveUserEvent(event.event_id);
        setSavedId(res.user_event_id);
      } catch {
        setSaved(false); // rollback
        setSaveError('Could not save. Try again.');
      } finally {
        setSaveBusy(false);
      }
    } else {
      // Optimistic unsave.
      const prevId = savedId;
      setSaved(false);
      setSaveBusy(true);
      try {
        if (prevId) await deleteUserEvent(prevId);
        setSavedId(null);
        setNote('');
        setSavedNote('');
        setImages([]);
        onSavedEventUpdated?.({ event_comment: null });
      } catch {
        setSaved(true); // rollback
        setSaveError('Could not remove. Try again.');
      } finally {
        setSaveBusy(false);
      }
    }
  }

  async function handleSaveNote() {
    if (!savedId || noteBusy) return;
    setNoteBusy(true);
    setNoteError(null);
    setNoteMessage(null);

    const nextNote = normalizeNote(note);
    try {
      const updated = await updateSavedUserEvent(savedId, { event_comment: nextNote });
      const updatedNote = updated.event_comment ?? '';
      setNote(updatedNote);
      setSavedNote(updatedNote);
      setNoteMessage('Comment saved.');
      setNoteEditing(!updatedNote);
      setNoteHovered(false);
      onSavedEventUpdated?.({ event_comment: updated.event_comment });
    } catch {
      setNoteError('Could not save note.');
    } finally {
      setNoteBusy(false);
    }
  }

  async function handleClearNote() {
    await handleSaveNoteWithValue(null);
  }

  async function handleSaveNoteWithValue(value: string | null) {
    if (!savedId || noteBusy) return;
    setNoteBusy(true);
    setNoteError(null);
    setNoteMessage(null);

    try {
      const updated = await updateSavedUserEvent(savedId, { event_comment: value });
      const updatedNote = updated.event_comment ?? '';
      setNote(updatedNote);
      setSavedNote(updatedNote);
      setNoteMessage(value ? 'Comment saved.' : 'Comment cleared.');
      setNoteEditing(!updatedNote);
      setNoteHovered(false);
      onSavedEventUpdated?.({ event_comment: updated.event_comment });
    } catch {
      setNote(savedNote);
      setNoteError('Could not update note.');
    } finally {
      setNoteBusy(false);
    }
  }

  // --- photo capture ---

  async function pickFromLibrary() {
    setImageError(null);
    setImagePickerOpen(false);

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setImageError('Permission to access photos was denied.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.8,
      base64: true,
    });

    if (result.canceled) return;
    stageAsset(result.assets[0]);
  }

  async function takePhoto() {
    setImageError(null);
    setImagePickerOpen(false);

    if (Platform.OS === 'web') {
      setImageError('Camera capture is not supported in the browser. Please choose a photo instead.');
      return;
    }

    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setImageError('Permission to use the camera was denied.');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      quality: 0.8,
      base64: true,
    });

    if (result.canceled) return;
    stageAsset(result.assets[0]);
  }

  function stageAsset(asset: ImagePicker.ImagePickerAsset) {
    if (!asset.base64) {
      setImageError('Could not read the selected image.');
      return;
    }
    setStagedUri(asset.uri);
    setStagedBase64(asset.base64);
    setImageCaption('');
  }

  function cancelStagedImage() {
    setStagedUri(null);
    setStagedBase64(null);
    setImageCaption('');
    setImageError(null);
  }

  async function confirmImageUpload() {
    if (!stagedBase64 || !savedId) return;
    setImageUploading(true);
    setImageError(null);

    try {
      const hostedUrl = await uploadImageToImgbb(stagedBase64);
      const savedImage = await addSavedUserEventImage(savedId, {
        image_url: hostedUrl,
        caption: imageCaption.trim() || null,
      });
      setImages((prev) => [...prev, savedImage]);
      cancelStagedImage();
    } catch (err) {
      setImageError(err instanceof Error ? err.message : 'Image upload failed. Try again.');
    } finally {
      setImageUploading(false);
    }
  }

  async function handleRemoveImage(image: SavedUserEventImage) {
    if (!savedId || imageBusyId) return;
    setImageBusyId(image.user_event_image_id);
    setImageError(null);
    try {
      await deleteSavedUserEventImage(savedId, image.user_event_image_id);
      setImages((prev) => prev.filter((img) => img.user_event_image_id !== image.user_event_image_id));
    } catch {
      setImageError('Could not remove photo.');
    } finally {
      setImageBusyId(null);
    }
  }

  const cardAnimStyle = {
    opacity: anim,
    transform: [{ scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }],
  };

  return (
    <View style={[styles.root, Platform.OS === 'web' && ({ position: 'fixed' } as object)]}>
      {/* Backdrop — click to close. */}
      <Animated.View style={[styles.backdrop, { opacity: anim }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} aria-label="Close dialog" />
      </Animated.View>

      {/* Centering layer (also closes on outside click). */}
      <View style={styles.center} pointerEvents="box-none">
        <Animated.View style={[styles.card, cardAnimStyle]}>
          {/* The dialog surface. contentRef gets role/aria/focus in the effect. */}
          <View ref={contentRef} style={styles.dialog}>
            {/* Close button */}
            <Pressable style={styles.closeBtn} onPress={onClose} aria-label="Close">
              <Text style={styles.closeIcon}>✕</Text>
            </Pressable>

            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}>
              {/* Enlarged image / fallback */}
              <View style={[styles.hero, isLaunch && { borderColor: LAUNCH_ACCENT + '55' }]}>
                {event.image_url ? (
                  <Image source={{ uri: event.image_url }} style={styles.heroImage} resizeMode="cover" />
                ) : fallbackIcon ? (
                  <View style={styles.heroFallback}>
                    <Image source={fallbackIcon} style={styles.heroFallbackImage} resizeMode="contain" />
                  </View>
                ) : (
                  <View style={styles.heroFallback}>
                    <Text style={styles.heroFallbackIcon}>{isLaunch ? '🚀' : '✨'}</Text>
                  </View>
                )}
              </View>

              {/* Type badge */}
              <View style={styles.badgeRow}>
                <View style={[styles.badge, { backgroundColor: accent + '20' }]}>
                  <Text style={[styles.badgeText, { color: accent }]}>
                    {isLaunch ? '🚀 LAUNCH' : event.type.toUpperCase()}
                  </Text>
                </View>
              </View>

              {/* Title */}
              <Text style={styles.title}>{event.name}</Text>

              {/* Date + countdown */}
              <Text style={styles.date}>{formatEventDate(event.date, event.date_precision)}</Text>
              <EventCountdown date={event.date} />

              {/* Location */}
              {event.location ? (
                <Text style={styles.location}>📍 {event.location}</Text>
              ) : null}

              {/* Viewing score — or, if the event is too far, a 0 + gentle note */}
              {tooFar ? (
                <View style={styles.gaugeWrap}>
                  <ScoreGauge score={0} />
                  <Text style={styles.note}>
                    You're about {distanceMiles} mi from this one, a little too far to catch it
                    in person.{' '}
                    {event.video_url
                      ? 'Tune into the live stream below to enjoy it live! 🚀'
                      : "But keep an eye out, there's always the next one. 🔭"}
                  </Text>
                </View>
              ) : userLat == null || userLon == null ? (
                <Text style={styles.note}>Enable location to see your viewing score.</Text>
              ) : scoreLoading ? (
                <View style={styles.scoreLoading}>
                  <ActivityIndicator color={Palette.accent} />
                </View>
              ) : score != null ? (
                <View style={styles.gaugeWrap}>
                  <ScoreGauge score={score} />
                </View>
              ) : (
                <Text style={styles.note}>Viewing score unavailable right now.</Text>
              )}

              {/* Full description */}
              {event.description ? (
                <Text style={styles.description}>{event.description}</Text>
              ) : null}

              {/* Launch details */}
              {isLaunch && event.launch_details ? (
                <LaunchDetailsSection details={event.launch_details} />
              ) : null}

              {/* Webcast */}
              {hasWebcast ? (
                event.video_url ? (
                  <Pressable style={styles.watchBtn} onPress={() => openUrl(event.video_url!)}>
                    <Text style={styles.watchBtnText}>▶  Watch live</Text>
                  </Pressable>
                ) : (
                  <View style={styles.liveTag}>
                    <View style={styles.liveDot} />
                    <Text style={styles.liveText}>Live coverage expected</Text>
                  </View>
                )
              ) : null}

              {canSaveEvent ? (
                <Pressable
                  style={[
                    styles.saveBtn,
                    saved && styles.saveBtnSaved,
                    (userId == null || saveBusy) && styles.saveBtnDisabled,
                  ]}
                  onPress={handleSaveToggle}
                  disabled={userId == null || saveBusy}
                  aria-label={saved ? 'Remove saved event' : 'Save event'}>
                  <Text style={[styles.saveBtnText, saved && styles.saveBtnTextSaved]}>
                    {userId == null ? 'Log in to save' : saved ? '✓ Saved' : 'Save event'}
                  </Text>
                </Pressable>
              ) : null}
              {saveError ? <Text style={styles.saveError}>{saveError}</Text> : null}

              {saved && savedId ? (
                <View style={styles.noteSection}>
                  <Text style={styles.noteSectionTitle}>PRIVATE COMMENT</Text>
                  {normalizeNote(savedNote) && !noteEditing ? (
                    <Pressable
                      onHoverIn={() => setNoteHovered(true)}
                      onHoverOut={() => setNoteHovered(false)}
                      onPress={() => setNoteEditing(true)}
                      style={styles.savedNoteBox}
                      aria-label="Edit private comment">
                      <Text style={styles.savedNoteText}>{savedNote}</Text>
                      <View
                        pointerEvents="none"
                        style={[
                          styles.noteEditIcon,
                          (noteHovered || Platform.OS !== 'web') && styles.noteEditIconVisible,
                        ]}>
                        <Text style={styles.noteEditIconText}>✎</Text>
                      </View>
                    </Pressable>
                  ) : (
                    <>
                      <TextInput
                        value={note}
                        onChangeText={(value) => {
                          setNote(value);
                          setNoteMessage(null);
                          setNoteError(null);
                        }}
                        placeholder="Observation plan, reminder, gear..."
                        placeholderTextColor={Palette.textTertiary}
                        multiline
                        textAlignVertical="top"
                        style={styles.noteInput}
                        editable={!noteBusy}
                      />
                      <View style={styles.noteActions}>
                        <Pressable
                          onPress={handleSaveNote}
                          disabled={noteBusy || normalizeNote(note) === normalizeNote(savedNote)}
                          style={[
                            styles.noteButton,
                            (noteBusy || normalizeNote(note) === normalizeNote(savedNote)) && styles.noteButtonDisabled,
                          ]}>
                          <Text style={styles.noteButtonText}>{noteBusy ? 'SAVING...' : 'SAVE COMMENT'}</Text>
                        </Pressable>
                        <Pressable
                          onPress={handleClearNote}
                          disabled={noteBusy || (!normalizeNote(note) && !normalizeNote(savedNote))}
                          style={[
                            styles.noteSecondaryButton,
                            (noteBusy || (!normalizeNote(note) && !normalizeNote(savedNote))) && styles.noteButtonDisabled,
                          ]}>
                          <Text style={styles.noteSecondaryButtonText}>CLEAR</Text>
                        </Pressable>
                      </View>
                    </>
                  )}
                  {noteMessage ? <Text style={styles.noteSuccess}>{noteMessage}</Text> : null}
                  {noteError ? <Text style={styles.noteError}>{noteError}</Text> : null}
                </View>
              ) : null}

              {saved && savedId ? (
                <View style={styles.noteSection}>
                  <Text style={styles.noteSectionTitle}>PHOTOS</Text>

                  {images.length > 0 ? (
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={{ gap: 10 }}>
                      {images.map((img) => (
                        <View key={img.user_event_image_id} style={{ width: 120 }}>
                          <Image
                            source={{ uri: img.image_url }}
                            style={{ width: 120, height: 120, borderRadius: 8 }}
                            resizeMode="cover"
                          />
                          {img.caption ? (
                            <Text
                              style={{ fontSize: 11, color: Palette.textSecondary, marginTop: 4 }}
                              numberOfLines={2}>
                              {img.caption}
                            </Text>
                          ) : null}
                          <Pressable
                            onPress={() => handleRemoveImage(img)}
                            disabled={imageBusyId === img.user_event_image_id}
                            style={[styles.noteSecondaryButton, { marginTop: 4 }]}>
                            <Text style={styles.noteSecondaryButtonText}>
                              {imageBusyId === img.user_event_image_id ? 'REMOVING…' : 'REMOVE'}
                            </Text>
                          </Pressable>
                        </View>
                      ))}
                    </ScrollView>
                  ) : null}

                  {stagedUri ? (
                    <View style={{ gap: 10 }}>
                      <Image
                        source={{ uri: stagedUri }}
                        style={{ width: '100%', height: 180, borderRadius: 8 }}
                        resizeMode="cover"
                      />
                      <TextInput
                        value={imageCaption}
                        onChangeText={setImageCaption}
                        placeholder="Describe this photo..."
                        placeholderTextColor={Palette.textTertiary}
                        multiline
                        textAlignVertical="top"
                        style={styles.noteInput}
                        editable={!imageUploading}
                      />
                      <View style={styles.noteActions}>
                        <Pressable
                          onPress={confirmImageUpload}
                          disabled={imageUploading}
                          style={[styles.noteButton, imageUploading && styles.noteButtonDisabled]}>
                          <Text style={styles.noteButtonText}>
                            {imageUploading ? 'UPLOADING…' : 'SAVE PHOTO'}
                          </Text>
                        </Pressable>
                        <Pressable
                          onPress={cancelStagedImage}
                          disabled={imageUploading}
                          style={styles.noteSecondaryButton}>
                          <Text style={styles.noteSecondaryButtonText}>CANCEL</Text>
                        </Pressable>
                      </View>
                    </View>
                  ) : imagePickerOpen ? (
                    <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                      <Pressable style={styles.noteButton} onPress={takePhoto}>
                        <Text style={styles.noteButtonText}>TAKE PHOTO</Text>
                      </Pressable>
                      <Pressable style={styles.noteButton} onPress={pickFromLibrary}>
                        <Text style={styles.noteButtonText}>CHOOSE PHOTO</Text>
                      </Pressable>
                      <Pressable
                        style={styles.noteSecondaryButton}
                        onPress={() => setImagePickerOpen(false)}>
                        <Text style={styles.noteSecondaryButtonText}>CANCEL</Text>
                      </Pressable>
                    </View>
                  ) : (
                    <Pressable
                      style={styles.saveBtn}
                      onPress={() => setImagePickerOpen(true)}
                      aria-label="Add photo">
                      <Text style={styles.saveBtnText}>Add photo</Text>
                    </Pressable>
                  )}

                  {imageError ? <Text style={styles.saveError}>{imageError}</Text> : null}
                </View>
              ) : null}
            </ScrollView>
          </View>
        </Animated.View>
      </View>
    </View>
  );
}

function getSavedEventNote(event: EventListItem): string {
  return 'event_comment' in event && typeof event.event_comment === 'string'
    ? event.event_comment
    : '';
}

function getSavedEventImages(event: EventListItem): SavedUserEventImage[] {
  return Array.isArray(event.user_event_images) ? event.user_event_images : [];
}

function normalizeNote(value: string | null) {
  const trimmed = String(value ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute', // overridden to 'fixed' inline on web
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1000,
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: alpha(Palette.bgVoid, 0.72),
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: dvw(560),
    maxHeight: '90%',
  },
  dialog: {
    // flex:1 + minHeight:0 lets the dialog fill the card UP TO its maxHeight and
    // clip, which is what gives the inner ScrollView a bounded height to scroll
    // within. Without this the content just overflows and can't be reached.
    flex: 1,
    minHeight: dvh(0),
    backgroundColor: Palette.surface,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    // RN shadow props; react-native-web maps these to box-shadow on web.
    shadowColor: Palette.shadow,
    shadowOpacity: 0.6,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 20 },
    elevation: 12,
  },
  closeBtn: {
    position: 'absolute',
    top: 12,
    right: 12,
    zIndex: 5,
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: alpha(Palette.bgDeep, 0.6),
    borderWidth: 1,
    borderColor: Palette.borderSoft,
  },
  closeIcon: {
    fontSize: 15,
    color: Palette.textSecondary,
    fontWeight: '700',
    lineHeight: 18,
  },
  scroll: {
    // Fill the bounded dialog and scroll when content exceeds it. minHeight:0 is
    // required on web so this flex item can shrink below its content height.
    flex: 1,
    minHeight: dvh(0),
  },
  scrollContent: {
    padding: 20,
    gap: 12,
  },
  hero: {
    height: dvh(200),
    borderRadius: Radius.md,
    overflow: 'hidden',
    backgroundColor: Palette.bgDeep,
    borderWidth: 1,
    borderColor: Palette.borderSoft,
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  heroFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroFallbackIcon: {
    fontSize: 56,
    opacity: 0.7,
  },
  heroFallbackImage: {
    width: 104,
    height: 104,
  },
  badgeRow: {
    flexDirection: 'row',
  },
  badge: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: Radius.pill,
  },
  badgeText: {
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  title: {
    fontSize: 22,
    lineHeight: 27,
    fontWeight: '700',
    color: Palette.textPrimary,
  },
  date: {
    fontSize: 14,
    fontWeight: '600',
    color: Palette.accent,
  },
  location: {
    fontSize: 13,
    color: Palette.textSecondary,
  },
  note: {
    fontSize: 12.5,
    color: Palette.textSecondary,
    fontStyle: 'italic',
    backgroundColor: Palette.bgDeep,
    borderRadius: Radius.sm,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  scoreLoading: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  gaugeWrap: {
    alignItems: 'center',
    paddingVertical: 4,
    gap: 10,
  },
  description: {
    fontSize: 14,
    lineHeight: 21,
    color: Palette.textSecondary,
  },
  watchBtn: {
    backgroundColor: Palette.accentRed,
    borderRadius: Radius.md,
    paddingVertical: 13,
    alignItems: 'center',
  },
  watchBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: Palette.textPrimary,
  },
  liveTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Palette.accentRed,
  },
  liveText: {
    fontSize: 12,
    color: Palette.textSecondary,
  },
  saveBtn: {
    borderWidth: 1,
    borderColor: Palette.accent,
    borderRadius: Radius.md,
    paddingVertical: 13,
    alignItems: 'center',
    backgroundColor: Palette.accent + '14',
  },
  saveBtnSaved: {
    backgroundColor: Palette.accentGreen + '1A',
    borderColor: Palette.accentGreen,
  },
  saveBtnDisabled: {
    opacity: 0.5,
  },
  saveBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: Palette.accent,
  },
  saveBtnTextSaved: {
    color: Palette.accentGreen,
  },
  saveError: {
    fontSize: 12,
    color: Palette.accentRed,
    textAlign: 'center',
  },
  noteSection: {
    backgroundColor: Palette.bgDeep,
    borderWidth: 1,
    borderColor: Palette.borderSoft,
    borderRadius: Radius.md,
    padding: 12,
    gap: 10,
  },
  noteSectionTitle: {
    color: Palette.accentMuted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0,
  },
  savedNoteBox: {
    position: 'relative',
    borderWidth: 1,
    borderColor: Palette.borderSoft,
    borderRadius: Radius.sm,
    backgroundColor: Palette.surfaceRaised,
    paddingHorizontal: 12,
    paddingVertical: 10,
    paddingRight: 42,
  },
  savedNoteText: {
    color: Palette.textPrimary,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
  },
  noteEditIcon: {
    position: 'absolute',
    top: 8,
    right: 8,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: Radius.pill,
    backgroundColor: Palette.bgDeep,
    paddingHorizontal: 8,
    paddingVertical: 4,
    opacity: 0,
  },
  noteEditIconVisible: {
    opacity: 1,
  },
  noteEditIconText: {
    color: Palette.accent,
    fontSize: 13,
    fontWeight: '900',
    lineHeight: 15,
  },
  noteInput: {
    minHeight: dvh(96),
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: Radius.sm,
    backgroundColor: Palette.surface,
    color: Palette.textPrimary,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    lineHeight: 18,
    outlineStyle: 'none' as any,
  },
  noteActions: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  noteButton: {
    minHeight: dvh(38),
    borderRadius: Radius.md,
    backgroundColor: Palette.accent,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noteSecondaryButton: {
    minHeight: dvh(38),
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Palette.border,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noteButtonDisabled: {
    opacity: 0.45,
  },
  noteButtonText: {
    color: Palette.bgVoid,
    fontSize: 11,
    fontWeight: '900',
  },
  noteSecondaryButtonText: {
    color: Palette.textSecondary,
    fontSize: 11,
    fontWeight: '900',
  },
  noteSuccess: {
    color: Palette.accentGreen,
    fontSize: 12,
    fontWeight: '700',
  },
  noteError: {
    color: Palette.accentRed,
    fontSize: 12,
    fontWeight: '700',
  },
});
