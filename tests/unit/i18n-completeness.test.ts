import { execFileSync } from 'node:child_process';
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
});
