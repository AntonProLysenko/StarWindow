// Picks a fallback icon for an event that has NO image from the API. Shared by
// the card thumbnail and the modal hero so both stay consistent.
//
//   - eclipses            -> icon_eclipse.png
//   - spacecraft ops      -> icon_spacecraft.png  (docking, flyby, insertion, …)
//   - everything else     -> null (caller shows an emoji: 🚀 launch / ✨ event)

import type { ImageSourcePropType } from 'react-native';

import type { EventListItem } from '@/lib/events-api';

const ECLIPSE = require('@/assets/images/icons/icon_eclipse.png');
const SPACECRAFT = require('@/assets/images/icons/icon_spacecraft.png');
const SPACEWALK = require('@/assets/images/spacewalk-astronaut.png');

// Keywords that identify a "spacecraft" event (LL2 event types / names).
const SPACECRAFT_KEYWORDS = [
  'docking',
  'undocking',
  'berthing',
  'unberthing',
  'flyby',
  'fly-by',
  'fly by',
  'spacecraft',
  'orbit insertion',
  'insertion',
  'maneuver',
  'rendezvous',
  'separation',
  'deploy',
  'impact',
  'encounter',
];

/**
 * Returns an image asset to use as the no-image fallback, or null to let the
 * caller fall back to an emoji. Only meaningful for events without an image_url.
 */
export function fallbackIconSource(event: EventListItem): ImageSourcePropType | null {
  const type = `${event.type ?? ''}`.toLowerCase();
  const label = `${event.type} ${event.name}`.toLowerCase();

  if (label.includes('eclipse')) return ECLIPSE;
  if (label.includes('spacewalk') || type === 'eva') return SPACEWALK;

  // Launches keep the rocket emoji unless the API image exists; not "spacecraft".
  if (event.category === 'launch') return null;

  if (SPACECRAFT_KEYWORDS.some((k) => label.includes(k))) return SPACECRAFT;

  return null;
}
