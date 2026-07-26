import sendRequest from './send-request';

const API_BASE = process.env.EXPO_PUBLIC_API_URL;
const EVENTS_URL = `${API_BASE}/api/events`;
const LAUNCHES_URL = `${API_BASE}/api/launches`;
const ASTRONOMY_BODIES_URL = `${API_BASE}/api/astronomy/bodies`;
const calendarSourceCache = new Map<string, unknown | null>();
const pendingCalendarSourceRequests = new Map<string, Promise<unknown | null>>();

type RawEvent = {
  id?: number | string;
  event_id?: number | string;
  category?: 'event' | 'launch';
  name?: string;
  type?: string;
  date?: string;
  date_precision?: string;
  location?: string | null;
  description?: string | null;
  webcast_live?: boolean;
  video_urls?: string[];
  video_url?: string | null;
  image_url?: string | null;
};

type RawLaunch = {
  id?: number | string;
  launch_id?: number | string;
  event_id?: number | string;
  name?: string;
  status?: string;
  net?: string;
  net_precision?: string;
  mission?: {
    name?: string;
    type?: string;
    description?: string | null;
  } | null;
  pad?: {
    name?: string;
    location?: string;
    latitude?: string | number | null;
    longitude?: string | number | null;
    country?: string;
  } | null;
  provider?: string;
  rocket?: string;
  webcast_live?: boolean;
  video_url?: string | null;
  image?: string | null;
};

export type UpcomingLaunch = RawLaunch;

type RawSpacewalk = {
  name?: string;
  start?: string;
  end?: string | null;
  duration?: string | number | null;
  location?: string | null;
  space_station?: string | null;
  schedule_status?: 'upcoming' | 'latest';
  crew?: {
    name?: string;
    nationality?: string;
    role?: string;
  }[];
};

export type UpcomingSpacewalk = RawSpacewalk;

type RawBody = {
  body?: string;
  observed_date?: string;
  altitude_degrees?: string | number | null;
  azimuth_degrees?: string | number | null;
  distance_from_earth_km?: string | number | null;
  constellation?: string | null;
  magnitude?: string | number | null;
  image_url?: string | null;
  image_source?: string | null;
};

type EventsResponse = {
  count?: number;
  results?: RawEvent[];
};

type LaunchesResponse = {
  count?: number;
  results?: RawLaunch[];
};

type SpacewalksResponse = {
  count?: number;
  results?: RawSpacewalk[];
};

type BodiesResponse = {
  count?: number;
  results?: RawBody[];
};

export type CalendarEvent = {
  id: string;
  sourceId?: number | string;
  eventId?: number | string | null;
  category?: 'event' | 'launch';
  date: number;
  startDate: string;
  title: string;
  time: string | null;
  detail: string;
  icon: string;
  type?: string;
  datePrecision?: string | null;
  webcastLive?: boolean;
  videoUrl?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  launchDetails?: {
    rocket_model: string | null;
    provider: string | null;
    mission_name: string | null;
    mission_type: string | null;
    pad_name: string | null;
    pad_location: string | null;
    status: string | null;
  } | null;
  location?: string | null;
  imageUrl?: string | null;
  visibleBodies?: VisibleBodyCalendarItem[];
};

export type VisibleBodyCalendarItem = {
  body: string;
  altitude_degrees?: string | number | null;
  azimuth_degrees?: string | number | null;
  distance_from_earth_km?: string | number | null;
  constellation?: string | null;
  magnitude?: string | number | null;
  image_url?: string | null;
  image_source?: string | null;
};

export type CalendarEventsQuery = {
  limit?: number;
  fromDate?: string;
  toDate?: string;
  latitude?: number;
  longitude?: number;
  includeVisibleBodies?: boolean;
};

function getEventIcon(type?: string) {
  const normalized = type?.toLowerCase() ?? '';
  if (normalized.includes('launch')) return 'L';
  if (normalized.includes('eclipse')) return 'E';
  if (normalized.includes('spacewalk')) return 'S';
  if (normalized.includes('iss')) return 'I';
  if (normalized.includes('visible body')) return 'B';
  if (normalized.includes('moon')) return 'M';
  return '*';
}

function formatEventTime(date: Date, precision?: string) {
  if (Number.isNaN(date.getTime())) return precision ?? 'Time TBD';

  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function parseApiDate(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day);
  }
  return new Date(value);
}

