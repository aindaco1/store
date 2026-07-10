const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/;
const US_POSTAL_CODE_PATTERN = /^\d{5}(?:-\d{4})?$/;
const INTERNATIONAL_POSTAL_CODE_PATTERN = /^[A-Z0-9][A-Z0-9 -]{1,15}$/;

export function normalizeDestinationCountry(value) {
  const country = String(value || '').trim().toUpperCase();
  return COUNTRY_CODE_PATTERN.test(country) ? country : '';
}

export function normalizeDestinationPostalCode(value, country = '') {
  const postalCode = String(value || '').trim().toUpperCase();
  const pattern = country === 'US' ? US_POSTAL_CODE_PATTERN : INTERNATIONAL_POSTAL_CODE_PATTERN;
  return pattern.test(postalCode) ? postalCode : '';
}
