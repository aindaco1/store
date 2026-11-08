# Licensing server-secret recovery and rotation

This is the test-only operating procedure. Paid Entitle sales, production licensing
and scheduled licensing capture remain disabled. Ordinary encrypted backups keep
their existing schedule and destinations. No new secret store or backup pipeline
is introduced. Use the existing protected `production-recovery` environment for
provider access; never copy credentials into an issue, artifact, browser, or log.

## Secret ownership

| Material | Owner and use | Recovery/rotation rule |
| --- | --- | --- |
| `LICENSING_KEY_SECRET` | Store derives original and replacement customer keys | Stable root for the lifetime of its grants. Recover the original value; changing it is not a supported rotation. Wrong values fail closed. |
| `ADMIN_SECRET` / Store `LICENSING_ADMIN_SECRET` | Authority service authentication | Rotate with one previous credential and an absolute retirement deadline. Store sends only the current credential. |
| `SOFTWARE_BACKUP_READ_SECRET` | Each Worker grants capture-only access | Independent values per Worker. Rotate independently; never substitute an admin credential for scheduled capture. |
| `TOKEN_SECRET`, `TOKEN_KEY_ID` | Authority signs installation tokens | One current key and optionally one previous verification key. Keep the complete required set available for checkpoint recovery. |
| `UPDATER_PUBLIC_KEY` | Authority verifies publisher release signatures | Public verification material, not the build signing private key. Recover the exact key for the archived releases. Build-signing recovery stays with the app release process. |
| Store admin/session/provider secrets | Existing Store owners | Follow the existing security/provider procedures; they are not license derivation roots. |

Use independent random values with at least 32 bytes of entropy for secret roles.
Keep the original derivation root and required signing keys in the existing
protected credential system before creating durable licenses. Normal software
snapshots contain **proofs of possession, never these secret values**. GitHub and
Cloudflare secret metadata cannot recover the plaintext of an unrecorded root.
There is no production license root provisioned or rotated by this phase.
Loss of every copy of the derivation root requires a separately designed migration;
do not generate a substitute and mark recovery successful.

## Recovery

1. Keep checkout/capture disabled. Restore to a separate empty test target using
   the existing [backup and restore procedure](BACKUP_RESTORE.md). Recover root and
   token key values through the protected credential environment, separately from
   downloading the encrypted data archive. Do not run recovery with shell tracing.
2. Bind the original Store derivation root and authority signing set, including
   key IDs and the original previous-key retirement timestamp. Administrative and
   capture credentials may be fresh independent values. Restore the archived
   updater public key. Never move a retirement deadline forward during restore.
3. Run `verifySoftwareRestoreDestination` through the existing restore command.
   It compares checkpoint-specific HMAC proofs of the derivation root, current
   signing key and previous verification key, plus key IDs/deadline and updater
   public key, **before any import**. A missing or wrong root/key, including a
   partially configured rotation, leaves the destination closed and empty.
4. Complete matched logical/KV/R2 readback, signed-artifact verification and fresh
   money/revocation/administration reconciliation before accepting the checkpoint.
   Recovered expired keys stay expired. Do not resume alarms or mail from snapshots.
5. Prove existing customer key recovery, current and retired token behavior, seat
   limits and refunded/revoked coverage in the isolated target. Preserve sanitized
   evidence and original key custody. A successful rehearsal does not enable sales.

Pre-rotation archives without `tokenKeys` describe one unversioned `legacy` signer.
Restore that original signer first; perform a separate rotation after acceptance.
Archives made during an overlap require the exact two-key set even if its previous
deadline has elapsed. This checks recovery completeness without extending access.

## Service and capture credential rotation

For authority service access use `ADMIN_SECRET_PREVIOUS` and
`ADMIN_SECRET_PREVIOUS_UNTIL`. For capture on either Worker use
`SOFTWARE_BACKUP_READ_SECRET_PREVIOUS` and
`SOFTWARE_BACKUP_READ_SECRET_PREVIOUS_UNTIL`. Deadlines are absolute Unix **seconds**.
Use a short operator-selected overlap (normally 24 hours or less). Both previous
fields must be set together; incomplete configuration fails closed.

