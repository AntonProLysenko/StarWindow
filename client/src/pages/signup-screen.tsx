import { useState, useEffect, useRef } from 'react';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Dimensions,
  Image,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Audio } from 'expo-av';
import { ShootingStar } from '@/components/shooting-star';
import { Palette, Radius } from '@/constants/tokens';
import * as eventTypesAPI from '@/utilities/event-types-api';
import type { EventType } from '@/utilities/event-types-api';
import * as usersService from '@/utilities/users-service';
import { dvw, dvh } from '@/utilities/responsive-dimensions';

const getScreen = () => Dimensions.get('window');

const STARS = Array.from({ length: 150 }, (_, i) => ({
  top: (i * 23.7) % 100,
  left: (i * 41.3) % 100,
  size: (i % 4) + 0.5,
  opacity: (i % 6) * 0.08 + 0.15,
}));

export default function SignUpScreen() {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showEventTypes, setShowEventTypes] = useState(false);
  const [eventTypes, setEventTypes] = useState<EventType[]>([]);
  const [selectedEventTypeIds, setSelectedEventTypeIds] = useState<number[]>([]);
  const [isLoadingEventTypes, setIsLoadingEventTypes] = useState(false);
  const [isSavingEventTypes, setIsSavingEventTypes] = useState(false);
  const [screen, setScreen] = useState(getScreen());
  const signInGlow = useRef(new Animated.Value(0)).current;
  const newUserGlow = useRef(new Animated.Value(0)).current;
  const soundRef = useRef<Audio.Sound | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const isMutedRef = useRef(false);

  useEffect(() => {
    const sub = Dimensions.addEventListener('change', ({ window }) => {
      setScreen(window);
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    const loadSound = async () => {
      try {
        const { sound } = await Audio.Sound.createAsync(
          require('@/assets/sounds/space.mp3'),
          { shouldPlay: true, volume: isMutedRef.current ? 0 : 0.4, isLooping: true, isMuted: isMutedRef.current }
        );
        soundRef.current = sound;
      } catch (e) {
        console.log('Sound error:', e);
      }
    };
    loadSound();
    return () => {
      soundRef.current?.unloadAsync();
    };
  }, []);

  const isSmall = screen.width < 380;
  const isMedium = screen.width < 768;
  const isShort = screen.height < 740;
  const logoSize = isMedium ? (isShort ? 52 : isSmall ? 64 : 76) : 104;
  const titleSize = isMedium ? (isShort ? 28 : isSmall ? 31 : 34) : 38;
  const inputPad = isMedium ? 13 : isShort ? 8 : isSmall ? 10 : 12;
  const cardPad = isMedium ? 18 : isShort ? 12 : isSmall ? 14 : 18;
  const passwordMismatch = confirm.length > 0 && password !== confirm;

  const handleToggleSound = async () => {
    const next = !isMutedRef.current;
    isMutedRef.current = next;
    setIsMuted(next);

    try {
      await soundRef.current?.setStatusAsync({
        isMuted: next,
        volume: next ? 0 : 0.4,
      });
    } catch (e) {
      console.log('Sound toggle error:', e);
    }
  };

  const handleSignInPressIn = () => {
    Animated.timing(signInGlow, { toValue: 1, duration: 150, useNativeDriver: false }).start();
  };
  const handleSignInPressOut = () => {
    Animated.timing(signInGlow, { toValue: 0, duration: 300, useNativeDriver: false }).start();
  };
  const handleNewUserPressIn = () => {
    Animated.timing(newUserGlow, { toValue: 1, duration: 150, useNativeDriver: false }).start();
  };
  const handleNewUserPressOut = () => {
    Animated.timing(newUserGlow, { toValue: 0, duration: 300, useNativeDriver: false }).start();
  };

  const loadEventTypes = async () => {
    setIsLoadingEventTypes(true);
    try {
      setEventTypes(await eventTypesAPI.getEventTypes());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load event types.');
    } finally {
      setIsLoadingEventTypes(false);
    }
  };

  const handleSignUp = async () => {
    if (!firstName.trim() || !lastName.trim() || !email.trim() || !password) {
      setError('All fields are required.');
      return;
    }

    const passwordError = usersService.getPasswordValidationError(password);
    if (passwordError) {
      setError(passwordError);
      return;
    }

    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setError('');
    setIsSubmitting(true);

    try {
      await usersService.signUp({
        f_name: firstName.trim(),
        l_name: lastName.trim(),
        email: email.trim(),
        password,
      });
      
      setShowEventTypes(true);
      await loadEventTypes();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign Up Failed - Try Again');
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleEventType = (eventTypeId: number) => {
    setError('');
    setSelectedEventTypeIds((current) =>
      current.includes(eventTypeId)
        ? current.filter((id) => id !== eventTypeId)
        : [...current, eventTypeId]
    );
  };

  const handleSaveEventTypes = async () => {
    if (selectedEventTypeIds.length === 0) {
      setError('Select at least one event type.');
      return;
    }

    setError('');
    setIsSavingEventTypes(true);

    try {
      await usersService.saveEventTypes(selectedEventTypeIds);
      router.replace('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save event types.');
    } finally {
      setIsSavingEventTypes(false);
    }
  };

  const signInBorderColor = signInGlow.interpolate({
    inputRange: [0, 1],
    outputRange: [Palette.accent, Palette.textPrimary],
  });
  const newUserBorderColor = newUserGlow.interpolate({
    inputRange: [0, 1],
    outputRange: [Palette.accentMuted, Palette.accent],
  });

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.starField}>
        {STARS.map((star, i) => (
          <View key={i} style={{
            position: 'absolute',
            top: `${star.top}%` as any,
            left: `${star.left}%` as any,
            width: star.size,
            height: star.size,
            borderRadius: star.size,
            backgroundColor: Palette.textPrimary,
            opacity: star.opacity,
          }} />
        ))}
      </View>

      {[0, 800, 1600, 2400, 3200, 4000].map((delay, i) => (
        <ShootingStar key={i} delay={delay} />
      ))}

      <TouchableOpacity style={styles.soundButton} onPress={handleToggleSound} activeOpacity={0.8}>
        <SymbolView
          name={{
            ios: isMuted ? 'speaker.slash.fill' : 'speaker.wave.2.fill',
            android: isMuted ? 'volume_off' : 'volume_up',
            web: isMuted ? 'volume_off' : 'volume_up',
          }}
          size={18}
          tintColor={Palette.accent}
        />
      </TouchableOpacity>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.inner, isMedium && styles.innerMobile]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <View style={[styles.centerWrapper, isMedium && styles.centerWrapperMobile]}>
          <Image
            source={require('@/assets/images/logo_starwindow.png')}
            style={{
              width: logoSize,
              height: logoSize,
              marginBottom: 8,
            }}
            resizeMode="contain"
          />

          <Text style={[styles.appName, { fontSize: titleSize }]}>StarWindow</Text>
          <Text style={[styles.tagline, isMedium && styles.taglineMobile]}>Your personal guide to the night sky</Text>

          <View style={[styles.card, isMedium && styles.cardMobile, { padding: cardPad }]}>
            {showEventTypes ? (
              <>
                <Text style={styles.stepTitle}>Choose Event Types</Text>
                <Text style={styles.stepCopy}>Pick the space events that should shape your StarWindow feed.</Text>

                {isLoadingEventTypes ? (
                  <Text style={styles.loadingText}>Loading event types...</Text>
                ) : (
                  <View style={[styles.eventTypeList, isMedium && styles.eventTypeListMobile]}>
                    {eventTypes.map((eventType) => {
                      const selected = selectedEventTypeIds.includes(eventType.event_type_id);
                      return (
                        <TouchableOpacity
                          key={eventType.event_type_id}
                          onPress={() => toggleEventType(eventType.event_type_id)}
                          activeOpacity={0.8}
                          style={[styles.eventTypeOption, isMedium && styles.eventTypeOptionMobile, selected && styles.eventTypeOptionSelected]}
                        >
                          <Text style={[styles.eventTypeText, selected && styles.eventTypeTextSelected]}>
                            {eventType.event_type}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}

                {!!error && <Text style={styles.errorText}>{error}</Text>}

                <TouchableOpacity
                  onPress={handleSaveEventTypes}
                  onPressIn={handleSignInPressIn}
                  onPressOut={handleSignInPressOut}
                  activeOpacity={1}
                  disabled={isSavingEventTypes || isLoadingEventTypes}
                >
                  <Animated.View
                    style={[
                      styles.signInButton,
                      { borderColor: signInBorderColor },
                      (isSavingEventTypes || isLoadingEventTypes) && styles.disabledButton,
                    ]}
                  >
                    <Text style={[styles.signInText, isMedium && styles.signInTextMobile]}>
                      {isSavingEventTypes ? 'SAVING...' : 'CONTINUE'}
                    </Text>
                  </Animated.View>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <TextInput
                  style={[styles.input, isMedium && styles.inputMobile, { padding: inputPad }]}
                  placeholder="First Name"
                  placeholderTextColor={Palette.textTertiary}
                  value={firstName}
                  onChangeText={(value) => {
                    setFirstName(value);
                    setError('');
                  }}
                  autoCapitalize="words"
                />

                <TextInput
                  style={[styles.input, isMedium && styles.inputMobile, { padding: inputPad }]}
                  placeholder="Last Name"
                  placeholderTextColor={Palette.textTertiary}
                  value={lastName}
                  onChangeText={(value) => {
                    setLastName(value);
                    setError('');
                  }}
                  autoCapitalize="words"
                />

                <TextInput
                  style={[styles.input, isMedium && styles.inputMobile, { padding: inputPad }]}
                  placeholder="Email"
                  placeholderTextColor={Palette.textTertiary}
                  value={email}
                  onChangeText={(value) => {
                    setEmail(value);
                    setError('');
                  }}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                />

                <View style={styles.passwordInputWrap}>
                  <TextInput
                    style={[styles.passwordTextInput, isMedium && styles.inputMobile, { padding: inputPad }]}
                    placeholder="Password"
                    placeholderTextColor={Palette.textTertiary}
                    value={password}
                    onChangeText={(value) => {
                      setPassword(value);
                      setError('');
                    }}
                    secureTextEntry={!showPassword}
                  />
                  <TouchableOpacity
                    style={styles.passwordIconButton}
                    onPress={() => setShowPassword((visible) => !visible)}
                    activeOpacity={0.8}
                    accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}>
                    <SymbolView
                      name={{
                        ios: showPassword ? 'eye.slash.fill' : 'eye.fill',
                        android: showPassword ? 'visibility_off' : 'visibility',
                        web: showPassword ? 'visibility_off' : 'visibility',
                      }}
                      size={18}
                      tintColor={Palette.textTertiary}
                    />
                  </TouchableOpacity>
                </View>

                <View style={styles.passwordInputWrap}>
                  <TextInput
                    style={[styles.passwordTextInput, isMedium && styles.inputMobile, { padding: inputPad }]}
                    placeholder="Repeat Password"
                    placeholderTextColor={Palette.textTertiary}
                    value={confirm}
                    onChangeText={(value) => {
                      setConfirm(value);
                      setError('');
                    }}
                    secureTextEntry={!showConfirmPassword}
                  />
                  <TouchableOpacity
                    style={styles.passwordIconButton}
                    onPress={() => setShowConfirmPassword((visible) => !visible)}
                    activeOpacity={0.8}
                    accessibilityLabel={showConfirmPassword ? 'Hide repeat password' : 'Show repeat password'}>
                    <SymbolView
                      name={{
                        ios: showConfirmPassword ? 'eye.slash.fill' : 'eye.fill',
                        android: showConfirmPassword ? 'visibility_off' : 'visibility',
                        web: showConfirmPassword ? 'visibility_off' : 'visibility',
                      }}
                      size={18}
                      tintColor={Palette.textTertiary}
                    />
                  </TouchableOpacity>
                </View>

                <TouchableOpacity
                  onPress={handleSignUp}
                  onPressIn={handleSignInPressIn}
                  onPressOut={handleSignInPressOut}
                  activeOpacity={1}
                  disabled={isSubmitting || passwordMismatch}
                >
                  <Animated.View
                    style={[
                      styles.signInButton,
                      { borderColor: signInBorderColor },
                      (isSubmitting || passwordMismatch) && styles.disabledButton,
                    ]}
                  >
                    <Text style={[styles.signInText, isMedium && styles.signInTextMobile]}>{isSubmitting ? 'SIGNING UP...' : 'SIGN UP'}</Text>
                  </Animated.View>
                </TouchableOpacity>

                {!!(error || passwordMismatch) && (
                  <Text style={styles.errorText}>{passwordMismatch ? 'Passwords do not match.' : error}</Text>
                )}

                <View style={styles.divider}>
                  <View style={styles.dividerLine} />
                  <Text style={styles.dividerText}>Have an account?</Text>
                  <View style={styles.dividerLine} />
                </View>

                <TouchableOpacity
                  onPress={() => router.push('/login')}
                  onPressIn={handleNewUserPressIn}
                  onPressOut={handleNewUserPressOut}
                  activeOpacity={1}
                >
                  <Animated.View style={[styles.newUserButton, { borderColor: newUserBorderColor }]}>
                    <Text style={[styles.newUserText, isMedium && styles.newUserTextMobile]}>Log in</Text>
                  </Animated.View>
                </TouchableOpacity>
              </>
            )}
          </View>

          <Text style={styles.footer}>*   *   *</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Palette.bgVoid,
    overflow: 'hidden',
  },
  starField: {
    position: 'absolute',
    width: '100%',
    height: '100%',
  },
  soundButton: {
    position: 'absolute',
    top: 18,
    right: 18,
    zIndex: 10,
    borderWidth: 1,
    borderColor: Palette.borderSoft,
    borderRadius: Radius.sm,
    backgroundColor: Palette.bgDeep,
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    flex: 1,
    width: '100%',
  },
  inner: {
    flexGrow: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 20,
    overflow: 'hidden',
  },
  innerMobile: {
    justifyContent: 'flex-start',
    paddingTop: 52,
    paddingBottom: 28,
    paddingHorizontal: 18,
    overflow: 'visible',
  },
  centerWrapper: {
    width: '100%',
    maxWidth: dvw(420),
    maxHeight: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerWrapperMobile: {
    maxWidth: 440,
    justifyContent: 'flex-start',
  },
  appName: {
    fontWeight: '900',
    color: Palette.textPrimary,
    letterSpacing: 4,
    marginBottom: 4,
    textShadowColor: Palette.accent,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 14,
  },
  tagline: {
    fontSize: 10,
    color: Palette.textMuted,
    marginBottom: 10,
    letterSpacing: 1.5,
    textAlign: 'center',
  },
  taglineMobile: {
    fontSize: 11,
    lineHeight: 16,
    letterSpacing: 0.6,
    marginBottom: 14,
  },
  card: {
    width: '100%',
    backgroundColor: Palette.bgDeep,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Palette.borderSoft,
    shadowColor: Palette.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.1,
    shadowRadius: 24,
  },
  cardMobile: {
    borderRadius: Radius.md,
  },
  input: {
    backgroundColor: Palette.surface,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: Radius.sm,
    color: Palette.textSecondary,
    fontSize: 13,
    marginBottom: 8,
  },
  inputMobile: {
    minHeight: 47,
    fontSize: 15,
  },
  passwordInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Palette.surface,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: Radius.sm,
    marginBottom: 8,
  },
  passwordTextInput: {
    flex: 1,
    color: Palette.textSecondary,
    fontSize: 13,
    outlineStyle: 'none' as any,
  },
  passwordIconButton: {
    width: 42,
    minHeight: dvh(40),
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepTitle: {
    color: Palette.textPrimary,
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 8,
    textAlign: 'center',
  },
  stepCopy: {
    color: Palette.textMuted,
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 16,
    textAlign: 'center',
  },
  loadingText: {
    color: Palette.textMuted,
    fontSize: 12,
    marginBottom: 16,
    textAlign: 'center',
  },
  eventTypeList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 12,
  },
  eventTypeListMobile: {
    gap: 8,
  },
  eventTypeOption: {
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: Radius.sm,
    backgroundColor: Palette.surface,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginRight: 8,
    marginBottom: 8,
  },
  eventTypeOptionMobile: {
    flexGrow: 1,
    marginRight: 0,
    marginBottom: 0,
    alignItems: 'center',
  },
  eventTypeOptionSelected: {
    borderColor: Palette.accent,
    backgroundColor: Palette.surfaceRaised,
  },
  eventTypeText: {
    color: Palette.textMuted,
    fontSize: 12,
  },
  eventTypeTextSelected: {
    color: Palette.accent,
    fontWeight: '700',
  },
  signInButton: {
    backgroundColor: Palette.surfaceRaised,
    borderRadius: Radius.sm,
    padding: 10,
    alignItems: 'center',
    marginBottom: 10,
    borderWidth: 1,
    shadowColor: Palette.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
  },
  disabledButton: {
    opacity: 0.55,
  },
  signInText: {
    color: Palette.accent,
    fontSize: 13,
    fontWeight: 'bold',
    letterSpacing: 4,
  },
  signInTextMobile: {
    fontSize: 14,
    letterSpacing: 2,
  },
  errorText: {
    color: Palette.accentRed,
    fontSize: 11,
    marginBottom: 12,
    textAlign: 'center',
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  dividerLine: {
    flex: 1,
    height: dvh(1),
    backgroundColor: Palette.border,
  },
  dividerText: {
    color: Palette.textMuted,
    marginHorizontal: 10,
    fontSize: 10,
  },
  newUserButton: {
    borderRadius: Radius.sm,
    padding: 10,
    alignItems: 'center',
    borderWidth: 1,
    backgroundColor: 'transparent',
  },
  newUserText: {
    color: Palette.accentMuted,
    fontSize: 12,
    letterSpacing: 1,
  },
  newUserTextMobile: {
    fontSize: 13,
  },
  footer: {
    color: Palette.border,
    fontSize: 14,
    marginTop: 10,
    letterSpacing: 8,
  },
});