function formatDateForApi(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function defaultCalendarWindow() {
  const today = new Date();
  const from = new Date(today.getFullYear(), today.getMonth(), 1);
  const to = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  return { fromDate: formatDateForApi(from), toDate: formatDateForApi(to) };
}

function toCalendarEvent(event: RawEvent, index: number): CalendarEvent | null {
  if (!event.date) return null;

  const start = parseApiDate(event.date);
  if (Number.isNaN(start.getTime())) return null;

  return {
    id: String(event.id ?? `${event.name ?? 'event'}-${event.date}-${index}`),
    sourceId: event.id,
    eventId: event.event_id ?? event.id ?? null,
    category: event.category ?? 'event',
    date: start.getDate(),
    startDate: start.toISOString(),
    title: event.name ?? 'Space event',
    time: formatEventTime(start, event.date_precision),
    detail: event.description ?? event.location ?? 'No event details available.',
    icon: getEventIcon(event.type),
    type: event.type,
    datePrecision: event.date_precision ?? null,
    webcastLive: event.webcast_live ?? false,
    videoUrl: event.video_url ?? event.video_urls?.[0] ?? null,
    location: event.location,
    imageUrl: event.image_url,
  };
}

function toLaunchCalendarEvent(launch: RawLaunch, index: number): CalendarEvent | null {
  if (!launch.net) return null;

  const start = parseApiDate(launch.net);
  if (Number.isNaN(start.getTime())) return null;

  const detailParts = [
    launch.status,
    launch.rocket ? `${launch.rocket}${launch.provider ? ` by ${launch.provider}` : ''}` : launch.provider,
    launch.mission?.description,
    launch.pad?.location,
  ].filter(Boolean);

  return {
    id: String(launch.launch_id ?? launch.id ?? `launch-${launch.name ?? index}-${launch.net}`),
    sourceId: launch.launch_id ?? launch.id,
    eventId: launch.event_id ?? null,
    category: 'launch',
    date: start.getDate(),
    startDate: start.toISOString(),
    title: launch.name ?? 'Rocket launch',
    time: formatEventTime(start, launch.net_precision),
    detail: detailParts.join(' | ') || 'Upcoming rocket launch.',
    icon: getEventIcon('Launch'),
    type: 'Launch',
    datePrecision: launch.net_precision ?? null,
    webcastLive: launch.webcast_live ?? false,
    videoUrl: launch.video_url ?? null,
    latitude: launch.pad?.latitude == null ? null : Number(launch.pad.latitude),
    longitude: launch.pad?.longitude == null ? null : Number(launch.pad.longitude),
    launchDetails: {
      rocket_model: launch.rocket ?? null,
      provider: launch.provider ?? null,
      mission_name: launch.mission?.name ?? null,
      mission_type: launch.mission?.type ?? null,
      pad_name: launch.pad?.name ?? null,
      pad_location: launch.pad?.location ?? null,
      status: launch.status ?? null,
    },
    location: launch.pad?.location ?? launch.pad?.name ?? null,
    imageUrl: launch.image ?? null,
  };
}

function toSpacewalkCalendarEvent(spacewalk: RawSpacewalk, index: number): CalendarEvent | null {
  if (!spacewalk.start) return null;

  const start = parseApiDate(spacewalk.start);
  if (Number.isNaN(start.getTime())) return null;

  const crew = spacewalk.crew?.map((member) => member.name).filter(Boolean).join(', ');
  const detailParts = [
    spacewalk.space_station,
    spacewalk.location,
    crew ? `Crew: ${crew}` : null,
    spacewalk.duration ? `Duration: ${spacewalk.duration}` : null,
  ].filter(Boolean);

  return {
    id: `spacewalk-${spacewalk.name ?? index}-${spacewalk.start}`,
    date: start.getDate(),
    startDate: start.toISOString(),
    title: spacewalk.name ?? 'Spacewalk',
    time: formatEventTime(start),
    detail: detailParts.join(' | ') || 'Scheduled spacewalk.',
    icon: getEventIcon('Spacewalk'),
    type: 'Spacewalk',
    location: spacewalk.location ?? spacewalk.space_station ?? null,
  };
}

function toBodyCalendarEvents(bodies: RawBody[]): CalendarEvent[] {
  const bodiesByDate = new Map<string, RawBody[]>();

  for (const body of bodies) {
    if (!body.observed_date || !body.body) continue;
    const group = bodiesByDate.get(body.observed_date) ?? [];
    group.push(body);
    bodiesByDate.set(body.observed_date, group);
  }

  return [...bodiesByDate.entries()]
    .map(([observedDate, dateBodies]) => toBodyCalendarEvent(observedDate, dateBodies))
    .filter((event): event is CalendarEvent => event !== null);
}

function toBodyCalendarEvent(observedDate: string, bodies: RawBody[]): CalendarEvent | null {
  const observed = parseApiDate(observedDate);
  if (Number.isNaN(observed.getTime())) return null;

  const visibleBodies = bodies
    .filter((body): body is RawBody & { body: string } => Boolean(body.body))
    .sort((a, b) => (toFiniteNumber(b.altitude_degrees) ?? -Infinity) - (toFiniteNumber(a.altitude_degrees) ?? -Infinity));
  if (visibleBodies.length === 0) return null;

  const bodyNames = visibleBodies.map((body) => body.body).filter(Boolean).join(', ');
  const detail = visibleBodies.map(formatBodyEventDetail).join(' | ');
  const bodyItems = visibleBodies.map(toVisibleBodyCalendarItem);

  return {
    id: `visible-bodies-${observedDate}`,
    date: observed.getDate(),
    startDate: observed.toISOString(),
    title: visibleBodies.length === 1 ? `${visibleBodies[0].body} visible` : 'Visible bodies tonight',
    time: null,
    detail: detail || `${bodyNames} visible above the horizon.`,
    icon: getEventIcon('Visible Body'),
    type: 'Visible Body',
    imageUrl: bodyItems.find((body) => body.image_url)?.image_url ?? null,
    visibleBodies: bodyItems,
  };
}

function toVisibleBodyCalendarItem(body: RawBody & { body: string }): VisibleBodyCalendarItem {
  return {
    body: body.body,
    altitude_degrees: body.altitude_degrees ?? null,
    azimuth_degrees: body.azimuth_degrees ?? null,
    distance_from_earth_km: body.distance_from_earth_km ?? null,
    constellation: body.constellation ?? null,
    magnitude: body.magnitude ?? null,
    image_url: body.image_url ?? null,
    image_source: body.image_source ?? null,
  };
}

function formatBodyEventDetail(body: RawBody) {
  const altitude = formatNumber(body.altitude_degrees, 1);
  const azimuth = formatNumber(body.azimuth_degrees, 1);
  const magnitude = formatNumber(body.magnitude, 1);
  const distance = formatNumber(body.distance_from_earth_km, 0);
  const details = [
    altitude ? `alt ${altitude} deg` : null,
    azimuth ? `az ${azimuth} deg` : null,
    body.constellation ? `constellation ${body.constellation}` : null,
    magnitude ? `mag ${magnitude}` : null,
    distance ? `${Number(distance).toLocaleString('en-US')} km` : null,
  ].filter(Boolean);

  return `${body.body}: ${details.join(', ') || 'visible above the horizon'}`;
}

function formatNumber(value: string | number | null | undefined, digits: number) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(digits) : null;
}

