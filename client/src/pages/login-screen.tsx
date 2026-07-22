import { useState, useEffect, useRef } from 'react';
import { router } from 'expo-router';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Dimensions,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ShootingStar } from '@/components/shooting-star';
import { SoundToggle } from '@/components/sound-toggle';
import { Palette, Radius } from '@/constants/tokens';
import * as ambientSound from '@/utilities/ambient-sound-service';
import * as usersService from '@/utilities/users-service';
import { dvw, dvh } from '@/utilities/responsive-dimensions';

const getScreen = () => Dimensions.get('window');

const STARS = Array.from({ length: 150 }, (_, i) => ({
  top: (i * 23.7) % 100,
  left: (i * 41.3) % 100,
  size: (i % 4) + 0.5,
  opacity: (i % 6) * 0.08 + 0.15,
}));

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [screen, setScreen] = useState(getScreen());
  const signInGlow = useRef(new Animated.Value(0)).current;
  const newUserGlow = useRef(new Animated.Value(0)).current;

  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (usersService.getUser()) router.replace('/dashboard');
  }, []);

  useEffect(() => {
    ambientSound.ensureAmbientSound();
  }, []);

  useEffect(() => {
    const sub = Dimensions.addEventListener('change', ({ window }) => {
      setScreen(window);
    });
    return () => sub.remove();
  }, []);

  const isSmall = screen.width < 380;
  const isMedium = screen.width < 768;
  const isShort = screen.height < 740;
  const logoSize = isShort ? 120 : isSmall ? 120 : isMedium ? 140 : 165;
  const titleSize = isShort ? 50 : isSmall ? 52 : isMedium ? 52 : 58;
  const inputPad = isShort ? 8 : isSmall ? 10 : 12;
  const cardPad = isShort ? 12 : isSmall ? 14 : 18;

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



  const handleLogin = async () => {
    if (!email.trim() || !password) {
      setError('Email and password are required.');
      return;
    }

    setError('');
    setIsSubmitting(true);

    try {
      await usersService.login({ email: email.trim(), password });
      router.replace('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Log In Failed - Try Again');
    } finally {
      setIsSubmitting(false);
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

      <SoundToggle floating />

      <View style={styles.inner}>
        <View style={styles.centerWrapper}>
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
          <Text style={styles.tagline}>Your personal guide to the night sky</Text>

          <View style={[styles.card, { padding: cardPad }]}>
            
            <TextInput
              style={[styles.input, { padding: inputPad }]}
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

            <TextInput
              style={[styles.input, { padding: inputPad }]}
              placeholder="Password"
              placeholderTextColor={Palette.textTertiary}
              value={password}
              onChangeText={(value) => {
                setPassword(value);
                setError('');
              }}
              secureTextEntry
            />

            <TouchableOpacity style={styles.forgotRow}>
              <Text style={styles.forgot}>Forgot Password?</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleLogin}
              onPressIn={handleSignInPressIn}
              onPressOut={handleSignInPressOut}
              activeOpacity={1}
              disabled={isSubmitting}
            >
              <Animated.View
                style={[
                  styles.signInButton,
                  { borderColor: signInBorderColor },
                  isSubmitting && styles.disabledButton,
                ]}
              >
                <Text style={styles.signInText}>{isSubmitting ? 'SIGNING IN...' : 'SIGN IN'}</Text>
              </Animated.View>
            </TouchableOpacity>

            {!!error && <Text style={styles.errorText}>{error}</Text>}

            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>or</Text>
              <View style={styles.dividerLine} />
            </View>

            <TouchableOpacity
              onPress={() => router.push('/signup')}
              onPressIn={handleNewUserPressIn}
              onPressOut={handleNewUserPressOut}
              activeOpacity={1}
            >
              <Animated.View style={[styles.newUserButton, { borderColor: newUserBorderColor }]}>
                <Text style={styles.newUserText}>Create New Account</Text>
              </Animated.View>
            </TouchableOpacity>
          </View>

          <Text style={styles.footer}>*   *   *</Text>
        </View>
      </View>
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
  inner: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 20,
    overflow: 'hidden',
  },
  centerWrapper: {
    width: '100%',
    maxWidth: dvw(420),
    maxHeight: '100%',
    alignItems: 'center',
    justifyContent: 'center',
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
    fontSize: 13,
    color: Palette.textMuted,
    marginBottom: 10,
    letterSpacing: 1.5,
    textAlign: 'center',
  },
  card: {
    width: '120%',
    backgroundColor: Palette.bgDeep,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Palette.borderSoft,
    shadowColor: Palette.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.1,
    shadowRadius: 24,
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
  forgotRow: {
    alignSelf: 'flex-end',
    marginBottom: 10,
  },
  forgot: {
    color: Palette.accent,
    fontSize: 10,
    opacity: 0.6,
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
  footer: {
    color: Palette.border,
    fontSize: 14,
    marginTop: 10,
    letterSpacing: 8,
  },
});




