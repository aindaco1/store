export const DEFAULT_PLATFORM_TIME_ZONE = 'America/Denver';

const SUPPLEMENTAL_TIME_ZONES = Object.freeze([
  'UTC',
  'Etc/UTC'
]);

let cachedSupportedTimeZones = null;
let cachedTimeZoneSet = null;

function isRuntimeAcceptedTimeZone(timeZone) {
  if (typeof Intl === 'undefined' || typeof Intl.DateTimeFormat !== 'function') {
    return false;
  }

  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

function runtimeSupportedTimeZones() {
  if (typeof Intl === 'undefined' || typeof Intl.supportedValuesOf !== 'function') {
    return [DEFAULT_PLATFORM_TIME_ZONE];
  }

  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return [DEFAULT_PLATFORM_TIME_ZONE];
  }
}

export function getSupportedTimeZones() {
  if (cachedSupportedTimeZones) return cachedSupportedTimeZones;

  const zones = [
    ...runtimeSupportedTimeZones(),
    ...SUPPLEMENTAL_TIME_ZONES.filter(isRuntimeAcceptedTimeZone)
  ]
    .map((timeZone) => String(timeZone || '').trim())
    .filter(Boolean);
  if (!zones.includes(DEFAULT_PLATFORM_TIME_ZONE)) {
    zones.push(DEFAULT_PLATFORM_TIME_ZONE);
  }

  cachedSupportedTimeZones = Object.freeze(Array.from(new Set(zones)).sort((a, b) => a.localeCompare(b)));
  cachedTimeZoneSet = new Set(cachedSupportedTimeZones);
  return cachedSupportedTimeZones;
}

export function getTimeZoneOptions() {
  return getSupportedTimeZones().map((timeZone) => ({
    value: timeZone,
    label: timeZone.replace(/_/g, ' ')
  }));
}

export function isSupportedTimeZone(value) {
  const timeZone = String(value || '').trim();
  if (!timeZone) return false;
  getSupportedTimeZones();
  return cachedTimeZoneSet.has(timeZone);
}

export function normalizeTimeZone(value, fallback = DEFAULT_PLATFORM_TIME_ZONE) {
  const timeZone = String(value || '').trim();
  if (isSupportedTimeZone(timeZone)) return timeZone;
  return isSupportedTimeZone(fallback) ? fallback : DEFAULT_PLATFORM_TIME_ZONE;
}
