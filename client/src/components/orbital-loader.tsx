import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  Platform,
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
const ORBIT_PROJECTION = 0.66;
const ORBIT_TILT = '-12deg';
const ORBIT_SAMPLE_COUNT = 32;
const ORBIT_TRACE_SEGMENTS = 88;

const PLANETS = [
  { name: 'mercury', orbit: 0.29, eccentricity: 0.2056, planet: 0.065, color: '#B9AFA5', duration: 2400, phase: 0.12, ring: false },
  { name: 'venus', orbit: 0.44, eccentricity: 0.0068, planet: 0.086, color: '#F2C94C', duration: 3800, phase: 0, ring: false },
  { name: 'earth', orbit: 0.6, eccentricity: 0.0167, planet: 0.084, color: '#2F80ED', duration: 5200, phase: 0.28, ring: false },
  { name: 'mars', orbit: 0.76, eccentricity: 0.0934, planet: 0.074, color: '#D94A38', duration: 7200, phase: 0.58, ring: false },
  { name: 'saturn', orbit: 0.94, eccentricity: 0.0565, planet: 0.1, color: '#D8B16A', duration: 11600, phase: 0.82, ring: true },
] as const;
const ORBIT_INPUT_RANGE = Array.from({ length: ORBIT_SAMPLE_COUNT * 2 + 1 }, (_, index) => index / ORBIT_SAMPLE_COUNT);
const ORBIT_UNIT_X = ORBIT_INPUT_RANGE.map((point) => Math.cos(point * Math.PI * 2));
const ORBIT_UNIT_Y = ORBIT_INPUT_RANGE.map((point) => Math.sin(point * Math.PI * 2));

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
          const orbitWidth = size * planet.orbit;
          const semiMajorAxis = orbitWidth / 2;
          const semiMinorAxis = semiMajorAxis * Math.sqrt(1 - planet.eccentricity ** 2) * ORBIT_PROJECTION;
          const orbitHeight = semiMinorAxis * 2;
          const focusOffsetX = semiMajorAxis * planet.eccentricity;
          const planetSize = size * planet.planet;
          const translateX = spins[index].interpolate({
            inputRange: ORBIT_INPUT_RANGE,
            outputRange: ORBIT_UNIT_X.map((point) => point * semiMajorAxis - focusOffsetX),
          });
          const translateY = spins[index].interpolate({
            inputRange: ORBIT_INPUT_RANGE,
            outputRange: ORBIT_UNIT_Y.map((point) => point * semiMinorAxis),
          });

          return (
            <View key={planet.name} style={styles.orbitPlane}>
              <OrbitTrace width={orbitWidth} height={orbitHeight} offsetX={focusOffsetX} />
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

function OrbitTrace({ width, height, offsetX }: { width: number; height: number; offsetX: number }) {
  const left = -width / 2 - offsetX;
  const top = -height / 2;

  if (Platform.OS === 'web') {
    return (
      <View pointerEvents="none" style={[styles.orbitTrace, { width, height, left, top }]}>
        {/*
          React Native Web can host raw SVG nodes; native gets the segmented
          fallback below because there is no react-native-svg dependency here.
        */}
        {React.createElement(
          'svg' as any,
          {
            width,
            height,
            viewBox: `0 0 ${width} ${height}`,
            style: styles.orbitSvg,
          },
          React.createElement('ellipse' as any, {
            cx: width / 2,
            cy: height / 2,
            rx: Math.max(width / 2 - 0.75, 0),
            ry: Math.max(height / 2 - 0.75, 0),
            fill: 'none',
            stroke: alpha(Palette.accentBlue, 0.26),
            strokeWidth: 1.25,
            vectorEffect: 'non-scaling-stroke',
          })
        )}
      </View>
    );
  }

  const radiusX = width / 2;
  const radiusY = height / 2;
  const dotSize = 1.15;

  return (
    <View pointerEvents="none" style={[styles.orbitTrace, { width, height, left, top }]}>
      {Array.from({ length: ORBIT_TRACE_SEGMENTS }, (_, index) => {
        const theta = (index / ORBIT_TRACE_SEGMENTS) * Math.PI * 2;
        const x = radiusX + Math.cos(theta) * radiusX;
        const y = radiusY + Math.sin(theta) * radiusY;

        return (
          <View
            key={index}
            style={[
              styles.orbitDot,
              {
                width: dotSize,
                height: dotSize,
                borderRadius: dotSize / 2,
                left: x - dotSize / 2,
                top: y - dotSize / 2,
              },
            ]}
          />
        );
      })}
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
    transform: [{ rotate: ORBIT_TILT }],
  },
  orbitTrace: {
    position: 'absolute',
  },
  orbitSvg: {
    display: 'block',
    overflow: 'visible',
  } as any,
  orbitDot: {
    position: 'absolute',
    backgroundColor: alpha(Palette.accentBlue, 0.28),
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
