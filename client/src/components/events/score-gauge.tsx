// A static (non-map) viewing-score gauge for the event modal. Reuses the exact
// arc SVG from the map (gaugeSvgMarkup) rendered as a data-URI <Image>, with the
// number drawn as real text on top — so the score is legible even if the SVG
// image fails to decode.

import { Image, StyleSheet, Text, View } from 'react-native';

import { Palette } from '@/constants/tokens';
import { gaugeSvgMarkup, scoreColor } from '@/components/star-map/gauge-svg';
import { dvw, dvh } from '@/utilities/responsive-dimensions';

/** Encode SVG as a data URI. Base64 is the most broadly-supported form (the
 *  `;utf8,` shorthand is rejected by several browsers and renders blank). */
function svgToDataUri(svg: string): string {
  if (typeof btoa === 'function') return `data:image/svg+xml;base64,${btoa(svg)}`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function ScoreGauge({ score, label = 'VIEWING SCORE' }: { score: number; label?: string }) {
  const s = Math.max(0, Math.min(100, Math.round(score)));
  const uri = svgToDataUri(gaugeSvgMarkup(s, false, 'wide')); // arc only; number rendered below
  const color = scoreColor(s);

  return (
    <View style={styles.wrap} accessibilityRole="image" aria-label={`Viewing score ${s} out of 100`}>
      <View style={styles.arcBox}>
        <Image source={{ uri }} style={styles.gauge} resizeMode="contain" />
        <Text style={[styles.number, { color }]}>{s}</Text>
      </View>
      <Text style={[styles.label, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    backgroundColor: Palette.bgDeep,
    borderWidth: 1,
    borderColor: Palette.borderSoft,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 20,
    gap: 4,
  },
  arcBox: {
    width: dvw(188),
    height: dvh(92),
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  gauge: {
    position: 'absolute',
    top: 2,
    width: dvw(188),
    height: dvh(78),
  },
  number: {
    minWidth: 76,
    textAlign: 'center',
    fontSize: 32,
    lineHeight: 38,
    fontWeight: '800',
    marginBottom: 2,
  },
  label: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
});
