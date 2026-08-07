import sendRequest from './send-request';

const API_BASE = process.env.EXPO_PUBLIC_API_URL;
const MOON_PHASE_URL = `${API_BASE}/api/astronomy/moon-phase`;
const REQUEST_TIMEOUT_MS = 25000;
const SYNODIC_MONTH_DAYS = 29.530588853;
const KNOWN_NEW_MOON_UTC = Date.UTC(2000, 0, 6, 18, 14);

export type MoonPhaseResponse = {
  phase_date?: string | null;
  phase_string?: string | null;
  phase_fraction?: number | null;
  phase_percent?: number | null;
  phase_angle?: number | null;
  phase_trend?: string | null;
  age_days?: number | null;
  cached_at?: string | null;
  image_url?: string | null;
};

type MoonPhaseQuery = {
  latitude: number;
  longitude: number;
  date?: Date;
};

export async function fetchMoonPhase({ latitude, longitude, date = new Date() }: MoonPhaseQuery) {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    date: date.toISOString(),
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await sendRequest<null, MoonPhaseResponse>(
      `${MOON_PHASE_URL}?${params}`,
      'GET',
      null,
      { signal: controller.signal }
    );
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.log('Moon phase request timed out; using local estimate');
      return getApproxMoonPhase(date);
    }
    console.log('Moon phase API unavailable; using local estimate', error);
    return getApproxMoonPhase(date);
  } finally {
    clearTimeout(timeout);
  }
}

function getApproxMoonPhase(date: Date): MoonPhaseResponse {
  const daysSinceKnownNewMoon = (date.getTime() - KNOWN_NEW_MOON_UTC) / 86400000;
  const age = modulo(daysSinceKnownNewMoon, SYNODIC_MONTH_DAYS);
  const phasePercent = ((1 - Math.cos((2 * Math.PI * age) / SYNODIC_MONTH_DAYS)) / 2) * 100;

  return {
    phase_date: date.toISOString().slice(0, 10),
    phase_string: getMoonPhaseName(age),
    phase_fraction: phasePercent / 100,
    phase_percent: Math.round(phasePercent),
    phase_angle: Math.round((age / SYNODIC_MONTH_DAYS) * 360),
    phase_trend: getMoonTrend(age),
    age_days: age,
    cached_at: null,
    image_url: null,
  };
}

function getMoonTrend(age: number) {
  return age < SYNODIC_MONTH_DAYS / 2 ? 'Growing' : 'Shrinking';
}

function getMoonPhaseName(age: number) {
  if (age < 1.84) return 'New Moon';
  if (age < 5.53) return 'Waxing Crescent';
  if (age < 9.22) return 'First Quarter';
  if (age < 12.91) return 'Waxing Gibbous';
  if (age < 16.61) return 'Full Moon';
  if (age < 20.3) return 'Waning Gibbous';
  if (age < 23.99) return 'Third Quarter';
  if (age < 27.68) return 'Waning Crescent';
  return 'New Moon';
}

function modulo(value: number, divisor: number) {
  return ((value % divisor) + divisor) % divisor;
}
