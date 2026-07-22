// pages/dashboard-screen.tsx
// StarWindow — Home Dashboard
// Left rail with 4 tabs (Calendar, Map, Launches, Profile),
// moon-phase hero, and preview cards for each tab.
// All colors/spacing/radii come from @/constants/tokens.

import React, { useEffect, useState } from 'react';
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
import { MonthGrid } from '@/components/calendar/month-grid';
import { StarMap } from '@/components/star-map';
import { useCalendarEvents } from '@/hooks/use-calendar-events';
import { fetchVisibleBodies, type VisibleBody } from '@/utilities/bodies-api';
import {
  fetchNextUpcomingSpacewalk,
  fetchNextUpcomingLaunch,
  getCalendarEventsForMonth,
  getNextCalendarEvent,
  type CalendarEvent,
  type UpcomingSpacewalk,
  type UpcomingLaunch,
} from '@/utilities/events-api';
import { fetchIssPasses, type IssPass } from '@/utilities/iss-api';
import { fetchNearestLocation } from '@/utilities/location-api';
import { fetchMoonPhase } from '@/utilities/moon-api';
import { fetchNasaNews, type NewsArticle } from '@/utilities/news-api';
import { fetchViewingScore } from '@/utilities/viewing-score-api';
import { fetchCurrentWeather, type WeatherResponse } from '@/utilities/weather-api';
import { getUserLevelProgressLabel, getUserLevelProgressPercent } from '@/utilities/level-progress';
import { getOrRequestUserLocation } from '@/utilities/user-location-service';
import * as ambientSound from '@/utilities/ambient-sound-service';
import * as usersService from '@/utilities/users-service';
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

function formatIssMeta(pass: IssPass | null) {
  if (!pass) return 'Enable location to check visible ISS passes near you.';

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
  synthetic?: boolean;
};

function eventDetailRoute(input: EventDetailRouteParams) {
  const params: Record<string, string> = {};

  for (const [key, value] of Object.entries(input)) {
    if (value === null || value === undefined || value === '') continue;
    params[key] = String(value);
  }

  return { pathname: '/events', params } as const;
}

type DashboardScreenProps = {
  locked?: boolean;
};

