// Pure solar-position math — no I/O, no external API.
//
// sunAltitudeDeg(lat, lon, date) returns the sun's altitude (elevation) above
// the horizon in degrees: positive = sun is up (daytime), negative = below the
// horizon. Used by the viewing score to collapse the score during daylight.
//
// Algorithm: the standard low-precision solar position used by SunCalc
// (github.com/mourner/suncalc), accurate to a fraction of a degree — far more
// than a 0-100 viewing score needs. All angles in radians internally.

const RAD = Math.PI / 180;
const DAY_MS = 1000 * 60 * 60 * 24;
const J1970 = 2440588;
const J2000 = 2451545;
const OBLIQUITY = RAD * 23.4397; // axial tilt of the Earth
const PERIHELION = RAD * 102.9372; // Earth's perihelion of the ecliptic

// Days since J2000.0 for a JS Date (UTC).
function toDays(date) {
  return date.valueOf() / DAY_MS - 0.5 + J1970 - J2000;
}

function solarMeanAnomaly(d) {
  return RAD * (357.5291 + 0.98560028 * d);
}

function eclipticLongitude(M) {
  const C =
    RAD *
    (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  return M + C + PERIHELION + Math.PI;
}

function declination(L) {
  return Math.asin(Math.sin(OBLIQUITY) * Math.sin(L));
}

function rightAscension(L) {
  return Math.atan2(Math.sin(L) * Math.cos(OBLIQUITY), Math.cos(L));
}

function siderealTime(d, lw) {
  return RAD * (280.16 + 360.9856235 * d) - lw;
}

/**
 * Sun altitude above the horizon, in degrees.
 * @param {number} lat  latitude, degrees
 * @param {number} lon  longitude, degrees
 * @param {Date}   [date=new Date()]  moment to evaluate (UTC)
 * @returns {number} altitude in degrees (positive = above horizon)
 */
function sunAltitudeDeg(lat, lon, date = new Date()) {
  const lw = RAD * -lon;
  const phi = RAD * lat;
  const d = toDays(date);

  const M = solarMeanAnomaly(d);
  const L = eclipticLongitude(M);
  const dec = declination(L);
  const ra = rightAscension(L);
  const H = siderealTime(d, lw) - ra;

  const altitude = Math.asin(
    Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H)
  );
  return altitude / RAD;
}

module.exports = { sunAltitudeDeg };
