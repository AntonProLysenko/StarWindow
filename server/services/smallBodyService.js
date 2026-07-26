const CAD_BASE = "https://ssd-api.jpl.nasa.gov/cad.api";
const DEFAULT_LIMIT = 200;
const ASTEROID_DISTANCE_MAX = "10LD";
const COMET_DISTANCE_MAX = "0.2";
const LD_PER_AU = 149597870.7 / 384400;
const ASTEROID_IMAGE_URL = "https://images-assets.nasa.gov/image/2019-02-25_regolith_image_compilation/2019-02-25_regolith_image_compilation~medium.jpg";
const COMET_IMAGE_URL = "https://images-assets.nasa.gov/image/PIA19102/PIA19102~medium.jpg";

const MONTHS = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11,
};

async function fetchSmallBodyFlybys({ fromDate, toDate, limit = DEFAULT_LIMIT } = {}) {
  if (!fromDate || !toDate) return [];

  const [nearEarthObjects, comets] = await Promise.all([
    fetchCadRecords({
      fromDate,
      toDate,
      limit,
      distanceMax: ASTEROID_DISTANCE_MAX,
      extraParams: { "nea-comet": "true" },
    }),
    fetchCadRecords({
      fromDate,
      toDate,
      limit: 50,
      distanceMax: COMET_DISTANCE_MAX,
      extraParams: { kind: "c" },
    }),
  ]);

  return dedupeFlybys([...nearEarthObjects, ...comets])
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
}

async function fetchCadRecords({ fromDate, toDate, limit, distanceMax, extraParams }) {
  const params = new URLSearchParams({
    "date-min": toDateParam(fromDate),
    "date-max": toDateParam(toDate),
    "dist-max": distanceMax,
    diameter: "true",
    fullname: "true",
    sort: "date",
    limit: String(limit),
    ...extraParams,
  });

  const response = await fetch(`${CAD_BASE}?${params}`);
  const payload = await response.json();

  if (!response.ok) {
    const error = new Error(payload?.message || payload?.error || `JPL CAD API returned ${response.status}`);
    error.status = response.status;
    throw error;
  }

  const fields = Array.isArray(payload.fields) ? payload.fields : [];
  return (payload.data || [])
    .map((record) => normalizeCadRecord(fields, record))
    .filter(Boolean);
}

function dedupeFlybys(events) {
  const seen = new Set();
  const unique = [];

  for (const event of events) {
    const key = `${event.name}|${event.startTime}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(event);
  }

  return unique;
}

function normalizeCadRecord(fields, record) {
  const row = Object.fromEntries(fields.map((field, index) => [field, record[index]]));
  const startTime = parseCadDate(row.cd);
  const des = cleanText(row.des);
  const objectName = cleanObjectName(des, row.fullname);
  if (!startTime || !objectName) return null;

  const isComet = isCometObject(des, objectName);
  const objectKind = isComet ? "comet" : "asteroid";
  const distanceAu = toNumber(row.dist);
  const distanceLd = distanceAu == null ? null : distanceAu * LD_PER_AU;
  const speed = toNumber(row.v_rel);
  const diameter = toNumber(row.diameter);
  const absoluteMagnitude = cleanText(row.h);
  const timeUncertainty = cleanText(row.t_sigma_f);

  return {
    name: `${objectName} ${objectKind} flyby`,
    startTime,
    endTime: null,
    datePrecision: "Minute",
    description: buildDescription({
      distanceAu,
      distanceLd,
      speed,
      diameter,
      absoluteMagnitude,
      timeUncertainty,
    }),
    eventType: isComet ? "Comet Flyby" : "Asteroid Flyby",
    webcastLive: false,
    videoUrl: null,
    infoUrl: buildSbdbUrl(des || objectName),
    imageUrl: isComet ? COMET_IMAGE_URL : ASTEROID_IMAGE_URL,
    locationId: null,
  };
}

function buildDescription({
  distanceAu,
  distanceLd,
  speed,
  diameter,
  absoluteMagnitude,
  timeUncertainty,
}) {
  return [
    "Closest approach to Earth",
    distanceLd != null && distanceAu != null
      ? `Distance ${formatNumber(distanceLd, 2)} lunar distances (${formatNumber(distanceAu, 5)} AU)`
      : null,
    speed != null ? `Speed ${formatNumber(speed, 1)} km/s` : null,
    diameter != null ? `Diameter ${formatDiameter(diameter)}` : null,
    absoluteMagnitude ? `Absolute magnitude H ${absoluteMagnitude}` : null,
    timeUncertainty ? `Time uncertainty ${timeUncertainty}` : null,
    "Source NASA/JPL CNEOS",
  ]
    .filter(Boolean)
    .join(" | ");
}

function parseCadDate(value) {
  const match = String(value || "").match(/^(\d{4})-([A-Za-z]{3})-(\d{1,2})\s+(\d{1,2}):(\d{2})$/);
  if (!match) return null;

  const [, year, monthName, day, hour, minute] = match;
  const month = MONTHS[monthName];
  if (month == null) return null;

  return new Date(Date.UTC(
    Number(year),
    month,
    Number(day),
    Number(hour),
    Number(minute)
  )).toISOString();
}

function cleanObjectName(des, fullname) {
  const full = cleanText(fullname);
  const fallback = cleanText(des);
  const value = full || fallback;
  if (!value) return fallback;
  return value.replace(/^\((.+)\)$/, "$1");
}

function isCometObject(des, name) {
  const text = `${des || ""} ${name || ""}`;
  return (
    text.includes("/") ||
    /\b\d+[PDC]\b/i.test(text) ||
    /\b[PCD]\/\d{4}\b/i.test(text)
  );
}

function buildSbdbUrl(value) {
  return `https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html#/?sstr=${encodeURIComponent(value)}`;
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function toNumber(value) {
  if (value == null || String(value).trim() === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function formatNumber(value, digits) {
  return Number(value).toLocaleString("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  });
}

function formatDiameter(valueKm) {
  if (valueKm < 1) {
    return `${formatNumber(valueKm * 1000, 0)} m`;
  }
  return `${formatNumber(valueKm, 2)} km`;
}

function toDateParam(value) {
  return String(value).slice(0, 10);
}

module.exports = { fetchSmallBodyFlybys };
