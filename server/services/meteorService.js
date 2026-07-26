// Curated major annual meteor showers. The 2026 activity windows, peak dates,
// ZHR values, and best observing times are based on the American Meteor Society
// list, which credits the International Meteor Organization table.

const MAJOR_SHOWERS = [
  {
    code: "QUA",
    name: "Quadrantids",
    activeStart: { month: 12, day: 26 },
    peak: { month: 1, day: 3 },
    activeEnd: { month: 1, day: 16 },
    radiant: "Bootes",
    zhr: 120,
    bestTime: "05:00",
    moonAgeDays: 15,
    radiantDeclinationDegrees: 49.7,
    imageUrl: "https://assets.science.nasa.gov/dynamicimage/assets/science/psd/solar/2023/07/geminids_main.jpg?crop=faces%2Cfocalpoint&fit=clip&h=576&w=768",
    description: "A sharp, intense northern-hemisphere shower with a short peak window.",
  },
  {
    code: "LYR",
    name: "Lyrids",
    activeStart: { month: 4, day: 17 },
    peak: { month: 4, day: 22 },
    activeEnd: { month: 4, day: 26 },
    radiant: "Lyra",
    zhr: 18,
    bestTime: "04:00",
    moonAgeDays: 6,
    radiantDeclinationDegrees: 33.3,
    imageUrl: "https://assets.science.nasa.gov/dynamicimage/assets/science/psd/solar/2023/07/Lyrids_From_Orbit_1600.jpg?crop=faces%2Cfocalpoint&fit=clip&h=900&w=1600",
    description: "A spring shower known for occasional bright meteors and outbursts.",
  },
  {
    code: "ETA",
    name: "eta Aquariids",
    activeStart: { month: 4, day: 15 },
    peak: { month: 5, day: 5 },
    activeEnd: { month: 5, day: 27 },
    radiant: "Aquarius",
    zhr: 60,
    bestTime: "04:00",
    moonAgeDays: 19,
    radiantDeclinationDegrees: -1.4,
    imageUrl: "https://assets.science.nasa.gov/dynamicimage/assets/science/psd/solar/2023/07/eta_aquarids_main.jpg?crop=faces%2Cfocalpoint&fit=clip&h=576&w=768",
    description: "Fast meteors from Halley's Comet debris, best before dawn.",
  },
  {
    code: "SDA",
    name: "Southern delta Aquariids",
    activeStart: { month: 7, day: 19 },
    peak: { month: 7, day: 30 },
    activeEnd: { month: 8, day: 13 },
    radiant: "Aquarius",
    zhr: 25,
    bestTime: "03:00",
    moonAgeDays: 16,
    radiantDeclinationDegrees: -16.4,
    imageUrl: "https://assets.science.nasa.gov/dynamicimage/assets/science/psd/solar-system/skywatching/evergreen-images/Perseids_2024_Preston_Dyches.jpg?crop=faces%2Cfocalpoint&fit=clip&h=1363&w=2048",
    description: "A steady summer shower that favors southern latitudes.",
  },
  {
    code: "PER",
    name: "Perseids",
    activeStart: { month: 7, day: 17 },
    peak: { month: 8, day: 13 },
    activeEnd: { month: 8, day: 29 },
    radiant: "Perseus",
    zhr: 100,
    bestTime: "04:00",
    moonAgeDays: 1,
    radiantDeclinationDegrees: 58.1,
    imageUrl: "https://assets.science.nasa.gov/dynamicimage/assets/science/psd/solar-system/skywatching/evergreen-images/Perseids_2024_Preston_Dyches.jpg?crop=faces%2Cfocalpoint&fit=clip&h=1363&w=2048",
    description: "One of the strongest annual showers, often producing bright meteors and fireballs.",
  },
  {
    code: "ORI",
    name: "Orionids",
    activeStart: { month: 10, day: 2 },
    peak: { month: 10, day: 23 },
    activeEnd: { month: 11, day: 12 },
    radiant: "Orion",
    zhr: 20,
    bestTime: "05:00",
    moonAgeDays: 12,
    radiantDeclinationDegrees: 15.8,
    imageUrl: "https://assets.science.nasa.gov/dynamicimage/assets/science/psd/solar/2023/07/orionids_main.jpg?crop=faces%2Cfocalpoint&fit=clip&h=576&w=768",
    description: "Fast meteors from Halley's Comet debris, radiating from Orion.",
  },
  {
    code: "LEO",
    name: "Leonids",
    activeStart: { month: 10, day: 28 },
    peak: { month: 11, day: 18 },
    activeEnd: { month: 12, day: 7 },
    radiant: "Leo",
    zhr: 15,
    bestTime: "05:00",
    moonAgeDays: 8,
    radiantDeclinationDegrees: 21.8,
    imageUrl: "https://assets.science.nasa.gov/dynamicimage/assets/science/psd/solar/2023/07/462_leonids_main-800x600-1.jpg?crop=faces%2Cfocalpoint&fit=clip&h=600&w=800",
    description: "A historically famous shower that occasionally produces enhanced activity.",
  },
  {
    code: "GEM",
    name: "Geminids",
    activeStart: { month: 12, day: 1 },
    peak: { month: 12, day: 14 },
    activeEnd: { month: 12, day: 21 },
    radiant: "Gemini",
    zhr: 120,
    bestTime: "01:00",
    moonAgeDays: 5,
    radiantDeclinationDegrees: 32.4,
    imageUrl: "https://assets.science.nasa.gov/dynamicimage/assets/science/psd/solar/2023/07/geminids_main.jpg?crop=faces%2Cfocalpoint&fit=clip&h=576&w=768",
    description: "A reliable, high-rate December shower with many bright meteors.",
  },
  {
    code: "URS",
    name: "Ursids",
    activeStart: { month: 12, day: 13 },
    peak: { month: 12, day: 22 },
    activeEnd: { month: 12, day: 24 },
    radiant: "Ursa Minor",
    zhr: 10,
    bestTime: "05:00",
    moonAgeDays: 14,
    radiantDeclinationDegrees: 75.3,
    imageUrl: "https://assets.science.nasa.gov/dynamicimage/assets/science/psd/solar/2023/07/geminids_main.jpg?crop=faces%2Cfocalpoint&fit=clip&h=576&w=768",
    description: "A smaller northern shower near the winter solstice.",
  },
];

