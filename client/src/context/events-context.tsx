import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

import { fetchEventsList, type EventListItem } from '@/lib/events-api';

export const SHARED_EVENTS_PAST_DAYS = 365;
export const SHARED_EVENTS_FUTURE_DAYS = 365;

type EventsContextValue = {
  events: EventListItem[];
  isLoading: boolean;
  error: string | null;
  refreshEvents: () => void;
};

const EventsContext = createContext<EventsContextValue | null>(null);

export function EventsProvider({
  children,
  enabled = true,
}: {
  children: React.ReactNode;
  enabled?: boolean;
}) {
  const [events, setEvents] = useState<EventListItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setEvents([]);
      setIsLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();

    (async () => {
      try {
        setIsLoading(true);
        setError(null);
        const data = await fetchEventsList({
          includePast: true,
          pastDays: SHARED_EVENTS_PAST_DAYS,
          futureDays: SHARED_EVENTS_FUTURE_DAYS,
          signal: controller.signal,
        });
        setEvents(data);
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setError(err instanceof Error ? err.message : 'Could not load events.');
        }
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    })();

    return () => {
      controller.abort();
    };
  }, [enabled, refreshToken]);

  const value = useMemo<EventsContextValue>(() => ({
    events,
    isLoading,
    error,
    refreshEvents: () => setRefreshToken((current) => current + 1),
  }), [events, error, isLoading]);

  return (
    <EventsContext.Provider value={value}>
      {children}
    </EventsContext.Provider>
  );
}

export function useSharedEvents() {
  const value = useContext(EventsContext);
  if (!value) {
    throw new Error('useSharedEvents must be used inside EventsProvider');
  }

  return value;
}
