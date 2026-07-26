import type { RocketLaunch } from '@/components/star-map';

// Base URL of our Express server. Set per-environment with EXPO_PUBLIC_API_URL.
const API_BASE = process.env.EXPO_PUBLIC_API_URL;

/** Moon render + phase for a given instant, from GET /api/astronomy/moon. */
export interface MoonView {
  datetime: string;
  /** URL of NASA's rendered Moon image, or null if unavailable. */
  image_url: string | null;
  /** Percent illuminated (0–100). */
  phase: number | null;
  /** Days since the new moon (0–29.53). */
  age: number | null;
}

/**
 * Fetch the current (or a given instant's) Moon view via our backend proxy of
 * NASA's Dial-a-Moon. Proxied server-side so it isn't blocked by browser CORS.
 */
export async function fetchMoonView(datetime?: string): Promise<MoonView> {
  const qs = datetime ? `?datetime=${encodeURIComponent(datetime)}` : '';
  const res = await fetch(`${API_BASE}/api/astronomy/moon${qs}`);
  if (!res.ok) throw new Error(`Moon request failed: ${res.status}`);
  return res.json();
}

/** Raw shape of one launch as returned by GET /api/astronomy/launches. */
interface RawLaunch {
  id?: string | number;
  launch_id?: string | number;
  event_id?: string | number | null;
  name?: string;
  status?: string;
  net?: string;
  net_precision?: string | null;
  date_precision?: string | null;
  provider?: string;
  rocket?: string;
  image?: string | null;
  image_url?: string | null;
  mission?: {
    name?: string | null;
    type?: string | null;
    description?: string | null;
  } | null;
  pad?: {
    name?: string;
    location?: string;
    latitude?: string | number | null;
    longitude?: string | number | null;
  } | null;
}

function normalizeLaunchKey(value?: string | null) {
  return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function getLaunchKey(launch: RawLaunch) {
  return [
    normalizeLaunchKey(launch.name),
    normalizeLaunchKey(launch.net),
    normalizeLaunchKey(launch.rocket),
    normalizeLaunchKey(launch.provider),
  ].join('|');
}

function sortByNet(left: NonNullable<RocketLaunch['upcoming']>[number], right: NonNullable<RocketLaunch['upcoming']>[number]) {
  const leftTime = left.net ? new Date(left.net).getTime() : Infinity;
  const rightTime = right.net ? new Date(right.net).getTime() : Infinity;
  return leftTime - rightTime;
}

/**
 * Fetches upcoming launches from our server and normalizes them into one
 * `RocketLaunch` per pad (so multiple launches at the same pad share a marker).
 * Entries without usable pad coordinates are dropped.
 */
export async function fetchLaunches(limit = 20): Promise<RocketLaunch[]> {
  const res = await fetch(`${API_BASE}/api/launches?limit=${limit}`);
  if (!res.ok) throw new Error(`Launches request failed: ${res.status}`);

  const data: { results?: RawLaunch[] } = await res.json();
  const byPad = new Map<string, RocketLaunch>();
  const seenByPad = new Map<string, Set<string>>();

  for (const l of data.results ?? []) {
    const lat = Number(l.pad?.latitude);
    const lng = Number(l.pad?.longitude);
    if (!l.pad || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const padName = l.pad.name ?? 'Launch pad';
    const id = `${padName}@${lat.toFixed(4)},${lng.toFixed(4)}`;

    let site = byPad.get(id);
    if (!site) {
      site = { id, name: padName, lat, lng, location: l.pad.location, upcoming: [] };
      byPad.set(id, site);
      seenByPad.set(id, new Set());
    }

    const launchKey = getLaunchKey(l);
    const seenLaunches = seenByPad.get(id);
    if (seenLaunches?.has(launchKey)) continue;
    seenLaunches?.add(launchKey);

    site.upcoming!.push({
      id: l.launch_id ?? l.id,
      eventId: l.event_id ?? null,
      name: l.name ?? 'Launch',
      net: l.net,
      netPrecision: l.net_precision ?? l.date_precision ?? null,
      status: l.status,
      provider: l.provider,
      rocket: l.rocket,
      imageUrl: l.image ?? l.image_url ?? undefined,
      missionName: l.mission?.name ?? null,
      missionType: l.mission?.type ?? null,
      missionDescription: l.mission?.description ?? null,
    });
  }

  return [...byPad.values()]
    .map((site) => ({
      ...site,
      upcoming: [...(site.upcoming ?? [])].sort(sortByNet).slice(0, 1),
    }))
    .filter((site) => (site.upcoming?.length ?? 0) > 0);
}
