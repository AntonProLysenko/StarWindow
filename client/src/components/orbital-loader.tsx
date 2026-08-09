import { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { Palette, alpha } from '@/constants/tokens';

type OrbitalLoaderProps = {
  label?: string;
  size?: number;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
};

const SUN_COLOR = '#FDB813';

const PLANETS = [
  { name: 'venus', orbit: 0.36, orbitY: 0.23, planet: 0.095, color: '#F2C94C', duration: 3200, phase: 0, ring: false },
  { name: 'earth', orbit: 0.56, orbitY: 0.36, planet: 0.09, color: '#2F80ED', duration: 4400, phase: 0.28, ring: false },
  { name: 'mars', orbit: 0.74, orbitY: 0.47, planet: 0.082, color: '#D94A38', duration: 5600, phase: 0.58, ring: false },
  { name: 'saturn', orbit: 0.92, orbitY: 0.58, planet: 0.105, color: '#D8B16A', duration: 7600, phase: 0.82, ring: true },
] as const;
const ORBIT_INPUT_RANGE = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1, 1.125, 1.25, 1.375, 1.5, 1.625, 1.75, 1.875, 2];
const ORBIT_UNIT_X = [1, 0.707, 0, -0.707, -1, -0.707, 0, 0.707, 1, 0.707, 0, -0.707, -1, -0.707, 0, 0.707, 1];
const ORBIT_UNIT_Y = [0, 0.707, 1, 0.707, 0, -0.707, -1, -0.707, 0, 0.707, 1, 0.707, 0, -0.707, -1, -0.707, 0];

export function OrbitalLoader({ label, size = 96, compact = false, style }: OrbitalLoaderProps) {
  const spinsRef = useRef(PLANETS.map(() => new Animated.Value(0)));
  const spins = spinsRef.current;
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let cancelled = false;

    spins.forEach((spin, index) => {
      const planet = PLANETS[index];

      const runOrbit = () => {
        if (cancelled) return;
        spin.setValue(planet.phase);
        Animated.timing(spin, {
          toValue: planet.phase + 1,
          duration: planet.duration,
          easing: Easing.linear,
          useNativeDriver: true,
        }).start(({ finished }) => {
          if (finished && !cancelled) runOrbit();
        });
      };

      runOrbit();
    });

    const runPulse = () => {
      if (cancelled) return;
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1400,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 1400,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (finished && !cancelled) runPulse();
      });
    };
    runPulse();

    return () => {
      cancelled = true;
      spins.forEach((spin) => spin.stopAnimation());
      pulse.stopAnimation();
    };
  }, [pulse, spins]);

  const sunSize = size * 0.18;
  const sunScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.12],
  });
  const sunOpacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.55, 0.95],
  });

  return (
    <View style={[styles.container, compact && styles.containerCompact, style]} accessibilityRole="progressbar">
      <View style={[styles.stage, { width: size, height: size }]}>
        {PLANETS.map((planet, index) => {
          const orbitSize = size * planet.orbit;
          const orbitHeight = size * planet.orbitY;
          const planetSize = size * planet.planet;
          const translateX = spins[index].interpolate({
            inputRange: ORBIT_INPUT_RANGE,
            outputRange: ORBIT_UNIT_X.map((point) => point * (orbitSize / 2)),
          });
          const translateY = spins[index].interpolate({
            inputRange: ORBIT_INPUT_RANGE,
            outputRange: ORBIT_UNIT_Y.map((point) => point * (orbitHeight / 2)),
          });

          return (
            <View key={planet.color} style={styles.orbitPlane}>
              <View
                style={[
                  styles.orbitRing,
                  {
                    width: orbitSize,
                    height: orbitHeight,
                    borderRadius: orbitSize / 2,
                    marginLeft: -orbitSize / 2,
                    marginTop: -orbitHeight / 2,
                  },
                ]}
              />
              <Animated.View
                style={[
                  styles.planetWrap,
                  {
                    width: planetSize,
                    height: planetSize,
                    borderRadius: planetSize / 2,
                    marginLeft: -planetSize / 2,
                    marginTop: -planetSize / 2,
                    transform: [
                      { translateX },
                      { translateY },
                    ],
                  },
                ]}>
                {planet.ring ? (
                  <View
                    style={[
                      styles.saturnRing,
                      {
                        width: planetSize * 2.05,
                        height: planetSize * 0.68,
                        borderRadius: planetSize,
                        left: -planetSize * 0.525,
                        top: planetSize * 0.16,
                        borderColor: alpha(planet.color, 0.78),
                      },
                    ]}
                  />
                ) : null}
                <View
                  style={[
                    styles.planet,
                    {
                      width: planetSize,
                      height: planetSize,
                      borderRadius: planetSize / 2,
                      backgroundColor: planet.color,
                      shadowColor: planet.color,
                    },
                  ]}
                />
              </Animated.View>
            </View>
          );
        })}

        <Animated.View
          style={[
            styles.sunGlow,
            {
              width: sunSize * 2.4,
              height: sunSize * 2.4,
              borderRadius: sunSize * 1.2,
              marginLeft: -sunSize * 1.2,
              marginTop: -sunSize * 1.2,
              opacity: sunOpacity,
              transform: [{ scale: sunScale }],
            },
          ]}
        />
        <View
          style={[
            styles.sun,
            {
              width: sunSize,
              height: sunSize,
              borderRadius: sunSize / 2,
              marginLeft: -sunSize / 2,
              marginTop: -sunSize / 2,
            },
          ]}
        />
      </View>
      {label ? <Text style={[styles.label, compact && styles.labelCompact]}>{label}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  containerCompact: {
    gap: 8,
  },
  stage: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  orbitPlane: {
    position: 'absolute',
    left: '50%' as any,
    top: '50%' as any,
    transform: [{ rotate: '-12deg' }],
  },
  orbitRing: {
    position: 'absolute',
    borderWidth: 1,
    borderColor: alpha(Palette.accentBlue, 0.24),
  },
  planetWrap: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  planet: {
    position: 'relative',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.75,
    shadowRadius: 8,
  },
  saturnRing: {
    position: 'absolute',
    borderWidth: 1.5,
    transform: [{ rotate: '-18deg' }],
    opacity: 0.95,
  },
  sunGlow: {
    position: 'absolute',
    left: '50%' as any,
    top: '50%' as any,
    backgroundColor: alpha(SUN_COLOR, 0.28),
  },
  sun: {
    position: 'absolute',
    left: '50%' as any,
    top: '50%' as any,
    backgroundColor: SUN_COLOR,
    shadowColor: SUN_COLOR,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 14,
  },
  label: {
    color: Palette.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
    textAlign: 'center',
  },
  labelCompact: {
    fontSize: 12,
    lineHeight: 16,
  },
});
