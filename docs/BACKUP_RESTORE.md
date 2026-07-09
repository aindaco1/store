# Backup And Restore

This runbook covers Store-owned data that is not already recoverable from a normal deploy: Cloudflare KV state, R2 download objects, and Git product/config history.

Do not commit backup files to this repository. Store exports in an encrypted operator location with restricted access.

References:

- [Cloudflare Wrangler KV commands](https://developers.cloudflare.com/kv/reference/kv-commands/)
- [Cloudflare Wrangler R2 commands](https://developers.cloudflare.com/r2/reference/wrangler-commands/)

## What To Back Up

Back up these before major production releases, after production smoke, before bulk admin changes, and before replacing production downloads:

- Git history: `_products/`, `_config.yml`, localized public source pages, `api/products.json`, `worker/src/generated/catalog-snapshot.js`, and the commit hash deployed to the storefront and Worker.
- `STORE_STATE` KV authoritative records: `orders:`, `admin-store-orders:index:v1`, `store-inventory-overrides:v1`, `store-inventory:v1:`, `store-coupons:v1`, `add-on-inventory-overrides`, `add-on-inventory-sold:v1`, `admin-users:v1`, `admin-user:`, `admin-audit:`, `store-order-email:`, `store-order-email-sent:`, `admin-store-marketing-referrals:v1`, and reminder queue/sent records.
- `STORE_DOWNLOADS` R2 objects referenced by active product `download.file_key` values.
- Operator exports: Store orders CSV, attendee CSV, reconciliation CSV, audit CSV, release notes, configured Cloudflare resource IDs, Stripe webhook endpoint ID, coupon/referral review notes, and manual inventory adjustments.

Do not restore ephemeral records unless you are deliberately debugging an incident:

- `admin-session:` and `admin-login:` records, including one-time super-admin order notification login links.
- `rl:` rate-limit records.
- `store-order-lookup:` one-time tokens.
- `abandoned-cart-resume:` signed resume snapshots, unless you are reconstructing reminder behavior.
- `abandoned-cart-suppressed:` suppression records are usually user preference records; restore them only when preserving suppression state is required and privacy review has approved it.
- Stripe webhook idempotency markers, unless replay behavior is the incident being repaired.
- `cron:lastRun` and `cron:lastError`, unless restoring an isolated local/Podman rehearsal namespace for diagnostics.
- `observability:` summaries, unless restoring them for incident review.

Durable Object inventory state should be treated as derived live state. Restore orders and inventory overrides first, then verify inventory through the admin dashboard rather than writing Durable Object storage directly.

## Backup Directory

Use the snapshot helper for the normal plan and local artifact structure:

```bash
npm run backup:plan
npm run backup:snapshot -- --output "$HOME/store-backups/$(date -u +%Y%m%dT%H%M%SZ)"
```

The helper writes a manifest, Git status/head/diff details, an optional Git bundle, selected config/build files, Wrangler cache/KV/R2 inventory, secret presence inventory without values, KV backup classification, R2 download key inventory, and a generated restore plan. It does not call remote provider APIs unless `--remote` is passed.

Remote reads are opt-in:

```bash
npm run backup:snapshot -- --remote
npm run backup:snapshot -- --remote --kv-values
npm run backup:snapshot -- --remote --r2-objects
```

`--kv-values` can export customer/order/admin data and `--r2-objects` can download private fulfillment files. Store those snapshots only outside the repository in encrypted operator storage. The helper never exports production secret values.

Manual fallback from the repository root:

```bash
export STORE_BACKUP_DIR="$HOME/store-backups/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$STORE_BACKUP_DIR"/{exports,git,kv,r2}
git rev-parse HEAD > "$STORE_BACKUP_DIR/git/store-head.txt"
git bundle create "$STORE_BACKUP_DIR/git/store.bundle" --all
git status --short > "$STORE_BACKUP_DIR/git/status.txt"
git diff --binary > "$STORE_BACKUP_DIR/git/worktree.patch"
```

If `git status --short` is not clean, read `status.txt` before relying on the bundle as a full catalog backup. Untracked files are not included in a bundle.

## KV Backup

Run Wrangler commands from `worker/`. Production commands use the root environment and `--remote`; local verification can add `--env dev --local`.

```bash
cd worker

for prefix in \
  'orders:' \
  'admin-store-orders:index:v1' \
  'store-inventory-overrides:v1' \
  'store-inventory:v1:' \
  'store-coupons:v1' \
  'add-on-inventory-overrides' \
  'add-on-inventory-sold:v1' \
  'admin-users:v1' \
  'admin-user:' \
  'admin-audit:' \
  'store-order-email:' \
  'store-order-email-sent:' \
  'admin-store-marketing-referrals:v1' \
  'abandoned-cart:' \
  'abandoned-cart-sent:' \
  'abandoned-cart-suppressed:' \
  'abandoned-cart-queue:v1' \
  'abandoned-cart-health:v1' \
  'store-event-reminder:' \
  'store-event-reminder-sent:' \
  'store-event-reminder-queue:v1'
do
  safe_prefix=$(printf '%s' "$prefix" | tr -c 'A-Za-z0-9._-' '_')
  keys_file="$STORE_BACKUP_DIR/kv/${safe_prefix}.keys.json"
  values_file="$STORE_BACKUP_DIR/kv/${safe_prefix}.values.json"
  npx wrangler kv key list --remote --binding STORE_STATE --prefix "$prefix" > "$keys_file"
  npx wrangler kv bulk get "$keys_file" --remote --binding STORE_STATE > "$values_file"
done
```

`kv key list` outputs objects with `name`; `kv bulk get` accepts that file directly. `kv bulk put` uses a different restore shape, so transform before restore.

## KV Restore

Always take a fresh backup before restoring over an existing namespace.

Rehearse the transform and restore shape against an isolated local/Podman namespace first when possible:

```bash
values_file="$STORE_BACKUP_DIR/kv/orders_.values.json"
restore_file="$STORE_BACKUP_DIR/kv/orders_.restore.json"

jq 'to_entries | map({ key: .key, value: (.value.value // "") } + (if .value.metadata then { metadata: .value.metadata } else {} end))' \
  "$values_file" > "$restore_file"

npx wrangler kv bulk put "$restore_file" --env dev --local --binding STORE_STATE
```

Only after that rehearsal and operator review should you restore a production binding:

```bash
npx wrangler kv bulk put "$restore_file" --remote --binding STORE_STATE
```

Restore production in this order:

1. `admin-users:v1` and `admin-user:` only if admin users were lost or intentionally rolled back.
2. `orders:` records.
3. `admin-store-orders:index:v1` only after order records are present, or let the Worker rebuild/index through normal admin reads.
4. Inventory override records, then derived inventory projection records only if you are restoring a known-good production snapshot.
5. Coupon, add-on inventory, and marketing referral records.
6. Email index/sent records.
7. Reminder records only after reviewing whether queued sends should still happen.
8. `admin-audit:` records only when preserving historical audit context matters.

After restore, use the admin dashboard to verify orders, inventory, downloads, marketing referrals, and audit export. Run the Worker smoke script against the target environment before accepting new checkout traffic.

## R2 Backup

The production bucket is `store-downloads`; local/dev uses `store-downloads-preview`. See [DOWNLOADS.md](DOWNLOADS.md) for the download entitlement and fallback-URL model.

Build a manifest of configured download keys from `_products/` or the admin Downloads tab, then fetch each object:

```bash
mkdir -p "$STORE_BACKUP_DIR/r2/objects"

ruby -rdate -ryaml -e '
  Dir["_products/*.md"].sort.each do |path|
    text = File.read(path)
    next unless text =~ /\A---\n(.*?)\n---/m
    data = YAML.safe_load($1, permitted_classes: [Date], aliases: true) || {}
    keys = [data.dig("download", "file_key")]
    Array(data["variants"]).each { |variant| keys << variant.dig("download", "file_key") if variant.respond_to?(:dig) }
    keys.compact.map(&:to_s).map(&:strip).reject(&:empty?).each { |key| puts key }
  end
' | sort -u > "$STORE_BACKUP_DIR/r2/download-keys.txt"

while IFS= read -r key
do
  [ -n "$key" ] || continue
  mkdir -p "$STORE_BACKUP_DIR/r2/objects/$(dirname "$key")"
  npx wrangler r2 object get "store-downloads/$key" --remote --file "$STORE_BACKUP_DIR/r2/objects/$key"
done < "$STORE_BACKUP_DIR/r2/download-keys.txt"
```

## R2 Restore

Prefer the admin Downloads tab for replacement restores, because it writes to the configured key and records an audit event.

For CLI restores:

```bash
while IFS= read -r key
do
  [ -n "$key" ] || continue
  npx wrangler r2 object put "store-downloads/$key" \
    --remote \
    --file "$STORE_BACKUP_DIR/r2/objects/$key" \
    --content-type "application/octet-stream"
done < "$STORE_BACKUP_DIR/r2/download-keys.txt"
```

If the restored file needs a specific MIME type or filename, set the correct `--content-type` and `--content-disposition`, or re-upload through the admin Downloads tab.

## Git Catalog Restore

Use Git restore for product/catalog mistakes before touching KV:

```bash
git log --oneline -- _products worker/src/generated/catalog-snapshot.js api/products.json
git show <good-sha>:_products/fronteras-t-shirt.md
git restore --source <good-sha> -- _products worker/src/generated/catalog-snapshot.js api/products.json
npm run sync:worker-config
bundle exec jekyll build --config _config.yml,_config.local.yml
```

For a full clone from the bundle:

```bash
git clone "$STORE_BACKUP_DIR/git/store.bundle" store-restore
```

After restoring catalog files, deploy storefront and Worker together so public product JSON and Worker catalog validation stay aligned.

## Verification

After any restore:

```bash
bundle exec jekyll build --config _config.yml,_config.local.yml
npm run test:seo
npm run test:content-security
SITE_URL=http://127.0.0.1:4002 WORKER_URL=http://127.0.0.1:8989 ./scripts/test-worker.sh
```

For production restore, also complete a real **Settings -> Store readiness** refresh, audit CSV export, order CSV export, and one non-destructive order lookup before reopening checkout traffic.
