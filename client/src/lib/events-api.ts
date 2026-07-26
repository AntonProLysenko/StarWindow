// Client for the unified events list endpoint (GET /api/events/list).

import sendRequest from '@/utilities/send-request';

const API_BASE = process.env.EXPO_PUBLIC_API_URL;

/** Whether an item is a generic space event or a rocket launch. */
export type EventCategory = 'event' | 'launch';

/** Launch-only detail fields (present when category === "launch"). */
export interface LaunchDetails {
  rocket_model: string | null;
  provider: string | null;
  mission_name: string | null;
  mission_type: string | null;
  pad_name: string | null;
  pad_location: string | null;
  status: string | null;
}

export interface VisibleBodyEventItem {
  body: string;
  altitude_degrees?: string | number | null;
  azimuth_degrees?: string | number | null;
  distance_from_earth_km?: string | number | null;
  constellation?: string | null;
  magnitude?: string | number | null;
  image_url?: string | null;
  image_source?: string | null;
}

/**
 * One row in the unified events list. Space events and rocket launches are
 * merged into this single normalized shape by the backend.
 */
export interface EventListItem {
  /** Display id: event_id for events, launch_id for launches. Unique within category. */
  id: number | string;
  /**
   * The underlying events.event_id — the FK used when saving to user_events.
   * For launches this differs from `id` (which is the launch_id).
   */
  event_id: number | string;
  category: EventCategory;
  name: string;
  /** event_type name, or "Rocket Launch" for launches. Used for the type filter. */
  type: string;
  /** ISO timestamp (start_time / launch NET). May be approximate — see date_precision. */
  date: string | null;
  /** LL2 precision name: "Year" | "Month" | "Day" | "Hour" | "Minute" | ... */
  date_precision: string | null;
  description: string | null;
  image_url: string | null;
  /** Human-readable place name, if known. */
  location: string | null;
  /** Event coordinates when known (launch pads); null for name-only events. */
  latitude: number | null;
  longitude: number | null;
  webcast_live: boolean;
  video_url: string | null;
  launch_details: LaunchDetails | null;
  visible_bodies?: VisibleBodyEventItem[];
  radiant?: string | null;
  radiant_declination_degrees?: number | string | null;
  zhr?: number | string | null;
  active_start?: string | null;
  active_end?: string | null;
  peak_date?: string | null;
  best_time?: string | null;
  moon_age_days?: number | string | null;
  radiant_max_altitude_degrees?: number | string | null;
  user_event_images?: SavedUserEventImage[];
}

export interface SavedUserEvent extends EventListItem {
  user_event_id: string;
  event_comment: string | null;
  event_rating: number | null;
  user_event_images?: SavedUserEventImage[];
}

export interface SavedUserEventImage {
  user_event_image_id: string;
  image_url: string;
  caption: string | null;
  created_at: string;
}

export interface UserPointAward {
  awarded: boolean;
  reversed?: boolean;
  points_awarded: number;
  points_reversed?: number;
  total_points: number;
  status_id: number | null;
  status: string | null;
  next_level_points: number | null;
  points_to_next_level: number;
}

export interface ImgbbDeletionSummary {
  attempted: number;
  deleted: number;
  skipped: number;
  failed: number;
}

export interface SaveUserEventResponse {
  user_event_id: string;
  already_saved: boolean;
  progress: UserPointAward | null;
}

export interface UpdateSavedEventResponse {
  user_event_id: string;
  user_id: number;
  event_id: number | string;
  event_comment: string | null;
  event_rating: number | null;
  awards: UserPointAward[];
  reversals?: UserPointAward[];
}

export interface UserEventImage {
  user_event_image_id: string;
  user_event_id: string;
  image_url: string;
  caption: string | null;
  created_at: string;
  progress: UserPointAward | null;
}

export interface DeleteUserEventResponse {
  deleted: boolean;
  user_event_id: string;
  reversals: UserPointAward[];
  imgbb_deletions?: ImgbbDeletionSummary;
}

export interface DeleteUserEventImageResponse {
  deleted: boolean;
  user_event_image_id: string;
  progress: UserPointAward | null;
  imgbb_deleted?: boolean | null;
}

