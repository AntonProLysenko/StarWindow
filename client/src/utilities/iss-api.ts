import sendRequest from './send-request';

const API_BASE = process.env.EXPO_PUBLIC_API_URL;
const ISS_URL = `${API_BASE}/api/iss`;
const REQUEST_TIMEOUT_MS = 15000;

export type IssPassPoint = {
  time?: string | null;
  direction?: string | null;
};

export type IssPass = {
  rise?: IssPassPoint | null;
  peak?: (IssPassPoint & { elevation_deg?: number | null }) | null;
  set?: IssPassPoint | null;
  duration_sec?: number | null;
  visible_duration_sec?: number | null;
  visible?: boolean | null;
};

export type IssPassesResponse = {
  observer?: {
    lat?: number;
    lon?: number;
  };
  tle_epoch?: string | null;
  generated_at?: string | null;
  passes?: IssPass[];
};

export async function fetchIssPasses({
  latitude,
  longitude,
  count = 1,
  daysAhead = 5,
}: {
  latitude: number;
  longitude: number;
  count?: number;
  daysAhead?: number;
}) {
  const params = new URLSearchParams({
    lat: String(latitude),
    lon: String(longitude),
    n: String(count),
    days_ahead: String(daysAhead),
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await sendRequest<null, IssPassesResponse>(
      `${ISS_URL}?${params}`,
      'GET',
      null,
      { signal: controller.signal }
    );
  } finally {
    clearTimeout(timeout);
  }
}
