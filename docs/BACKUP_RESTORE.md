# Backup And Restore

This runbook covers Store-owned data that is not already recoverable from a normal deploy: Cloudflare KV state, R2 download objects, and Git product history.

Do not commit backup files to this repository. Store exports in an encrypted operator location with restricted access.

References:

- [Cloudflare Wrangler KV commands](https://developers.cloudflare.com/kv/reference/kv-commands/)
- [Cloudflare Wrangler R2 commands](https://developers.cloudflare.com/r2/reference/wrangler-commands/)

## What To Back Up

Back up these before launch, after launch smoke, before bulk admin changes, and before replacing production downloads:

- Git history: `_products/`, `_config.yml`, `api/products.json`, `worker/src/generated/catalog-snapshot.js`, and the commit hash deployed to the storefront and Worker.
- `STORE_STATE` KV authoritative records: `orders:`, `store-inventory-overrides:v1`, `add-on-inventory-overrides`, `add-on-inventory-sold`, `admin-users:v1`, `admin-user:`, `admin-audit:`, `store-order-email:`, and `store-order-email-sent:`.
- `STORE_DOWNLOADS` R2 objects referenced by active product `download.file_key` values.
- Operator exports: Store orders CSV, attendee CSV, audit CSV, launch notes, configured Cloudflare resource IDs, Stripe webhook endpoint ID, and manual inventory adjustments.

Do not restore ephemeral records unless you are deliberately debugging an incident:

- `admin-session:` and `admin-login:` records.
- `rl:` rate-limit records.
- `store-order-lookup:` one-time tokens.
- Stripe webhook idempotency markers, unless replay behavior is the incident being repaired.
- `cron:lastRun` and `cron:lastError`, unless restoring a staging clone for diagnostics.

Durable Object inventory state should be treated as derived live state. Restore orders and inventory overrides first, then verify inventory through the admin dashboard rather than writing Durable Object storage directly.

## Backup Directory

Run from the repository root:

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
  'store-inventory-overrides:v1' \
  'add-on-inventory-overrides' \
  'add-on-inventory-sold' \
  'admin-users:v1' \
  'admin-user:' \
  'admin-audit:' \
  'store-order-email:' \
  'store-order-email-sent:'
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

Restore into staging first:

```bash
values_file="$STORE_BACKUP_DIR/kv/orders_.values.json"
restore_file="$STORE_BACKUP_DIR/kv/orders_.restore.json"

jq 'to_entries | map({ key: .key, value: (.value.value // "") } + (if .value.metadata then { metadata: .value.metadata } else {} end))' \
  "$values_file" > "$restore_file"

npx wrangler kv bulk put "$restore_file" --remote --binding STORE_STATE
```

Restore production in this order:

1. `admin-users:v1` and `admin-user:` only if admin users were lost or intentionally rolled back.
2. `orders:` records.
3. Inventory override records.
4. Email index/sent records.
5. `admin-audit:` records only when preserving historical audit context matters.

After restore, use the admin dashboard to verify orders, inventory, downloads, and audit export. Run the Worker smoke script against the target environment before accepting new checkout traffic.

## R2 Backup

The production bucket is `store-downloads`; local/dev uses `store-downloads-preview`.

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
npm run test:content-security
SITE_URL=http://127.0.0.1:4002 WORKER_URL=http://127.0.0.1:8989 ./scripts/test-worker.sh
```

For production restore, also complete a real **Settings -> Store readiness** refresh, audit CSV export, order CSV export, and one non-destructive order lookup before reopening checkout traffic.
