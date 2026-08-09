// Event detail MODAL (phase 2). Rendered by the events page only while open, so
// its mount/unmount cleanly drives the web a11y lifecycle (scroll lock, focus
// trap, return focus). Composed from small sub-components (countdown, launch
// details, score gauge) so a future detail page can reuse the pieces.

import { useEffect, useMemo, useRef, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import { SymbolView } from 'expo-symbols';
import {
  Animated,
  Easing,
  Image,
  Linking,
  Platform,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';

import { EventCountdown } from '@/components/events/event-countdown';
import { LaunchDetailsSection } from '@/components/events/launch-details';
import { ScoreGauge } from '@/components/events/score-gauge';
import { fallbackIconSource } from '@/components/events/event-fallback-icon';
import { formatEventDate } from '@/components/events/event-card';
import { OrbitalLoader } from '@/components/orbital-loader';
import { Breakpoints, Palette, Radius, alpha } from '@/constants/tokens';
import {
  addSavedUserEventImage,
  checkEventSaved,
  deleteSavedUserEventImage,
  deleteUserEvent,
  fetchLaunchLinks,
  fetchViewingScore,
  saveUserEvent,
  updateSavedUserEvent,
  type EventListItem,
  type EventLinkResponse,
  type SavedUserEventImage,
  type ViewingScoreResponse,
  type VisibleBodyEventItem,
} from '@/lib/events-api';
import { describeVisibility } from '@/lib/event-visibility';
import { dvw, dvh } from '@/utilities/responsive-dimensions';

const LAUNCH_ACCENT = Palette.accentRed;
const EVENT_ACCENT = Palette.accent;
const VIDEO_LINK_ACCENT = Palette.accentRed;
const INFO_LINK_ACCENT = '#B46CFF';
const OTHER_LINK_ACCENT = '#5EA88E';
const OTHER_LINK_TEXT = Palette.textPrimary;

// ImgBB upload — reads the key from EXPO_PUBLIC_IMGBB_API_KEY (see .env).
const IMGBB_API_KEY = process.env.EXPO_PUBLIC_IMGBB_API_KEY;

async function uploadImageToImgbb(base64: string): Promise<{ image_url: string; imgbb_delete_url: string | null }> {
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
  return {
    image_url: json.data.url as string,
    imgbb_delete_url: typeof json.data.delete_url === 'string' ? json.data.delete_url : null,
  };
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
  onNavigateEvent,
  onSavedEventUpdated,
  onSavedStateChange,
  userId,
  userLat,
  userLon,
}: {
  event: EventListItem;
  onClose: () => void;
  onNavigateEvent?: (direction: 'next' | 'previous') => boolean | void;
  onSavedEventUpdated?: (updates: { event_comment?: string | null; event_rating?: number | null }) => void;
  onSavedStateChange?: (eventId: number | string, saved: boolean) => void;
  userId: number | null;
  userLat: number | null;
  userLon: number | null;
}) {
  const { width } = useWindowDimensions();
  const isMobile = width < Breakpoints.tablet;
  const isTablet = width >= Breakpoints.tablet && width < Breakpoints.desktop;
  const isSwipeLayout = isMobile || isTablet;
  const [liveLaunchLinks, setLiveLaunchLinks] = useState<EventLinkResponse | null>(null);
  const isLaunch = event.category === 'launch';
  const accent = isLaunch ? LAUNCH_ACCENT : EVENT_ACCENT;
  const canSaveEvent = /^\d+$/.test(String(event.event_id));
  const fallbackIcon = fallbackIconSource(event);
  const { visible, tooFar, distanceMiles } = describeVisibility(event, userLat, userLon);
  const videoUrls = getEventUrls(event.video_urls, event.video_url, liveLaunchLinks?.video_urls, liveLaunchLinks?.video_url);
  const infoUrls = getEventUrls(event.external_urls, event.external_url, liveLaunchLinks?.external_urls, liveLaunchLinks?.external_url);
  const primaryVideoUrl = videoUrls[0] ?? null;
  const primaryInfoUrl = infoUrls[0] ?? null;
  const otherLinks = [
    ...videoUrls.slice(1).map((url) => ({
      key: `video-${url}`,
      url,
    })),
    ...infoUrls.slice(1).map((url) => ({
      key: `info-${url}`,
      url,
    })),
  ];
  const hasWebcast = videoUrls.length > 0 || event.webcast_live;
  const visibleBodies = getVisibleBodies(event);
  const hasVisibleBodySlider = visibleBodies.length > 0;
  const isMeteorShower = isMeteorShowerEvent(event);
  const isSpacewalk = isSpacewalkEvent(event);
  const suppressViewingScore = isNonViewingScoreEvent(event);

  const contentRef = useRef<View>(null);
  const scrollRef = useRef<ScrollView>(null);
  const visibleBodyCarouselActiveRef = useRef(false);
  const fullScreenImageActiveRef = useRef(false);
  const swipeAnimatingRef = useRef(false);
  const pendingSwipeDirectionRef = useRef<'next' | 'previous' | null>(null);
  const swipeX = useRef(new Animated.Value(0)).current;
  const anim = useRef(new Animated.Value(0)).current;

  // --- viewing score ---
  const [score, setScore] = useState<number | null>(null);
  const [scoreInputs, setScoreInputs] = useState<ViewingScoreResponse['inputs'] | null>(null);
  const [scoreLoading, setScoreLoading] = useState(false);

  // --- saved state ---
  const [saved, setSaved] = useState(() => getEventSavedState(event));
  const [savedId, setSavedId] = useState<string | null>(() => (
    event.user_event_id != null ? String(event.user_event_id) : null
  ));
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
  const [imageHoveredId, setImageHoveredId] = useState<string | null>(null);
  const imageHoverClearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [fullScreenImage, setFullScreenImage] = useState<SavedUserEventImage | null>(null);
  const [visibleBodyCarouselActive, setVisibleBodyCarouselActive] = useState(false);

  useEffect(() => {
    visibleBodyCarouselActiveRef.current = visibleBodyCarouselActive;
  }, [visibleBodyCarouselActive]);

  useEffect(() => {
    fullScreenImageActiveRef.current = Boolean(fullScreenImage);
  }, [fullScreenImage]);

  function canHandleEventSwipe() {
    return Boolean(
      isSwipeLayout &&
      onNavigateEvent &&
      !swipeAnimatingRef.current &&
      !fullScreenImageActiveRef.current &&
      !visibleBodyCarouselActiveRef.current
    );
  }

  function clampSwipeOffset(dx: number) {
    const limit = Math.max(width * 0.42, 140);
    return Math.max(Math.min(dx, limit), -limit);
  }

  function resetSwipePosition() {
    Animated.spring(swipeX, {
      toValue: 0,
      useNativeDriver: Platform.OS !== 'web',
      speed: 18,
      bounciness: 4,
    }).start();
  }

  function runSwipeNavigation(direction: 'next' | 'previous') {
    const navigate = onNavigateEvent;
    if (!navigate || swipeAnimatingRef.current) {
      resetSwipePosition();
      return;
    }

    swipeAnimatingRef.current = true;
    const exitX = direction === 'next' ? -width : width;
    Animated.timing(swipeX, {
      toValue: exitX,
      duration: 150,
      useNativeDriver: Platform.OS !== 'web',
    }).start(() => {
      const navigated = navigate(direction) !== false;
      if (!navigated) {
        swipeAnimatingRef.current = false;
        resetSwipePosition();
        return;
      }

      pendingSwipeDirectionRef.current = direction;
    });
  }

  const swipeResponder = useMemo(
    () => {
      return PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_evt, gestureState) => {
          if (!canHandleEventSwipe()) return false;
          const absX = Math.abs(gestureState.dx);
          const absY = Math.abs(gestureState.dy);
          return absX > 18 && absX > absY * 1.25;
        },
        onMoveShouldSetPanResponder: (_evt, gestureState) => {
          if (!canHandleEventSwipe()) return false;
          const absX = Math.abs(gestureState.dx);
          const absY = Math.abs(gestureState.dy);
          return absX > 18 && absX > absY * 1.25;
        },
        onPanResponderMove: (_evt, gestureState) => {
          if (!canHandleEventSwipe()) return;
          swipeX.setValue(clampSwipeOffset(gestureState.dx));
        },
        onPanResponderRelease: (_evt, gestureState) => {
          if (!canHandleEventSwipe() || Math.abs(gestureState.dx) < 64) {
            resetSwipePosition();
            return;
          }
          runSwipeNavigation(gestureState.dx < 0 ? 'next' : 'previous');
        },
        onPanResponderTerminate: resetSwipePosition,
        onShouldBlockNativeResponder: () => false,
      });
    },
    [isSwipeLayout, onNavigateEvent, swipeX, width]
  );

  useEffect(() => {
    const direction = pendingSwipeDirectionRef.current;
    if (!direction) {
      swipeX.setValue(0);
      swipeAnimatingRef.current = false;
      return;
    }

    pendingSwipeDirectionRef.current = null;
    swipeX.setValue(direction === 'next' ? width : -width);
    Animated.timing(swipeX, {
      toValue: 0,
      duration: 180,
      useNativeDriver: Platform.OS !== 'web',
    }).start(() => {
      swipeAnimatingRef.current = false;
    });
  }, [event, swipeX, width]);

  useEffect(() => {
    if (Platform.OS !== 'web' || !isSwipeLayout || !onNavigateEvent) return;
    const node = contentRef.current as unknown as HTMLElement | null;
    if (!node) return;

    let startX = 0;
    let startY = 0;
    let tracking = false;
    let horizontalIntent = false;

    const onTouchStart = (event: TouchEvent) => {
      if (!canHandleEventSwipe() || event.touches.length !== 1) {
        tracking = false;
        return;
      }
      const touch = event.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;
      tracking = true;
      horizontalIntent = false;
    };

    const onTouchMove = (event: TouchEvent) => {
      if (!tracking || !canHandleEventSwipe() || event.touches.length !== 1) return;
      const touch = event.touches[0];
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      const absX = Math.abs(dx);
      const absY = Math.abs(dy);
      if (!horizontalIntent && absX > 16 && absX > absY * 1.2) {
        horizontalIntent = true;
      }
      if (horizontalIntent) {
        swipeX.setValue(clampSwipeOffset(dx));
      }
    };

    const onTouchEnd = (event: TouchEvent) => {
      if (!tracking || !canHandleEventSwipe()) return;
      tracking = false;
      const touch = event.changedTouches[0];
      if (!touch) return;

      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      const absX = Math.abs(dx);
      const absY = Math.abs(dy);
      if (absX < 56 || absX < absY * 1.25) {
        resetSwipePosition();
        return;
      }
      runSwipeNavigation(dx < 0 ? 'next' : 'previous');
    };

    const onTouchCancel = () => {
      tracking = false;
      resetSwipePosition();
    };

    node.addEventListener('touchstart', onTouchStart, { passive: true });
    node.addEventListener('touchmove', onTouchMove, { passive: true });
    node.addEventListener('touchend', onTouchEnd, { passive: true });
    node.addEventListener('touchcancel', onTouchCancel, { passive: true });

    return () => {
      node.removeEventListener('touchstart', onTouchStart);
      node.removeEventListener('touchmove', onTouchMove);
      node.removeEventListener('touchend', onTouchEnd);
      node.removeEventListener('touchcancel', onTouchCancel);
    };
  }, [isSwipeLayout, onNavigateEvent, event, swipeX, width]);

  // --- enter animation (fade + scale) ---
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
    const previousBodyOverflow = document.body.style.overflow;
    const previousBodyOverscroll = document.body.style.overscrollBehavior;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousHtmlOverscroll = document.documentElement.style.overscrollBehavior;

    document.body.style.overflow = 'hidden';
    document.body.style.overscrollBehavior = 'none';
    document.documentElement.style.overflow = 'hidden';
    document.documentElement.style.overscrollBehavior = 'none';
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
      document.body.style.overflow = previousBodyOverflow;
      document.body.style.overscrollBehavior = previousBodyOverscroll;
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.documentElement.style.overscrollBehavior = previousHtmlOverscroll;
      trigger?.focus?.();
    };
  }, [event.name, onClose]);

  useEffect(() => {
    setLiveLaunchLinks(null);
    if (!isLaunch || !event.name) return;

    let isActive = true;
    const controller = new AbortController();
    fetchLaunchLinks({ name: event.name, date: event.date }, controller.signal)
      .then((links) => {
        if (!isActive || controller.signal.aborted) return;
        setLiveLaunchLinks(links);
      })
      .catch(() => {});

    return () => {
      isActive = false;
      controller.abort();
    };
  }, [isLaunch, event.name, event.date]);

  // --- fetch viewing score for the user's location (only if visible) ---
  useEffect(() => {
    setScore(null);
    setScoreInputs(null);
    setScoreLoading(false);
    if (suppressViewingScore || !visible || userLat == null || userLon == null) return;

    let isActive = true;
    const controller = new AbortController();
    setScoreLoading(true);
    fetchViewingScore(userLat, userLon, controller.signal)
      .then((r) => {
        if (!isActive || controller.signal.aborted) return;
        setScore(r.viewing_score);
        setScoreInputs(r.inputs ?? null);
      })
      .catch((err) => {
        if (isActive && (err as Error).name !== 'AbortError') {
          setScore(null);
          setScoreInputs(null);
        }
      })
      .finally(() => {
        if (isActive && !controller.signal.aborted) setScoreLoading(false);
      });
    return () => {
      isActive = false;
      controller.abort();
    };
  }, [event.event_id, suppressViewingScore, visible, userLat, userLon]);

  // --- seed saved state ---
  useEffect(() => {
    if (userId == null || !canSaveEvent) return;

    if (event.saved !== undefined || event.user_event_id != null) {
      setSaved(getEventSavedState(event));
      setSavedId(event.user_event_id != null ? String(event.user_event_id) : null);
      setNote(getSavedEventNote(event));
      setSavedNote(getSavedEventNote(event));
      setNoteEditing(!normalizeNote(getSavedEventNote(event)));
      setNoteHovered(false);
      setImages(getSavedEventImages(event));
      return;
    }

    const controller = new AbortController();
    checkEventSaved(event.event_id, controller.signal)
      .then((r) => {
        setSaved(r.saved);
        setSavedId(r.user_event_id != null ? String(r.user_event_id) : null);
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
  }, [canSaveEvent, userId, event]);

  useEffect(() => {
    const currentNote = getSavedEventNote(event);
    setSaved(getEventSavedState(event));
    setSavedId(event.user_event_id != null ? String(event.user_event_id) : null);
    setNote(currentNote);
    setSavedNote(currentNote);
    setNoteEditing(!normalizeNote(currentNote));
    setNoteHovered(false);
    setNoteMessage(null);
    setNoteError(null);
    setImages(getSavedEventImages(event));
    setFullScreenImage(null);
    cancelStagedImage();
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [event]);

  useEffect(() => {
    return () => {
      if (imageHoverClearTimer.current) clearTimeout(imageHoverClearTimer.current);
    };
  }, []);

  function showImageDelete(imageId: string) {
    if (imageHoverClearTimer.current) {
      clearTimeout(imageHoverClearTimer.current);
      imageHoverClearTimer.current = null;
    }
    setImageHoveredId(imageId);
  }

  function scheduleImageDeleteHide(imageId: string) {
    if (imageHoverClearTimer.current) clearTimeout(imageHoverClearTimer.current);
    imageHoverClearTimer.current = setTimeout(() => {
      setImageHoveredId((current) => (current === imageId ? null : current));
      imageHoverClearTimer.current = null;
    }, 180);
  }

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
        onSavedStateChange?.(event.event_id, true);
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
        onSavedStateChange?.(event.event_id, false);
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
      setNoteMessage('Note saved.');
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
      setNoteMessage(value ? 'Note saved.' : 'Note cleared.');
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
      const uploadedImage = await uploadImageToImgbb(stagedBase64);
      const savedImage = await addSavedUserEventImage(savedId, {
        image_url: uploadedImage.image_url,
        imgbb_delete_url: uploadedImage.imgbb_delete_url,
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
      setImageHoveredId((current) => (current === image.user_event_image_id ? null : current));
      setFullScreenImage((current) =>
        current?.user_event_image_id === image.user_event_image_id ? null : current
      );
    } catch {
      setImageError('Could not remove photo.');
    } finally {
      setImageBusyId(null);
    }
  }

  const cardAnimStyle = {
    opacity: anim,
    transform: [
      { perspective: 1200 },
      { translateX: swipeX },
      {
        rotateY: swipeX.interpolate({
          inputRange: [-width, 0, width],
          outputRange: ['22deg', '0deg', '-22deg'],
          extrapolate: 'clamp',
        }),
      },
      {
        rotateZ: swipeX.interpolate({
          inputRange: [-width, 0, width],
          outputRange: ['-3deg', '0deg', '3deg'],
          extrapolate: 'clamp',
        }),
      },
      { scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) },
    ],
  };

  return (
    <View style={[styles.root, Platform.OS === 'web' && ({ position: 'fixed' } as object)]}>
      {/* Backdrop — click to close. */}
      <Animated.View style={[styles.backdrop, { opacity: anim }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} aria-label="Close dialog" />
      </Animated.View>

      {/* Centering layer (also closes on outside click). */}
      <View style={[styles.center, isTablet && styles.centerTablet, isMobile && styles.centerMobile]} pointerEvents="box-none">
        <Animated.View
          style={[styles.card, isTablet && styles.cardTablet, isMobile && styles.cardMobile, cardAnimStyle]}
          {...(isSwipeLayout && onNavigateEvent ? swipeResponder.panHandlers : {})}>
          {/* The dialog surface. contentRef gets role/aria/focus in the effect. */}
          <View
            ref={contentRef}
            style={[
              styles.dialog,
              isSwipeLayout && styles.dialogSwipeSurface,
              isTablet && styles.dialogTablet,
              isMobile && styles.dialogMobile,
            ]}>
            {/* Close button */}
            <Pressable style={[styles.closeBtn, isMobile && styles.closeBtnMobile]} onPress={onClose} aria-label="Close">
              <Text style={styles.closeIcon}>✕</Text>
            </Pressable>

            <ScrollView
              ref={scrollRef}
              style={styles.scroll}
              contentContainerStyle={[styles.scrollContent, isTablet && styles.scrollContentTablet, isMobile && styles.scrollContentMobile]}
              showsVerticalScrollIndicator={false}
              scrollEnabled={!fullScreenImage && !visibleBodyCarouselActive}>
              {/* Enlarged image / fallback */}
              <View style={[styles.hero, isTablet && styles.heroTablet, isMobile && styles.heroMobile]}>
                {hasVisibleBodySlider ? (
                  <VisibleBodyHero
                    bodies={visibleBodies}
                    isMobile={isMobile}
                    onInteractionChange={setVisibleBodyCarouselActive}
                  />
                ) : event.image_url ? (
                  <Image source={{ uri: event.image_url }} style={styles.heroImage} resizeMode="cover" />
                ) : fallbackIcon && isSpacewalk ? (
                  <Image source={fallbackIcon} style={styles.heroImage} resizeMode="cover" />
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
                  <Text style={[styles.badgeText, { color: accent }]} numberOfLines={1}>
                    {isLaunch ? '🚀 LAUNCH' : event.type.toUpperCase()}
                  </Text>
                </View>
              </View>

              {/* Title */}
              <Text style={[styles.title, isMobile && styles.titleMobile]}>{event.name}</Text>

              {/* Date + countdown */}
              <Text style={[styles.date, isMobile && styles.dateMobile]}>{formatEventDate(event.date, event.date_precision)}</Text>
              <EventCountdown date={event.date} />

              {/* Location */}
              {event.location ? (
                <Text style={[styles.location, isMobile && styles.locationMobile]}>📍 {event.location}</Text>
              ) : null}

              {/* Viewing score — or, if the event is too far, a 0 + gentle note */}
              {suppressViewingScore ? null : isMeteorShower ? (
                <MeteorVisibilityPanel
                  event={event}
                  score={score}
                  scoreInputs={scoreInputs}
                  scoreLoading={scoreLoading}
                  hasLocation={userLat != null && userLon != null}
                />
              ) : tooFar ? (
                <View style={[styles.gaugeWrap, isMobile && styles.gaugeWrapMobile]}>
                  <ScoreGauge score={0} />
                  <Text style={[styles.note, isMobile && styles.noteMobile]}>
                    You're about {distanceMiles} mi from this one, a little too far to catch it
                    in person.{' '}
                    {videoUrls.length > 0
                      ? 'Tune into the live stream below to enjoy it live! 🚀'
                      : "But keep an eye out, there's always the next one. 🔭"}
                  </Text>
                </View>
              ) : userLat == null || userLon == null ? (
                <Text style={[styles.note, isMobile && styles.noteMobile]}>Enable location to see your viewing score.</Text>
              ) : scoreLoading ? (
                <View style={styles.scoreLoading}>
                  <OrbitalLoader label="Checking current sky..." size={72} compact />
                </View>
              ) : score != null ? (
                <View style={[styles.gaugeWrap, isMobile && styles.gaugeWrapMobile]}>
                  <ScoreGauge score={score} />
                </View>
              ) : (
                <Text style={[styles.note, isMobile && styles.noteMobile]}>Viewing score unavailable right now.</Text>
              )}

              {/* Full description */}
              {hasVisibleBodySlider ? (
                <VisibleBodyDescription bodies={visibleBodies} />
              ) : event.description ? (
                <Text style={[styles.description, isMobile && styles.descriptionMobile]}>{event.description}</Text>
              ) : null}

              {/* Launch details */}
              {isLaunch && event.launch_details ? (
                <LaunchDetailsSection details={event.launch_details} />
              ) : null}

              {/* Event links */}
              {videoUrls.length > 0 || infoUrls.length > 0 || hasWebcast ? (
                <View style={styles.eventLinkActions}>
                  {primaryVideoUrl || primaryInfoUrl ? (
                    <View style={[styles.primaryLinkRow, isMobile && styles.primaryLinkRowMobile]}>
                      {primaryVideoUrl ? (
                        <Pressable
                          style={[styles.eventLinkButton, styles.videoLinkButton, styles.primaryLinkButton, isMobile && styles.eventLinkButtonMobile]}
                          onPress={() => openUrl(primaryVideoUrl)}>
                          <Text style={[styles.eventLinkKicker, styles.videoLinkKicker]}>Video</Text>
                          <Text style={[styles.eventLinkText, styles.videoLinkText]}>{getVideoLinkText(event)}</Text>
                        </Pressable>
                      ) : null}
                      {primaryInfoUrl ? (
                        <Pressable
                          style={[styles.eventLinkButton, styles.infoLinkButton, styles.primaryLinkButton, isMobile && styles.eventLinkButtonMobile]}
                          onPress={() => openUrl(primaryInfoUrl)}>
                          <Text style={[styles.eventLinkKicker, styles.infoLinkKicker]}>Info</Text>
                          <Text style={[styles.eventLinkText, styles.infoLinkText]}>{getInfoLinkText()}</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  ) : null}
                  {otherLinks.length > 0 ? (
                    <View style={styles.otherLinks}>
                      <Text style={styles.otherLinksTitle}>Other links</Text>
                      {otherLinks.map((link) => (
                        <Pressable key={link.key} style={styles.otherLinkRow} onPress={() => openUrl(link.url)}>
                          <SymbolView
                            name={{
                              ios: 'globe',
                              android: 'public',
                              web: 'public',
                            }}
                            size={15}
                            tintColor={OTHER_LINK_TEXT}
                          />
                          <Text style={styles.otherLinkLabel} numberOfLines={1}>{getShortLinkText(link.url)}</Text>
                        </Pressable>
                      ))}
                    </View>
                  ) : null}
                  {videoUrls.length === 0 && infoUrls.length === 0 ? (
                  <View style={styles.liveTag}>
                    <View style={styles.liveDot} />
                    <Text style={styles.liveText}>Live coverage expected</Text>
                  </View>
                  ) : null}
                </View>
              ) : null}

              {canSaveEvent ? (
                <Pressable
                  style={[
                    styles.saveBtn,
                    isMobile && styles.saveBtnMobile,
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
                <View style={[styles.noteSection, isMobile && styles.noteSectionMobile]}>
                  <Text style={styles.noteSectionTitle}>PRIVATE NOTE</Text>
                  {normalizeNote(savedNote) && !noteEditing ? (
                    <Pressable
                      onHoverIn={() => setNoteHovered(true)}
                      onHoverOut={() => setNoteHovered(false)}
                      onPress={() => setNoteEditing(true)}
                      style={styles.savedNoteBox}
                      aria-label="Edit private note">
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
                        style={[styles.noteInput, isMobile && styles.noteInputMobile]}
                        editable={!noteBusy}
                      />
                      <View style={[styles.noteActions, isMobile && styles.noteActionsMobile]}>
                        <Pressable
                          onPress={handleSaveNote}
                          disabled={noteBusy || normalizeNote(note) === normalizeNote(savedNote)}
                          style={[
                            styles.noteButton,
                            isMobile && styles.noteButtonMobile,
                            (noteBusy || normalizeNote(note) === normalizeNote(savedNote)) && styles.noteButtonDisabled,
                          ]}>
                          <Text style={styles.noteButtonText}>{noteBusy ? 'SAVING...' : 'SAVE NOTE'}</Text>
                        </Pressable>
                        <Pressable
                          onPress={handleClearNote}
                          disabled={noteBusy || (!normalizeNote(note) && !normalizeNote(savedNote))}
                          style={[
                            styles.noteSecondaryButton,
                            isMobile && styles.noteButtonMobile,
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
                <View style={[styles.noteSection, isMobile && styles.noteSectionMobile]}>
                  <Text style={styles.noteSectionTitle}>PHOTOS</Text>

                  {images.length > 0 ? (
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={{ gap: 10 }}>
                      {images.map((img) => {
                        const imageBusy = imageBusyId === img.user_event_image_id;
                        const showDelete = imageHoveredId === img.user_event_image_id || imageBusy || Platform.OS !== 'web';

                        return (
                        <View
                          key={img.user_event_image_id}
                          style={styles.savedImageTile}>
                          <Pressable
                            onPress={() => setFullScreenImage(img)}
                            style={styles.savedImageOpenButton}
                            onHoverIn={() => showImageDelete(img.user_event_image_id)}
                            onHoverOut={() => scheduleImageDeleteHide(img.user_event_image_id)}
                            aria-label="Open photo full screen">
                            <Image
                              source={{ uri: img.image_url }}
                              style={styles.savedImageThumb}
                              resizeMode="cover"
                            />
                            <Pressable
                              onPress={(pressEvent) => {
                                pressEvent.stopPropagation?.();
                                handleRemoveImage(img);
                              }}
                              disabled={imageBusy}
                              onHoverIn={() => showImageDelete(img.user_event_image_id)}
                              onHoverOut={() => scheduleImageDeleteHide(img.user_event_image_id)}
                              style={[
                                styles.imageDeleteButton,
                                showDelete && styles.imageDeleteButtonVisible,
                                imageBusy && styles.imageDeleteButtonBusy,
                              ]}
                              aria-label="Delete photo">
                              {imageBusy ? (
                                <OrbitalLoader size={22} compact />
                              ) : (
                                <SymbolView
                                  name={{
                                    ios: 'trash.fill',
                                    android: 'delete',
                                    web: 'delete',
                                  }}
                                  size={16}
                                  tintColor={Palette.textPrimary}
                                />
                              )}
                            </Pressable>
                          </Pressable>
                          {img.caption ? (
                            <Text
                              style={styles.savedImageCaption}
                              numberOfLines={2}>
                              {img.caption}
                            </Text>
                          ) : null}
                        </View>
                        );
                      })}
                    </ScrollView>
                  ) : null}

                  {stagedUri ? (
                    <View style={{ gap: 10 }}>
                      <Image
                        source={{ uri: stagedUri }}
                        style={[styles.stagedImagePreview, isMobile && styles.stagedImagePreviewMobile]}
                        resizeMode="cover"
                      />
                      <TextInput
                        value={imageCaption}
                        onChangeText={setImageCaption}
                        placeholder="Describe this photo..."
                        placeholderTextColor={Palette.textTertiary}
                        multiline
                        textAlignVertical="top"
                        style={[styles.noteInput, isMobile && styles.noteInputMobile]}
                        editable={!imageUploading}
                      />
                      <View style={[styles.noteActions, isMobile && styles.noteActionsMobile]}>
                        <Pressable
                          onPress={confirmImageUpload}
                          disabled={imageUploading}
                          style={[styles.noteButton, isMobile && styles.noteButtonMobile, imageUploading && styles.noteButtonDisabled]}>
                          <Text style={styles.noteButtonText}>
                            {imageUploading ? 'UPLOADING…' : 'SAVE PHOTO'}
                          </Text>
                        </Pressable>
                        <Pressable
                          onPress={cancelStagedImage}
                          disabled={imageUploading}
                          style={[styles.noteSecondaryButton, isMobile && styles.noteButtonMobile]}>
                          <Text style={styles.noteSecondaryButtonText}>CANCEL</Text>
                        </Pressable>
                      </View>
                    </View>
                  ) : imagePickerOpen ? (
                    <View style={[styles.imagePickerActions, isMobile && styles.noteActionsMobile]}>
                      <Pressable style={[styles.noteButton, isMobile && styles.noteButtonMobile]} onPress={pickFromLibrary}>
                        <Text style={styles.noteButtonText}>CHOOSE PHOTO</Text>
                      </Pressable>
                      <Pressable
                        style={[styles.noteSecondaryButton, isMobile && styles.noteButtonMobile]}
                        onPress={() => setImagePickerOpen(false)}>
                        <Text style={styles.noteSecondaryButtonText}>CANCEL</Text>
                      </Pressable>
                    </View>
                  ) : (
                    <Pressable
                      style={[styles.saveBtn, isMobile && styles.saveBtnMobile]}
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

      {fullScreenImage ? (
        <View style={[styles.root, styles.fullScreenImageRoot, Platform.OS === 'web' && ({ position: 'fixed' } as object)]}>
          <Animated.View style={[styles.backdrop, { opacity: anim }]}>
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={() => setFullScreenImage(null)}
              aria-label="Close full screen photo"
            />
          </Animated.View>

          <View style={[styles.center, isMobile && styles.centerMobile]} pointerEvents="box-none">
            <Animated.View style={[styles.fullScreenImageCard, isMobile && styles.fullScreenImageCardMobile, cardAnimStyle]}>
              <View style={[styles.dialog, styles.fullScreenImageDialog, isMobile && styles.dialogMobile]}>
                <Pressable
                  style={[styles.closeBtn, isMobile && styles.closeBtnMobile]}
                  onPress={() => setFullScreenImage(null)}
                  aria-label="Close full screen photo">
                  <Text style={styles.closeIcon}>✕</Text>
                </Pressable>
                <Image
                  source={{ uri: fullScreenImage.image_url }}
                  style={styles.fullScreenImage}
                  resizeMode="contain"
                />
                {fullScreenImage.caption ? (
                  <Text style={styles.fullScreenImageCaption}>{fullScreenImage.caption}</Text>
                ) : null}
              </View>
            </Animated.View>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function VisibleBodyHero({
  bodies,
  isMobile,
  onInteractionChange,
}: {
  bodies: VisibleBodyEventItem[];
  isMobile: boolean;
  onInteractionChange?: (active: boolean) => void;
}) {
  const scrollRef = useRef<ScrollView>(null);
  const slideAnim = useRef(new Animated.Value(1)).current;
  const [activeIndex, setActiveIndex] = useState(0);
  const [transitionDirection, setTransitionDirection] = useState(1);
  const [sliderWidth, setSliderWidth] = useState(0);
  const slideInset = isMobile ? 0 : 10;
  const slideGap = isMobile ? 0 : 10;
  const slideWidth = Math.max(sliderWidth - slideInset * 2, 0);
  const snapInterval = slideWidth + slideGap;
  const canGoPrevious = activeIndex > 0;
  const canGoNext = activeIndex < bodies.length - 1;
  const bodiesKey = bodies.map((body) => `${body.body}-${body.image_url ?? ''}`).join('|');

  function scrollToIndex(index: number) {
    const nextIndex = Math.min(Math.max(index, 0), bodies.length - 1);
    if (isMobile) {
      if (nextIndex === activeIndex) return;
      setTransitionDirection(nextIndex > activeIndex ? 1 : -1);
      slideAnim.setValue(0);
      setActiveIndex(nextIndex);
      onInteractionChange?.(true);
      Animated.timing(slideAnim, {
        toValue: 1,
        duration: 260,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: Platform.OS !== 'web',
      }).start(() => onInteractionChange?.(false));
      return;
    }

    setActiveIndex(nextIndex);
    scrollRef.current?.scrollTo({ x: nextIndex * snapInterval, animated: true });
  }

  useEffect(() => {
    setActiveIndex(0);
    setTransitionDirection(1);
    slideAnim.setValue(1);
  }, [bodiesKey, slideAnim]);

  function finishInteraction(offsetX: number) {
    onInteractionChange?.(false);
    if (snapInterval <= 0) return;
    const nextIndex = Math.round(offsetX / snapInterval);
    setActiveIndex(Math.min(Math.max(nextIndex, 0), bodies.length - 1));
  }

  function renderBodySlide(body: VisibleBodyEventItem, index: number, extraStyle?: any) {
    const altitude = formatBodyMetric(body.altitude_degrees, 1);
    const magnitude = formatBodyMetric(body.magnitude, 1);
    const meta = [
      altitude ? `Alt ${altitude} deg` : null,
      body.constellation,
      magnitude ? `Mag ${magnitude}` : null,
    ].filter(Boolean).join(' | ');

    return (
      <View
        key={`${body.body}-${index}`}
        style={[
          styles.visibleBodySlide,
          isMobile && styles.visibleBodySlideMobile,
          extraStyle,
        ]}>
        {body.image_url ? (
          <Image source={{ uri: body.image_url }} style={styles.visibleBodyImage} resizeMode="contain" />
        ) : (
          <View style={styles.visibleBodyFallback}>
            <Text style={styles.visibleBodyFallbackText}>{body.body.slice(0, 1).toUpperCase()}</Text>
          </View>
        )}
        <View style={styles.visibleBodyScrim} />
        <View style={styles.visibleBodyOverlay}>
          <Text style={styles.visibleBodyName} numberOfLines={1}>{body.body}</Text>
          {meta ? <Text style={styles.visibleBodyMeta} numberOfLines={2}>{meta}</Text> : null}
        </View>
      </View>
    );
  }

  if (isMobile) {
    const activeBody = bodies[activeIndex] ?? bodies[0];
    const translateX = slideAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [transitionDirection * 34, 0],
    });
    return (
      <View
        style={styles.visibleBodyCarousel}
        onLayout={(event) => setSliderWidth(event.nativeEvent.layout.width)}>
        <Animated.View
          style={[
            styles.visibleBodyMobileSlideWrap,
            {
              opacity: slideAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [0.72, 1],
              }),
              transform: [{ translateX }],
            },
          ]}>
          {activeBody ? renderBodySlide(activeBody, activeIndex, styles.visibleBodySingleSlide) : null}
        </Animated.View>

        {bodies.length > 1 ? (
          <>
            <Pressable
              style={[styles.visibleBodyCarouselButton, styles.visibleBodyCarouselButtonLeft, !canGoPrevious && styles.visibleBodyCarouselButtonDisabled]}
              onPress={() => scrollToIndex(activeIndex - 1)}
              disabled={!canGoPrevious}
              aria-label="Previous visible body">
              <Text style={styles.visibleBodyCarouselButtonText}>‹</Text>
            </Pressable>
            <Pressable
              style={[styles.visibleBodyCarouselButton, styles.visibleBodyCarouselButtonRight, !canGoNext && styles.visibleBodyCarouselButtonDisabled]}
              onPress={() => scrollToIndex(activeIndex + 1)}
              disabled={!canGoNext}
              aria-label="Next visible body">
              <Text style={styles.visibleBodyCarouselButtonText}>›</Text>
            </Pressable>
            <View style={styles.visibleBodyDots}>
              {bodies.map((body, index) => (
                <View
                  key={`${body.body}-dot-${index}`}
                  style={[styles.visibleBodyDot, index === activeIndex && styles.visibleBodyDotActive]}
                />
              ))}
            </View>
          </>
        ) : null}
      </View>
    );
  }

  return (
    <View
      style={styles.visibleBodyCarousel}
      onLayout={(event) => setSliderWidth(event.nativeEvent.layout.width)}>
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled={isMobile && slideWidth > 0}
        snapToInterval={!isMobile && snapInterval > 0 ? snapInterval : undefined}
        decelerationRate="fast"
        disableIntervalMomentum
        directionalLockEnabled
        showsHorizontalScrollIndicator={false}
        style={[styles.visibleBodySlider, isMobile && styles.visibleBodySliderMobile]}
        contentContainerStyle={[
          styles.visibleBodySliderContent,
          isMobile && styles.visibleBodySliderContentMobile,
        ]}
        onScrollBeginDrag={() => onInteractionChange?.(true)}
        onTouchStart={() => onInteractionChange?.(true)}
        onTouchEnd={() => onInteractionChange?.(false)}
        onTouchCancel={() => onInteractionChange?.(false)}
        onMomentumScrollEnd={(event) => {
          finishInteraction(event.nativeEvent.contentOffset.x);
        }}
        onScrollEndDrag={(event) => {
          if (isMobile) finishInteraction(event.nativeEvent.contentOffset.x);
        }}>
        {bodies.map((body, index) =>
          renderBodySlide(body, index, [
                slideWidth > 0 && { width: slideWidth },
                !isMobile && index < bodies.length - 1 && { marginRight: slideGap },
          ])
        )}
      </ScrollView>

      {bodies.length > 1 ? (
        <>
          <Pressable
            style={[styles.visibleBodyCarouselButton, styles.visibleBodyCarouselButtonLeft, !canGoPrevious && styles.visibleBodyCarouselButtonDisabled]}
            onPress={() => scrollToIndex(activeIndex - 1)}
            disabled={!canGoPrevious}
            aria-label="Previous visible body">
            <Text style={styles.visibleBodyCarouselButtonText}>‹</Text>
          </Pressable>
          <Pressable
            style={[styles.visibleBodyCarouselButton, styles.visibleBodyCarouselButtonRight, !canGoNext && styles.visibleBodyCarouselButtonDisabled]}
            onPress={() => scrollToIndex(activeIndex + 1)}
            disabled={!canGoNext}
            aria-label="Next visible body">
            <Text style={styles.visibleBodyCarouselButtonText}>›</Text>
          </Pressable>
          <View style={styles.visibleBodyDots}>
            {bodies.map((body, index) => (
              <View
                key={`${body.body}-dot-${index}`}
                style={[styles.visibleBodyDot, index === activeIndex && styles.visibleBodyDotActive]}
              />
            ))}
          </View>
        </>
      ) : null}
    </View>
  );
}

function VisibleBodyDescription({ bodies }: { bodies: VisibleBodyEventItem[] }) {
  return (
    <View style={styles.visibleBodyDescriptionList}>
      {bodies.map((body, index) => (
        <View key={`${body.body}-description-${index}`} style={styles.visibleBodyDescriptionRow}>
          <Text style={styles.visibleBodyDescriptionBullet}>{'\u2022'}</Text>
          <View style={styles.visibleBodyDescriptionTextWrap}>
            <Text style={styles.visibleBodyDescriptionBody}>{body.body}</Text>
            <Text style={styles.visibleBodyDescriptionMeta}>{formatVisibleBodyDescription(body)}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function MeteorVisibilityPanel({
  event,
  score,
  scoreInputs,
  scoreLoading,
  hasLocation,
}: {
  event: EventListItem;
  score: number | null;
  scoreInputs: ViewingScoreResponse['inputs'] | null;
  scoreLoading: boolean;
  hasLocation: boolean;
}) {
  const radiantAltitude = formatMeteorNumber(event.radiant_max_altitude_degrees, 0);
  const radiantDeclination = formatMeteorNumber(event.radiant_declination_degrees, 1);
  const sunAltitude = formatMeteorNumber(scoreInputs?.sun_altitude_deg, 1);
  const darknessFactor = formatMeteorNumber(scoreInputs?.darkness_factor, 2);
  const clouds = formatMeteorNumber(scoreInputs?.clouds_pct, 0);
  const visibilityKm = formatMeteorNumber(
    scoreInputs?.visibility_m == null ? null : Number(scoreInputs.visibility_m) / 1000,
    1
  );
  const lightPollution = formatMeteorNumber(scoreInputs?.light_pollution_level, 1);

  return (
    <View style={styles.meteorVisibilityPanel}>
      <Text style={styles.meteorVisibilityTitle}>Meteor shower data</Text>

      <View style={styles.meteorVisibilityGrid}>
        {hasLocation && radiantAltitude ? (
          <View style={styles.meteorVisibilityMetric}>
            <Text style={styles.meteorVisibilityValue}>{radiantAltitude} deg</Text>
            <Text style={styles.meteorVisibilityLabel}>max radiant altitude</Text>
          </View>
        ) : null}
        {radiantDeclination ? (
          <View style={styles.meteorVisibilityMetric}>
            <Text style={styles.meteorVisibilityValue}>{radiantDeclination} deg</Text>
            <Text style={styles.meteorVisibilityLabel}>radiant declination</Text>
          </View>
        ) : null}
        {event.zhr != null ? (
          <View style={styles.meteorVisibilityMetric}>
            <Text style={styles.meteorVisibilityValue}>{event.zhr}</Text>
            <Text style={styles.meteorVisibilityLabel}>max meteors/hour</Text>
          </View>
        ) : null}
        {score != null ? (
          <View style={styles.meteorVisibilityMetric}>
            <Text style={styles.meteorVisibilityValue}>{score}/100</Text>
            <Text style={styles.meteorVisibilityLabel}>current sky score</Text>
          </View>
        ) : null}
        {sunAltitude ? (
          <View style={styles.meteorVisibilityMetric}>
            <Text style={styles.meteorVisibilityValue}>{sunAltitude} deg</Text>
            <Text style={styles.meteorVisibilityLabel}>current sun altitude</Text>
          </View>
        ) : null}
        {darknessFactor ? (
          <View style={styles.meteorVisibilityMetric}>
            <Text style={styles.meteorVisibilityValue}>{darknessFactor}</Text>
            <Text style={styles.meteorVisibilityLabel}>current darkness factor</Text>
          </View>
        ) : null}
        {clouds ? (
          <View style={styles.meteorVisibilityMetric}>
            <Text style={styles.meteorVisibilityValue}>{clouds}%</Text>
            <Text style={styles.meteorVisibilityLabel}>current cloud cover</Text>
          </View>
        ) : null}
        {visibilityKm ? (
          <View style={styles.meteorVisibilityMetric}>
            <Text style={styles.meteorVisibilityValue}>{visibilityKm} km</Text>
            <Text style={styles.meteorVisibilityLabel}>current ground visibility</Text>
          </View>
        ) : null}
        {lightPollution ? (
          <View style={styles.meteorVisibilityMetric}>
            <Text style={styles.meteorVisibilityValue}>{lightPollution}</Text>
            <Text style={styles.meteorVisibilityLabel}>light pollution level</Text>
          </View>
        ) : null}
      </View>

      {!hasLocation ? (
        <Text style={styles.meteorSkyScoreText}>Location needed for max radiant altitude and current sky score.</Text>
      ) : scoreLoading ? (
        <View style={styles.meteorSkyScoreRow}>
          <OrbitalLoader label="Loading current sky data..." size={64} compact />
        </View>
      ) : null}
    </View>
  );
}

function getSavedEventNote(event: EventListItem): string {
  return 'event_comment' in event && typeof event.event_comment === 'string'
    ? event.event_comment
    : '';
}

function getEventSavedState(event: EventListItem): boolean {
  return event.user_event_id != null || Boolean(event.saved);
}

function getVisibleBodies(event: EventListItem): VisibleBodyEventItem[] {
  if (!Array.isArray(event.visible_bodies)) return [];

  return [...event.visible_bodies]
    .filter((body) => body.body)
    .sort((a, b) => (toFiniteNumber(b.altitude_degrees) ?? -Infinity) - (toFiniteNumber(a.altitude_degrees) ?? -Infinity));
}

function getSavedEventImages(event: EventListItem): SavedUserEventImage[] {
  return Array.isArray(event.user_event_images) ? event.user_event_images : [];
}

function toFiniteNumber(value: string | number | null | undefined) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isMeteorShowerEvent(event: EventListItem) {
  const text = `${event.type ?? ''} ${event.name ?? ''}`.toLowerCase();
  return text.includes('meteor') && text.includes('shower');
}

function isSpacewalkEvent(event: EventListItem) {
  const type = `${event.type ?? ''}`.toLowerCase();
  return type === 'eva' || type.includes('spacewalk');
}

function isNonViewingScoreEvent(event: EventListItem) {
  const text = `${event.type ?? ''} ${event.name ?? ''}`.toLowerCase();
  return (
    isSpacewalkEvent(event) ||
    isPressEvent(event) ||
    text.includes('docking') ||
    text.includes('undocking') ||
    text.includes('asteroid') ||
    text.includes('comet') ||
    text.includes('flyby') ||
    text.includes('near-earth') ||
    text.includes('close approach') ||
    text.includes('landing') ||
    text.includes('farewell') ||
    text.includes('hatch') ||
    text.includes('eva')
  );
}

function isPressEvent(event: EventListItem) {
  const text = `${event.type ?? ''} ${event.name ?? ''}`.toLowerCase();
  return (
    text.includes('press') ||
    text.includes('briefing') ||
    text.includes('media event') ||
    text.includes('news conference')
  );
}

function getVideoLinkText(event: EventListItem, index = 0) {
  if (index > 0) return `Open recording ${index + 1}`;

  if (event.video_url) {
    if (event.webcast_live) return 'Watch live';
    if (isSpacewalkEvent(event) || isPressEvent(event)) return 'Open recording';
    return 'Watch recording';
  }

  return 'Watch recording';
}

function getInfoLinkText(index = 0) {
  return index === 0 ? 'Open event info' : `Open event info ${index + 1}`;
}

function getShortLinkText(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function getEventUrls(...groups: Array<string[] | string | null | undefined>) {
  const output: string[] = [];
  const seen = new Set<string>();

  for (const group of groups) {
    const urls = Array.isArray(group) ? group : group ? [group] : [];
    for (const url of urls) {
      const value = String(url).trim();
      if (!value || seen.has(value)) continue;
      seen.add(value);
      output.push(value);
    }
  }

  return output;
}

function formatMeteorNumber(value: string | number | null | undefined, digits: number) {
  const number = toFiniteNumber(value);
  return number == null ? null : number.toFixed(digits);
}

function formatBodyMetric(value: string | number | null | undefined, digits: number) {
  const number = toFiniteNumber(value);
  return number == null ? null : number.toFixed(digits);
}

function formatVisibleBodyDescription(body: VisibleBodyEventItem) {
  const altitude = formatBodyMetric(body.altitude_degrees, 1);
  const azimuth = formatBodyMetric(body.azimuth_degrees, 1);
  const magnitude = formatBodyMetric(body.magnitude, 1);
  const distance = toFiniteNumber(body.distance_from_earth_km);
  const details = [
    altitude ? `alt ${altitude} deg` : null,
    azimuth ? `az ${azimuth} deg` : null,
    body.constellation ? `constellation ${body.constellation}` : null,
    magnitude ? `mag ${magnitude}` : null,
    distance == null ? null : `${Math.round(distance).toLocaleString('en-US')} km`,
  ].filter(Boolean);

  return details.join(', ') || 'visible above the horizon';
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
    overflow: 'hidden',
    overscrollBehavior: 'none',
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
  centerTablet: {
    padding: 18,
  },
  centerMobile: {
    padding: 8,
    paddingTop: 8,
  },
  card: {
    width: '100%',
    maxWidth: dvw(560),
    maxHeight: '90%',
  },
  cardTablet: {
    width: '88%' as any,
    maxWidth: 760,
    maxHeight: '94%' as any,
  },
  cardMobile: {
    maxWidth: '100%' as any,
    maxHeight: '96%' as any,
    height: '96%' as any,
    alignSelf: 'stretch',
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
  dialogSwipeSurface: {
    touchAction: 'pan-y',
  } as any,
  dialogMobile: {
    borderRadius: Radius.md,
  },
  dialogTablet: {
    borderRadius: Radius.lg,
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
  scrollContentTablet: {
    padding: 22,
    gap: 14,
  },
  scrollContentMobile: {
    padding: 14,
    paddingTop: 58,
    paddingBottom: 24,
    gap: 14,
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
  visibleBodyCarousel: {
    flex: 1,
    overflow: 'hidden',
  },
  visibleBodyMobileSlideWrap: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  visibleBodySlider: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  visibleBodySliderMobile: {
    scrollSnapType: 'x mandatory',
    overscrollBehaviorX: 'contain',
    touchAction: 'pan-x',
  } as any,
  visibleBodySliderContentMobile: {
    padding: 0,
    gap: 0,
  },
  visibleBodySliderContent: {
    height: '100%',
    alignItems: 'stretch',
    padding: 10,
  },
  visibleBodySlide: {
    width: 520,
    height: '100%',
    flexShrink: 0,
    position: 'relative',
    borderRadius: Radius.sm,
    overflow: 'hidden',
    backgroundColor: Palette.bgDeep,
    borderWidth: 1,
    borderColor: Palette.borderSoft,
    scrollSnapAlign: 'start',
    scrollSnapStop: 'always',
  } as any,
  visibleBodySlideMobile: {
    borderRadius: Radius.md,
  },
  visibleBodySingleSlide: {
    width: '100%',
    flex: 1,
    height: '100%',
  },
  heroMobile: {
    height: 190,
    borderRadius: Radius.md,
  },
  closeBtnMobile: {
    top: 10,
    right: 10,
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  visibleBodyImage: {
    width: '100%',
    height: '100%',
  },
  visibleBodyFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Palette.bgVoid,
  },
  visibleBodyFallbackText: {
    color: Palette.accent,
    fontSize: 54,
    fontWeight: '800',
  },
  visibleBodyScrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 52,
    backgroundColor: 'transparent',
  },
  visibleBodyOverlay: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 8,
    gap: 2,
  },
  visibleBodyName: {
    color: Palette.textPrimary,
    fontSize: 13,
    fontWeight: '800',
  },
  visibleBodyMeta: {
    color: Palette.textSecondary,
    fontSize: 10.5,
    lineHeight: 13,
  },
  visibleBodyCarouselButton: {
    position: 'absolute',
    top: '50%',
    width: 34,
    height: 44,
    marginTop: -22,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: alpha(Palette.bgVoid, 0.72),
    borderWidth: 1,
    borderColor: Palette.borderSoft,
  },
  heroTablet: {
    height: 260,
  },
  visibleBodyCarouselButtonLeft: {
    left: 14,
  },
  visibleBodyCarouselButtonRight: {
    right: 14,
  },
  visibleBodyCarouselButtonDisabled: {
    opacity: 0.28,
  },
  visibleBodyCarouselButtonText: {
    color: Palette.textPrimary,
    fontSize: 30,
    lineHeight: 32,
    fontWeight: '700',
  },
  visibleBodyDots: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  visibleBodyDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: alpha(Palette.textPrimary, 0.36),
  },
  visibleBodyDotActive: {
    width: 18,
    backgroundColor: Palette.accent,
  },
  badgeRow: {
    flexDirection: 'row',
  },
  badge: {
    maxWidth: '100%' as any,
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
  titleMobile: {
    fontSize: 20,
    lineHeight: 25,
  },
  date: {
    fontSize: 14,
    fontWeight: '600',
    color: Palette.accent,
  },
  dateMobile: {
    fontSize: 13,
    lineHeight: 17,
  },
  location: {
    fontSize: 13,
    color: Palette.textSecondary,
  },
  locationMobile: {
    fontSize: 13,
    lineHeight: 18,
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
  noteMobile: {
    fontSize: 13,
    lineHeight: 19,
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
  gaugeWrapMobile: {
    paddingVertical: 0,
  },
  meteorVisibilityPanel: {
    backgroundColor: Palette.bgDeep,
    borderWidth: 1,
    borderColor: Palette.borderSoft,
    borderRadius: Radius.md,
    padding: 12,
    gap: 10,
  },
  meteorVisibilityTitle: {
    color: Palette.textPrimary,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '800',
  },
  meteorVisibilityGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  meteorVisibilityMetric: {
    minWidth: 120,
    flex: 1,
    borderWidth: 1,
    borderColor: Palette.borderSoft,
    borderRadius: Radius.sm,
    backgroundColor: Palette.surfaceRaised,
    paddingVertical: 9,
    paddingHorizontal: 10,
    gap: 2,
  },
  meteorVisibilityValue: {
    color: Palette.accent,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '900',
  },
  meteorVisibilityLabel: {
    color: Palette.textSecondary,
    fontSize: 10.5,
    lineHeight: 14,
    fontWeight: '700',
    letterSpacing: 0,
  },
  meteorVisibilityNote: {
    color: Palette.textSecondary,
    fontSize: 12.5,
    lineHeight: 18,
  },
  meteorSkyScoreRow: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  meteorSkyScoreText: {
    color: Palette.textTertiary,
    fontSize: 12,
    lineHeight: 17,
  },
  description: {
    fontSize: 14,
    lineHeight: 21,
    color: Palette.textSecondary,
  },
  descriptionMobile: {
    fontSize: 14,
    lineHeight: 22,
  },
  visibleBodyDescriptionList: {
    gap: 10,
  },
  visibleBodyDescriptionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  visibleBodyDescriptionBullet: {
    color: Palette.accent,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '800',
  },
  visibleBodyDescriptionTextWrap: {
    flex: 1,
    gap: 2,
  },
  visibleBodyDescriptionBody: {
    color: Palette.textPrimary,
    fontSize: 13.5,
    lineHeight: 18,
    fontWeight: '800',
  },
  visibleBodyDescriptionMeta: {
    color: Palette.textSecondary,
    fontSize: 13,
    lineHeight: 19,
  },
  eventLinkActions: {
    gap: 10,
  },
  primaryLinkRow: {
    flexDirection: 'row',
    gap: 10,
  },
  primaryLinkRowMobile: {
    flexDirection: 'column',
  },
  primaryLinkButton: {
    flex: 1,
    minWidth: 0,
  },
  eventLinkButton: {
    borderRadius: Radius.md,
    paddingVertical: 11,
    paddingHorizontal: 14,
    minHeight: 58,
    justifyContent: 'center',
    gap: 2,
  },
  eventLinkButtonMobile: {
    minHeight: 54,
  },
  videoLinkButton: {
    backgroundColor: alpha(VIDEO_LINK_ACCENT, 0.12),
    borderWidth: 1,
    borderLeftWidth: 4,
    borderColor: alpha(VIDEO_LINK_ACCENT, 0.82),
    borderLeftColor: VIDEO_LINK_ACCENT,
    shadowColor: VIDEO_LINK_ACCENT,
    shadowOpacity: 0.3,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 7 },
  },
  infoLinkButton: {
    backgroundColor: Palette.surfaceRaised,
    borderWidth: 1,
    borderLeftWidth: 4,
    borderColor: alpha(INFO_LINK_ACCENT, 0.58),
    borderLeftColor: INFO_LINK_ACCENT,
    shadowColor: INFO_LINK_ACCENT,
    shadowOpacity: 0.26,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 7 },
  },
  eventLinkKicker: {
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '900',
    letterSpacing: 0,
    textTransform: 'uppercase',
  },
  videoLinkKicker: {
    color: VIDEO_LINK_ACCENT,
  },
  infoLinkKicker: {
    color: INFO_LINK_ACCENT,
  },
  eventLinkText: {
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 18,
  },
  videoLinkText: {
    color: Palette.textPrimary,
  },
  infoLinkText: {
    color: Palette.textPrimary,
  },
  otherLinks: {
    borderWidth: 1,
    borderColor: alpha(OTHER_LINK_ACCENT, 0.22),
    borderRadius: Radius.md,
    backgroundColor: alpha(OTHER_LINK_ACCENT, 0.025),
    overflow: 'hidden',
  },
  otherLinksTitle: {
    color: alpha(OTHER_LINK_ACCENT, 0.86),
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 6,
  },
  otherLinkRow: {
    minHeight: 42,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderTopWidth: 1,
    borderTopColor: alpha(OTHER_LINK_ACCENT, 0.14),
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  otherLinkLabel: {
    color: OTHER_LINK_TEXT,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '700',
    flex: 1,
    minWidth: 0,
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
  saveBtnMobile: {
    minHeight: 48,
    justifyContent: 'center',
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
  noteSectionMobile: {
    padding: 14,
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
  noteInputMobile: {
    minHeight: 112,
    fontSize: 14,
    lineHeight: 20,
  },
  noteActions: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  noteActionsMobile: {
    flexDirection: 'column',
  },
  noteButton: {
    minHeight: dvh(38),
    borderRadius: Radius.md,
    backgroundColor: Palette.accent,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noteButtonMobile: {
    width: '100%',
    minHeight: 44,
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
  savedImageTile: {
    width: 120,
    gap: 4,
  },
  savedImageOpenButton: {
    position: 'relative',
    width: 120,
    height: 120,
    borderRadius: Radius.sm,
    overflow: 'hidden',
    backgroundColor: Palette.bgDeep,
  },
  savedImageThumb: {
    width: '100%',
    height: '100%',
  },
  savedImageCaption: {
    fontSize: 11,
    color: Palette.textSecondary,
    lineHeight: 15,
  },
  stagedImagePreview: {
    width: '100%',
    height: 180,
    borderRadius: Radius.sm,
  },
  stagedImagePreviewMobile: {
    height: 170,
  },
  imagePickerActions: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  imageDeleteButton: {
    position: 'absolute',
    top: 7,
    right: 7,
    width: 32,
    height: 32,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: alpha(Palette.accentRed, 0.9),
    borderWidth: 1,
    borderColor: alpha(Palette.textPrimary, 0.3),
    opacity: 0,
    zIndex: 3,
    elevation: 3,
  },
  imageDeleteButtonVisible: {
    opacity: 1,
  },
  imageDeleteButtonBusy: {
    opacity: 0.65,
  },
  fullScreenImageRoot: {
    zIndex: 20,
  },
  fullScreenImageCard: {
    width: '100%',
    maxWidth: dvw(1100),
    height: '100%',
    maxHeight: '92%',
  },
  fullScreenImageCardMobile: {
    maxWidth: '100%' as any,
    maxHeight: '96%' as any,
  },
  fullScreenImageDialog: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  fullScreenImage: {
    width: '100%',
    flex: 1,
    minHeight: dvh(0),
  },
  fullScreenImageCaption: {
    color: Palette.textPrimary,
    backgroundColor: alpha(Palette.bgDeep, 0.78),
    borderRadius: Radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
});