function getMeteorShowers({ fromDate, toDate, limit, latitude } = {}) {
  const windowStart = parseDate(fromDate, false) || startOfYear(new Date());
  const windowEnd = parseDate(toDate, true) || endOfYear(windowStart);
  const boundedLimit = Number.isFinite(limit) && limit > 0 ? limit : Infinity;
  const observerLatitude = toFiniteNumber(latitude);
  const startYear = windowStart.getUTCFullYear() - 1;
  const endYear = windowEnd.getUTCFullYear() + 1;
  const results = [];

  for (let year = startYear; year <= endYear; year++) {
    for (const shower of MAJOR_SHOWERS) {
      const event = toMeteorEvent(shower, year, observerLatitude);
      if (eventDateInRange(event.date, windowStart, windowEnd)) {
        results.push(event);
      }
    }
  }

  results.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const limited = results.slice(0, boundedLimit);
  return { count: limited.length, results: limited };
}

function toMeteorEvent(shower, peakYear, observerLatitude) {
  const peakDate = dateFromParts(peakYear, shower.peak);
  const activeStart = dateFromParts(getActivityStartYear(shower.activeStart, shower.peak, peakYear), shower.activeStart);
  const activeEnd = dateFromParts(getActivityEndYear(shower.activeEnd, shower.peak, peakYear), shower.activeEnd);
  const activeWindow = `${formatMonthDay(activeStart)}-${formatMonthDay(activeEnd)}`;
  const peakLabel = formatMonthDay(peakDate);
  const visibility = getVisibilityForLatitude(shower, observerLatitude);
  const detailParts = [
    shower.description,
    `Active ${activeWindow}`,
    `Peak ${peakLabel}`,
    `Radiant ${shower.radiant}`,
    `ZHR up to ${shower.zhr}`,
    `Best around ${formatBestTime(shower.bestTime)}`,
    `Moon age ${shower.moonAgeDays} days`,
  ].filter(Boolean);

  return {
    id: `meteor-${shower.code.toLowerCase()}-${peakYear}`,
    event_id: `meteor-${shower.code.toLowerCase()}-${peakYear}`,
    category: "event",
    name: `${shower.name} meteor shower peak`,
    type: "Meteor Shower",
    date: peakDate.toISOString(),
    date_precision: "Day",
    location: "Best viewed from a dark, open sky",
    description: detailParts.join(" | "),
    image_url: shower.imageUrl,
    radiant: shower.radiant,
    radiant_declination_degrees: shower.radiantDeclinationDegrees,
    zhr: shower.zhr,
    active_start: activeStart.toISOString().slice(0, 10),
    active_end: activeEnd.toISOString().slice(0, 10),
    peak_date: peakDate.toISOString().slice(0, 10),
    best_time: shower.bestTime,
    moon_age_days: shower.moonAgeDays,
    radiant_max_altitude_degrees: visibility?.radiantMaxAltitudeDegrees ?? null,
  };
}

function getVisibilityForLatitude(shower, latitude) {
  if (latitude == null || shower.radiantDeclinationDegrees == null) return null;

  const radiantMaxAltitudeDegrees = Math.max(
    0,
    90 - Math.abs(latitude - shower.radiantDeclinationDegrees)
  );

  return { radiantMaxAltitudeDegrees };
}

function getActivityStartYear(datePart, peakPart, peakYear) {
  if (datePart.month > peakPart.month) return peakYear - 1;
  return peakYear;
}

function getActivityEndYear(datePart, peakPart, peakYear) {
  if (datePart.month < peakPart.month) return peakYear + 1;
  return peakYear;
}

function eventDateInRange(dateValue, start, end) {
  const eventDate = new Date(dateValue);
  return eventDate.getTime() >= start.getTime() && eventDate.getTime() <= end.getTime();
}

function parseDate(value, endOfDay) {
  if (!value) return null;
  const isDateOnlyValue = /^\d{4}-\d{2}-\d{2}$/.test(String(value));
  const date = isDateOnlyValue
    ? new Date(`${value}T${endOfDay ? "23:59:59" : "00:00:00"}Z`)
    : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function dateFromParts(year, { month, day }) {
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

function startOfYear(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), 0, 1, 0, 0, 0));
}

function endOfYear(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), 11, 31, 23, 59, 59));
}

function formatMonthDay(date) {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function formatBestTime(value) {
  const [hour, minute] = String(value).split(":");
  const date = new Date(Date.UTC(2000, 0, 1, Number(hour), Number(minute || 0)));
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

module.exports = { getMeteorShowers };
