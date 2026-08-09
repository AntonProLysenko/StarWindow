import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

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

type EventsState = {
  events: EventListItem[];
  isLoading: boolean;
  error: string | null;
};

export function EventsProvider({
  children,
  enabled = true,
}: {
  children: React.ReactNode;
  enabled?: boolean;
}) {
  const [state, setState] = useState<EventsState>({
    events: [],
    isLoading: false,
    error: null,
  });
  const [refreshToken, setRefreshToken] = useState(0);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!enabled) {
      requestIdRef.current += 1;
      setState({ events: [], isLoading: false, error: null });
      return;
    }

    const controller = new AbortController();
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    (async () => {
      try {
        setState((current) => (
          current.isLoading && current.error === null
            ? current
            : { ...current, isLoading: true, error: null }
        ));
        const data = await fetchEventsList({
          includePast: true,
          pastDays: SHARED_EVENTS_PAST_DAYS,
          futureDays: SHARED_EVENTS_FUTURE_DAYS,
          signal: controller.signal,
        });
        if (controller.signal.aborted || requestIdRef.current !== requestId) return;
        setState({ events: data, isLoading: false, error: null });
      } catch (err) {
        if (controller.signal.aborted || requestIdRef.current !== requestId || (err as Error).name === 'AbortError') return;
        setState((current) => ({
          ...current,
          isLoading: false,
          error: err instanceof Error ? err.message : 'Could not load events.',
        }));
      }
    })();

    return () => {
      controller.abort();
    };
  }, [enabled, refreshToken]);

  const refreshEvents = useCallback(() => {
    setRefreshToken((current) => current + 1);
  }, []);

  const value = useMemo<EventsContextValue>(() => ({
    events: state.events,
    isLoading: state.isLoading,
    error: state.error,
    refreshEvents,
  }), [refreshEvents, state.error, state.events, state.isLoading]);

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
