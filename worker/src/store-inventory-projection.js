function nonNegativeInteger(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
}

function unavailableAvailability() {
  return {
    availabilityStatus: 'unavailable',
    coordinatorLimit: null,
    claimed: null,
    reserved: null,
    available: null,
    remaining: null,
    baselineInSync: null
  };
}

export function buildStoreInventoryAvailability({
  sku = '',
  baseline = null,
  coordinator = null
} = {}) {
  if (baseline === null || baseline === undefined || baseline === '') {
    return {
      availabilityStatus: 'unlimited',
      coordinatorLimit: null,
      claimed: null,
      reserved: null,
      available: null,
      remaining: null,
      baselineInSync: true
    };
  }

  const normalizedBaseline = nonNegativeInteger(baseline);
  if (!coordinator?.ok) return unavailableAvailability();

  const normalizedSku = String(sku || '').trim();
  const entry = normalizedSku && coordinator.inventory && typeof coordinator.inventory === 'object'
    ? coordinator.inventory[normalizedSku]
    : null;
  if (!entry && normalizedBaseline > 0) return unavailableAvailability();

  const coordinatorLimit = entry
    ? nonNegativeInteger(entry.limit, normalizedBaseline)
    : normalizedBaseline;
  const claimed = entry ? nonNegativeInteger(entry.claimed) : 0;
  const reserved = normalizedSku
    ? nonNegativeInteger(coordinator.reservedCounts?.[normalizedSku])
    : 0;
  const available = Math.max(0, coordinatorLimit - claimed - reserved);
  const baselineInSync = coordinatorLimit === normalizedBaseline;

  return {
    availabilityStatus: baselineInSync ? 'ready' : 'drift',
    coordinatorLimit,
    claimed,
    reserved,
    available,
    remaining: available,
    baselineInSync
  };
}

export function aggregateStoreInventoryAvailability(entries = []) {
  const normalized = Array.isArray(entries) ? entries : [];
  if (normalized.length === 0 || normalized.some((entry) => entry?.availabilityStatus === 'unavailable')) {
    return unavailableAvailability();
  }
  if (normalized.some((entry) => entry?.availabilityStatus === 'unlimited')) {
    return {
      availabilityStatus: 'unlimited',
      coordinatorLimit: null,
      claimed: null,
      reserved: null,
      available: null,
      remaining: null,
      baselineInSync: normalized.every((entry) => entry?.baselineInSync !== false)
    };
  }

  const totals = normalized.reduce((result, entry) => ({
    coordinatorLimit: result.coordinatorLimit + nonNegativeInteger(entry?.coordinatorLimit),
    claimed: result.claimed + nonNegativeInteger(entry?.claimed),
    reserved: result.reserved + nonNegativeInteger(entry?.reserved),
    available: result.available + nonNegativeInteger(entry?.available)
  }), { coordinatorLimit: 0, claimed: 0, reserved: 0, available: 0 });
  const baselineInSync = normalized.every((entry) => entry?.baselineInSync === true);

  return {
    availabilityStatus: baselineInSync ? 'ready' : 'drift',
    ...totals,
    remaining: totals.available,
    baselineInSync
  };
}
