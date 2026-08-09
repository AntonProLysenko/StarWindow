// Pure SVG rendering for the viewing-score gauge (semicircle, 0-100, color-tiered).
//
// Extracted from viewing-score-gauge.web.tsx so it can be reused off the map
// without importing leaflet/react-leaflet.

import { Palette } from '@/constants/tokens';

const POOR = Palette.accentRed;
const MODERATE = Palette.accentAmber;
const GREAT = Palette.accentGreen;

export function scoreColor(score: number): string {
  if (score <= 40) return POOR;
  if (score <= 70) return MODERATE;
  return GREAT;
}

const DEFAULT_GEOMETRY = {
  cx: 25,
  cy: 26,
  r: 21,
  stroke: 6,
  width: 50,
  height: 30,
  textY: 24,
  textSize: 13,
};

const WIDE_GEOMETRY = {
  cx: 50,
  cy: 37,
  r: 34,
  stroke: 6,
  width: 100,
  height: 42,
  textY: 34,
  textSize: 15,
};

type GaugeGeometry = typeof DEFAULT_GEOMETRY;

function polar(angleDeg: number, geometry: GaugeGeometry): [number, number] {
  const a = (angleDeg * Math.PI) / 180;
  return [
    geometry.cx + geometry.r * Math.cos(a),
    geometry.cy - geometry.r * Math.sin(a),
  ];
}

function arcPath(startAngle: number, endAngle: number, geometry: GaugeGeometry): string {
  const [x1, y1] = polar(startAngle, geometry);
  const [x2, y2] = polar(endAngle, geometry);
  const largeArc = Math.abs(startAngle - endAngle) > 180 ? 1 : 0;
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${geometry.r} ${geometry.r} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

export function gaugeSvgMarkup(
  score: number,
  includeText = true,
  variant: 'compact' | 'wide' = 'compact'
): string {
  const s = Math.max(0, Math.min(100, Math.round(score)));
  const color = scoreColor(s);
  const geometry = variant === 'wide' ? WIDE_GEOMETRY : DEFAULT_GEOMETRY;
  const endAngle = 180 - 1.8 * s;
  const track = arcPath(180, 0, geometry);
  const progress = s > 0 ? arcPath(180, endAngle, geometry) : '';
  const text = includeText
    ? `<text x="${geometry.cx}" y="${geometry.textY}" text-anchor="middle" font-family="sans-serif" font-size="${geometry.textSize}" font-weight="700" fill="${color}">${s}</text>`
    : '';

  return `<svg width="${geometry.width}" height="${geometry.height}" viewBox="0 0 ${geometry.width} ${geometry.height}" xmlns="http://www.w3.org/2000/svg">
    <path d="${track}" fill="none" stroke="rgba(255,255,255,0.16)" stroke-width="${geometry.stroke}" stroke-linecap="round" />
    ${progress ? `<path d="${progress}" fill="none" stroke="${color}" stroke-width="${geometry.stroke}" stroke-linecap="round" />` : ''}
    ${text}
  </svg>`;
}
