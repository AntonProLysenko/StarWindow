// pages/dashboard-screen.tsx
// StarWindow — Home Dashboard
// Left rail with 4 tabs (Calendar, Map, Launches, Profile),
// moon-phase hero, and preview cards for each tab.
// All colors/spacing/radii come from @/constants/tokens.

import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  SafeAreaView,
  Image,
  Linking,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { Palette, Radius, Spacing, alpha } from '@/constants/tokens';
import { ShootingStar } from '@/components/shooting-star';
import { SoundToggle } from '@/components/sound-toggle';
import { OrbitalLoader } from '@/components/orbital-loader';
import { MonthGrid } from '@/components/calendar/month-grid';
import { StarMap } from '@/components/star-map';
import { useSharedEvents } from '@/context/events-context';
import { fetchEventsList, type EventListItem } from '@/lib/events-api';
import { fetchVisibleBodies, type VisibleBody } from '@/utilities/bodies-api';
import {
  eventListItemToCalendarEvent,
  getCalendarEventsForMonth,
  getNextCalendarEvent,
  type CalendarEvent,
  type UpcomingSpacewalk,
  type UpcomingLaunch,
  type UpcomingMeteorShower,
} from '@/utilities/events-api';
import { fetchIssPasses, type IssPass } from '@/utilities/iss-api';
import { fetchNearestLocation } from '@/utilities/location-api';
import { fetchMoonPhase } from '@/utilities/moon-api';
import { fetchNasaNews, type NewsArticle } from '@/utilities/news-api';
import { fetchViewingScore, type ViewingScoreResponse } from '@/utilities/viewing-score-api';
import { fetchCurrentWeather, type WeatherResponse } from '@/utilities/weather-api';
import { getUserLevelProgressLabel, getUserLevelProgressPercent } from '@/utilities/level-progress';
import { getOrRequestUserLocation } from '@/utilities/user-location-service';
import * as ambientSound from '@/utilities/ambient-sound-service';
import * as usersService from '@/utilities/users-service';
import { useReliableWindowWidth } from '@/utilities/use-reliable-window-width';
import { dvw, dvh } from '@/utilities/responsive-dimensions';

const STARS = Array.from({ length: 150 }, (_, i) => ({
  top: (i * 23.7) % 100,
  left: (i * 41.3) % 100,
  size: (i % 4) + 0.5,
  opacity: (i % 6) * 0.08 + 0.15,
}));

const LOCATION_REQUIRED_LABEL = 'Location required';
const LOCATION_SETTINGS_MESSAGE = 'Enable browser location access in site settings to load your sky data.';
const DASHBOARD_MAP_FALLBACK_CENTER: [number, number] = [39.157, -84.538];
const DASHBOARD_MAP_ZOOM = 11;
const UNKNOWN_OBSERVING_TIME = '--:--';
const DASHBOARD_MOBILE_BREAKPOINT = 640;
const DASHBOARD_MAX_CONTENT_WIDTH = 1240;

function isDashboardMobileWidth(width: number) {
  return width < DASHBOARD_MOBILE_BREAKPOINT;
}

function formatMoonTrend(value: string | null) {
  return value ?? 'Loading';
}

function formatMoonPercent(value: number | null) {
  return value === null ? 'Loading' : `${Math.round(value)}%`;
}

