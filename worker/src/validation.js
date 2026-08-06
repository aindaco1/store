/**
 * SEC-011: Input Validation Helpers
 * 
 * Centralized validation functions to prevent injection, overflow, and malformed inputs.
 */

import {
  SECURITY_HEADERS,
  createWorkerHttpHelpers
} from '../../shared/dust-wave-platform/packages/worker-core/src/http.js';

export { SECURITY_HEADERS };

export const VALID_SLUG_REGEX = /^[a-z0-9-]+$/;
export const VALID_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MAX_SLUG_LENGTH = 100;
export const MAX_EMAIL_LENGTH = 254;
export const MAX_VOTE_OPTION_LENGTH = 50;
export const MAX_DECISION_ID_LENGTH = 100;
export const MAX_AMOUNT_CENTS = 100000000; // Max $1M

export function isValidSlug(slug) {
  return typeof slug === 'string' && 
         slug.length > 0 && 
         slug.length <= MAX_SLUG_LENGTH && 
         VALID_SLUG_REGEX.test(slug);
}

export function isValidEmail(email) {
  return typeof email === 'string' && 
         email.length > 0 && 
         email.length <= MAX_EMAIL_LENGTH && 
         VALID_EMAIL_REGEX.test(email);
}

export function isValidAmount(amountCents) {
  return typeof amountCents === 'number' && 
         Number.isInteger(amountCents) && 
         amountCents >= 0 && 
         amountCents <= MAX_AMOUNT_CENTS;
}

export function isValidVoteOption(option) {
  return typeof option === 'string' && 
         option.length > 0 && 
         option.length <= MAX_VOTE_OPTION_LENGTH;
}

export function isValidDecisionId(decisionId) {
  return typeof decisionId === 'string' && 
         decisionId.length > 0 && 
         decisionId.length <= MAX_DECISION_ID_LENGTH &&
         VALID_SLUG_REGEX.test(decisionId);
}

// SEC-004/SEC-012: Store injects its private origin while Platform owns the
// characterized CORS normalization, JSON response, and baseline headers.
const {
  getAllowedOrigin,
  jsonResponse
} = createWorkerHttpHelpers({
  defaultPrivateOrigin: 'https://shop.dustwave.xyz'
});

export { getAllowedOrigin, jsonResponse };
