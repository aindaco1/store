/**
 * SEC-011: Input Validation Helpers
 * 
 * Centralized validation functions to prevent injection, overflow, and malformed inputs.
 */

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

// SEC-012: Security headers to prevent common attacks
export const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin'
};

const DEFAULT_PRIVATE_CORS_ORIGIN = 'https://shop.dustwave.xyz';

function normalizeOrigin(value) {
  const configured = String(value || '').trim();
  if (!configured || configured === '*') return '';
  try {
    return new URL(configured).origin;
  } catch {
    return '';
  }
}

// SEC-004: CORS helper - returns allowed origin based on endpoint type
export function getAllowedOrigin(env, isPublic = false) {
  if (isPublic) return '*';
  return normalizeOrigin(env?.CORS_ALLOWED_ORIGIN) ||
         normalizeOrigin(env?.SITE_BASE) ||
         DEFAULT_PRIVATE_CORS_ORIGIN;
}

// Shared JSON response helper with security headers
export function jsonResponse(data, status = 200, env = null, isPublic = false) {
  const origin = getAllowedOrigin(env, isPublic);
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-admin-key',
      ...SECURITY_HEADERS
    }
  });
}