function formatMoonDate(value: string | null) {
  if (!value) return 'Today';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return 'Today';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function normalizeMoonPhaseName(value?: string | null) {
  if (!value) return null;
  return value.toLowerCase().includes('last quarter') ? 'Third Quarter' : value;
}

function formatCoordinates(latitude: number, longitude: number) {
  return `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
}

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return count === 1 ? singular : plural;
}

function formatCount(count: number, singular: string, plural?: string) {
  return `${count} ${pluralize(count, singular, plural)}`;
}

function getDisplayName(user: usersService.AuthUser | null) {
  const fullName = [user?.f_name, user?.l_name].filter(Boolean).join(' ').trim();
  return fullName || user?.email || 'Guest';
}

function getFirstName(user: usersService.AuthUser | null) {
  return user?.f_name?.trim() || getDisplayName(user);
}

function getProfileMeta(user: usersService.AuthUser | null) {
  if (user?.status_id != null && user?.status) return `Lvl ${user.status_id} ${user.status}`;
  if (user?.status_id != null) return `Lvl ${user.status_id}`;
  if (user?.status) return user.status;
  return 'Status unavailable';
}

type ViewingScoreStatus = 'loading' | 'ready' | 'unavailable' | 'location-required';

function getSkyGreeting(score: number | null, status: ViewingScoreStatus) {
  if (status === 'location-required') return 'Enable location for sky conditions';
  if (status === 'unavailable') return 'Sky conditions unavailable';
  if (score === null) return 'Checking sky conditions';
  if (score >= 80) return 'Excellent stargazing tonight';
  if (score >= 65) return 'Clear skies ahead';
  if (score >= 50) return 'Decent sky conditions';
  if (score >= 35) return 'Mixed viewing tonight';
  return 'Poor viewing conditions';
}

function formatLaunchBadge(launch: UpcomingLaunch | null) {
  if (!launch?.net) return 'TBD';

  const launchDate = new Date(launch.net);
  if (Number.isNaN(launchDate.getTime())) return 'TBD';

  const diffMs = launchDate.getTime() - Date.now();
  if (diffMs <= 0) return 'SOON';

  const totalMinutes = Math.ceil(diffMs / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const clock = `${hours}:${String(minutes).padStart(2, '0')}`;

  if (days > 0) return `${days}D ${clock}`;
  return clock;
}

function formatLaunchDate(value?: string) {
  if (!value) return null;

  const launchDate = new Date(value);
  if (Number.isNaN(launchDate.getTime())) return null;

  return launchDate.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatLaunchMeta(launch: UpcomingLaunch | null) {
  if (!launch) return 'No upcoming launch found in the current feed.';

  const detailParts = [
    formatLaunchDate(launch.net),
    launch.pad?.name,
    launch.pad?.location,
    launch.status,
  ].filter(Boolean);

  return detailParts.join(' | ') || 'Upcoming rocket launch.';
}

function parseEventDate(value?: string | null) {
  if (!value) return null;

  const direct = new Date(value);
  if (!Number.isNaN(direct.getTime())) return direct;

  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const withUtc = /(?:Z|[+-]\d{2}:?\d{2})$/.test(normalized) ? normalized : `${normalized}Z`;
  const fallback = new Date(withUtc);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

function getEventTime(event: EventListItem) {
  if (!event.date) return Infinity;
  return parseEventDate(event.date)?.getTime() ?? Infinity;
}

function getNextSharedEvent(events: EventListItem[], predicate: (event: EventListItem) => boolean) {
  const serverOrdered = events.find((event) => predicate(event) && event.timeline_section === 'upcoming');
  if (serverOrdered) return serverOrdered;

  const now = Date.now();
  return events
    .filter((event) => predicate(event) && getEventTime(event) >= now)
    .sort((a, b) => getEventTime(a) - getEventTime(b))[0] ?? null;
}

function getLatestSharedEvent(events: EventListItem[], predicate: (event: EventListItem) => boolean) {
  const serverPastEvents = events.filter((event) => predicate(event) && event.timeline_section === 'past');
  if (serverPastEvents.length > 0) {
    return [...serverPastEvents].sort((a, b) => getEventTime(b) - getEventTime(a))[0] ?? null;
  }

  const now = Date.now();
  return events
    .filter((event) => predicate(event) && getEventTime(event) < now)
    .sort((a, b) => getEventTime(b) - getEventTime(a))[0] ?? null;
}

function isMeteorShowerEvent(event: EventListItem) {
  const type = `${event.type ?? ''}`.toLowerCase();
  return type.includes('meteor') && type.includes('shower');
}

function isSpacewalkEvent(event: EventListItem) {
  const type = `${event.type ?? ''}`.toLowerCase();
  return type === 'eva' || type.includes('spacewalk');
}

function toUpcomingLaunch(event: EventListItem | null): UpcomingLaunch | null {
  if (!event) return null;
  const details = event.launch_details;

  return {
    id: event.id,
    launch_id: event.id,
    event_id: event.event_id,
    name: event.name,
    status: details?.status ?? undefined,
    net: event.date ?? undefined,
    net_precision: event.date_precision ?? undefined,
    mission: {
      name: details?.mission_name ?? event.name,
      type: details?.mission_type ?? undefined,
      description: event.description ?? null,
    },
    pad: {
      name: details?.pad_name ?? event.location ?? undefined,
      location: details?.pad_location ?? event.location ?? undefined,
      latitude: event.latitude,
      longitude: event.longitude,
    },
    provider: details?.provider ?? undefined,
    rocket: details?.rocket_model ?? undefined,
    webcast_live: event.webcast_live,
    video_url: event.video_url,
    video_urls: event.video_urls,
    external_url: event.external_url,
    external_urls: event.external_urls,
    image: event.image_url,
  };
}

function toUpcomingMeteorShower(event: EventListItem | null): UpcomingMeteorShower | null {
  if (!event) return null;

  return {
    id: event.id,
    event_id: event.event_id,
    category: event.category,
    name: event.name,
    type: event.type,
    date: event.date ?? undefined,
    date_precision: event.date_precision ?? undefined,
    location: event.location,
    description: event.description,
    webcast_live: event.webcast_live,
    video_url: event.video_url,
    video_urls: event.video_urls,
    external_url: event.external_url,
    external_urls: event.external_urls,
    image_url: event.image_url,
    radiant: event.radiant,
    radiant_declination_degrees: event.radiant_declination_degrees,
    zhr: event.zhr,
    active_start: event.active_start,
    active_end: event.active_end,
    peak_date: event.peak_date,
    best_time: event.best_time,
    moon_age_days: event.moon_age_days,
    radiant_max_altitude_degrees: event.radiant_max_altitude_degrees,
  };
}

function toUpcomingSpacewalk(event: EventListItem | null, status: UpcomingSpacewalk['schedule_status']): UpcomingSpacewalk | null {
  if (!event) return null;

  return {
    name: event.name,
    start: event.date ?? undefined,
    location: event.location,
    space_station: event.location,
    description: event.description,
    image_url: event.image_url,
    schedule_status: status,
    crew: [],
  };
}

function formatIssTime(value?: string | null) {
  if (!value) return 'Time TBD';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatIssClock(value?: string | null) {
  if (!value) return '--';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatIssDuration(seconds?: number | null) {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return null;
  if (seconds < 60) return `${Math.round(seconds)} sec`;
  const minutes = Math.round(seconds / 60);
  return `${minutes} min`;
}

function formatIssBadge({
  isLoading,
  error,
  hasLocation,
  pass,
}: {
  isLoading: boolean;
  error: string | null;
  hasLocation: boolean;
  pass: IssPass | null;
}) {
  if (isLoading) return 'LOADING';
  if (!hasLocation) return 'LOCATION';
  if (error) return 'UNAVAILABLE';
  if (!pass) return 'NO PASS';
  return pass.visible === false ? 'UPCOMING' : 'VISIBLE';
}

function formatIssTitle({
  isLoading,
  error,
  hasLocation,
  pass,
}: {
  isLoading: boolean;
  error: string | null;
  hasLocation: boolean;
  pass: IssPass | null;
}) {
  if (isLoading) return 'Loading next ISS pass...';
  if (!hasLocation) return 'Location required';
  if (error) return 'ISS pass unavailable';
  if (!pass) return 'No visible ISS passes';
  return 'Next ISS Pass';
}

function formatIssMeta(pass: IssPass | null, hasLocation = false) {
  if (!pass) {
    return hasLocation
      ? 'No visible ISS pass found in the current forecast window.'
      : 'Enable location to check visible ISS passes near you.';
  }

  const visibleDuration = formatIssDuration(pass.visible_duration_sec ?? pass.duration_sec);
  const details = [
    `Rises ${formatIssTime(pass.rise?.time)}${pass.rise?.direction ? ` ${pass.rise.direction}` : ''}`,
    pass.peak?.elevation_deg != null ? `Peak ${Math.round(pass.peak.elevation_deg)} deg` : null,
    visibleDuration ? `Visible ${visibleDuration}` : null,
  ].filter(Boolean);

  return details.join(' | ') || 'Visible pass details are unavailable.';
}

function toNumber(value: string | number | null | undefined) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function titleCase(value?: string | null) {
  if (!value) return null;
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatTemperature(value?: number | null, units?: string | null) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '--';
  const suffix = units === 'metric' ? 'C' : units === 'standard' ? 'K' : 'F';
  return `${Math.round(value)} deg ${suffix}`;
}

function formatWeatherBadge({
  isLoading,
  error,
  hasLocation,
}: {
  isLoading: boolean;
  error: string | null;
  hasLocation: boolean;
}) {
  if (isLoading) return 'LOADING';
  if (!hasLocation) return 'LOCATION';
  if (error) return 'UNAVAILABLE';
  return 'TODAY';
}

function formatWeatherMeta(weather: WeatherResponse | null) {
  if (!weather) return 'Enable location to load current observing weather.';

  const details = [
    titleCase(weather.conditions),
    weather.clouds_pct != null ? `Clouds ${Math.round(weather.clouds_pct)}%` : null,
    weather.humidity != null ? `Humidity ${Math.round(weather.humidity)}%` : null,
  ].filter(Boolean);

  return details.join(' | ') || 'Current weather details unavailable.';
}

function getWeatherImageSource(conditions?: string | null) {
  const normalized = conditions?.toLowerCase() ?? '';

  if (normalized.includes('thunder')) {
    return require('@/assets/images/weather-thunderstorm.png');
  }

  if (normalized.includes('snow') || normalized.includes('sleet')) {
    return require('@/assets/images/weather-snow.png');
  }

  if (
    normalized.includes('rain') ||
    normalized.includes('drizzle') ||
    normalized.includes('shower')
  ) {
    return require('@/assets/images/weather-rain.png');
  }

  if (
    normalized.includes('mist') ||
    normalized.includes('fog') ||
    normalized.includes('haze') ||
    normalized.includes('smoke') ||
    normalized.includes('dust') ||
    normalized.includes('sand') ||
    normalized.includes('ash') ||
    normalized.includes('squall') ||
    normalized.includes('tornado')
  ) {
    return require('@/assets/images/weather-fog.png');
  }

  if (normalized.includes('clear')) {
    return require('@/assets/images/weather-clear.png');
  }

  return require('@/assets/images/weather-clouds.png');
}

function isMoonBody(bodyName?: string | null) {
  return bodyName?.trim().toLowerCase() === 'moon';
}

function getTopVisibleBodies(bodies: VisibleBody[]) {
  const sortedBodies = [...bodies]
    .filter((body) => body.body)
    .sort((a, b) => (toNumber(b.altitude_degrees) ?? -Infinity) - (toNumber(a.altitude_degrees) ?? -Infinity));

  if (isMoonBody(sortedBodies[0]?.body)) {
    const nextBodyIndex = sortedBodies.findIndex((body) => !isMoonBody(body.body));
    if (nextBodyIndex > 0) {
      const [nextBody] = sortedBodies.splice(nextBodyIndex, 1);
      sortedBodies.unshift(nextBody);
    }
  }

  return sortedBodies.slice(0, 4);
}

function formatBodiesBadge({
  isLoading,
  error,
  hasLocation,
  count,
}: {
  isLoading: boolean;
  error: string | null;
  hasLocation: boolean;
  count: number;
}) {
  if (isLoading) return 'LOADING';
  if (!hasLocation) return 'LOCATION';
  if (error) return 'UNAVAILABLE';
  return `${count} VISIBLE`;
}

function formatBodiesMeta(bodies: VisibleBody[]) {
  const topBodies = getTopVisibleBodies(bodies);
  if (topBodies.length === 0) return `No visible bodies found for tonight at ${UNKNOWN_OBSERVING_TIME}.`;

  return topBodies
    .slice(0, 3)
    .map((body) => {
      const altitude = toNumber(body.altitude_degrees);
      return altitude == null ? body.body : `${body.body} ${Math.round(altitude)} deg`;
    })
    .join(' | ');
}

function formatMeteorDate(value?: string | null) {
  if (!value) return 'TBD';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'TBD';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatMeteorBadge({
  isLoading,
  error,
  shower,
}: {
  isLoading: boolean;
  error: string | null;
  shower: UpcomingMeteorShower | null;
}) {
  if (isLoading) return 'LOADING';
  if (error) return 'UNAVAILABLE';
  return shower ? formatMeteorDate(shower.date) : 'NO SHOWER';
}

function formatMeteorMeta(shower: UpcomingMeteorShower | null, hasLocation: boolean) {
  if (!shower) return 'No upcoming meteor shower found.';

  const radiantAltitude = toNumber(shower.radiant_max_altitude_degrees);
  const details = [
    shower.radiant ? `Radiant ${shower.radiant}` : null,
    shower.best_time ? `Best ${formatBestTimeLabel(shower.best_time)}` : null,
    shower.zhr != null ? `ZHR ${shower.zhr}` : null,
    hasLocation && radiantAltitude != null ? `Max altitude ${Math.round(radiantAltitude)} deg` : null,
  ].filter(Boolean);

  return joinDashboardMeta(details) || shower.description || 'Upcoming meteor shower.';
}

function joinDashboardMeta(parts: (string | null | undefined)[]) {
  return keepPipeGroupsTogether(parts.filter((part): part is string => Boolean(part)).join(' | '));
}

function keepPipeGroupsTogether(value: string) {
  if (!value.includes('|')) return value;
  return value
    .split(/\s*\|\s*/)
    .filter(Boolean)
    .map((part) => part.replace(/\s+/g, '\u00A0'))
    .join('\u00A0|\u00A0');
}

function formatBestTimeLabel(value: string) {
  const [hourPart, minutePart = '00'] = value.split(':');
  const hour = Number(hourPart);
  const minute = Number(minutePart);
  if (!Number.isFinite(hour)) return value;
  const date = new Date();
  date.setHours(hour, Number.isFinite(minute) ? minute : 0, 0, 0);
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function formatSpacewalkDate(value?: string | null) {
  if (!value) return 'TBD';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'TBD';
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function getSpacewalkCrew(spacewalk: UpcomingSpacewalk | null) {
  return spacewalk?.crew?.map((member) => member.name).filter(Boolean).join(', ') || null;
}

function formatSpacewalkBadge({
  isLoading,
  error,
  spacewalk,
}: {
  isLoading: boolean;
  error: string | null;
  spacewalk: UpcomingSpacewalk | null;
}) {
  if (isLoading) return 'LOADING';
  if (error) return 'UNAVAILABLE';
  if (!spacewalk) return 'NO EVA';
  return spacewalk.schedule_status === 'latest' ? 'LATEST' : 'UPCOMING';
}

function formatSpacewalkMeta(spacewalk: UpcomingSpacewalk | null) {
  if (!spacewalk) return 'No upcoming spacewalk found in the current feed.';

  const prefix = spacewalk.schedule_status === 'latest' ? 'Latest:' : 'Next:';
  const details = [
    `${prefix} ${formatSpacewalkDate(spacewalk.start)}`,
    spacewalk.space_station,
    getSpacewalkCrew(spacewalk) ? `Crew: ${getSpacewalkCrew(spacewalk)}` : null,
    !getSpacewalkCrew(spacewalk) ? spacewalk.description : null,
  ].filter(Boolean);

  return details.join(' | ') || 'Upcoming spacewalk details unavailable.';
}

function formatNewsDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatNewsBadge({
  isLoading,
  error,
  article,
}: {
  isLoading: boolean;
  error: string | null;
  article: NewsArticle | null;
}) {
  if (isLoading) return 'LOADING';
  if (error) return 'UNAVAILABLE';
  return article?.source === 'NASA News' ? 'NASA NEWS' : 'NASA';
}

function formatNewsMeta(article: NewsArticle | null) {
  if (!article) return 'No NASA news article found in the current feed.';

  return [article.source, formatNewsDate(article.published_at)].filter(Boolean).join(' | ') || 'NASA news';
}

function openExternalUrl(url?: string | null) {
  if (!url) return;

  if (typeof window !== 'undefined' && typeof window.open === 'function') {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }

  void Linking.openURL(url);
}

type EventDetailRouteParams = {
  eventId?: string | number | null;
  category?: 'event' | 'launch';
  type?: string | null;
  name?: string | null;
  date?: string | null;
  datePrecision?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  location?: string | null;
  videoUrl?: string | null;
  videoUrls?: string[] | null;
  externalUrl?: string | null;
  externalUrls?: string[] | null;
  visibleBodies?: VisibleBody[];
  synthetic?: boolean;
};

function eventDetailRoute(input: EventDetailRouteParams) {
  const params: Record<string, string> = {};

  for (const [key, value] of Object.entries(input)) {
    if (value === null || value === undefined || value === '') continue;
    params[key] = Array.isArray(value) ? JSON.stringify(value) : String(value);
  }

  return { pathname: '/events', params } as const;
}

function toVisibleBodyRouteItems(bodies: VisibleBody[]) {
  return bodies
    .filter((body) => body.body)
    .map((body) => ({
      body: body.body,
      altitude_degrees: body.altitude_degrees ?? null,
      azimuth_degrees: body.azimuth_degrees ?? null,
      constellation: body.constellation ?? null,
      magnitude: body.magnitude ?? null,
      image_url: body.image_url ?? null,
      image_source: body.image_source ?? null,
    }));
}

function formatDateForQuery(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getMonthWindow(year: number, month: number) {
  return {
    fromDate: formatDateForQuery(new Date(year, month, 1)),
    toDate: formatDateForQuery(new Date(year, month + 1, 0)),
  };
}

type DashboardScreenProps = {
  locked?: boolean;
};

export default function DashboardScreen({ locked = false }: DashboardScreenProps = {}) {
  const router = useRouter();
  const width = useReliableWindowWidth();
  const today = new Date();
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth();
  const isMobile = isDashboardMobileWidth(width);
  const [user, setUser] = useState<usersService.AuthUser | null>(() => usersService.getUser());
  const isLocked = locked && !user;
  const firstName = getFirstName(user);
  const displayName = getDisplayName(user);
  const profileMeta = getProfileMeta(user);
  const levelProgressLabel = getUserLevelProgressLabel(user);
  const levelProgressPercent = getUserLevelProgressPercent(user);
  const [browserCoords, setBrowserCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [lockedCalendarEventCount, setLockedCalendarEventCount] = useState<number | null>(null);
  const [lockedCalendarEventCountError, setLockedCalendarEventCountError] = useState(false);
  const { events: sharedEvents, isLoading: isEventsLoading, error: eventsError } = useSharedEvents();
  const currentMonthWindow = useMemo(() => getMonthWindow(currentYear, currentMonth), [currentYear, currentMonth]);
  const calendarEvents = useMemo(
    () => sharedEvents
      .map((event, index) => eventListItemToCalendarEvent(event, index))
      .filter((event): event is CalendarEvent => event !== null),
    [sharedEvents]
  );
  const currentMonthEvents = getCalendarEventsForMonth(calendarEvents, currentYear, currentMonth);
  const calendarTitle = today.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const nextCalendarEvent = getNextCalendarEvent(calendarEvents, today);
  const nextCalendarDate = nextCalendarEvent
    ? new Date(nextCalendarEvent.startDate).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      })
    : null;
  const isLockedCalendarEventCountLoading = isLocked && lockedCalendarEventCount === null && !lockedCalendarEventCountError;
  const calendarBadge = isEventsLoading || isLockedCalendarEventCountLoading
    ? 'LOADING'
    : eventsError || lockedCalendarEventCountError
    ? 'UNAVAILABLE'
    : formatCount(lockedCalendarEventCount ?? currentMonthEvents.length, 'EVENT', 'EVENTS');
  const calendarMeta = isEventsLoading
    ? 'Loading upcoming events...'
    : eventsError
    ? 'Could not load event data'
    : nextCalendarEvent
    ? `Next: ${nextCalendarEvent.title} - ${nextCalendarDate}`
    : 'No calendar events scheduled';
  const nextLaunch = useMemo(
    () => toUpcomingLaunch(getNextSharedEvent(sharedEvents, (event) => event.category === 'launch')),
    [sharedEvents]
  );
  const nextMeteorShower = useMemo(
    () => toUpcomingMeteorShower(getNextSharedEvent(sharedEvents, isMeteorShowerEvent)),
    [sharedEvents]
  );
  const nextUpcomingSpacewalkEvent = useMemo(
    () => getNextSharedEvent(sharedEvents, isSpacewalkEvent),
    [sharedEvents]
  );
  const displayedSpacewalkEvent = useMemo(
    () => nextUpcomingSpacewalkEvent ?? getLatestSharedEvent(sharedEvents, isSpacewalkEvent),
    [nextUpcomingSpacewalkEvent, sharedEvents]
  );
  const nextSpacewalk = useMemo(
    () => toUpcomingSpacewalk(
      displayedSpacewalkEvent,
      nextUpcomingSpacewalkEvent ? 'upcoming' : 'latest'
    ),
    [displayedSpacewalkEvent, nextUpcomingSpacewalkEvent]
  );
  const isLaunchLoading = isEventsLoading;
  const launchError = eventsError ? 'Could not load upcoming launches' : null;
  const isMeteorLoading = isEventsLoading;
  const meteorError = eventsError ? 'Could not load meteor shower data' : null;
  const isSpacewalkLoading = isEventsLoading;
  const spacewalkError = eventsError ? 'Could not load spacewalk schedule' : null;
  const [locationLabel, setLocationLabel] = useState('Requesting location...');
  const [locationMessage, setLocationMessage] = useState('Waiting for browser location access.');
  const [moonImageUrl, setMoonImageUrl] = useState<string | null>(null);
  const [moonPhasePercent, setMoonPhasePercent] = useState<number | null>(null);
  const [moonPhaseAngle, setMoonPhaseAngle] = useState<number | null>(null);
  const [moonPhaseTrend, setMoonPhaseTrend] = useState<string | null>(null);
  const [moonPhaseDate, setMoonPhaseDate] = useState<string | null>(null);
  const [moonPhaseName, setMoonPhaseName] = useState('Waiting for location...');
  const [viewingScore, setViewingScore] = useState<number | null>(null);
  const [viewingScoreInputs, setViewingScoreInputs] = useState<ViewingScoreResponse['inputs'] | null>(null);
  const [viewingScoreStatus, setViewingScoreStatus] = useState<ViewingScoreStatus>('loading');
  const [nextIssPass, setNextIssPass] = useState<IssPass | null>(null);
  const [isIssLoading, setIsIssLoading] = useState(true);
  const [issError, setIssError] = useState<string | null>(null);
  const [visibleBodies, setVisibleBodies] = useState<VisibleBody[]>([]);
  const [isBodiesLoading, setIsBodiesLoading] = useState(true);
  const [bodiesError, setBodiesError] = useState<string | null>(null);
  const [currentWeather, setCurrentWeather] = useState<WeatherResponse | null>(null);
  const [isWeatherLoading, setIsWeatherLoading] = useState(true);
  const [weatherError, setWeatherError] = useState<string | null>(null);
  const [nasaArticle, setNasaArticle] = useState<NewsArticle | null>(null);
  const [isNewsLoading, setIsNewsLoading] = useState(true);
  const [newsError, setNewsError] = useState<string | null>(null);

  useEffect(() => {
    ambientSound.ensureAmbientSound();
  }, []);

  useEffect(() => {
    if (!isLocked) {
      setLockedCalendarEventCount(null);
      setLockedCalendarEventCountError(false);
      return;
    }

    const controller = new AbortController();
    setLockedCalendarEventCount(null);
    setLockedCalendarEventCountError(false);

    fetchEventsList({
      includePast: true,
      fromDate: currentMonthWindow.fromDate,
      toDate: currentMonthWindow.toDate,
      signal: controller.signal,
    })
      .then((events) => {
        if (controller.signal.aborted) return;
        const monthEvents = events
          .map((event, index) => eventListItemToCalendarEvent(event, index))
          .filter((event): event is CalendarEvent => event !== null);
        setLockedCalendarEventCount(
          getCalendarEventsForMonth(monthEvents, currentYear, currentMonth).length
        );
      })
      .catch((error) => {
        if (controller.signal.aborted || error?.name === 'AbortError') return;
        setLockedCalendarEventCountError(true);
        console.log('Locked calendar event count unavailable:', error);
      });

    return () => {
      controller.abort();
    };
  }, [currentMonth, currentMonthWindow.fromDate, currentMonthWindow.toDate, currentYear, isLocked]);

  useEffect(() => {
    let isMounted = true;

    usersService.getCurrentUser()
      .then((currentUser) => {
        if (isMounted) setUser(currentUser);
      })
      .catch((error) => {
        console.log('User profile unavailable:', error);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function loadNasaNews() {
      try {
        setIsNewsLoading(true);
        setNewsError(null);
        const news = await fetchNasaNews({ limit: 1 });
        if (!isMounted) return;
        setNasaArticle(news.results?.[0] ?? null);
      } catch (error) {
        console.log('NASA news fetch error:', error);
        if (isMounted) {
          setNasaArticle(null);
          setNewsError('Could not load NASA news feed');
        }
      } finally {
        if (isMounted) setIsNewsLoading(false);
      }
    }

    void loadNasaNews();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    function clearMoonData(message: string) {
      setMoonImageUrl(null);
      setMoonPhasePercent(null);
      setMoonPhaseAngle(null);
      setMoonPhaseTrend(null);
      setMoonPhaseDate(null);
      setMoonPhaseName(message);
    }

    async function loadMoonPhase(coords: { latitude: number; longitude: number }) {
      try {
        const moon = await fetchMoonPhase(coords);
        if (!isMounted) return;
        setMoonImageUrl(null);
        setMoonPhasePercent(moon.phase_percent ?? null);
        setMoonPhaseAngle(moon.phase_angle ?? null);
        setMoonPhaseTrend(moon.phase_trend ?? null);
        setMoonPhaseDate(moon.phase_date ?? null);
        setMoonPhaseName(normalizeMoonPhaseName(moon.phase_string) ?? 'Moon phase unavailable');
      } catch (error) {
        console.log('Moon fetch error:', error);
        if (isMounted) {
          setMoonPhaseName('Moon data unavailable');
        }
      }
    }

    async function loadViewingScore(coords: { latitude: number; longitude: number }) {
      try {
        setViewingScoreStatus('loading');
        const score = await fetchViewingScore(coords);
        if (!isMounted) return;
        setViewingScore(score.viewing_score ?? null);
        setViewingScoreInputs(score.inputs ?? null);
        setViewingScoreStatus(score.viewing_score == null ? 'unavailable' : 'ready');
      } catch (error) {
        console.log('Viewing score fetch error:', error);
        if (isMounted) {
          setViewingScore(null);
          setViewingScoreInputs(null);
          setViewingScoreStatus('unavailable');
        }
      }
    }

    async function loadIssPass(coords: { latitude: number; longitude: number }) {
      try {
        setIsIssLoading(true);
        setIssError(null);
        const iss = await fetchIssPasses({ ...coords, count: 1, daysAhead: 14 });
        if (!isMounted) return;
        setNextIssPass(iss.passes?.[0] ?? null);
      } catch (error) {
        console.log('ISS pass fetch error:', error);
        if (isMounted) {
          setNextIssPass(null);
          setIssError('Could not load ISS pass data');
        }
      } finally {
        if (isMounted) setIsIssLoading(false);
      }
    }

    async function loadVisibleBodies(coords: { latitude: number; longitude: number }) {
      try {
        setIsBodiesLoading(true);
        setBodiesError(null);
        const bodies = await fetchVisibleBodies(coords);
        if (!isMounted) return;
        setVisibleBodies(bodies.results ?? []);
      } catch (error) {
        console.log('Visible bodies fetch error:', error);
        if (isMounted) {
          setVisibleBodies([]);
          setBodiesError('Could not load visible bodies');
        }
      } finally {
        if (isMounted) setIsBodiesLoading(false);
      }
    }

    async function loadWeather(coords: { latitude: number; longitude: number }) {
      try {
        setIsWeatherLoading(true);
        setWeatherError(null);
        const weather = await fetchCurrentWeather(coords);
        if (!isMounted) return;
        setCurrentWeather(weather);
      } catch (error) {
        console.log('Weather fetch error:', error);
        if (isMounted) {
          setCurrentWeather(null);
          setWeatherError('Could not load weather');
        }
      } finally {
        if (isMounted) setIsWeatherLoading(false);
      }
    }

    (async () => {
      try {
        const coords = await getOrRequestUserLocation();
        if (!isMounted) return;
        if (!coords) {
          setBrowserCoords(null);
          setViewingScore(null);
          setViewingScoreInputs(null);
          setViewingScoreStatus('location-required');
          setLocationLabel(LOCATION_REQUIRED_LABEL);
          setLocationMessage(LOCATION_SETTINGS_MESSAGE);
          setNextIssPass(null);
          setIsIssLoading(false);
          setIssError(null);
          setVisibleBodies([]);
          setIsBodiesLoading(false);
          setBodiesError(null);
          setCurrentWeather(null);
          setIsWeatherLoading(false);
          setWeatherError(null);
          clearMoonData('Location permission required');
          return;
        }

        setBrowserCoords(coords);
        setLocationLabel(formatCoordinates(coords.latitude, coords.longitude));
        setLocationMessage(
          coords.source === 'ip'
            ? 'Sky data is based on your approximate IP-based location.'
            : 'Sky data is based on your current browser location.'
        );
        void loadMoonPhase(coords);
        void loadViewingScore(coords);
        void loadIssPass(coords);
        void loadVisibleBodies(coords);
        void loadWeather(coords);

        try {
          const nearest = await fetchNearestLocation(coords);
          if (!isMounted) return;
          setLocationLabel(nearest.label);
        } catch (error) {
          console.log('Nearest city lookup unavailable:', error);
        }

        try {
          const places = await Location.reverseGeocodeAsync({
            latitude: coords.latitude,
            longitude: coords.longitude,
          });

          if (!isMounted || places.length === 0) return;
          const place = places[0];
          const city = place.city ?? place.subregion;
          const region = place.region ?? '';
          if (city) setLocationLabel(region ? `${city}, ${region}` : city);
        } catch (error) {
          console.log('Reverse geocode unavailable:', error);
        }
      } catch {
        if (!isMounted) return;
        setBrowserCoords(null);
        setViewingScore(null);
        setViewingScoreInputs(null);
        setViewingScoreStatus('unavailable');
        setLocationLabel(LOCATION_REQUIRED_LABEL);
        setLocationMessage(LOCATION_SETTINGS_MESSAGE);
        setNextIssPass(null);
        setIsIssLoading(false);
        setIssError(null);
        setVisibleBodies([]);
        setIsBodiesLoading(false);
        setBodiesError(null);
        setCurrentWeather(null);
        setIsWeatherLoading(false);
        setWeatherError(null);
        clearMoonData('Location unavailable');
      }
    })();

    return () => {
      isMounted = false;
    };
  }, []);

  const dashboardContent = (
    <SafeAreaView style={styles.app}>
      <View style={styles.starField}>
        {STARS.map((star, i) => (
          <View key={i} style={{
            position: 'absolute',
            top: `${star.top}%` as any,
            left: `${star.left}%` as any,
            width: star.size,
            height: star.size,
            borderRadius: star.size,
            backgroundColor: Palette.textPrimary,
            opacity: star.opacity,
          }} />
        ))}
      </View>

      {[0, 800, 1600, 2400, 3200, 4000].map((delay, i) => (
        <ShootingStar key={i} delay={delay} />
      ))}

      <View style={styles.body}>
        {/* ---------- MAIN CONTENT ---------- */}
        <ScrollView
          style={[styles.main, isMobile && styles.mobileSnapScroll]}
          contentContainerStyle={[styles.mainScrollContent, isMobile && styles.mainScrollContentMobile]}
          decelerationRate={isMobile ? 'fast' : 'normal'}
          disableIntervalMomentum={isMobile}>
          <View style={[styles.mainContent, isMobile && styles.mainContentMobile]} testID="dashboard-main-content">
          <View style={[styles.topBar, isMobile && styles.topBarMobile]} testID="dashboard-topbar">
            <View style={styles.topBarCopy}>
              <Text style={styles.eyebrow}>
                {`TONIGHT SKY - ${today.toLocaleDateString('en-US', {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                }).toUpperCase()}`}
              </Text>
              <Text style={[styles.greeting, isMobile && styles.greetingMobile]}>
                {isLocked ? 'Welcome to Star Window' : `${getSkyGreeting(viewingScore, viewingScoreStatus)}, ${firstName}`}
              </Text>
            </View>
            {isLocked ? (
              <View style={[styles.guestTopActions, isMobile && styles.guestTopActionsMobile]} testID="dashboard-top-actions">
                <View style={[styles.locationChip, isMobile && styles.locationChipMobile]} testID="dashboard-location-chip">
                  <Text style={styles.locationChipText} numberOfLines={1}>📍 {locationLabel}</Text>
                </View>
                <Pressable style={styles.topSignInButton} onPress={() => router.push('/login' as any)}>
                  <Text style={styles.topSignInText}>SIGN IN</Text>
                </Pressable>
                <Pressable style={styles.topCreateButton} onPress={() => router.push('/signup' as any)}>
                  <Text style={styles.topCreateText}>CREATE ACCOUNT</Text>
                </Pressable>
                <SoundToggle />
              </View>
            ) : (
              <View style={[styles.guestTopActions, isMobile && styles.guestTopActionsMobile]} testID="dashboard-top-actions">
                <View style={[styles.locationChip, isMobile && styles.locationChipMobile]} testID="dashboard-location-chip">
                  <Text style={styles.locationChipText} numberOfLines={1}>📍 {locationLabel}</Text>
                </View>
                <SoundToggle />
              </View>
            )}
          </View>

          {!isLocked && viewingScoreStatus === 'ready' && viewingScoreInputs ? (
            <ViewingScoreBreakdown score={viewingScore} inputs={viewingScoreInputs} />
          ) : null}

{/*
          <SectionLabel text="ACCOUNT" /> */}

          {!isLocked ? (
            <Pressable style={[styles.profileCard, isMobile && styles.profileCardMobile]} onPress={() => router.replace('/profile')}>
              <View style={styles.profileRing}>
                <View style={styles.profileAvatar} />
              </View>
              <View style={styles.profileText}>
                <Text style={styles.previewTitle}>{displayName}</Text>
                <Text style={styles.previewMeta}>{profileMeta}</Text>
                {levelProgressLabel ? (
                  <View style={[styles.profileLevelProgress, isMobile && styles.profileLevelProgressMobile]}>
                    <View style={styles.profileLevelTrack}>
                      <View style={[styles.profileLevelFill, { width: `${levelProgressPercent}%` as any }]} />
                    </View>
                    <Text style={styles.profileLevelMeta}>{levelProgressLabel}</Text>
                  </View>
                ) : null}
              </View>
            </Pressable>
          ) : null}


          {/* ---------- ISS HERO ---------- */}
          <View style={[styles.hero, isMobile && styles.heroMobile]}>
            <View style={[styles.heroLeft, isMobile && styles.heroLeftMobile]}>

              <View style={[styles.heroNow, isMobile && styles.heroNowMobile]}>
                <View style={styles.pulseDot} />
                <Text style={styles.heroNowText}>
                  {locationMessage}
                </Text>
              </View>

              <Text style={styles.heroEyebrow}>ISS PASS - LIVE</Text>
              <Text style={[styles.heroTitle, isMobile && styles.heroTitleMobile]}>
                {formatIssTitle({
                  isLoading: isIssLoading,
                  error: issError,
                  hasLocation: Boolean(browserCoords),
                  pass: nextIssPass,
                })}
              </Text>

              <View style={[styles.heroStats, isMobile && styles.heroStatsMobile]}>
                <Stat label="RISE" value={nextIssPass?.rise?.time ? formatIssClock(nextIssPass.rise.time) : '--'} />
                <Stat label="PEAK" value={nextIssPass?.peak?.elevation_deg != null ? `${Math.round(nextIssPass.peak.elevation_deg)} deg` : '--'} />
                <Stat label="DURATION" value={formatIssDuration(nextIssPass?.visible_duration_sec ?? nextIssPass?.duration_sec) ?? '--'} />
              </View>

              <Text style={styles.heroMetaText}>
                {keepPipeGroupsTogether(isIssLoading
                  ? 'Checking visible passes for your location.'
                  : issError
                  ? issError
                  : formatIssMeta(nextIssPass, Boolean(browserCoords)))}
              </Text>
            </View>

            <View style={[styles.issHeroStage, isMobile && styles.issHeroStageMobile]}>
              {isIssLoading ? (
                <PreviewLoadingThumb label="Checking ISS orbit..." size={96} />
              ) : (
                <IssThumb pass={nextIssPass} variant="hero" />
              )}
            </View>
          </View>

          <SectionLabel text="YOUR TABS" />

          {/* ---------- PREVIEW CARDS ---------- */}
          <View style={styles.previewGrid} testID="dashboard-preview-grid">
            <PreviewCard
              eyebrow="CALENDAR"
              badge={calendarBadge}
              badgeColor={Palette.accentBlue}
              title={calendarTitle}
              meta={calendarMeta}
              thumb={
                isEventsLoading || isLockedCalendarEventCountLoading ? (
                  <PreviewLoadingThumb label="Loading calendar..." />
                ) : (
                  <CalendarThumb events={currentMonthEvents} />
                )
              }
              onPress={() => router.replace('/calendar' as any)}
              locked={isLocked}
            />

            <PreviewCard
              eyebrow="LIGHT POLLUTION MAP"
              badge="LIVE"
              badgeColor={Palette.accentGreen}
              title="Your Sky Tonight"
              meta={browserCoords ? locationLabel : 'Enable location for current sky map'}
              thumb={<MapThumb coords={browserCoords} locationLabel={locationLabel} />}
              onPress={() => router.replace(eventDetailRoute({
                category: 'event',
                type: 'Sky Conditions',
                name: 'Your Sky Tonight',
                date: today.toISOString(),
                description: [locationMessage, getSkyGreeting(viewingScore, viewingScoreStatus)]
                  .filter(Boolean)
                  .join(' | '),
                location: browserCoords ? locationLabel : null,
                synthetic: true,
              }) as any)}
              locked={isLocked}
            />

            <PreviewCard
              eyebrow="LAUNCHES"
              badge={isLaunchLoading ? 'LOADING' : launchError ? 'UNAVAILABLE' : formatLaunchBadge(nextLaunch)}
              badgeColor={Palette.accent}
              title={
                isLaunchLoading
                  ? 'Loading next launch...'
                  : launchError
                  ? 'Launch data unavailable'
                  : nextLaunch?.name ?? 'No upcoming launches'
              }
              meta={
                isLaunchLoading
                  ? 'Fetching the latest launch schedule.'
                  : launchError
                  ? launchError
                  : formatLaunchMeta(nextLaunch)
              }
              thumb={
                isLaunchLoading ? (
                  <PreviewLoadingThumb label="Loading launch data..." />
                ) : (
                  <LaunchThumb imageUrl={nextLaunch?.image ?? null} />
                )
              }
              onPress={() => router.replace(eventDetailRoute({
                eventId: nextLaunch?.event_id ?? null,
                category: 'launch',
                type: 'Rocket Launch',
                name: nextLaunch?.name ?? 'Upcoming Launches',
                date: nextLaunch?.net ?? null,
                datePrecision: nextLaunch?.net_precision ?? null,
                description: nextLaunch?.mission?.description ?? formatLaunchMeta(nextLaunch),
                imageUrl: nextLaunch?.image ?? null,
                location: nextLaunch?.pad?.location ?? nextLaunch?.pad?.name ?? null,
                videoUrl: nextLaunch?.video_url ?? null,
                videoUrls: nextLaunch?.video_urls ?? null,
                externalUrl: nextLaunch?.external_url ?? null,
                externalUrls: nextLaunch?.external_urls ?? null,
                synthetic: true,
              }) as any)}
              locked={isLocked}
            />

            <PreviewCard
              eyebrow="METEOR SHOWER"
              badge={formatMeteorBadge({
                isLoading: isMeteorLoading,
                error: meteorError,
                shower: nextMeteorShower,
              })}
              badgeColor={Palette.accent}
              title={
                isMeteorLoading
                  ? 'Loading meteor shower...'
                  : meteorError
                  ? 'Meteor showers unavailable'
                  : nextMeteorShower?.name ?? 'No upcoming meteor shower'
              }
              meta={
                isMeteorLoading
                  ? 'Fetching the next major meteor shower.'
                  : meteorError
                  ? meteorError
                  : formatMeteorMeta(nextMeteorShower, Boolean(browserCoords))
              }
              thumb={
                isMeteorLoading ? (
                  <PreviewLoadingThumb label="Loading meteor shower..." />
                ) : (
                  <MeteorThumb shower={nextMeteorShower} hasLocation={Boolean(browserCoords)} />
                )
              }
              onPress={() => router.replace(eventDetailRoute({
                eventId: nextMeteorShower?.event_id ?? nextMeteorShower?.id ?? null,
                category: 'event',
                type: nextMeteorShower?.type ?? 'Meteor Shower',
                name: nextMeteorShower?.name ?? 'Upcoming Meteor Shower',
                date: nextMeteorShower?.date ?? null,
                datePrecision: nextMeteorShower?.date_precision ?? null,
                description: nextMeteorShower?.description ?? formatMeteorMeta(nextMeteorShower, Boolean(browserCoords)),
                imageUrl: nextMeteorShower?.image_url ?? null,
                location: nextMeteorShower?.location ?? null,
                synthetic: true,
              }) as any)}
              locked={isLocked}
            />

            <PreviewCard
              eyebrow="VISIBLE BODIES"
              badge={formatBodiesBadge({
                isLoading: isBodiesLoading,
                error: bodiesError,
                hasLocation: Boolean(browserCoords),
                count: visibleBodies.length,
              })}
              badgeColor={Palette.accentBlue}
              title={
                isBodiesLoading
                  ? 'Loading visible bodies...'
                  : bodiesError
                  ? 'Visible bodies unavailable'
                  : visibleBodies.length > 0
                  ? 'Planets & Bodies Tonight'
                  : 'No visible bodies found'
              }
              meta={
                isBodiesLoading
                  ? `Checking the sky at ${UNKNOWN_OBSERVING_TIME} for your location.`
                  : bodiesError
                  ? bodiesError
                  : formatBodiesMeta(visibleBodies)
              }
              thumb={
                isBodiesLoading ? (
                  <PreviewLoadingThumb label="Checking visible bodies..." />
                ) : (
                  <BodiesThumb bodies={visibleBodies} />
                )
              }
              onPress={() => router.replace(eventDetailRoute({
                category: 'event',
                type: 'Visible Body',
                name: "Today's Visible Bodies",
                date: visibleBodies[0]?.observed_date ?? today.toISOString(),
                datePrecision: 'Day',
                description: formatBodiesMeta(visibleBodies),
                imageUrl: visibleBodies.find((body) => body.image_url)?.image_url ?? null,
                location: browserCoords ? locationLabel : null,
                visibleBodies: toVisibleBodyRouteItems(visibleBodies),
                synthetic: true,
              }) as any)}
              locked={isLocked}
            />

            <PreviewCard
              eyebrow="SPACEWALKS"
              badge={formatSpacewalkBadge({
                isLoading: isSpacewalkLoading,
                error: spacewalkError,
                spacewalk: nextSpacewalk,
              })}
              badgeColor={Palette.accentGreen}
              title={
                isSpacewalkLoading
                  ? 'Loading spacewalk schedule...'
                  : spacewalkError
                  ? 'Spacewalks unavailable'
                  : nextSpacewalk?.name ?? 'No spacewalk data'
              }
              meta={
                isSpacewalkLoading
                  ? 'Checking upcoming and recent EVA data.'
                  : spacewalkError
                  ? spacewalkError
                  : formatSpacewalkMeta(nextSpacewalk)
              }
              thumb={
                isSpacewalkLoading ? (
                  <PreviewLoadingThumb label="Loading spacewalks..." />
                ) : (
                  <SpacewalkThumb spacewalk={nextSpacewalk} />
                )
              }
              onPress={() => router.replace(eventDetailRoute({
                eventId: displayedSpacewalkEvent?.event_id ?? displayedSpacewalkEvent?.id ?? null,
                category: 'event',
                type: displayedSpacewalkEvent?.type ?? 'Spacewalk',
                name: nextSpacewalk?.name ?? 'Spacewalk',
                date: nextSpacewalk?.start ?? null,
                datePrecision: displayedSpacewalkEvent?.date_precision ?? null,
                description: nextSpacewalk?.description ?? formatSpacewalkMeta(nextSpacewalk),
                imageUrl: nextSpacewalk?.image_url ?? null,
                location: nextSpacewalk?.location ?? nextSpacewalk?.space_station ?? null,
                videoUrl: displayedSpacewalkEvent?.video_url ?? null,
                videoUrls: displayedSpacewalkEvent?.video_urls ?? null,
                externalUrl: displayedSpacewalkEvent?.external_url ?? null,
                externalUrls: displayedSpacewalkEvent?.external_urls ?? null,
                synthetic: true,
              }) as any)}
              locked={isLocked}
            />

            <PreviewCard
              eyebrow="MOON PHASE"
              badge={moonPhasePercent === null ? 'LOADING' : 'LIVE'}
              badgeColor={Palette.accent}
              title={moonPhaseName}
              meta={`${formatMoonPercent(moonPhasePercent)} illuminated | ${formatMoonTrend(moonPhaseTrend)} | ${formatMoonDate(moonPhaseDate)}`}
              thumb={
                moonPhasePercent === null ? (
                  <PreviewLoadingThumb label="Loading moon phase..." size={86} />
                ) : (
                  <MoonThumb
                    imageUrl={moonImageUrl}
                    phaseName={moonPhaseName}
                    phasePercent={moonPhasePercent}
                    phaseAngle={moonPhaseAngle}
                    phaseTrend={moonPhaseTrend}
                  />
                )
              }
              locked={isLocked}
              fullWidth
            />

            <PreviewCard
              eyebrow="NASA NEWS"
              badge={formatNewsBadge({
                isLoading: isNewsLoading,
                error: newsError,
                article: nasaArticle,
              })}
              badgeColor={Palette.accent}
              title={
                isNewsLoading
                  ? 'Loading NASA news...'
                  : newsError
                  ? 'NASA news unavailable'
                  : nasaArticle?.title ?? 'No NASA news found'
              }
              meta={
                isNewsLoading
                  ? 'Fetching the latest NASA news article.'
                  : newsError
                  ? newsError
                  : formatNewsMeta(nasaArticle)
              }
              thumb={
                isNewsLoading ? (
                  <PreviewLoadingThumb label="Loading NASA news..." />
                ) : (
                  <NewsThumb article={nasaArticle} />
                )
              }
              onPress={nasaArticle?.url ? () => openExternalUrl(nasaArticle.url) : undefined}
              locked={isLocked}
              wide
            />

            <PreviewCard
              eyebrow="TODAY'S WEATHER"
              badge={formatWeatherBadge({
                isLoading: isWeatherLoading,
                error: weatherError,
                hasLocation: Boolean(browserCoords),
              })}
              badgeColor={Palette.accentBlue}
              title={
                isWeatherLoading
                  ? 'Loading weather...'
                  : weatherError
                  ? 'Weather unavailable'
                  : `${formatTemperature(currentWeather?.temp, currentWeather?.units)} Today`
              }
              meta={
                isWeatherLoading
                  ? 'Checking clouds, humidity, and current conditions.'
                  : weatherError
                  ? weatherError
                  : formatWeatherMeta(currentWeather)
              }
              thumb={
                isWeatherLoading ? (
                  <PreviewLoadingThumb label="Loading weather..." />
                ) : (
                  <WeatherThumb weather={currentWeather} />
                )
              }
              locked={isLocked}
              wide
            />
          </View>


          </View>
        </ScrollView>
      </View>
    </SafeAreaView>
  );

  return dashboardContent;
}

/* ---------- small subcomponents ---------- */

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

/** Plain-language sky-darkness class for a Bortle-like light-pollution level. */
function bortleLabel(level: number): string {
  if (level <= 2) return 'excellent dark sky';
  if (level <= 3) return 'rural sky';
  if (level <= 4) return 'rural / suburban';
  if (level <= 5) return 'suburban sky';
  if (level <= 6) return 'bright suburban';
  if (level <= 7) return 'suburban / urban';
  if (level <= 8) return 'city sky';
  return 'inner-city sky';
}

/**
 * Breakdown of the (time-gated) viewing score: what's driving it right now —
 * time of day, cloud cover, and light pollution.
 */
function ViewingScoreBreakdown({
  score,
  inputs,
}: {
  score: number | null;
  inputs: NonNullable<ViewingScoreResponse['inputs']>;
}) {
  const width = useReliableWindowWidth();
  const isMobile = isDashboardMobileWidth(width);
  const darkness = inputs.darkness_factor ?? null;
  const clouds = inputs.clouds_pct ?? null;
  const light = inputs.light_pollution_level ?? null;

  const timeText =
    darkness == null
      ? '--'
      : darkness <= 0
        ? 'Daytime — sun is up'
        : darkness < 1
          ? 'Twilight — sun near horizon'
          : 'Dark — good for viewing';

  // Lead with whatever is hurting the score the most.
  const why =
    darkness != null && darkness <= 0
      ? "It's daytime where you are — the sun is up, so the score stays at 0 until after dark."
      : darkness != null && darkness < 1
        ? 'The sun is near the horizon; the score climbs as the sky darkens.'
        : clouds != null && clouds >= 60
          ? 'Heavy cloud cover is the main drag on tonight’s score.'
          : light != null && light >= 6
            ? 'Bright local light pollution is limiting your score tonight.'
            : 'Here’s what’s shaping your score right now.';

  const compactWhy =
    darkness != null && darkness <= 0
      ? 'Daylight now. Check again after dark.'
      : darkness != null && darkness < 1
        ? 'Twilight now. Viewing improves as the sky darkens.'
        : clouds != null && clouds >= 60
          ? 'Cloud cover is the main limit tonight.'
          : light != null && light >= 6
            ? 'Light pollution is limiting visibility.'
            : 'Good context for tonight.';

  return (
    <View style={[styles.scoreBreakdown, isMobile && styles.scoreBreakdownMobile]}>
      <View style={styles.scoreBreakdownHeader}>
        <Text style={[styles.scoreBreakdownLabel, isMobile && styles.scoreBreakdownLabelMobile]}>
          VIEWING SCORE
        </Text>
        <Text style={[styles.scoreBreakdownValue, isMobile && styles.scoreBreakdownValueMobile]}>
          {score ?? '--'}
        </Text>
      </View>
      <Text style={[styles.scoreBreakdownWhy, isMobile && styles.scoreBreakdownWhyMobile]}>
        {isMobile ? compactWhy : why}
      </Text>
      {isMobile ? (
        <View style={styles.scoreCompactMetrics}>
          <View style={styles.scoreCompactMetric}>
            <Text style={styles.scoreCompactLabel}>Clouds</Text>
            <Text style={styles.scoreCompactValue}>
              {clouds != null ? `${Math.round(clouds)}%` : '--'}
            </Text>
          </View>
          <View style={styles.scoreCompactMetric}>
            <Text style={styles.scoreCompactLabel}>Light</Text>
            <Text style={styles.scoreCompactValue}>
              {light != null ? `Bortle ${Math.round(light)}` : '--'}
            </Text>
          </View>
        </View>
      ) : (
        <View style={styles.scoreBreakdownRow}>
          <Stat label="TIME OF DAY" value={timeText} />
          <Stat label="CLOUD COVER" value={clouds != null ? `${Math.round(clouds)}%` : '--'} />
          <Stat
            label="LIGHT POLLUTION"
            value={light != null ? `Bortle ~${Math.round(light)} · ${bortleLabel(light)}` : '--'}
          />
        </View>
      )}
    </View>
  );
}

function SectionLabel({ text }: { text: string }) {
  return (
    <View style={styles.sectionLabelRow}>
      <Text style={styles.sectionLabelText}>{text}</Text>
      <View style={styles.sectionLabelLine} />
    </View>
  );
}

function PreviewCard({
  eyebrow,
  badge,
  badgeColor,
  title,
  meta,
  thumb,
  onPress,
  locked = false,
  fullWidth = false,
  wide = false,
}: {
  eyebrow: string;
  badge: string;
  badgeColor: string;
  title: string;
  meta: string;
  thumb: React.ReactNode;
  onPress?: () => void;
  locked?: boolean;
  fullWidth?: boolean;
  wide?: boolean;
}) {
  const router = useRouter();
  const width = useReliableWindowWidth();
  const isMobile = isDashboardMobileWidth(width);
  const handlePress = locked ? () => router.push('/signup' as any) : onPress;
  const metaLineCount = isMobile ? 2 : 3;

  return (
    <Pressable
      style={[styles.previewCard, wide && styles.previewCardWide, fullWidth && styles.previewCardFullWidth, isMobile && styles.previewCardMobile]}
      testID={fullWidth ? 'dashboard-preview-card-full' : wide ? 'dashboard-preview-card-wide' : 'dashboard-preview-card'}
      onPress={handlePress}
      disabled={!handlePress}>
      <View
        style={[styles.previewThumb, fullWidth && styles.previewThumbFullWidth, isMobile && styles.previewThumbMobile]}
        testID={fullWidth ? 'dashboard-preview-thumb-full' : 'dashboard-preview-thumb'}>
        <View style={locked ? styles.lockedThumbContent : styles.previewThumbContent}>
          {thumb}
        </View>
        {locked ? (
          <View style={styles.cardLockOverlay}>
            <View style={styles.cardLockCircle}>
              <Text style={styles.cardLockIcon}>🔒</Text>
            </View>
            <Text style={styles.cardLockTitle}>ACCOUNT REQUIRED</Text>
            <Text style={styles.cardLockText}>Tap to create an account</Text>
          </View>
        ) : null}
      </View>
      <View style={[styles.previewBody, isMobile && styles.previewBodyMobile]}>
        <View style={[styles.previewEyebrowRow, isMobile && styles.previewEyebrowRowMobile]}>
          <Text style={styles.previewEyebrow}>{eyebrow}</Text>
          <View style={[styles.badge, { backgroundColor: badgeColor + '20' }]}>
            <Text style={[styles.badgeText, { color: badgeColor }]}>{badge}</Text>
          </View>
        </View>
        <Text style={[styles.previewTitle, isMobile && styles.previewTitleMobile, locked && styles.lockedPreviewText]} numberOfLines={2}>{title}</Text>
        <Text style={[styles.previewMeta, isMobile && styles.previewMetaMobile, locked && styles.lockedPreviewText]} numberOfLines={metaLineCount}>{keepPipeGroupsTogether(meta)}</Text>
      </View>
    </Pressable>
  );
}

function CalendarThumb({ events }: { events: CalendarEvent[] }) {
  const today = new Date();

  return (
    <MonthGrid
      year={today.getFullYear()}
      month={today.getMonth()}
      selectedDate={today}
      events={events}
      compact
      thumbnail
    />
  );
}

function PreviewLoadingThumb({ label, size = 76 }: { label: string; size?: number }) {
  return (
    <View style={styles.previewLoadingThumb}>
      <OrbitalLoader label={label} size={size} compact />
    </View>
  );
}

function MoonThumb({
  imageUrl,
  phaseName,
  phasePercent,
  phaseAngle,
  phaseTrend,
}: {
  imageUrl: string | null;
  phaseName: string;
  phasePercent: number | null;
  phaseAngle: number | null;
  phaseTrend: string | null;
}) {
  return (
    <View style={styles.moonThumb}>
      <View style={styles.moonThumbRing} />
      <View style={styles.moonThumbDisc}>
        <GeneratedMoonPhase
          phaseName={phaseName}
          phasePercent={phasePercent}
          phaseAngle={phaseAngle}
          phaseTrend={phaseTrend}
        />
      </View>
      <View style={styles.moonThumbLabel}>
        <Text style={styles.bodyNameText} numberOfLines={1}>{phaseName}</Text>
      </View>
    </View>
  );
}

function GeneratedMoonPhase({
  phaseName,
  phasePercent,
  phaseAngle,
  phaseTrend,
}: {
  phaseName: string;
  phasePercent: number | null;
  phaseAngle: number | null;
  phaseTrend: string | null;
}) {
  const illumination = getMoonIlluminationPercent(phasePercent, phaseAngle);

  if (illumination === null) {
    return <OrbitalLoader size={62} compact />;
  }

  const phaseKey = getMoonPhaseKey(phaseName, illumination, phaseAngle, phaseTrend);
  const shadeCircleStyle = getMoonShadeCircleStyle(phaseKey);
  const lightCircleStyle = getMoonLightCircleStyle(phaseKey);

  return (
    <View style={styles.generatedMoon}>
      {phaseKey === 'full' ? <View style={styles.generatedMoonLightSurface} /> : null}
      {phaseKey === 'first-quarter' ? (
        <View style={[styles.generatedMoonHalfLight, styles.generatedMoonRightSide]} />
      ) : null}
      {phaseKey === 'third-quarter' ? (
        <View style={[styles.generatedMoonHalfLight, styles.generatedMoonLeftSide]} />
      ) : null}
      {shadeCircleStyle ? (
        <>
          <View style={styles.generatedMoonLightSurface} />
          <View style={[styles.generatedMoonShadeCircle, shadeCircleStyle]} />
        </>
      ) : null}
      {lightCircleStyle ? <View style={[styles.generatedMoonLightCircle, lightCircleStyle]} /> : null}
      <View style={[styles.generatedMoonCrater, styles.generatedMoonCraterLarge]} />
      <View style={[styles.generatedMoonCrater, styles.generatedMoonCraterMedium]} />
      <View style={[styles.generatedMoonCrater, styles.generatedMoonCraterSmall]} />
      <View style={styles.generatedMoonLimb} />
    </View>
  );
}

function getMoonPhaseKey(
  phaseName: string,
  illumination: number,
  phaseAngle: number | null,
  phaseTrend: string | null
) {
  const name = phaseName.toLowerCase();
  if (name.includes('new')) return 'new';
  if (name.includes('full')) return 'full';
  if (name.includes('first')) return 'first-quarter';
  if (name.includes('third') || name.includes('last')) return 'third-quarter';
  if (name.includes('waxing') && (name.includes('crescent') || name.includes('crescen'))) return 'waxing-crescent';
  if (name.includes('waxing') && name.includes('gibbous')) return 'waxing-gibbous';
  if (name.includes('waning') && (name.includes('crescent') || name.includes('crescen'))) return 'waning-crescent';
  if (name.includes('waning') && name.includes('gibbous')) return 'waning-gibbous';

  if (phaseAngle !== null && Number.isFinite(phaseAngle)) {
    const angle = normalizeMoonAngle(phaseAngle);
    if (angle < 22.5 || angle >= 337.5) return 'new';
    if (angle < 67.5) return 'waxing-crescent';
    if (angle < 112.5) return 'first-quarter';
    if (angle < 157.5) return 'waxing-gibbous';
    if (angle < 202.5) return 'full';
    if (angle < 247.5) return 'waning-gibbous';
    if (angle < 292.5) return 'third-quarter';
    return 'waning-crescent';
  }

  if (illumination <= 8) return 'new';
  if (illumination >= 92) return 'full';

  const isWaxing = getIsWaxingMoon(phaseTrend, phaseAngle);
  if (illumination < 42) return isWaxing ? 'waxing-crescent' : 'waning-crescent';
  if (illumination > 58) return isWaxing ? 'waxing-gibbous' : 'waning-gibbous';
  return isWaxing ? 'first-quarter' : 'third-quarter';
}

function getMoonShadeCircleStyle(phaseKey: string) {
  if (phaseKey === 'waxing-crescent') return styles.generatedMoonWaxingCrescentShade;
  if (phaseKey === 'waning-crescent') return styles.generatedMoonWaningCrescentShade;
  return null;
}

function getMoonLightCircleStyle(phaseKey: string) {
  if (phaseKey === 'waxing-gibbous') return styles.generatedMoonWaxingGibbousLight;
  if (phaseKey === 'waning-gibbous') return styles.generatedMoonWaningGibbousLight;
  return null;
}

function getMoonIlluminationPercent(phasePercent: number | null, phaseAngle: number | null) {
  if (phasePercent !== null && Number.isFinite(phasePercent)) {
    return Math.max(0, Math.min(100, phasePercent));
  }

  if (phaseAngle !== null && Number.isFinite(phaseAngle)) {
    const radians = (normalizeMoonAngle(phaseAngle) * Math.PI) / 180;
    return Math.max(0, Math.min(100, ((1 - Math.cos(radians)) / 2) * 100));
  }

  return null;
}

function getIsWaxingMoon(phaseTrend: string | null, phaseAngle: number | null) {
  const trend = phaseTrend?.toLowerCase() ?? '';
  if (trend.includes('grow') || trend.includes('wax')) return true;
  if (trend.includes('shrink') || trend.includes('wan')) return false;

  if (phaseAngle !== null && Number.isFinite(phaseAngle)) {
    return normalizeMoonAngle(phaseAngle) < 180;
  }

  return true;
}

function normalizeMoonAngle(value: number) {
  return ((value % 360) + 360) % 360;
}

function MapThumb({
  coords,
  locationLabel,
}: {
  coords: { latitude: number; longitude: number } | null;
  locationLabel: string;
}) {
  const center: [number, number] = coords
    ? [coords.latitude, coords.longitude]
    : DASHBOARD_MAP_FALLBACK_CENTER;
  const userLocation = coords ? { lat: coords.latitude, lng: coords.longitude } : null;

  return (
    <View style={styles.mapThumbWrap}>
      <StarMap
        center={center}
        zoom={DASHBOARD_MAP_ZOOM}
        userLocation={userLocation}
        showLightPollution
        preview
        style={styles.mapThumb}
      />
      {coords && (
        <View style={styles.mapLocationChip}>
          <Text style={styles.mapLocationChipText} numberOfLines={1}>
            Current: {locationLabel}
          </Text>
        </View>
      )}
    </View>
  );
}

function LaunchThumb({ imageUrl }: { imageUrl?: string | null }) {
  return (
    <View style={styles.launchThumb}>
      {imageUrl ? (
        <>
          <Image source={{ uri: imageUrl }} style={styles.launchImage} resizeMode="cover" />
          <View style={styles.launchImageScrim} />
        </>
      ) : (
        <>
          <View style={styles.launchTrail} />
          <Text style={styles.launchRocket}>🚀</Text>
        </>
      )}
    </View>
  );
}

function IssThumb({
  pass,
  variant = 'card',
}: {
  pass: IssPass | null;
  variant?: 'card' | 'hero';
}) {
  const width = useReliableWindowWidth();
  const isMobile = isDashboardMobileWidth(width);
  const duration = formatIssDuration(pass?.visible_duration_sec ?? pass?.duration_sec);
  const passTime = pass ? formatIssClock(pass.rise?.time) : 'No pass found';
  const stats = (
    <View style={[styles.issStatsRow, variant === 'hero' && styles.issHeroStatsRow, variant === 'hero' && isMobile && styles.issHeroStatsRowMobile]}>
      <View style={styles.issStatPill}>
        <Text style={styles.issStatLabel}>RISE</Text>
        <Text style={styles.issStatValue}>{pass?.rise?.direction ?? '--'}</Text>
      </View>
      <View style={styles.issStatPill}>
        <Text style={styles.issStatLabel}>PEAK</Text>
        <Text style={styles.issStatValue}>
          {pass?.peak?.elevation_deg != null ? `${Math.round(pass.peak.elevation_deg)} deg` : '--'}
        </Text>
      </View>
      <View style={styles.issStatPill}>
        <Text style={styles.issStatLabel}>DUR</Text>
        <Text style={styles.issStatValue}>{duration ?? '--'}</Text>
      </View>
    </View>
  );

  if (variant === 'hero') {
    return (
      <View style={[styles.issThumb, styles.issHeroThumb, isMobile && styles.issHeroThumbMobile]}>
        <Text style={[styles.issHeroPassLabelText, isMobile && styles.issHeroPassLabelTextMobile]}>NEXT VISIBLE PASS</Text>
        <View style={[styles.issOrbitArc, styles.issHeroOrbitArc, isMobile && styles.issHeroOrbitArcMobile]}>
          <View style={[styles.issNode, styles.issPeakNode]} />
        </View>
        <Text style={[styles.issHeroClockText, isMobile && styles.issHeroClockTextMobile]}>{passTime}</Text>
        <View style={[styles.issStation, styles.issHeroStation, isMobile && styles.issHeroStationMobile]}>
          <Image
            source={require('@/assets/images/iss.png')}
            style={styles.issStationIcon}
            resizeMode="contain"
          />
        </View>
        {stats}
      </View>
    );
  }

  return (
    <View style={styles.issThumb}>
      <View style={styles.issHorizon} />
      <View style={styles.issOrbitArc}>
        <View style={[styles.issNode, styles.issPeakNode]} />
      </View>
      <View style={styles.issStation}>
        <Image
          source={require('@/assets/images/iss.png')}
          style={styles.issStationIcon}
          resizeMode="contain"
        />
      </View>

      <View style={styles.issReadout}>
        <Text style={styles.issReadoutLabel}>NEXT VISIBLE PASS</Text>
        <Text style={styles.issReadoutValue}>{passTime}</Text>
      </View>

      {stats}
    </View>
  );
}

function BodiesThumb({ bodies }: { bodies: VisibleBody[] }) {
  const topBodies = getTopVisibleBodies(bodies);
  const primaryBody = topBodies[0] ?? null;
  const imageUrl = primaryBody?.image_url ?? null;
  const hasImage = Boolean(imageUrl);

  return (
    <View style={[styles.bodiesThumb, hasImage && styles.bodiesThumbWithImage]}>
      {hasImage ? (
        <>
          <Image source={{ uri: imageUrl ?? '' }} style={styles.bodiesImage} resizeMode="contain" />
          <View style={styles.bodiesImageScrim} />
        </>
      ) : (
        <>
          <View style={styles.bodiesSkyArc} />
          <View style={styles.bodiesHorizon} />
          {topBodies.slice(0, 4).map((body, index) => (
            <View
              key={`${body.body}-${index}`}
              style={[
                styles.bodyDot,
                index === 0 && styles.bodyDotPrimary,
                { left: `${18 + index * 20}%` as any, top: `${58 - index * 9}%` as any },
              ]}
            />
          ))}
        </>
      )}
      <View style={styles.bodiesBottomRow}>
        <View style={styles.bodyNamePill}>
          <Text style={styles.bodyNameText} numberOfLines={1}>
            {primaryBody?.body ?? 'No bodies'}
          </Text>
        </View>
        <View style={styles.bodiesReadout}>
          <Text style={styles.bodiesReadoutLabel}>VISIBLE TONIGHT</Text>
          <Text style={styles.bodiesReadoutValue}>
            {formatCount(bodies.length, 'body', 'bodies')}
          </Text>
        </View>
      </View>
    </View>
  );
}

function MeteorThumb({
  shower,
  hasLocation,
}: {
  shower: UpcomingMeteorShower | null;
  hasLocation: boolean;
}) {
  const altitude = toNumber(shower?.radiant_max_altitude_degrees);

  return (
    <View style={styles.meteorThumb}>
      {shower?.image_url ? (
        <Image source={{ uri: shower.image_url }} style={styles.meteorImage} resizeMode="cover" />
      ) : (
        <View style={styles.meteorFallback}>
          <Text style={styles.meteorFallbackText}>M</Text>
        </View>
      )}
      <View style={styles.meteorImageScrim} />
      <View style={styles.issStatsRow}>
        <View style={styles.issStatPill}>
          <Text style={styles.issStatLabel}>PEAK</Text>
          <Text style={styles.issStatValue}>
            {formatMeteorDate(shower?.date)}
          </Text>
        </View>
        <View style={styles.issStatPill}>
          <Text style={styles.issStatLabel}>BEST</Text>
          <Text style={styles.issStatValue}>
            {shower?.best_time ? formatBestTimeLabel(shower.best_time) : '--'}
          </Text>
        </View>
        <View style={styles.issStatPill}>
          <Text style={styles.issStatLabel}>ZHR</Text>
          <Text style={styles.issStatValue}>
            {shower?.zhr ?? '--'}
          </Text>
        </View>
        <View style={styles.issStatPill}>
          <Text style={styles.issStatLabel}>ALT</Text>
          <Text style={styles.issStatValue}>
            {hasLocation && altitude != null ? `${Math.round(altitude)} deg` : '--'}
          </Text>
        </View>
      </View>
    </View>
  );
}

function SpacewalkThumb({ spacewalk }: { spacewalk: UpcomingSpacewalk | null }) {
  const crewCount = spacewalk?.crew?.length ?? 0;
  const imageSource = spacewalk?.image_url
    ? { uri: spacewalk.image_url }
    : require('@/assets/images/spacewalk-astronaut.png');

  return (
    <View style={styles.spacewalkThumb}>
      <Image
        source={imageSource}
        style={styles.spacewalkImage}
        resizeMode="cover"
      />
      <View style={styles.spacewalkImageScrim} />
      <View style={styles.spacewalkBottomRow}>
        <View style={styles.spacewalkCrewPill}>
          <Text style={styles.bodyNameText}>
            {crewCount > 0 ? formatCount(crewCount, 'crew member') : spacewalk ? 'EVA' : 'Crew TBD'}
          </Text>
        </View>
        <View style={styles.spacewalkReadout}>
          <Text style={styles.spacewalkReadoutLabel}>{spacewalk?.schedule_status === 'latest' ? 'LATEST EVA' : 'NEXT EVA'}</Text>
          <Text style={styles.spacewalkReadoutValue} numberOfLines={1}>
            {spacewalk ? formatSpacewalkDate(spacewalk.start) : 'No EVA'}
          </Text>
        </View>
      </View>
    </View>
  );
}

function NewsThumb({ article }: { article: NewsArticle | null }) {
  return (
    <View style={styles.newsThumb}>
      {article?.image_url ? (
        <>
          <Image source={{ uri: article.image_url }} style={styles.newsImage} resizeMode="cover" />
          <View style={styles.newsScrim} />
        </>
      ) : (
        <View style={styles.newsFallback}>
          <Text style={styles.newsFallbackText}>NASA</Text>
        </View>
      )}
    </View>
  );
}

function WeatherThumb({ weather }: { weather: WeatherResponse | null }) {
  const clouds = Math.max(0, Math.min(100, weather?.clouds_pct ?? 0));
  const humidity = Math.max(0, Math.min(100, weather?.humidity ?? 0));
  const weatherImage = getWeatherImageSource(weather?.conditions);

  return (
    <View style={styles.weatherThumb}>
      <Image
        source={weatherImage}
        style={styles.weatherImage}
        resizeMode="cover"
      />
      <View style={styles.weatherImageScrim} />
      <View style={styles.weatherReadout}>
        <Text style={styles.tileReadoutLabel}>CURRENT CONDITIONS</Text>
        <Text style={styles.weatherTempValue}>
          {formatTemperature(weather?.temp, weather?.units)}
        </Text>
      </View>
      <View style={styles.weatherBars}>
        <WeatherBar label="Clouds" value={clouds} />
        <WeatherBar label="Humidity" value={humidity} />
      </View>
    </View>
  );
}

function WeatherBar({ label, value }: { label: string; value: number }) {
  const width = useReliableWindowWidth();
  const isMobile = isDashboardMobileWidth(width);

  if (isMobile) {
    return (
      <View style={styles.weatherMetricMobile}>
        <View style={styles.weatherMetricHeaderMobile}>
          <Text style={styles.weatherMetricLabelMobile}>{label}</Text>
          <Text style={styles.weatherMetricValueMobile}>{Math.round(value)}%</Text>
        </View>
        <View style={styles.weatherMetricTrackMobile}>
          <View style={[styles.weatherBarFill, { width: `${value}%` as any }]} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.weatherBarRow}>
      <Text style={styles.weatherBarLabel}>{label}</Text>
      <View style={styles.weatherBarTrack}>
        <View style={[styles.weatherBarFill, { width: `${value}%` as any }]} />
      </View>
      <Text style={styles.weatherBarValue}>{Math.round(value)}%</Text>
    </View>
  );
}

/* ---------- styles ---------- */

const styles = StyleSheet.create({
  guestTopActions: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' },
  topSignInButton: { paddingHorizontal: 14, paddingVertical: 9, borderWidth: 1, borderColor: Palette.border, borderRadius: Radius.md },
  topSignInText: { color: Palette.textSecondary, fontSize: 9, fontWeight: '700', letterSpacing: 0.8 },
  topCreateButton: { paddingHorizontal: 14, paddingVertical: 9, borderWidth: 1, borderColor: Palette.accent, borderRadius: Radius.md },
  topCreateText: { color: Palette.accent, fontSize: 9, fontWeight: '700', letterSpacing: 0.8 },
  cardLockOverlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: Palette.bgVoid + 'B8' },
  cardLockCircle: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Palette.accent, borderRadius: 19, backgroundColor: Palette.surfaceRaised, marginBottom: 7 },
  cardLockIcon: { fontSize: 14 },
  cardLockTitle: { color: Palette.textPrimary, fontSize: 9, fontWeight: '700', letterSpacing: 1 },
  cardLockText: { color: Palette.textSecondary, fontSize: 9, marginTop: 3 },
  lockedThumbContent: { flex: 1, width: '100%', height: '100%', opacity: 0.36, filter: 'blur(6px)' } as any,
  lockedPreviewText: { opacity: 0.24, filter: 'blur(4px)' } as any,
  app: { flex: 1, backgroundColor: Palette.bgVoid, overflow: 'hidden' },
  starField: {
    position: 'absolute',
    width: '100%',
    height: '100%',
  },
  body: { flex: 1 },

  main: { flex: 1 },
  mobileSnapScroll: {
    scrollSnapType: 'y proximity',
    overscrollBehaviorY: 'contain',
    WebkitOverflowScrolling: 'touch',
  } as any,
  mainScrollContent: {
    padding: Spacing.lg,
    paddingLeft: 20,
    paddingBottom: Spacing.xxl,
    width: '100%',
    alignItems: 'center',
  },
  mainScrollContentMobile: {
    padding: Spacing.md,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.lg,
  },
  mainContent: {
    width: '100%',
    maxWidth: DASHBOARD_MAX_CONTENT_WIDTH,
    gap: Spacing.md,
  },
  mainContentMobile: {
    maxWidth: '100%' as any,
    gap: Spacing.md,
  },
  topBar: {
    marginBottom: 4,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: Spacing.md,
  },
  topBarMobile: {
    flexDirection: 'column',
    gap: Spacing.sm,
    scrollSnapAlign: 'start',
    scrollSnapStop: 'normal',
  } as any,
  topBarCopy: {
    flex: 1,
    minWidth: dvw(0),
  },
  guestTopActionsMobile: {
    width: '100%',
    justifyContent: 'space-between',
  },
  eyebrow: {
    fontSize: 11,
    color: Palette.accent,
    letterSpacing: 1,
    marginBottom: 6,
    fontWeight: '600',
  },
  greeting: {
    fontSize: 26,
    lineHeight: 32,
    fontWeight: '700',
    color: Palette.textPrimary,
  },
  greetingMobile: {
    fontSize: 23,
    lineHeight: 29,
  },
  locationChip: {
    backgroundColor: Palette.surface,
    borderWidth: 1,
    borderColor: Palette.borderSoft,
    borderRadius: Radius.pill,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  locationChipMobile: {
    flex: 1,
    minWidth: 0,
  },
  locationChipText: {
    fontSize: 12,
    color: Palette.textSecondary,
  },

  hero: {
    backgroundColor: Palette.surface,
    borderWidth: 1,
    borderColor: Palette.borderSoft,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.lg,
  },
  heroMobile: {
    paddingTop: Spacing.md,
    paddingBottom: 0,
    paddingHorizontal: 0,
    gap: Spacing.md,
    scrollSnapAlign: 'start',
    scrollSnapStop: 'always',
  } as any,
  heroLeft: {},
  heroLeftMobile: {
    paddingHorizontal: Spacing.md,
  },
  heroEyebrow: {
    fontSize: 11,
    color: Palette.textTertiary,
    letterSpacing: 1,
    marginBottom: 8,
    fontWeight: '600',
  },
  heroTitle: {
    fontSize: 28,
    fontWeight: '600',
    color: Palette.textPrimary,
    marginBottom: Spacing.md,
    lineHeight: 34,
  },
  heroTitleMobile: {
    fontSize: 22,
    lineHeight: 28,
    marginBottom: Spacing.sm,
  },
  heroStats: {
    flexDirection: 'row',
    marginBottom: Spacing.md,
    flexWrap: 'wrap',
    rowGap: Spacing.sm,
    columnGap: Spacing.lg,
  },
  heroStatsMobile: {
    justifyContent: 'space-between',
    columnGap: Spacing.md,
    marginBottom: Spacing.sm,
  },
  heroMetaText: {
    fontSize: 13,
    lineHeight: 19,
    color: Palette.textSecondary,
  },
  scoreBreakdown: {
    backgroundColor: Palette.surface,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: Radius.md,
    padding: Spacing.md,
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  scoreBreakdownMobile: {
    padding: 12,
    gap: 8,
    marginBottom: Spacing.sm,
    borderRadius: Radius.md,
  },
  scoreBreakdownHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  scoreBreakdownLabel: {
    fontSize: 12,
    color: Palette.textTertiary,
    letterSpacing: 1,
    fontWeight: '700',
  },
  scoreBreakdownLabelMobile: {
    fontSize: 10,
    lineHeight: 12,
  },
  scoreBreakdownValue: {
    fontSize: 28,
    color: Palette.accent,
    fontWeight: '700',
  },
  scoreBreakdownValueMobile: {
    fontSize: 24,
    lineHeight: 28,
  },
  scoreBreakdownWhy: {
    fontSize: 13,
    lineHeight: 18,
    color: Palette.textSecondary,
  },
  scoreBreakdownWhyMobile: {
    fontSize: 12,
    lineHeight: 17,
  },
  scoreBreakdownRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: Spacing.sm,
    columnGap: Spacing.lg,
  },
  scoreCompactMetrics: {
    flexDirection: 'row',
    gap: 8,
  },
  scoreCompactMetric: {
    flex: 1,
    minWidth: 0,
    borderWidth: 1,
    borderColor: Palette.borderSoft,
    borderRadius: Radius.sm,
    backgroundColor: Palette.bgDeep,
    paddingVertical: 7,
    paddingHorizontal: 9,
    gap: 2,
  },
  scoreCompactLabel: {
    color: Palette.textTertiary,
    fontSize: 9,
    lineHeight: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  scoreCompactValue: {
    color: Palette.accent,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '800',
  },
  statLabel: {
    fontSize: 10,
    color: Palette.textSecondary,
    marginBottom: 4,
    letterSpacing: 0.5,
    fontWeight: '700',
  },
  statValue: {
    fontSize: 16,
    color: Palette.accent,
    fontWeight: '600',
  },
  heroNow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    backgroundColor: Palette.accent + '14',
    borderWidth: 1,
    borderColor: Palette.accent + '40',
    borderRadius: Radius.sm,
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    borderBottomLeftRadius: Radius.sm,
    borderBottomRightRadius: Radius.sm,
    padding: 10,
    marginTop: -Spacing.lg,
    marginLeft: -Spacing.lg,
    marginRight: -Spacing.lg,
    marginBottom: Spacing.lg,
    gap: 8,
  },
  heroNowMobile: {
    marginTop: -Spacing.md,
    marginLeft: -Spacing.md,
    marginRight: -Spacing.md,
    marginBottom: Spacing.md,
  },
  pulseDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: Palette.accentGreen,
  },
  heroNowText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    color: Palette.textPrimary,
  },
  moonStage: {
    width: '100%',
    height: dvh(160),
    alignItems: 'center',
    justifyContent: 'center',
  },
  moonOrbitRing: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: 80,
    borderWidth: 1,
    borderColor: Palette.border,
    borderStyle: 'dashed',
    opacity: 0.5,
  },
  moonDisc: {
    width: 120,
    height: 120,
    borderRadius: 60,
    overflow: 'hidden',
    backgroundColor: Palette.bgDeep,
    shadowColor: Palette.accent,
    shadowOpacity: 0.4,
    shadowRadius: 30,
    elevation: 8,
  },
  moonImage: {
    width: '100%',
    height: '100%',
  },
  moonImageFromApi: {
    transform: [{ scale: 1.18 }],
  },
  moonLoading: {
    width: '100%',
    height: '100%',
    backgroundColor: Palette.surfaceRaised,
  },
  generatedMoon: {
    width: '100%',
    height: '100%',
    position: 'relative',
    overflow: 'hidden',
    backgroundColor: Palette.moonShadow,
  },
  generatedMoonLightSurface: {
    ...StyleSheet.absoluteFill,
    backgroundColor: Palette.moonLit,
  },
  generatedMoonHalfLight: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: '50%',
    backgroundColor: Palette.moonLit,
  },
  generatedMoonLeftSide: {
    left: 0,
  },
  generatedMoonRightSide: {
    right: 0,
  },
  generatedMoonShadeCircle: {
    position: 'absolute',
    top: 0,
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: Palette.moonShadow,
  },
  generatedMoonWaxingCrescentShade: {
    left: -24,
  },
  generatedMoonWaningCrescentShade: {
    right: -24,
  },
  generatedMoonLightCircle: {
    position: 'absolute',
    top: 0,
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: Palette.moonLit,
  },
  generatedMoonWaxingGibbousLight: {
    right: -14,
  },
  generatedMoonWaningGibbousLight: {
    left: -14,
  },
  generatedMoonCrater: {
    position: 'absolute',
    borderWidth: 1,
    borderColor: alpha(Palette.textMuted, 0.24),
    backgroundColor: alpha(Palette.textMuted, 0.22),
  },
  generatedMoonCraterLarge: {
    width: 18,
    height: 18,
    borderRadius: 9,
    top: 24,
    left: 52,
  },
  generatedMoonCraterMedium: {
    width: 12,
    height: 12,
    borderRadius: 6,
    top: 54,
    left: 30,
  },
  generatedMoonCraterSmall: {
    width: 8,
    height: 8,
    borderRadius: 4,
    top: 62,
    right: 26,
  },
  generatedMoonLimb: {
    ...StyleSheet.absoluteFill,
    borderWidth: 1,
    borderColor: alpha(Palette.textPrimary, 0.26),
    borderRadius: 48,
    backgroundColor: alpha(Palette.textPrimary, 0.03),
  },
  issHeroStage: {
    width: '100%',
    height: dvh(220),
    borderRadius: Radius.md,
    overflow: 'hidden',
    backgroundColor: Palette.bgDeep,
    borderWidth: 1,
    borderColor: Palette.borderSoft,
  },
  issHeroStageMobile: {
    height: 230,
  },
  moonThumb: {
    flex: 1,
    backgroundColor: Palette.bgDeep,
    alignItems: 'center',
    justifyContent: 'flex-start',
    overflow: 'hidden',
    paddingTop: 22,
    paddingBottom: 54,
  },
  moonThumbRing: {
    position: 'absolute',
    top: 4,
    width: 132,
    height: 132,
    borderRadius: 66,
    borderWidth: 1,
    borderColor: Palette.border,
    borderStyle: 'dashed',
    opacity: 0.55,
  },
  moonThumbDisc: {
    width: 96,
    height: 96,
    borderRadius: 48,
    overflow: 'hidden',
    backgroundColor: 'transparent',
    shadowColor: Palette.accent,
    shadowOpacity: 0.36,
    shadowRadius: 22,
    elevation: 6,
  },
  moonThumbLabel: {
    position: 'absolute',
    left: 8,
    right: 8,
    bottom: 8,
    backgroundColor: Palette.surface + 'E6',
    borderWidth: 1,
    borderColor: Palette.borderSoft,
    borderRadius: Radius.sm,
    paddingVertical: 5,
    paddingHorizontal: 8,
    alignItems: 'center',
  },

  sectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  sectionLabelText: {
    fontSize: 12,
    color: Palette.textTertiary,
    letterSpacing: 1,
    fontWeight: '600',
  },
  sectionLabelLine: {
    flex: 1,
    height: dvh(1),
    backgroundColor: Palette.borderSoft,
  },

  previewGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    justifyContent: 'flex-start',
  },
  previewCard: {
    backgroundColor: Palette.surface,
    borderWidth: 1,
    borderColor: Palette.borderSoft,
    borderRadius: Radius.md,
    overflow: 'hidden',
    flexBasis: '32%',
    flexGrow: 0,
    flexShrink: 1,
    minWidth: 280,
  },
  previewCardMobile: {
    flexBasis: '100%',
    width: '100%',
    minWidth: '100%' as any,
    flexGrow: 0,
    borderRadius: Radius.md,
    scrollSnapAlign: 'start',
    scrollSnapStop: 'always',
  } as any,
  previewCardFullWidth: {
    flexBasis: '100%',
    minWidth: '100%' as any,
    width: '100%',
  },
  previewCardWide: {
    flexBasis: '48%',
    flexGrow: 1,
    minWidth: 360,
  },
  previewThumb: {
    height: 168,
    backgroundColor: Palette.bgDeep,
    borderBottomWidth: 1,
    borderBottomColor: Palette.borderSoft,
    overflow: 'hidden',
  },
  previewThumbFullWidth: {
    height: 220,
  },
  previewThumbMobile: {
    height: 154,
  },
  previewThumbContent: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  previewLoadingThumb: {
    flex: 1,
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Palette.bgDeep,
    paddingHorizontal: 12,
  },
  previewBody: {
    padding: Spacing.sm,
    alignItems: 'stretch',
    gap: 3,
  },
  previewBodyMobile: {
    padding: Spacing.md,
    gap: 5,
  },
  previewEyebrowRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: 3,
  },
  previewEyebrowRowMobile: {
    marginBottom: 2,
  },
  previewEyebrow: {
    flex: 1,
    fontSize: 10,
    color: Palette.textTertiary,
    letterSpacing: 0.5,
    fontWeight: '600',
  },
  badge: {
    paddingVertical: 2,
    paddingHorizontal: 7,
    borderRadius: Radius.pill,
  },
  badgeText: {
    fontSize: 8.5,
    fontWeight: '700',
  },
  previewTitle: {
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '600',
    color: Palette.textPrimary,
  },
  previewTitleMobile: {
    fontSize: 17,
    lineHeight: 22,
  },
  previewMeta: {
    fontSize: 12,
    lineHeight: 17,
    color: Palette.textSecondary,
  },
  previewMetaMobile: {
    fontSize: 13,
    lineHeight: 18,
  },

  mapThumbWrap: {
    flex: 1,
    width: '100%',
    height: '100%',
    backgroundColor: Palette.bgDeep,
  },
  mapThumb: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  mapLocationChip: {
    position: 'absolute',
    top: 8,
    left: 8,
    right: 8,
    backgroundColor: Palette.surface + 'E6',
    borderWidth: 1,
    borderColor: Palette.borderSoft,
    borderRadius: Radius.pill,
    paddingVertical: 5,
    paddingHorizontal: 9,
  },
  mapLocationChipText: {
    color: Palette.textPrimary,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '600',
  },

  launchThumb: {
    flex: 1,
    backgroundColor: Palette.bgDeep,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 20,
  },
  launchTrail: {
    position: 'absolute',
    bottom: 0,
    left: '50%',
    marginLeft: -1.5,
    width: dvw(3),
    height: '60%',
    backgroundColor: Palette.accent,
    opacity: 0.5,
  },
  launchRocket: { fontSize: 20 },
  launchImage: {
    width: '100%',
    height: '100%',
  },
  launchImageScrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: alpha(Palette.bgDeep, 0.16),
  },

  issThumb: {
    flex: 1,
    backgroundColor: Palette.bgDeep,
    overflow: 'hidden',
    padding: Spacing.sm,
  },
  issHeroThumb: {
    minHeight: dvh(220),
  },
  issHeroThumbMobile: {
    minHeight: 230,
    paddingHorizontal: 0,
  },
  issHorizon: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 42,
    height: dvh(1),
    backgroundColor: Palette.border,
  },
  issOrbitArc: {
    position: 'absolute',
    left: '10%',
    right: '10%',
    bottom: 24,
    height: dvh(104),
    borderTopWidth: 2,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: Palette.accent,
    borderTopLeftRadius: 180,
    borderTopRightRadius: 180,
    opacity: 0.58,
  },
  issHeroOrbitArc: {
    left: '8%',
    right: '8%',
    bottom: dvh(48),
    height: dvh(120),
  },
  issHeroOrbitArcMobile: {
    left: 0,
    right: 0,
    bottom: 56,
    height: 132,
  },
  issNode: {
    position: 'absolute',
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: Palette.accentGlow,
    borderWidth: 1,
    borderColor: Palette.bgDeep,
  },
  issPeakNode: {
    left: '50%',
    marginLeft: -3.5,
    top: -4,
  },
  issStation: {
    position: 'absolute',
    top: 52,
    left: '50%',
    marginLeft: -44,
    width: dvw(88),
    height: dvh(46),
    borderRadius: Radius.sm,
    backgroundColor: alpha(Palette.accent, 0.08),
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Palette.accent,
    shadowOpacity: 0.35,
    shadowRadius: 18,
    elevation: 5,
  },
  issStationIcon: {
    width: '100%',
    height: '100%',
  },
  issReadout: {
    position: 'absolute',
    top: 4,
    left: 8,
    right: 8,
    alignItems: 'center',
    gap: 2,
  },
  issHeroPassLabelText: {
    position: 'absolute',
    top: dvh(26),
    left: 8,
    right: 8,
    color: Palette.textTertiary,
    fontSize: 9,
    lineHeight: 11,
    fontWeight: '700',
    textAlign: 'center',
  },
  issHeroPassLabelTextMobile: {
    top: 30,
    fontSize: 10,
    lineHeight: 12,
  },
  issHeroClockText: {
    position: 'absolute',
    top: dvh(62),
    left: 8,
    right: 8,
    color: Palette.textPrimary,
    fontSize: 17,
    lineHeight: 21,
    fontWeight: '700',
    textAlign: 'center',
  },
  issHeroClockTextMobile: {
    top: 58,
    fontSize: 24,
    lineHeight: 29,
  },
  issHeroStation: {
    top: dvh(102),
    marginLeft: -58,
    width: dvw(116),
    height: dvh(60),
  },
  issHeroStationMobile: {
    top: 98,
    marginLeft: -56,
    width: 112,
    height: 72,
  },
  issReadoutLabel: {
    color: Palette.textTertiary,
    fontSize: 9,
    lineHeight: 11,
    fontWeight: '700',
  },
  issReadoutValue: {
    color: Palette.textPrimary,
    fontSize: 17,
    lineHeight: 21,
    fontWeight: '700',
  },
  issStatsRow: {
    position: 'absolute',
    left: 8,
    right: 8,
    bottom: 8,
    flexDirection: 'row',
    gap: 6,
  },
  issHeroStatsRow: {
    left: 16,
    right: 16,
    bottom: 8,
  },
  issHeroStatsRowMobile: {
    left: 0,
    right: 0,
    bottom: 12,
    gap: 6,
  },
  issStatPill: {
    flex: 1,
    minWidth: dvw(0),
    backgroundColor: Palette.surface + 'E6',
    borderWidth: 1,
    borderColor: Palette.borderSoft,
    borderRadius: Radius.sm,
    paddingVertical: 5,
    paddingHorizontal: 6,
    alignItems: 'center',
  },
  issStatLabel: {
    color: Palette.textTertiary,
    fontSize: 8,
    lineHeight: 10,
    fontWeight: '700',
  },
  issStatValue: {
    color: Palette.textPrimary,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
  },

  tileReadoutLabel: {
    color: Palette.textTertiary,
    fontSize: 9,
    lineHeight: 11,
    fontWeight: '700',
  },
  tileReadoutValue: {
    color: Palette.textPrimary,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '700',
  },

  bodiesThumb: {
    flex: 1,
    backgroundColor: Palette.bgDeep,
    overflow: 'hidden',
  },
  bodiesThumbWithImage: {
    backgroundColor: '#000000',
  },
  bodiesImage: {
    width: '100%',
    height: '100%',
  },
  bodiesImageScrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: alpha(Palette.bgDeep, 0.34),
  },
  bodiesSkyArc: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 28,
    height: dvh(112),
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: Palette.accentBlue,
    borderTopLeftRadius: 160,
    borderTopRightRadius: 160,
    opacity: 0.45,
  },
  bodiesHorizon: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 34,
    height: dvh(1),
    backgroundColor: Palette.border,
  },
  bodyDot: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Palette.textSecondary,
    borderWidth: 1,
    borderColor: Palette.bgDeep,
  },
  bodyDotPrimary: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: Palette.accent,
    shadowColor: Palette.accent,
    shadowOpacity: 0.4,
    shadowRadius: 12,
  },
  bodiesReadout: {
    flex: 1,
    minWidth: dvw(0),
    alignItems: 'center',
    backgroundColor: Palette.surface + 'CC',
    borderWidth: 1,
    borderColor: Palette.borderSoft,
    borderRadius: Radius.sm,
    paddingVertical: 5,
    paddingHorizontal: 7,
  },
  bodiesReadoutLabel: {
    color: Palette.textTertiary,
    fontSize: 7.5,
    lineHeight: 9,
    fontWeight: '700',
  },
  bodiesReadoutValue: {
    color: Palette.textPrimary,
    fontSize: 13,
    lineHeight: 16,
    fontWeight: '800',
  },
  bodiesBottomRow: {
    position: 'absolute',
    left: 8,
    right: 8,
    bottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  bodyNamePill: {
    flexBasis: 96,
    minWidth: dvw(0),
    backgroundColor: Palette.surface + 'E6',
    borderWidth: 1,
    borderColor: Palette.borderSoft,
    borderRadius: Radius.sm,
    alignSelf: 'stretch',
    justifyContent: 'center',
    paddingVertical: 5,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  bodyNameText: {
    color: Palette.textPrimary,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
  },

  meteorThumb: {
    flex: 1,
    backgroundColor: Palette.bgDeep,
    overflow: 'hidden',
  },
  meteorImage: {
    width: '100%',
    height: '100%',
  },
  meteorImageScrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: alpha(Palette.bgDeep, 0.28),
  },
  meteorFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Palette.surfaceRaised,
  },
  meteorFallbackText: {
    color: Palette.accent,
    fontSize: 32,
    lineHeight: 38,
    fontWeight: '900',
  },
  spacewalkThumb: {
    flex: 1,
    backgroundColor: Palette.bgDeep,
    overflow: 'hidden',
  },
  spacewalkImage: {
    width: '100%',
    height: '100%',
  },
  spacewalkImageScrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: alpha(Palette.bgDeep, 0.28),
  },
  spacewalkBottomRow: {
    position: 'absolute',
    left: 8,
    right: 8,
    bottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  spacewalkReadout: {
    flex: 1,
    minWidth: dvw(0),
    alignItems: 'center',
    backgroundColor: Palette.surface + 'CC',
    borderWidth: 1,
    borderColor: Palette.borderSoft,
    borderRadius: Radius.sm,
    paddingVertical: 5,
    paddingHorizontal: 7,
  },
  spacewalkReadoutLabel: {
    color: Palette.textTertiary,
    fontSize: 8,
    lineHeight: 10,
    fontWeight: '700',
  },
  spacewalkReadoutValue: {
    color: Palette.textPrimary,
    fontSize: 13,
    lineHeight: 16,
    fontWeight: '700',
  },
  spacewalkCrewPill: {
    flexBasis: 96,
    minWidth: dvw(0),
    backgroundColor: Palette.surface + 'E6',
    borderWidth: 1,
    borderColor: Palette.borderSoft,
    borderRadius: Radius.sm,
    alignSelf: 'stretch',
    justifyContent: 'center',
    paddingVertical: 5,
    paddingHorizontal: 8,
  },

  newsThumb: {
    flex: 1,
    backgroundColor: Palette.bgDeep,
    overflow: 'hidden',
  },
  newsImage: {
    width: '100%',
    height: '100%',
  },
  newsScrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: alpha(Palette.bgDeep, 0.3),
  },
  newsFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Palette.surfaceRaised,
  },
  newsFallbackText: {
    color: Palette.accent,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '800',
  },
  weatherThumb: {
    flex: 1,
    backgroundColor: Palette.bgDeep,
    overflow: 'hidden',
  },
  weatherImage: {
    width: '100%',
    height: '100%',
  },
  weatherImageScrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: alpha(Palette.bgDeep, 0.3),
  },
  weatherReadout: {
    position: 'absolute',
    top: 10,
    left: 12,
    right: 12,
    alignItems: 'center',
  },
  weatherTempValue: {
    color: Palette.textPrimary,
    fontSize: 22,
    lineHeight: 27,
    fontWeight: '800',
  },
  weatherBars: {
    position: 'absolute',
    left: 10,
    right: 10,
    bottom: 10,
    gap: 6,
  },
  weatherMetricMobile: {
    gap: 4,
  },
  weatherMetricHeaderMobile: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  weatherMetricLabelMobile: {
    flex: 1,
    minWidth: 0,
    color: Palette.textSecondary,
    fontSize: 11,
    lineHeight: 13,
    fontWeight: '700',
  },
  weatherMetricValueMobile: {
    color: Palette.textPrimary,
    fontSize: 11,
    lineHeight: 13,
    fontWeight: '800',
    textAlign: 'right',
  },
  weatherMetricTrackMobile: {
    width: '100%',
    height: 6,
    borderRadius: 3,
    backgroundColor: Palette.surfaceRaised,
    overflow: 'hidden',
  },
  weatherBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  weatherBarLabel: {
    width: dvw(50),
    color: Palette.textSecondary,
    fontSize: 10,
    lineHeight: 12,
    fontWeight: '700',
  },
  weatherBarTrack: {
    flex: 1,
    height: dvh(6),
    borderRadius: 3,
    backgroundColor: Palette.surfaceRaised,
    overflow: 'hidden',
  },
  weatherBarFill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: Palette.accent,
  },
  weatherBarValue: {
    width: dvw(34),
    color: Palette.textPrimary,
    fontSize: 10,
    lineHeight: 12,
    fontWeight: '700',
    textAlign: 'right',
  },

  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Palette.surface,
    borderWidth: 1,
    borderColor: Palette.borderSoft,
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  profileCardMobile: {
    padding: Spacing.md,
    alignItems: 'flex-start',
    scrollSnapAlign: 'start',
    scrollSnapStop: 'always',
  } as any,
  profileText: {
    flex: 1,
    minWidth: dvw(0),
    marginLeft: Spacing.md,
  },
  profileLevelProgress: {
    marginTop: 8,
    gap: 5,
    width: '18dvw' as any,
  },
  profileLevelProgressMobile: {
    width: '100%',
  },
  profileLevelTrack: {
    height: '0.7dvh' as any,
    borderRadius: Radius.pill,
    backgroundColor: Palette.surfaceRaised,
    borderWidth: 1,
    borderColor: Palette.borderSoft,
    overflow: 'hidden',
  },
  profileLevelFill: {
    height: '100%',
    backgroundColor: Palette.accent,
  },
  profileLevelMeta: {
    color: Palette.textTertiary,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '800',
  },
  profileRing: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: Palette.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: Palette.accentBlue,
  },
});