export interface ViewingScoreResponse {
  viewing_score: number;
  inputs: {
    clouds_pct: number;
    visibility_m: number;
    light_pollution_level: number;
    sun_altitude_deg?: number;
    darkness_factor?: number;
  };
  weather: unknown;
}

/** Fetch a 0–100 viewing score for a coordinate (GET /api/score). */
export async function fetchViewingScore(
  lat: number,
  lon: number,
  signal?: AbortSignal
): Promise<ViewingScoreResponse> {
  const params = new URLSearchParams({ lat: String(lat), lon: String(lon) });
  const res = await fetch(`${API_BASE}/api/score?${params}`, { signal });
  if (!res.ok) throw new Error(`score request failed: ${res.status}`);
  return res.json();
}

/** Whether a user has already saved an event (GET /api/user-events). */
export async function checkEventSaved(
  eventId: number | string,
  signal?: AbortSignal
): Promise<{
  saved: boolean;
  user_event_id: string | null;
  event_comment: string | null;
  event_rating: number | null;
  user_event_images: SavedUserEventImage[];
}> {
  const params = new URLSearchParams({ event_id: String(eventId) });
  return sendRequest<null, {
    saved: boolean;
    user_event_id: string | null;
    event_comment: string | null;
    event_rating: number | null;
    user_event_images: SavedUserEventImage[];
  }>(`${API_BASE}/api/user-events?${params}`, 'GET', null, { signal });
}

/** Save an event for a user (POST /api/user-events). Idempotent server-side. */
export async function saveUserEvent(eventId: number | string): Promise<SaveUserEventResponse> {
  return sendRequest(
    `${API_BASE}/api/user-events`,
    'POST',
    { event_id: eventId }
  );
}

/** Unsave a previously-saved event (DELETE /api/user-events/:id). */
export async function deleteUserEvent(userEventId: number | string): Promise<DeleteUserEventResponse> {
  return sendRequest<null, DeleteUserEventResponse>(
    `${API_BASE}/api/user-events/${userEventId}`,
    'DELETE'
  );
}

type EventsListQuery = {
  includePast?: boolean;
  pastDays?: number;
  futureDays?: number;
  signal?: AbortSignal;
};

/**
 * Fetch space events + launches as one chronologically sorted array. By default
 * it returns the upcoming list; includePast adds recent history before it.
 */
export async function fetchEventsList(input?: AbortSignal | EventsListQuery): Promise<EventListItem[]> {
  const query = input instanceof AbortSignal ? { signal: input } : input ?? {};
  const params = new URLSearchParams();
  if (query.includePast) params.set('include_past', 'true');
  if (query.pastDays != null) params.set('past_days', String(query.pastDays));
  if (query.futureDays != null) params.set('future_days', String(query.futureDays));
  const url = `${API_BASE}/api/events/list${params.size > 0 ? `?${params}` : ''}`;
  const res = await fetch(url, { signal: query.signal });
  if (!res.ok) throw new Error(`events list request failed: ${res.status}`);
  return res.json();
}

export function updateSavedUserEvent(
  userEventId: number | string,
  data: { event_comment?: string | null; event_rating?: number | null }
): Promise<UpdateSavedEventResponse> {
  return sendRequest<typeof data, UpdateSavedEventResponse>(
    `${API_BASE}/api/user-events/${userEventId}`,
    'PATCH',
    data
  );
}

export function addSavedUserEventImage(
  userEventId: number | string,
  data: { image_url: string; imgbb_delete_url?: string | null; caption?: string | null }
): Promise<UserEventImage> {
  return sendRequest<typeof data, UserEventImage>(
    `${API_BASE}/api/user-events/${userEventId}/images`,
    'POST',
    data
  );
}

export function deleteSavedUserEventImage(
  userEventId: number | string,
  userEventImageId: number | string
): Promise<DeleteUserEventImageResponse> {
  return sendRequest<null, DeleteUserEventImageResponse>(
    `${API_BASE}/api/user-events/${userEventId}/images/${userEventImageId}`,
    'DELETE'
  );
}

/** Fetch every event saved by the currently logged-in user. */
export function fetchSavedUserEvents(signal?: AbortSignal): Promise<SavedUserEvent[]> {
  return sendRequest<null, SavedUserEvent[]>(
    `${API_BASE}/api/user-events/saved`,
    'GET',
    null,
    { signal }
  );
}
