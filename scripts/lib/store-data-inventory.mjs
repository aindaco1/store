import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const STORE_DATA_INVENTORY_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../config/store-data-inventory.json'
);

export function loadStoreDataInventory(inventoryPath = STORE_DATA_INVENTORY_PATH) {
  const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
  if (Number(inventory.schemaVersion || 0) !== 1 || !Array.isArray(inventory.families)) {
    throw new Error('Store data inventory uses an unsupported schema.');
  }
  const ids = new Set();
  for (const family of inventory.families) {
    for (const field of [
      'id', 'binding', 'type', 'prefix', 'sourceOfTruth', 'sensitivity', 'backupFrequency',
      'retention', 'restorePhase', 'validation', 'owner', 'classification', 'restoreDefault'
    ]) {
      if (family[field] === undefined || family[field] === null || String(family[field]).trim() === '') {
        throw new Error(`Store data inventory family ${family.id || '<unknown>'} is missing ${field}.`);
      }
    }
    if (ids.has(family.id)) throw new Error(`Duplicate Store data inventory family: ${family.id}`);
    ids.add(family.id);
  }
  return inventory;
}

export function storeDataFamilies(options = {}) {
  const inventory = options.inventory || loadStoreDataInventory();
  return inventory.families.filter((family) => (
    (!options.binding || family.binding === options.binding) &&
    (!options.type || family.type === options.type) &&
    (!options.classification || family.classification === options.classification)
  ));
}

export function storeKvBackupFamilies(options = {}) {
  return storeDataFamilies({ ...options, binding: options.binding || 'STORE_STATE', type: 'kv' })
    .filter((family) => family.classification !== 'ephemeral-quarantined');
}

export function storeKvValueBackupFamilies(options = {}) {
  return storeKvBackupFamilies(options).filter((family) => family.backupValues === true);
}

export function storeQuarantinedKvFamilies(options = {}) {
  return storeDataFamilies({ ...options, type: 'kv' })
    .filter((family) => family.classification === 'ephemeral-quarantined');
}

export function findStoreDataFamily(prefix, options = {}) {
  return storeDataFamilies(options).find((family) => family.prefix === prefix) || null;
}
