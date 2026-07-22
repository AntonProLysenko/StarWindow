// Pure SVG rendering for the viewing-score gauge (semicircle, 0–100, color-tiered).
//
// Extracted from viewing-score-gauge.web.tsx so it can be reused OFF the map
// (e.g. in the event detail modal) WITHOUT importing leaflet/react-leaflet. This
// module has zero dependencies — just string math — so it's safe on any platform.

// --- Color tiers ------------------------------------------------------------
// 0–40 poor (red) · 41–70 moderate (amber) · 71–100 great (green).
import { Palette } from '@/constants/tokens';

const POOR = Palette.accentRed;
const MODERATE = Palette.accentAmber;
const GREAT = Palette.accentGreen;

export function scoreColor(score: number): string {
  if (score <= 40) return POOR;
  if (score <= 70) return MODERATE;
  return GREAT;
}

// --- Arc geometry -----------------------------------------------------------
// Semicircle bulging upward: 180° = left, 90° = top, 0° = right.
// Screen space is y-down, so y = cy − r·sin(θ).
const CX = 25;
const CY = 26;
const R = 21;
const STROKE = 6;
const SVG_W = 50;
const SVG_H = 30;

function polar(angleDeg: number): [number, number] {
  const a = (angleDeg * Math.PI) / 180;
  return [CX + R * Math.cos(a), CY - R * Math.sin(a)];
}

/** SVG arc `d` from `startAngle` to `endAngle` along the top of the circle. */
function arcPath(startAngle: number, endAngle: number): string {
  const [x1, y1] = polar(startAngle);
  const [x2, y2] = polar(endAngle);
  const largeArc = Math.abs(startAngle - endAngle) > 180 ? 1 : 0;
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${R} ${R} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

/**
 * Pure SVG markup for the gauge at a given score. Progress fills the arc
 * proportionally (100 → full semicircle, 50 → half).
 * @param score 0–100
 * @param includeText whether to draw the number inside the arc (default true).
 *   The map gauge keeps it; the modal renders the number as real text instead
 *   and passes false, so the score is never lost if the SVG image fails to load.
 */
export function gaugeSvgMarkup(score: number, includeText = true): string {
  const s = Math.max(0, Math.min(100, Math.round(score)));
  const color = scoreColor(s);
  const endAngle = 180 - 1.8 * s; // 0→180 (empty) … 100→0 (full)
  const track = arcPath(180, 0);
  const progress = s > 0 ? arcPath(180, endAngle) : '';
  const text = includeText
    ? `<text x="${CX}" y="24" text-anchor="middle" font-family="sans-serif" font-size="13" font-weight="700" fill="${color}">${s}</text>`
    : '';

  return `<svg width="${SVG_W}" height="${SVG_H}" viewBox="0 0 ${SVG_W} ${SVG_H}" xmlns="http://www.w3.org/2000/svg">
    <path d="${track}" fill="none" stroke="rgba(255,255,255,0.16)" stroke-width="${STROKE}" stroke-linecap="round" />
    ${progress ? `<path d="${progress}" fill="none" stroke="${color}" stroke-width="${STROKE}" stroke-linecap="round" />` : ''}
    ${text}
  </svg>`;
}
