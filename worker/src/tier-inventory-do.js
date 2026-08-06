import {
  cloneInventory,
  cloneReservations,
  createInventoryStateMechanics,
  getReservationCounts,
  getReservedCounts,
  normalizeCountMap
} from '../../shared/dust-wave-platform/packages/inventory-core/src/index.js';

const DEFAULT_RESERVATION_TTL_SECONDS = 600;
const {
  buildReservationEntry,
  normalizeState
} = createInventoryStateMechanics({
  defaultReservationTtlSeconds: DEFAULT_RESERVATION_TTL_SECONDS,
  bootstrapStrategy: 'merge'
});

class InventoryCoordinator {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.scopeField = 'scope';
    this.itemField = 'sku';
    this.scopeLabel = 'inventory scope';
    this.itemLabel = 'SKU';
    this.availabilityLabel = 'SKU';
    this.kvKeyPrefix = 'store-inventory:v1';
  }

  getPayloadOptions() {
    return {
      scopeField: this.scopeField,
      itemField: this.itemField,
      scopeLabel: this.scopeLabel,
      itemLabel: this.itemLabel
    };
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/health') {
      return jsonResponse({ ok: true });
    }

    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    let body;
    try {
      body = await request.json();
    } catch (_err) {
      return jsonResponse({ error: 'Invalid JSON body' }, 400);
    }

    const payload = validatePayload(body, this.getPayloadOptions());
    if (!payload.ok) {
      return jsonResponse({ error: payload.error }, 400);
    }

    if (url.pathname === '/claim') {
      return this.handleClaim(payload.value);
    }

    if (url.pathname === '/release') {
      return this.handleRelease(payload.value);
    }

    if (url.pathname === '/apply-selection') {
      return this.handleApplySelection(payload.value);
    }

    if (url.pathname === '/claim-selection') {
      return this.handleClaimSelection(payload.value);
    }

    if (url.pathname === '/replace') {
      return this.handleReplace(payload.value);
    }

    if (url.pathname === '/reserve-selection') {
      return this.handleReserveSelection(payload.value);
    }

    if (url.pathname === '/release-reservation') {
      return this.handleReleaseReservation(payload.value);
    }

    if (url.pathname === '/confirm-reservation') {
      return this.handleConfirmReservation(payload.value);
    }

    if (url.pathname === '/reserved-counts') {
      return this.handleReservedCounts(payload.value);
    }

    if (url.pathname === '/snapshot') {
      return this.handleSnapshot(payload.value);
    }

    return jsonResponse({ error: 'Not found' }, 404);
  }

  async handleClaim(payload) {
    const result = await this.ctx.storage.transaction(async (storage) => {
      const state = await getWorkingState(storage, payload.inventory);
      const item = state.inventory[payload.itemId];

      if (!item) {
        return { success: true, state };
      }

      const remaining = Number(item.limit || 0) - Number(item.claimed || 0);
      if (payload.qty > remaining) {
        return {
          success: false,
          error: `Only ${Math.max(0, remaining)} remaining for this ${this.availabilityLabel}`,
          remaining: Math.max(0, remaining)
        };
      }

      item.claimed = Number(item.claimed || 0) + payload.qty;
      state.updatedAt = new Date().toISOString();
      await putWorkingState(storage, state);

      return {
        success: true,
        remaining: Math.max(0, Number(item.limit || 0) - Number(item.claimed || 0)),
        inventory: state.inventory,
        state
      };
    });

    await syncInventoryToKv(this.env, payload.scope, result.state?.inventory || result.inventory, this.kvKeyPrefix);
    return jsonResponse(result);
  }

  async handleRelease(payload) {
    const result = await this.ctx.storage.transaction(async (storage) => {
      const state = await getWorkingState(storage, payload.inventory);
      const item = state.inventory[payload.itemId];

      if (!item) {
        return { success: true, inventory: state.inventory, state };
      }

      item.claimed = Math.max(0, Number(item.claimed || 0) - payload.qty);
      state.updatedAt = new Date().toISOString();
      await putWorkingState(storage, state);
      return { success: true, inventory: state.inventory, state };
    });

    await syncInventoryToKv(this.env, payload.scope, result.state?.inventory || result.inventory, this.kvKeyPrefix);
    return jsonResponse(result);
  }

  async handleClaimSelection(payload) {
    return this.handleApplySelection({
      scope: payload.scope,
      inventory: payload.inventory,
      previousCounts: {},
      nextCounts: payload.nextCounts
    });
  }

  async handleApplySelection(payload) {
    const result = await this.ctx.storage.transaction(async (storage) => {
      const state = await getWorkingState(storage, payload.inventory);
      const inventory = state.inventory;
      const previousCounts = payload.previousCounts || {};
      const nextCounts = payload.nextCounts || {};
      const itemIds = new Set([...Object.keys(previousCounts), ...Object.keys(nextCounts)]);

      for (const itemId of itemIds) {
        const delta = Number(nextCounts[itemId] || 0) - Number(previousCounts[itemId] || 0);
        if (delta <= 0) continue;

        const item = inventory[itemId];
        if (!item) continue;

        const remaining = Number(item.limit || 0) - Number(item.claimed || 0);
        if (delta > remaining) {
          return {
            success: false,
            error: `Only ${Math.max(0, remaining)} remaining for this ${this.availabilityLabel}`,
            remaining: Math.max(0, remaining)
          };
        }
      }

      for (const itemId of itemIds) {
        const delta = Number(nextCounts[itemId] || 0) - Number(previousCounts[itemId] || 0);
        if (delta === 0) continue;

        const item = inventory[itemId];
        if (!item) continue;

        if (delta > 0) {
          item.claimed = Number(item.claimed || 0) + delta;
        } else {
          item.claimed = Math.max(0, Number(item.claimed || 0) + delta);
        }
      }

      state.updatedAt = new Date().toISOString();
      await putWorkingState(storage, state);
      return { success: true, inventory, state };
    });

    await syncInventoryToKv(this.env, payload.scope, result.state?.inventory || result.inventory, this.kvKeyPrefix);
    return jsonResponse(result);
  }

  async handleReplace(payload) {
    const state = await this.ctx.storage.transaction(async (storage) => {
      const currentState = await getWorkingState(storage, payload.inventory);
      currentState.inventory = cloneInventory(payload.inventory || {});
      currentState.reservations = {};
      currentState.updatedAt = new Date().toISOString();
      await putWorkingState(storage, currentState);
      return currentState;
    });
    await syncInventoryToKv(this.env, payload.scope, state.inventory, this.kvKeyPrefix);
    return jsonResponse({ success: true, inventory: state.inventory, state });
  }

  async handleReserveSelection(payload) {
    const result = await this.ctx.storage.transaction(async (storage) => {
      const state = await getWorkingState(storage, payload.inventory);
      const reservationId = payload.reservationId;
      const previousReservation = getReservationCounts(state.reservations[reservationId]);
      const nextReservation = normalizeCountMap(payload.nextCounts || {});
      const reservedCounts = getReservedCounts(state.reservations, reservationId);
      const itemIds = new Set([...Object.keys(previousReservation), ...Object.keys(nextReservation)]);

      for (const itemId of itemIds) {
        const item = state.inventory[itemId];
        if (!item) continue;

        const nextQty = Number(nextReservation[itemId] || 0);
        const reservedByOthers = Number(reservedCounts[itemId] || 0);
        const available = Number(item.limit || 0) - Number(item.claimed || 0) - reservedByOthers;
        if (nextQty > available) {
          return {
            success: false,
            error: `Only ${Math.max(0, available)} remaining for this ${this.availabilityLabel}`,
            remaining: Math.max(0, available)
          };
        }
      }

      if (Object.keys(nextReservation).length > 0) {
        state.reservations[reservationId] = buildReservationEntry(nextReservation, Date.now(), payload.ttlSeconds);
      } else {
        delete state.reservations[reservationId];
      }
      state.updatedAt = new Date().toISOString();
      await putWorkingState(storage, state);
      return {
        success: true,
        inventory: state.inventory,
        reservations: cloneReservations(state.reservations),
        state
      };
    });

    await syncInventoryToKv(this.env, payload.scope, result.state?.inventory || result.inventory, this.kvKeyPrefix);
    return jsonResponse(result);
  }

  async handleReleaseReservation(payload) {
    const result = await this.ctx.storage.transaction(async (storage) => {
      const state = await getWorkingState(storage, payload.inventory);
      delete state.reservations[payload.reservationId];
      state.updatedAt = new Date().toISOString();
      await putWorkingState(storage, state);
      return {
        success: true,
        inventory: state.inventory,
        reservations: cloneReservations(state.reservations),
        state
      };
    });

    await syncInventoryToKv(this.env, payload.scope, result.state?.inventory || result.inventory, this.kvKeyPrefix);
    return jsonResponse(result);
  }

  async handleConfirmReservation(payload) {
    const result = await this.ctx.storage.transaction(async (storage) => {
      const state = await getWorkingState(storage, payload.inventory);
      const reservation = getReservationCounts(state.reservations[payload.reservationId]);
      const confirmed = Object.keys(reservation).length > 0;

      for (const [itemId, qty] of Object.entries(reservation)) {
        const item = state.inventory[itemId];
        if (!item) continue;
        item.claimed = Number(item.claimed || 0) + Number(qty || 0);
      }

      delete state.reservations[payload.reservationId];
      state.updatedAt = new Date().toISOString();
      await putWorkingState(storage, state);
      return {
        success: true,
        confirmed,
        inventory: state.inventory,
        reservations: cloneReservations(state.reservations),
        state
      };
    });

    await syncInventoryToKv(this.env, payload.scope, result.state?.inventory || result.inventory, this.kvKeyPrefix);
    return jsonResponse(result);
  }

  async handleReservedCounts(payload) {
    const state = await getWorkingState(this.ctx.storage, payload.inventory);
    return jsonResponse({
      success: true,
      reservedCounts: getReservedCounts(state.reservations, payload.reservationId)
    });
  }

  async handleSnapshot(payload) {
    const state = await getWorkingState(this.ctx.storage, payload.inventory);
    return jsonResponse({
      success: true,
      inventory: cloneInventory(state.inventory),
      reservedCounts: getReservedCounts(state.reservations),
      updatedAt: state.updatedAt
    });
  }
}