export default function DashboardScreen({ locked = false }: DashboardScreenProps = {}) {
  const router = useRouter();
  const today = new Date();
  const [user, setUser] = useState<usersService.AuthUser | null>(() => usersService.getUser());
  const isLocked = locked && !user;
  const firstName = getFirstName(user);
  const displayName = getDisplayName(user);
  const profileMeta = getProfileMeta(user);
  const levelProgressLabel = getUserLevelProgressLabel(user);
  const levelProgressPercent = getUserLevelProgressPercent(user);
  const [browserCoords, setBrowserCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const { events, isLoading: isCalendarLoading, error: calendarError } = useCalendarEvents({
    ...(browserCoords ?? {}),
    includeVisibleBodies: false,
  });
  const currentMonthEvents = getCalendarEventsForMonth(events, today.getFullYear(), today.getMonth());
  const calendarTitle = today.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const nextCalendarEvent = getNextCalendarEvent(events, today);
  const nextCalendarDate = nextCalendarEvent
    ? new Date(nextCalendarEvent.startDate).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      })
    : null;
  const calendarBadge = isCalendarLoading
    ? 'LOADING'
    : calendarError
    ? 'UNAVAILABLE'
    : formatCount(currentMonthEvents.length, 'EVENT', 'EVENTS');
  const calendarMeta = isCalendarLoading
    ? 'Loading upcoming events...'
    : calendarError
    ? 'Could not load event data'
    : nextCalendarEvent
    ? `Next: ${nextCalendarEvent.title} - ${nextCalendarDate}`
    : 'No calendar events scheduled';
  const [locationLabel, setLocationLabel] = useState('Requesting location...');
  const [locationMessage, setLocationMessage] = useState('Waiting for browser location access.');
  const [moonImageUrl, setMoonImageUrl] = useState<string | null>(null);
  const [moonPhasePercent, setMoonPhasePercent] = useState<number | null>(null);
  const [moonPhaseAngle, setMoonPhaseAngle] = useState<number | null>(null);
  const [moonPhaseTrend, setMoonPhaseTrend] = useState<string | null>(null);
  const [moonPhaseDate, setMoonPhaseDate] = useState<string | null>(null);
  const [moonPhaseName, setMoonPhaseName] = useState('Waiting for location...');
  const [viewingScore, setViewingScore] = useState<number | null>(null);
  const [viewingScoreStatus, setViewingScoreStatus] = useState<ViewingScoreStatus>('loading');
  const [nextLaunch, setNextLaunch] = useState<UpcomingLaunch | null>(null);
  const [isLaunchLoading, setIsLaunchLoading] = useState(true);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [nextIssPass, setNextIssPass] = useState<IssPass | null>(null);
  const [isIssLoading, setIsIssLoading] = useState(true);
  const [issError, setIssError] = useState<string | null>(null);
  const [visibleBodies, setVisibleBodies] = useState<VisibleBody[]>([]);
  const [isBodiesLoading, setIsBodiesLoading] = useState(true);
  const [bodiesError, setBodiesError] = useState<string | null>(null);
  const [currentWeather, setCurrentWeather] = useState<WeatherResponse | null>(null);
  const [isWeatherLoading, setIsWeatherLoading] = useState(true);
  const [weatherError, setWeatherError] = useState<string | null>(null);
  const [nextSpacewalk, setNextSpacewalk] = useState<UpcomingSpacewalk | null>(null);
  const [isSpacewalkLoading, setIsSpacewalkLoading] = useState(true);
  const [spacewalkError, setSpacewalkError] = useState<string | null>(null);
  const [nasaArticle, setNasaArticle] = useState<NewsArticle | null>(null);
  const [isNewsLoading, setIsNewsLoading] = useState(true);
  const [newsError, setNewsError] = useState<string | null>(null);

  useEffect(() => {
    ambientSound.ensureAmbientSound();
  }, []);

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

    (async () => {
      try {
        setIsLaunchLoading(true);
        setLaunchError(null);
        const launch = await fetchNextUpcomingLaunch();
        if (!isMounted) return;
        setNextLaunch(launch);
      } catch (error) {
        console.log('Launch fetch error:', error);
        if (!isMounted) return;
        setNextLaunch(null);
        setLaunchError('Could not load upcoming launches');
      } finally {
        if (isMounted) setIsLaunchLoading(false);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function loadSpacewalk() {
      try {
        setIsSpacewalkLoading(true);
        setSpacewalkError(null);
        const spacewalk = await fetchNextUpcomingSpacewalk();
        if (!isMounted) return;
        setNextSpacewalk(spacewalk);
      } catch (error) {
        console.log('Spacewalk fetch error:', error);
        if (isMounted) {
          setNextSpacewalk(null);
          setSpacewalkError('Could not load spacewalk schedule');
        }
      } finally {
        if (isMounted) setIsSpacewalkLoading(false);
      }
    }

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

    void loadSpacewalk();
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
        setMoonImageUrl(moon.image_url ?? null);
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
        setViewingScoreStatus(score.viewing_score == null ? 'unavailable' : 'ready');
      } catch (error) {
        console.log('Viewing score fetch error:', error);
        if (isMounted) {
          setViewingScore(null);
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
        <ScrollView style={styles.main} contentContainerStyle={styles.mainContent}>
          <View style={styles.topBar}>
            <View>
              <Text style={styles.eyebrow}>
                {`TONIGHT SKY - ${today.toLocaleDateString('en-US', {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                }).toUpperCase()}`}
              </Text>
              <Text style={styles.greeting}>
                {isLocked ? 'Welcome to Star Window' : `${getSkyGreeting(viewingScore, viewingScoreStatus)}, ${firstName}`}
              </Text>
            </View>
            {isLocked ? (
              <View style={styles.guestTopActions}>
                <View style={styles.locationChip}>
                  <Text style={styles.locationChipText}>📍 {locationLabel}</Text>
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
              <View style={styles.guestTopActions}>
                <View style={styles.locationChip}>
                  <Text style={styles.locationChipText}>📍 {locationLabel}</Text>
                </View>
                <SoundToggle />
              </View>
            )}
          </View>

{/*
          <SectionLabel text="ACCOUNT" /> */}

          {!isLocked ? (
            <Pressable style={styles.profileCard} onPress={() => router.push('/profile')}>
              <View style={styles.profileRing}>
                <View style={styles.profileAvatar} />
              </View>
              <View style={styles.profileText}>
                <Text style={styles.previewTitle}>{displayName}</Text>
                <Text style={styles.previewMeta}>{profileMeta}</Text>
                {levelProgressLabel ? (
                  <View style={styles.profileLevelProgress}>
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
          <View style={styles.hero}>
            <View style={styles.heroLeft}>

              <View style={styles.heroNow}>
                <View style={styles.pulseDot} />
                <Text style={styles.heroNowText}>
                  {locationMessage}
                </Text>
              </View>

              <Text style={styles.heroEyebrow}>ISS PASS - LIVE</Text>
              <Text style={styles.heroTitle}>
                {formatIssTitle({
                  isLoading: isIssLoading,
                  error: issError,
                  hasLocation: Boolean(browserCoords),
                  pass: nextIssPass,
                })}
              </Text>

              <View style={styles.heroStats}>
                <Stat label="RISE" value={nextIssPass?.rise?.time ? formatIssClock(nextIssPass.rise.time) : '--'} />
                <Stat label="PEAK" value={nextIssPass?.peak?.elevation_deg != null ? `${Math.round(nextIssPass.peak.elevation_deg)} deg` : '--'} />
                <Stat label="DURATION" value={formatIssDuration(nextIssPass?.visible_duration_sec ?? nextIssPass?.duration_sec) ?? '--'} />
              </View>

              <Text style={styles.heroMetaText}>
                {isIssLoading
                  ? 'Checking visible passes for your location.'
                  : issError
                  ? issError
                  : formatIssMeta(nextIssPass)}
              </Text>
            </View>

            <View style={styles.issHeroStage}>
              <IssThumb pass={nextIssPass} isLoading={isIssLoading} variant="hero" />
            </View>
          </View>

          <SectionLabel text="YOUR TABS" />

          {/* ---------- PREVIEW CARDS ---------- */}
          <View style={styles.previewGrid}>
            <PreviewCard
              eyebrow="CALENDAR"
              badge={calendarBadge}
              badgeColor={Palette.accentBlue}
              title={calendarTitle}
              meta={calendarMeta}
              thumb={<CalendarThumb events={currentMonthEvents} />}
              onPress={() => router.push(eventDetailRoute(nextCalendarEvent
                ? {
                    eventId: nextCalendarEvent.id,
                    category: nextCalendarEvent.type?.toLowerCase().includes('launch') ? 'launch' : 'event',
                    type: nextCalendarEvent.type ?? 'Event',
                    name: nextCalendarEvent.title,
                    date: nextCalendarEvent.startDate,
                    description: nextCalendarEvent.detail,
                    imageUrl: nextCalendarEvent.imageUrl,
                    location: nextCalendarEvent.location,
                  }
                : {
                    category: 'event',
                    type: 'Calendar',
                    name: calendarTitle,
                    date: today.toISOString(),
                    description: calendarMeta,
                    synthetic: true,
                  }) as any)}
              locked={isLocked}
            />

            <PreviewCard
              eyebrow="LIGHT POLLUTION MAP"
              badge="LIVE"
              badgeColor={Palette.accentGreen}
              title="Your Sky Tonight"
              meta={browserCoords ? locationLabel : 'Enable location for current sky map'}
              thumb={<MapThumb coords={browserCoords} locationLabel={locationLabel} />}
              onPress={() => router.push(eventDetailRoute({
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
              thumb={<LaunchThumb imageUrl={nextLaunch?.image ?? null} />}
              onPress={() => router.push(eventDetailRoute({
                category: 'launch',
                type: 'Rocket Launch',
                name: nextLaunch?.name ?? 'Upcoming Launches',
                date: nextLaunch?.net ?? null,
                datePrecision: nextLaunch?.net_precision ?? null,
                description: nextLaunch?.mission?.description ?? formatLaunchMeta(nextLaunch),
                imageUrl: nextLaunch?.image ?? null,
                location: nextLaunch?.pad?.location ?? nextLaunch?.pad?.name ?? null,
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

                <MoonThumb
                  imageUrl={moonImageUrl}
                  phaseName={moonPhaseName}
                  phasePercent={moonPhasePercent}
                  phaseAngle={moonPhaseAngle}
                  phaseTrend={moonPhaseTrend}
                />

              }
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
              thumb={<BodiesThumb bodies={visibleBodies} isLoading={isBodiesLoading} />}
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
              thumb={<SpacewalkThumb spacewalk={nextSpacewalk} isLoading={isSpacewalkLoading} />}
              locked={isLocked}
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
              thumb={<NewsThumb article={nasaArticle} />}
              onPress={nasaArticle?.url ? () => openExternalUrl(nasaArticle.url) : undefined}
              locked={isLocked}
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
              thumb={<WeatherThumb weather={currentWeather} isLoading={isWeatherLoading} />}
              locked={isLocked}
            />
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
}: {
  eyebrow: string;
  badge: string;
  badgeColor: string;
  title: string;
  meta: string;
  thumb: React.ReactNode;
  onPress?: () => void;
  locked?: boolean;
}) {
  const router = useRouter();
  const handlePress = locked ? () => router.push('/signup' as any) : onPress;

  return (
    <Pressable style={styles.previewCard} onPress={handlePress} disabled={!handlePress}>
      <View style={styles.previewThumb}>
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
      <View style={styles.previewBody}>
        <View style={styles.previewEyebrowRow}>
          <Text style={styles.previewEyebrow}>{eyebrow}</Text>
          <View style={[styles.badge, { backgroundColor: badgeColor + '20' }]}>
            <Text style={[styles.badgeText, { color: badgeColor }]}>{badge}</Text>
          </View>
        </View>
        <Text style={[styles.previewTitle, locked && styles.lockedPreviewText]} numberOfLines={2}>{title}</Text>
        <Text style={[styles.previewMeta, locked && styles.lockedPreviewText]} numberOfLines={3}>{meta}</Text>
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
    />
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
        {imageUrl ? (
          <Image source={{ uri: imageUrl }} style={[styles.moonImage, styles.moonImageFromApi]} resizeMode="cover" />
        ) : (
          <GeneratedMoonPhase
            phaseName={phaseName}
            phasePercent={phasePercent}
            phaseAngle={phaseAngle}
            phaseTrend={phaseTrend}
          />
        )}
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
    return <View style={styles.moonLoading} />;
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
  isLoading,
  variant = 'card',
}: {
  pass: IssPass | null;
  isLoading: boolean;
  variant?: 'card' | 'hero';
}) {
  const duration = formatIssDuration(pass?.visible_duration_sec ?? pass?.duration_sec);

  return (
      <View style={[styles.issThumb, variant === 'hero' && styles.issHeroThumb]}>
      <View style={styles.issHorizon} />
      <View style={[styles.issOrbitArc, variant === 'hero' && styles.issHeroOrbitArc]} />
      <View style={[styles.issNode, styles.issPeakNode, variant === 'hero' && styles.issHeroPeakNode]} />
      <View style={[styles.issStation, variant === 'hero' && styles.issHeroStation]}>
        <Image
          source={require('@/assets/images/iss.png')}
          style={styles.issStationIcon}
          resizeMode="contain"
        />
      </View>

      <View style={styles.issReadout}>
        <Text style={styles.issReadoutLabel}>NEXT VISIBLE PASS</Text>
        <Text style={styles.issReadoutValue}>
          {isLoading ? 'Checking orbit...' : pass ? formatIssClock(pass.rise?.time) : 'No pass found'}
        </Text>
      </View>

      <View style={styles.issStatsRow}>
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
    </View>
  );
}

function BodiesThumb({ bodies, isLoading }: { bodies: VisibleBody[]; isLoading: boolean }) {
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
            {primaryBody?.body ?? (isLoading ? 'Loading...' : 'No bodies')}
          </Text>
        </View>
        <View style={styles.bodiesReadout}>
          <Text style={styles.bodiesReadoutLabel}>VISIBLE TONIGHT</Text>
          <Text style={styles.bodiesReadoutValue}>
            {isLoading ? 'Checking sky...' : formatCount(bodies.length, 'body', 'bodies')}
          </Text>
        </View>
      </View>
    </View>
  );
}

function SpacewalkThumb({
  spacewalk,
  isLoading,
}: {
  spacewalk: UpcomingSpacewalk | null;
  isLoading: boolean;
}) {
  const crewCount = spacewalk?.crew?.length ?? 0;

  return (
    <View style={styles.spacewalkThumb}>
      <Image
        source={require('@/assets/images/spacewalk-astronaut.png')}
        style={styles.spacewalkImage}
        resizeMode="cover"
      />
      <View style={styles.spacewalkImageScrim} />
      <View style={styles.spacewalkBottomRow}>
        <View style={styles.spacewalkCrewPill}>
          <Text style={styles.bodyNameText}>
            {crewCount > 0 ? formatCount(crewCount, 'crew member') : 'Crew TBD'}
          </Text>
        </View>
        <View style={styles.spacewalkReadout}>
          <Text style={styles.spacewalkReadoutLabel}>{spacewalk?.schedule_status === 'latest' ? 'LATEST EVA' : 'NEXT EVA'}</Text>
          <Text style={styles.spacewalkReadoutValue} numberOfLines={1}>
            {isLoading ? 'Checking schedule...' : spacewalk ? formatSpacewalkDate(spacewalk.start) : 'No EVA'}
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

function WeatherThumb({ weather, isLoading }: { weather: WeatherResponse | null; isLoading: boolean }) {
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
          {isLoading ? 'Loading...' : formatTemperature(weather?.temp, weather?.units)}
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
  mainContent: {
    padding: Spacing.lg,
    paddingLeft: 20,
    paddingBottom: Spacing.xxl,
    gap: Spacing.md,
    width: '100%',
    maxWidth: dvw(1040),
    alignSelf: 'center',
  },
  topBar: {
    marginBottom: 4,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: Spacing.md,
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
  locationChip: {
    backgroundColor: Palette.surface,
    borderWidth: 1,
    borderColor: Palette.borderSoft,
    borderRadius: Radius.pill,
    paddingVertical: 6,
    paddingHorizontal: 10,
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
  heroLeft: {},
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
  heroStats: {
    flexDirection: 'row',
    marginBottom: Spacing.md,
    flexWrap: 'wrap',
    rowGap: Spacing.sm,
    columnGap: Spacing.lg,
  },
  heroMetaText: {
    fontSize: 13,
    lineHeight: 19,
    color: Palette.textSecondary,
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
    left: -18,
  },
  generatedMoonWaningCrescentShade: {
    right: -18,
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
    justifyContent: 'space-between',
  },
  previewCard: {
    backgroundColor: Palette.surface,
    borderWidth: 1,
    borderColor: Palette.borderSoft,
    borderRadius: Radius.md,
    overflow: 'hidden',
    flexBasis: '31%',
    flexGrow: 1,
    minWidth: dvw(230),
  },
  previewThumb: {
    height: dvh(168),
    backgroundColor: Palette.bgDeep,
    borderBottomWidth: 1,
    borderBottomColor: Palette.borderSoft,
  },
  previewThumbContent: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  previewBody: {
    padding: Spacing.sm,
    alignItems: 'stretch',
    gap: 3,
  },
  previewEyebrowRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: 3,
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
  previewMeta: {
    fontSize: 12,
    lineHeight: 17,
    color: Palette.textSecondary,
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
    bottom: 48,
    height: dvh(120),
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
    top: 38,
  },
  issHeroPeakNode: {
    top: 49,
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
  issHeroStation: {
    top: 86,
    marginLeft: -58,
    width: dvw(116),
    height: dvh(60),
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
