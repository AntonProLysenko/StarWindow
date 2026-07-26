import { Palette, alpha } from '@/constants/tokens';

type EventColorInput = {
  category?: 'event' | 'launch' | string | null;
  type?: string | null;
  name?: string | null;
};

export type EventColorTheme = {
  accent: string;
  background: string;
  border: string;
};

const COLORS = {
  neutral: Palette.accent,
  hot: Palette.accentRed,
  earth: Palette.accentGreen,
  innerSpace: '#B46CFF',
  earthInteraction: '#FFB000',
  spacecraft: Palette.accentBlue,
} as const;

export function getEventColorTheme(input: EventColorInput): EventColorTheme {
  const accent = getEventAccent(input);
  return {
    accent,
    background: alpha(accent, 0.14),
    border: alpha(accent, 0.42),
  };
}

export function getEventEmoji(input: EventColorInput) {
  const type = normalize(input.type);
  const name = normalize(input.name);
  const text = `${type} ${name}`;

  if (normalize(input.category) === 'launch' || text.includes('launch')) return '🚀';
  if (text.includes('meteor') || text.includes('shower') || text.includes('reentry') || text.includes('splashdown')) {
    return '☄️';
  }
  if (text.includes('spacewalk') || type === 'eva') return '🧑‍🚀';
  if (text.includes('press') || text.includes('briefing') || text.includes('conference') || text.includes('media')) {
    return '🎙️';
  }
  if (text.includes('docking') || text.includes('undocking') || text.includes('hatch')) return '🛰️';
  if (text.includes('spacecraft') || text.includes('orbital') || text.includes('insertion') || text.includes('deployment')) {
    return '🛰️';
  }
  if (text.includes('eclipse') || text.includes('solar') || text.includes('lunar')) return '🌘';
  if (text.includes('moon')) return '🌙';
  if (text.includes('comet') || text.includes('asteroid') || text.includes('flyby')) return '🪐';
  if (text.includes('celestial') || text.includes('occultation') || text.includes('conjunction') || text.includes('opposition') || text.includes('transit') || text.includes('alignment')) {
    return '✨';
  }

  return '✦';
}

function getEventAccent(input: EventColorInput) {
  const type = normalize(input.type);
  const name = normalize(input.name);
  const text = `${type} ${name}`;

  if (normalize(input.category) === 'launch' || text.includes('launch')) {
    return COLORS.hot;
  }

  if (
    text.includes('press') ||
    text.includes('briefing') ||
    text.includes('conference') ||
    text.includes('media') ||
    text.includes('conversation') ||
    text.includes('change of command')
  ) {
    return COLORS.earth;
  }

  if (
    text.includes('meteor') ||
    text.includes('shower') ||
    text.includes('reentry') ||
    text.includes('splashdown')
  ) {
    return COLORS.earthInteraction;
  }

  if (
    text.includes('spacewalk') ||
    type === 'eva' ||
    text.includes('docking') ||
    text.includes('undocking') ||
    text.includes('hatch') ||
    text.includes('farewell') ||
    text.includes('landing')
  ) {
    return COLORS.earth;
  }

  if (
    text.includes('spacecraft') ||
    text.includes('orbital') ||
    text.includes('insertion') ||
    text.includes('deployment')
  ) {
    return COLORS.spacecraft;
  }

  if (
    text.includes('celestial') ||
    text.includes('eclipse') ||
    text.includes('occultation') ||
    text.includes('conjunction') ||
    text.includes('opposition') ||
    text.includes('transit') ||
    text.includes('alignment') ||
    text.includes('lunar') ||
    text.includes('solar') ||
    text.includes('moon') ||
    text.includes('comet') ||
    text.includes('asteroid') ||
    text.includes('flyby')
  ) {
    return COLORS.innerSpace;
  }

  return COLORS.neutral;
}

function normalize(value?: string | null) {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}
