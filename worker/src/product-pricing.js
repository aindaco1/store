import { isValidAmount } from './validation.js';

export const PAY_WHAT_YOU_WANT = 'pay_what_you_want';
export const MIN_CONTRIBUTION_CENTS = 50;

export function isContributionAmount(value) {
  return isValidAmount(value) && value >= MIN_CONTRIBUTION_CENTS;
}

export function normalizeProductPricing(product = {}) {
  const mode = product.pricing_mode ?? 'fixed';
  const suggestions = product.suggested_amounts ?? [];
  const errors = [];
  if (!['fixed', PAY_WHAT_YOU_WANT].includes(mode)) errors.push('Choose a valid pricing mode.');
  if (mode === PAY_WHAT_YOU_WANT) {
    if (product.fulfillment_type !== 'service' || (product.variants || []).length || product.inventory_tracking === true) {
      errors.push('Pay what you want requires a service without variants or inventory tracking.');
    }
    if ((product.currency || 'USD') !== 'USD') errors.push('Pay what you want currently supports USD.');
    if (!isContributionAmount(product.price_cents)) errors.push('The starting amount must be at least $0.50 and within the Store amount limit.');
    if (!Array.isArray(suggestions) || suggestions.length > 6 || suggestions.some((value) => (
      typeof value !== 'number' || !Number.isFinite(value) ||
      Math.abs(value * 100 - Math.round(value * 100)) > 0.000001 ||
      !isContributionAmount(Math.round(value * 100))
    )) || new Set(suggestions).size !== suggestions.length) {
      errors.push('Use up to six distinct suggested USD amounts, at least $0.50 each, with at most two decimal places.');
    }
  }
  return { mode, suggestedAmounts: mode === PAY_WHAT_YOU_WANT && Array.isArray(suggestions) ? suggestions : [], errors };
}