function toFiniteNumber(value: string | number | null | undefined) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeForKey(value?: string | null) {
  return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function getEventDedupeKey(event: CalendarEvent) {
  const start = new Date(event.startDate);
  const timeKey = Number.isNaN(start.getTime())
    ? event.startDate
    : start.toISOString().slice(0, 16);
  return `${normalizeForKey(event.title)}|${timeKey}`;
}

function dedupeCalendarEvents(events: CalendarEvent[]) {
  const byKey = new Map<string, CalendarEvent>();

  for (const event of events) {
    const key = getEventDedupeKey(event);
    const existing = byKey.get(key);
    if (!existing || getEventDetailScore(event) > getEventDetailScore(existing)) {
      byKey.set(key, event);
    }
  }

  return [...byKey.values()].sort(
    (a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
  );
}

function getEventDetailScore(event: CalendarEvent) {
  return [
    event.detail && event.detail !== 'No event details available.',
    event.location,
    event.imageUrl,
    event.type,
  ].filter(Boolean).length;
}

async function fetchOptionalCalendarSource<TResponse>(
  url: string,
  label: string
): Promise<TResponse | null> {
  if (calendarSourceCache.has(url)) {
    return calendarSourceCache.get(url) as TResponse | null;
  }

  let pendingRequest = pendingCalendarSourceRequests.get(url);
  pendingRequest ??= sendRequest<null, TResponse>(url)
    .then((response) => {
      calendarSourceCache.set(url, response);
      return response;
    })
    .catch((error) => {
      console.warn(`Could not load ${label} calendar data:`, error);
      calendarSourceCache.set(url, null);
      return null;
    })
    .finally(() => {
      pendingCalendarSourceRequests.delete(url);
    });
  pendingCalendarSourceRequests.set(url, pendingRequest);

  return pendingRequest as Promise<TResponse | null>;
}

function buildCalendarQuery(input?: number | CalendarEventsQuery): Required<Pick<CalendarEventsQuery, 'fromDate' | 'toDate'>> & CalendarEventsQuery {
  const defaults = defaultCalendarWindow();
  if (typeof input === 'number') return { ...defaults, limit: input };
  return { ...defaults, ...input };
}

export async function fetchCalendarEvents(input?: number | CalendarEventsQuery): Promise<CalendarEvent[]> {
  const { limit, fromDate, toDate, latitude, longitude, includeVisibleBodies = true } = buildCalendarQuery(input);
  const boundedLimit = typeof limit === 'number' && Number.isFinite(limit) && limit > 0 ? limit : undefined;
  const hasCoordinates =
    typeof latitude === 'number' &&
    Number.isFinite(latitude) &&
    typeof longitude === 'number' &&
    Number.isFinite(longitude);

  const eventsParams = new URLSearchParams();
  if (boundedLimit) eventsParams.set('limit', String(boundedLimit));
  eventsParams.set('from_date', fromDate);
  eventsParams.set('to_date', toDate);

  const eventsUrl = `${EVENTS_URL}?${eventsParams}`;
  const launchesParams = new URLSearchParams({
    limit: String(boundedLimit ?? 100),
    from_date: fromDate,
    to_date: toDate,
  });
  const spacewalksParams = new URLSearchParams({
    limit: String(boundedLimit ?? 50),
    from_date: fromDate,
    to_date: toDate,
  });

  const launchesUrl = `${LAUNCHES_URL}?${launchesParams}`;
  const spacewalksUrl = `${EVENTS_URL}/spacewalks?${spacewalksParams}`;
  const bodiesUrl = hasCoordinates && includeVisibleBodies
    ? `${ASTRONOMY_BODIES_URL}?latitude=${latitude}&longitude=${longitude}` +
      `&from_date=${fromDate}&to_date=${toDate}`
    : null;

  const [eventsData, launchesData, spacewalksData, bodiesData] = await Promise.all([
    fetchOptionalCalendarSource<EventsResponse>(eventsUrl, 'events'),
    fetchOptionalCalendarSource<LaunchesResponse>(launchesUrl, 'launches'),
    fetchOptionalCalendarSource<SpacewalksResponse>(spacewalksUrl, 'spacewalks'),
    bodiesUrl
      ? fetchOptionalCalendarSource<BodiesResponse>(bodiesUrl, 'visible bodies')
      : Promise.resolve(null),
  ]);

  if (!eventsData && !launchesData && !spacewalksData && !bodiesData) {
    throw new Error('Could not load calendar events.');
  }

  const allEvents = [
    ...(launchesData?.results ?? []).map(toLaunchCalendarEvent),
    ...(eventsData?.results ?? []).map(toCalendarEvent),
    ...(spacewalksData?.results ?? []).map(toSpacewalkCalendarEvent),
    ...toBodyCalendarEvents(bodiesData?.results ?? []),
  ].filter((event): event is CalendarEvent => event !== null);

  return dedupeCalendarEvents(allEvents);
}

export async function fetchNextUpcomingLaunch(now = new Date()): Promise<UpcomingLaunch | null> {
  const launchesParams = new URLSearchParams({
    limit: '1',
    from_date: now.toISOString(),
  });
  const launchesData = await sendRequest<null, LaunchesResponse>(`${LAUNCHES_URL}?${launchesParams}`);
  return launchesData.results?.[0] ?? null;
}

export async function fetchNextUpcomingSpacewalk(now = new Date()): Promise<UpcomingSpacewalk | null> {
  const end = new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000);
  const spacewalksParams = new URLSearchParams({
    limit: '100',
    from_date: now.toISOString(),
    to_date: end.toISOString(),
  });
  const spacewalksData = await sendRequest<null, SpacewalksResponse>(`${EVENTS_URL}/spacewalks?${spacewalksParams}`);

  const nextSpacewalk = (spacewalksData.results ?? [])
    .filter((spacewalk) => spacewalk.start && new Date(spacewalk.start).getTime() >= now.getTime())
    .sort((a, b) => new Date(a.start ?? 0).getTime() - new Date(b.start ?? 0).getTime())[0];

  if (nextSpacewalk) return { ...nextSpacewalk, schedule_status: 'upcoming' };

  const latestParams = new URLSearchParams({
    limit: '1',
  });
  const latestSpacewalksData = await sendRequest<null, SpacewalksResponse>(`${EVENTS_URL}/spacewalks?${latestParams}`);
  const latestSpacewalk = latestSpacewalksData.results?.[0] ?? null;

  return latestSpacewalk ? { ...latestSpacewalk, schedule_status: 'latest' } : null;
}

export function getCalendarEventsForMonth(events: CalendarEvent[], year: number, month: number) {
  return events.filter((event) => {
    const start = new Date(event.startDate);
    return start.getFullYear() === year && start.getMonth() === month;
  });
}

export function getCalendarEventsForDate(events: CalendarEvent[], date: Date) {
  return events.filter((event) => {
    const start = new Date(event.startDate);
    return (
      start.getFullYear() === date.getFullYear() &&
      start.getMonth() === date.getMonth() &&
      start.getDate() === date.getDate()
    );
  });
}

export function getNextCalendarEvent(events: CalendarEvent[], today = new Date()) {
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();

  return events
    .filter((event) => new Date(event.startDate).getTime() >= todayStart)
    .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime())[0];
}
