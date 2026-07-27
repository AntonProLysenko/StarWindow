import { useEffect, useState } from 'react';

import {
  fetchVisibleBodyCalendarEvents,
  type CalendarEvent,
  type CalendarEventsQuery,
} from '@/utilities/events-api';

const cachedEvents = new Map<string, CalendarEvent[]>();
const pendingRequests = new Map<string, Promise<CalendarEvent[]>>();

function getCacheKey(input?: CalendarEventsQuery) {
  return JSON.stringify(input ?? {});
}

function loadVisibleBodyEvents(cacheKey: string, input?: CalendarEventsQuery) {
  const cached = cachedEvents.get(cacheKey);
  if (cached) return Promise.resolve(cached);

  let pendingRequest = pendingRequests.get(cacheKey);
  pendingRequest ??= fetchVisibleBodyCalendarEvents(input)
    .then((events) => {
      cachedEvents.set(cacheKey, events);
      return events;
    })
    .finally(() => {
      pendingRequests.delete(cacheKey);
    });
  pendingRequests.set(cacheKey, pendingRequest);

  return pendingRequest;
}

export function useVisibleBodyEvents(input?: CalendarEventsQuery) {
  const cacheKey = getCacheKey(input);
  const cached = cachedEvents.get(cacheKey);
  const [events, setEvents] = useState<CalendarEvent[]>(cached ?? []);
  const [isLoading, setIsLoading] = useState(!cached);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const currentCached = cachedEvents.get(cacheKey);

    Promise.resolve().then(() => {
      if (cancelled) return;
      setEvents(currentCached ?? []);
      setIsLoading(!currentCached);
      setError(null);
    });

    loadVisibleBodyEvents(cacheKey, input)
      .then((loadedEvents) => {
        if (!cancelled) setEvents(loadedEvents);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not load visible body events.');
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [cacheKey]);

  return { events, isLoading, error };
}
