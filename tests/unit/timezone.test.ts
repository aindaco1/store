import { describe, expect, it } from 'vitest';

import {
  getPlatformDateKey,
  getPlatformTimeParts,
  getPlatformTimeZone,
  getSupportedTimeZones,
  getTimeZoneOptions,
  isPlatformDatePast,
  isSupportedTimeZone,
  platformDateEnd,
  platformDateStart
} from '../../worker/src/timezone.js';

describe('platform timezone utilities', () => {
  it('defaults to America/Denver and exposes IANA timezone options', () => {
    expect(getPlatformTimeZone({})).toBe('America/Denver');
    expect(isSupportedTimeZone('America/Denver')).toBe(true);
    expect(isSupportedTimeZone('Not/AZone')).toBe(false);
    expect(getSupportedTimeZones()).toContain('America/Denver');
    expect(getSupportedTimeZones()).toContain('UTC');
    const options = getTimeZoneOptions();
    expect(options).toEqual(expect.arrayContaining([
      { value: 'America/Denver', label: 'America/Denver' },
      { value: 'UTC', label: 'UTC' },
      { value: 'Europe/London', label: 'Europe/London' }
    ]));
    expect(options).toContainEqual({
      value: 'Africa/Addis_Ababa',
      label: 'Africa/Addis Ababa'
    });
  });

  it('converts date boundaries in the configured timezone', () => {
    expect(platformDateStart('2026-04-21', { PLATFORM_TIMEZONE: 'America/Denver' }).toISOString())
      .toBe('2026-04-21T06:00:00.000Z');
    expect(platformDateEnd('2026-04-21', { PLATFORM_TIMEZONE: 'America/Denver' }).toISOString())
      .toBe('2026-04-22T05:59:59.000Z');

    expect(platformDateStart('2026-04-21', { PLATFORM_TIMEZONE: 'Asia/Tokyo' }).toISOString())
      .toBe('2026-04-20T15:00:00.000Z');
    expect(platformDateEnd('2026-04-21', { PLATFORM_TIMEZONE: 'Asia/Tokyo' }).toISOString())
      .toBe('2026-04-21T14:59:59.000Z');
  });

  it('derives local date keys and deadline status from the platform timezone', () => {
    const instant = new Date('2026-04-21T05:30:00.000Z');
    expect(getPlatformDateKey({ PLATFORM_TIMEZONE: 'America/Denver' }, instant)).toBe('2026-04-20');
    expect(getPlatformDateKey({ PLATFORM_TIMEZONE: 'Europe/London' }, instant)).toBe('2026-04-21');
    expect(getPlatformTimeParts({ PLATFORM_TIMEZONE: 'America/New_York' }, instant)).toMatchObject({
      year: 2026,
      month: 4,
      day: 21,
      hour: 1,
      minute: 30
    });

    expect(isPlatformDatePast('2026-04-21', { PLATFORM_TIMEZONE: 'Asia/Tokyo' }, new Date('2026-04-21T15:00:00.000Z'))).toBe(true);
    expect(isPlatformDatePast('2026-04-21', { PLATFORM_TIMEZONE: 'America/Denver' }, new Date('2026-04-21T15:00:00.000Z'))).toBe(false);
  });
});
