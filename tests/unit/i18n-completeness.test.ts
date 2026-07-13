import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function loadLocale(lang: string) {
  const output = execFileSync('ruby', [
    '-ryaml',
    '-rjson',
    '-e',
    'puts JSON.generate(YAML.load_file(ARGV.fetch(0)))',
    `_data/i18n/${lang}.yml`
  ], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });
  return JSON.parse(output);
}

function valueAt(catalog: Record<string, any>, keyPath: string) {
  return keyPath.split('.').reduce((value, segment) => value?.[segment], catalog);
}

function placeholders(value: string) {
  return Array.from(value.matchAll(/%\{([^}]+)\}/g), (match) => match[1]).sort();
}

describe('i18n completeness', () => {
  it('keeps supported locale keys aligned with English', () => {
    const output = execFileSync('ruby', ['scripts/check-i18n-completeness.rb'], {
      cwd: process.cwd(),
      encoding: 'utf8'
    });

    expect(output).toContain('i18n completeness ok');
  });

  it('keeps release-critical Store surfaces localized with matching placeholders', () => {
    const en = loadLocale('en');
    const es = loadLocale('es');
    const releaseCriticalPaths = [
      'admin.overview_help',
      'admin.store_orders_intro',
      'admin.store_products_intro',
      'admin.store_coupons_intro',
      'admin.store_downloads_intro',
      'admin.store_marketing_intro',
      'runtime.cart.checkout_title',
      'runtime.cart.shipping_address',
      'runtime.cart.coupon_invalid',
      'runtime.cart.hosted_checkout_note',
      'runtime.order_lookup.generic_sent',
      'runtime.order_lookup.sending',
      'runtime.order_success.ready_fulfillment',
      'runtime.order_success.confirmed_heading',
      'runtime.order_success.download_note',
      'email.subjects.store_order_confirmed',
      'email.subjects.store_order_lookup',
      'email.subjects.store_abandoned_cart',
      'email.subjects.store_event_reminder',
      'email.store_order.admin_body',
      'email.store_order.attachments_note',
      'email.store_event_reminder.attachments',
      'email.store_order_lookup.body_one',
      'email.store_abandoned_cart.footer'
    ];

    for (const keyPath of releaseCriticalPaths) {
      const englishValue = valueAt(en, keyPath);
      const spanishValue = valueAt(es, keyPath);

      expect(englishValue, `${keyPath} missing from English catalog`).toEqual(expect.any(String));
      expect(spanishValue, `${keyPath} missing from Spanish catalog`).toEqual(expect.any(String));
      expect(spanishValue.trim(), `${keyPath} Spanish value is empty`).not.toBe('');
      expect(placeholders(spanishValue), `${keyPath} placeholder drift`).toEqual(placeholders(englishValue));
    }
  });

  it('routes v1.0.8 media-admin copy through the shared runtime catalog', () => {
    const en = loadLocale('en');
    const es = loadLocale('es');
    const mediaKeys = [
      'media_image_size_error',
      'media_video_size_error',
      'media_audio_size_error',
      'media_type_error',
      'media_uploading',
      'media_replaced',
      'media_uploaded',
      'media_status_missing_derivatives',
      'media_reference_other',
      'media_broken_other',
      'media_field_requires',
      'media_replace_label',
      'media_choose_existing',
      'media_meaningful',
      'media_decorative'
    ];
    const runtimeInclude = readFileSync('_includes/runtime-messages-json.html', 'utf8');
    const dashboard = readFileSync('assets/js/admin-dashboard.js', 'utf8');

    for (const key of mediaKeys) {
      const englishValue = valueAt(en, `admin.${key}`);
      const spanishValue = valueAt(es, `admin.${key}`);
      expect(englishValue, `admin.${key} missing from English catalog`).toEqual(expect.any(String));
      expect(spanishValue, `admin.${key} missing from Spanish catalog`).toEqual(expect.any(String));
      expect(placeholders(spanishValue), `admin.${key} placeholder drift`).toEqual(placeholders(englishValue));
      expect(runtimeInclude).toContain(`admin.${key}`);
    }

    for (const hardcoded of [
      'No product media found yet.',
      'No media matches these filters.',
      'Repair changed media',
      'Repair all media',
      'Meaningful — alt text required',
      'Decorative — empty alt text',
      'Use a supported image, video, or audio file.'
    ]) {
      expect(dashboard).not.toContain(`'${hardcoded}'`);
    }
  });
});