1. Generate a new independent credential in the protected credential environment.
   Record its owner, revision and deadline without recording its value in evidence.
2. Deploy the new current credential plus old previous credential/deadline to the
   receiving Worker first. Apply an explicit immediate Durable Object deployment
   after a bulk secret update, before testing or changing callers. The pinned
   `wrangler secret bulk` command does not expose the code-update strategy; the
   rehearsal reuses its guarded `deploy --durable-objects-code-update-mode immediate`
   path so existing instances adopt the new environment. See [Cloudflare code
   update behavior](https://developers.cloudflare.com/changelog/post/2026-10-30-durable-objects-deferred-code-updates/).
   Verify both credentials only have their intended scope.
3. Change Store `LICENSING_ADMIN_SECRET`, or the protected capture caller's read
   credential, to the new value. Check a harmless authorized read and rejection of
   an unrelated credential. Capture credentials must still fail grant, import,
   upload, pause/resume and other mutations. Keep scheduled licensing capture off.
4. Confirm callers use the new value. At the deadline the old credential is denied
   even after restart. Use the same immediate deployment when retiring secrets. Remove both previous fields in one deployment and verify
   denial again. Preserve recovery custody of durable signing/derivation material;
   disposable service credentials do not need to match a data checkpoint.

If compromise is suspected, omit overlap and replace the credential directly.
Requests made with the old value fail until callers update; no ambiguous money
operation should be retried outside its existing idempotent workflow.

## Activation-token signing rotation

Deploy the rotation-capable authority before issuing versioned tokens. Existing
four- and five-part tokens use key ID `legacy`. New deployments should set an
explicit unique `TOKEN_KEY_ID` (1–40 letters, digits, `_` or `-`). Token contents
remain opaque to applications.

Set the new `TOKEN_SECRET` and `TOKEN_KEY_ID`, plus
`TOKEN_PREVIOUS_SECRET`, `TOKEN_PREVIOUS_KEY_ID`, `TOKEN_PREVIOUS_UNTIL` for the
previous signer. On the first rotation its ID is `legacy`. Only the current key
issues tokens; the old key verifies existing tokens strictly before its deadline.
No search through an unbounded key history occurs. Invalid configuration fails
closed before grant/activation mutations. Key IDs must differ, as must key values.

Existing license generations, active seats and per-device revisions are checked
for both signers. Rotation cannot resurrect deactivated devices or replaced keys.
After retirement, an otherwise valid license key can reactivate the same stable
installation under the current signer without consuming an extra seat. Installed
software continues working. Verify the shipping client's reactivation/recovery UX
before production rotation; server acceptance alone is not native-client acceptance.

Before a second rotation, finish the first overlap and preserve the keys required
by retained archives. Never overwrite the only copy needed by an older checkpoint.
Roll back to a rotation-capable schema-4 reader with the same key configuration;
older readers cannot verify six-part tokens. A compromised signer may require
immediate retirement and reactivation rather than an overlap.

## Rehearsal and admin preview

`npm run restore:rehearse:software` uses the existing age/checksum/restore pipeline
with independent synthetic derivation and signing roots. It rejects wrong roots
and missing previous keys before importing, restores both signing keys, retires
old service/token credentials, and verifies deterministic license recovery.
`restore:rehearse:software:preview` carries the same key set through the existing
deployed-source/off-account workflow. Run that protected workflow on reviewed
merged refs; local evidence is not a protected off-account run.

With a sibling licensing checkout, patched Node and the existing Jekyll gems:

```sh
npm run preview:licensing-admin
```

Open `http://127.0.0.1:8899/preview/start`. The disposable preview uses the real
Store dashboard, signed one-time login, session/CSRF checks, SQLite authority and
synthetic provider fixture. Open **Licenses**; load the
printed synthetic order token to inspect payments/refunds and device controls.
**Load releases** and **Refresh complimentary licenses** show those records.
No credentials from `.dev.vars` are loaded; outside provider requests are blocked,
mail is dry-run, checkout stays disabled, and no scheduler is installed. Stop with
Ctrl-C to remove its temporary state. `SOFTWARE_ADMIN_PREVIEW_PORT` overrides 8899.
