import sendRequest from './send-request';

const API_BASE = process.env.EXPO_PUBLIC_API_URL;
const SCORE_URL = `${API_BASE}/api/score`;

export type ViewingScoreWeather = {
  conditions?: string | null;
  clouds_pct?: number | null;
  visibility_m?: number | null;
};

export type ViewingScoreResponse = {
  viewing_score: number | null;
  inputs?: {
    clouds_pct?: number | null;
    visibility_m?: number | null;
    light_pollution_level?: number | null;
    sun_altitude_deg?: number | null;
    darkness_factor?: number | null;
  };
  weather?: ViewingScoreWeather | null;
};

export async function fetchViewingScore({
  latitude,
  longitude,
  lightPollutionLevel,
}: {
  latitude: number;
  longitude: number;
  /** Optional override; omitted, the server reads the real VIIRS level. */
  lightPollutionLevel?: number;
}) {
  const params = new URLSearchParams({
    lat: String(latitude),
    lon: String(longitude),
  });
  if (lightPollutionLevel != null) {
    params.set('light_pollution', String(lightPollutionLevel));
  }

  return sendRequest<null, ViewingScoreResponse>(`${SCORE_URL}?${params}`);
}