export class StoreInventoryCoordinator extends InventoryCoordinator {
  constructor(ctx, env) {
    super(ctx, env);
  }
}

function validatePayload(body, options = {}) {
  const scopeField = options.scopeField || 'scope';
  const itemField = options.itemField || 'sku';
  const scopeLabel = options.scopeLabel || 'inventory scope';
  const itemLabel = options.itemLabel || 'SKU';
  const scope = String(body?.[scopeField] ?? '');
  const itemId = body?.[itemField] == null
    ? null
    : String(body?.[itemField] ?? '');
  const reservationId = body?.reservationId == null ? null : String(body.reservationId || '');
  const qty = body?.qty == null ? null : Number(body.qty);
  const inventory = body?.inventory && typeof body.inventory === 'object' ? body.inventory : {};
  const previousCounts = body?.previousCounts && typeof body.previousCounts === 'object' ? body.previousCounts : {};
  const nextCounts = body?.nextCounts && typeof body.nextCounts === 'object' ? body.nextCounts : {};
  const ttlSeconds = body?.ttlSeconds == null ? null : Number(body.ttlSeconds);

  if (!scope || scope.length > 200) {
    return { ok: false, error: `Invalid ${scopeLabel}` };
  }

  if (itemId !== null && (!itemId || itemId.length > 200)) {
    return { ok: false, error: `Invalid ${itemLabel}` };
  }

  if (reservationId !== null && (!reservationId || reservationId.length > 200)) {
    return { ok: false, error: 'Invalid reservation ID' };
  }

  if (qty !== null && (!Number.isFinite(qty) || qty <= 0)) {
    return { ok: false, error: 'Invalid quantity' };
  }

  if (ttlSeconds !== null && (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0)) {
    return { ok: false, error: 'Invalid reservation TTL' };
  }

  return {
    ok: true,
    value: {
      scope,
      itemId,
      sku: itemId,
      reservationId,
      qty: qty == null ? null : Math.floor(qty),
      inventory: cloneInventory(inventory),
      previousCounts: normalizeCountMap(previousCounts),
      nextCounts: normalizeCountMap(nextCounts),
      ttlSeconds: ttlSeconds == null ? null : Math.floor(ttlSeconds)
    }
  };
}

async function getWorkingState(storage, bootstrapInventory) {
  const storedState = await storage.get('state');
  if (storedState && typeof storedState === 'object') {
    const normalized = normalizeState(storedState, bootstrapInventory);
    if (normalized.cleanedExpiredReservations) {
      await putWorkingState(storage, normalized);
    }
    return normalized;
  }

  const state = normalizeState({ inventory: bootstrapInventory || {} }, bootstrapInventory);
  if (Object.keys(state.inventory).length > 0) {
    await putWorkingState(storage, state);
  }
  return state;
}

async function putWorkingState(storage, state) {
  await storage.put('state', {
    inventory: cloneInventory(state.inventory),
    reservations: cloneReservations(state.reservations),
    updatedAt: state.updatedAt || null
  });
}

async function syncInventoryToKv(env, scope, inventory, keyPrefix = 'store-inventory:v1') {
  if (!env?.STORE_STATE || !inventory) return;
  await env.STORE_STATE.put(`${keyPrefix}:${scope}`, JSON.stringify(inventory));
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json'
    }
  });
}
