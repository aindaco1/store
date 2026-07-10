import { describe, expect, it } from 'vitest';

import { runSyntheticRestoreRehearsal } from '../../scripts/rehearse-store-restore.mjs';

describe('representative Store restore rehearsal', () => {
  it('restores representative authoritative/control/R2 classes without quarantined, derived, or side-effect work', async () => {
    const result = await runSyntheticRestoreRehearsal({ probeWorker: false });
    expect(result).toMatchObject({
      schemaVersion: 1,
      ok: true,
      containsProductionData: false,
      providerWritesExecuted: false,
      representativeOrderTypes: ['digital', 'physical', 'rsvp', 'ticket'],
      failedPaymentOrderRestored: true,
      paymentIdempotencyRestored: true,
      reminderControlsRestored: true,
      auditEvidenceRestored: true,
      inventoryControlsRestored: true,
      restoredR2Objects: ['store-downloads-preview/downloads/restore-drill.txt'],
      quarantineRestored: false,
      derivedRestored: false,
      sideEffectCommands: 0,
      missingValueFamilies: 0,
      derivedRepairPlanned: true,
      podmanWorkerProbe: { skipped: true, status: 401, privateNoStore: true }
    });
    expect(result.restoredOrderRecords).toBe(5);
    expect(result.integrityArtifacts).toBeGreaterThan(10);
  });
});
