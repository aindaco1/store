import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Render the actual Liquid include so both Offer branches and policy settings
// are exercised without relying on a stale _site build or production services.
const renderScript = `
require 'bundler/setup'
require 'jekyll'
require 'json'
site = Jekyll::Site.new(Jekyll.configuration('source' => Dir.pwd, 'quiet' => true))
site.read
request = JSON.parse(STDIN.read)
site.config['seo']['merchant_return_policy'] = request.fetch('policy')
page = request.fetch('page')
puts Liquid::Template.parse('{% include seo-json-ld.html %}').render!(
  { 'site' => site.site_payload['site'], 'page' => page },
  registers: { site: site, page: page }
)
`;

describe('rendered Offer return policies', () => {
  it.each(['en', 'es'].flatMap(lang => [false, true].map(variants => ({ lang, variants }))))(
    'links every Offer to the configured policy ($lang, variants=$variants)',
    ({ lang, variants }) => {
      for (const category of ['MerchantReturnNotPermitted', 'MerchantReturnFiniteReturnWindow', 'MerchantReturnUnlimitedWindow']) {
        const html = execFileSync('ruby', ['-e', renderScript], {
          cwd: path.resolve(__dirname, '../..'),
          env: { ...process.env, JEKYLL_ENV: 'production' },
          encoding: 'utf8',
          input: JSON.stringify({
            policy: {
              applicable_country: 'CA',
              return_policy_category: `https://schema.org/${category}`,
              merchant_return_days: 30,
              return_method: 'https://schema.org/ReturnByMail',
              return_fees: 'https://schema.org/FreeReturn'
            },
            page: {
              store_product: true, lang, name: 'Mug', price: 20,
              url: `${lang === 'en' ? '' : '/es'}/products/mug/`,
              ...(variants ? { variants: [{ sku: 'small', price: 15 }, { sku: 'large', price: 20 }] } : {})
            }
          })
        });
        const graph = JSON.parse(html.match(/<script[^>]*>([\s\S]*?)<\/script>/)![1])['@graph'];
        const policy = graph.find(node => node['@type'] === 'Organization').hasMerchantReturnPolicy;
        const product = graph.find(node => node['@type'] === 'Product');
        const offers = Array.isArray(product.offers) ? product.offers : [product.offers];
        expect(offers).toHaveLength(variants ? 2 : 1);
        expect(product).not.toHaveProperty('review');
        expect(product).not.toHaveProperty('aggregateRating');
        expect(policy).toMatchObject({ applicableCountry: 'CA', returnPolicyCategory: `https://schema.org/${category}` });
        for (const offer of offers) {
          expect(offer.hasMerchantReturnPolicy).toEqual({ '@id': policy['@id'] });
          expect(offer).not.toHaveProperty('shippingDetails');
          expect(new URL(policy['@id']).pathname).toBe('/terms/');
          expect(new URL(policy['@id']).hash).toBe('#returns-refunds');
        }
        if (category === 'MerchantReturnFiniteReturnWindow') expect(policy.merchantReturnDays).toBe(30);
        else expect(policy).not.toHaveProperty('merchantReturnDays');
        if (category === 'MerchantReturnNotPermitted') {
          expect(policy).not.toHaveProperty('returnMethod');
          expect(policy).not.toHaveProperty('returnFees');
        }
      }
    }
  );
});
