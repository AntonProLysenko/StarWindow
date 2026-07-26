export type EventIconType = 'meteor' | 'launch' | 'moon' | 'iss' | 'spacewalk' | 'eclipse' | 'spacecraft' | 'other';

export function getEventIconByType(type?: string): string {
  const key = (type ?? 'other') as EventIconType;
  return ICON_MAP[key] ?? ICON_MAP.other;
}

export const ALL_EVENT_FILTER = 'All';

export const EVENT_FILTER_OPTIONS = [
  ALL_EVENT_FILTER,
  'Rocket Launch',
  'Meteor Shower',
  'Celestial Events',
  'Spacecraft Event',
  'Spacewalk',
] as const;

export type EventFilterOption = (typeof EVENT_FILTER_OPTIONS)[number];

export type EventFilterable = {
  category?: string | null;
  type?: string | null;
};

const ICON_MAP: Record<EventIconType, string> = {
  meteor: '☄️',
  launch: '🚀',
  moon: '🌕',
  iss: '🛰️',
  spacewalk: '🧑‍🚀',
  eclipse: '🌑',
  spacecraft: '🛰️',
  other: '✨',
};

function normalizeEventFilterValue(value?: string | null) {
  return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function matchesEventFilter(event: EventFilterable, filter: string) {
  if (filter === ALL_EVENT_FILTER) return true;

  const type = normalizeEventFilterValue(event.type);

  if (filter === 'Rocket Launch') {
    return event.category === 'launch' || type.includes('launch');
  }

  if (filter === 'Meteor Shower') {
    return type.includes('meteor');
  }

  if (filter === 'Spacecraft Event') {
    return type.includes('spacecraft');
  }

  if (filter === 'Spacewalk') {
    return type.includes('spacewalk');
  }

  if (filter === 'Celestial Events') {
    return (
      event.category !== 'launch' &&
      !type.includes('meteor') &&
      !type.includes('spacecraft') &&
      !type.includes('spacewalk')
    );
  }

  return normalizeEventFilterValue(event.type) === normalizeEventFilterValue(filter);
}

export function filterEvents<T extends EventFilterable>(events: T[], filter: string): T[] {
  return events.filter((event) => matchesEventFilter(event, filter));
}
