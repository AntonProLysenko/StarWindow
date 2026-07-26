export type EventIconType = 'meteor' | 'launch' | 'moon' | 'iss' | 'spacewalk' | 'eclipse' | 'spacecraft' | 'other';

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

function normalizeEventTypeValue(value?: string | null) {
  return (value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
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

export function getEventIconByType(type?: string): string {
  const normalized = normalizeEventTypeValue(type);

  if (!normalized) return ICON_MAP.other;
  if (normalized.includes('meteor')) return ICON_MAP.meteor;
  if (normalized.includes('launch')) return ICON_MAP.launch;
  if (normalized.includes('eclipse')) return ICON_MAP.eclipse;
  if (normalized.includes('spacewalk')) return ICON_MAP.spacewalk;
  if (normalized.includes('iss') || normalized.includes('space station')) return ICON_MAP.iss;
  if (normalized.includes('moon')) return ICON_MAP.moon;
  if (
    normalized.includes('spacecraft') ||
    normalized.includes('docking') ||
    normalized.includes('berthing') ||
    normalized.includes('flyby') ||
    normalized.includes('orbit insertion') ||
    normalized.includes('maneuver') ||
    normalized.includes('rendezvous') ||
    normalized.includes('deploy')
  ) {
    return ICON_MAP.spacecraft;
  }

  return ICON_MAP.other;
}
