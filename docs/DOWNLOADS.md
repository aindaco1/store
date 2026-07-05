# Downloads

Since `v1.0.4`, confirmed digital purchases are durable customer entitlements. Access stays available from the order page unless an admin explicitly revokes it.

Digital products should keep private file details out of the public catalog. Product records store a stable object key only:

```yaml
download:
  file_key: dust-wave-digital-download
  filename: dust-wave-digital-download.pdf
  delivery: signed_link
```

The Worker signs order-scoped fulfillment links after checkout. A confirmed order grants permanent customer entitlement to the purchased digital item unless an admin explicitly revokes it for support, refund, chargeback, fraud, or takedown reasons. The signed link itself remains short-lived and can be refreshed from the order page. When a buyer opens a signed download link, the Worker first checks the stored order's per-item download access state, then looks for the object in the `STORE_DOWNLOADS` R2 binding and serves it with private no-store headers.

## R2 Buckets

`worker/wrangler.toml` binds:

- `store-downloads` for production
- `store-downloads-preview` for dev/preview

Object keys must match `_products/*` `download.file_key` values. For example, `_products/dust-wave-digital-download.md` currently expects an R2 object or Worker-only fallback URL mapped to `dust-wave-digital-download`.

Store admins can upload reusable library files from the admin Downloads tab, then attach the selected `file_key` to a product or digital variant in the product editor. Admins can also replace a configured product/variant object. Uploads are limited to 100 MB, require the Store fulfillment permission plus CSRF, write the object to `STORE_DOWNLOADS`, and record a short admin audit event in KV.

Admin download endpoints:

- `GET /admin/store/downloads`: readiness/library snapshot.
- `POST /admin/store/downloads/create`: upload a reusable library file.
- `POST /admin/store/downloads/upload`: replace a configured product/variant object.
- `POST /admin/store/downloads/delete`: delete a library object.

Admins can also revoke or refresh access for a specific digital fulfillment row from the admin Orders tab. Revoking access updates the stored order immediately, so previously issued links fail on the next request. Refreshing access restores entitlement and records the admin action in KV audit history.

Use a dedicated `STORE_DOWNLOAD_SECRET` in production when possible. If it is absent, Store falls back through shared fulfillment/magic-link secrets, but dedicated download signing gives cleaner rotation boundaries.

Customer-facing download links must stay off product markdown, public JSON, emails, and admin CSV exports. The customer order confirmation links to `/order-success/?orderToken=...`; the order page asks the Worker for a fresh signed action only after entitlement checks pass.

## Fallback URL Map

For externally hosted or temporary migration files, the Worker still accepts `STORE_DOWNLOAD_URLS_JSON` or per-file `STORE_DOWNLOAD_URL_<KEY>` environment values. Prefer R2 for PDFs, images, audio, and downloadable archives. Use a Worker-only URL mapping for externally hosted files such as Google Drive videos when streaming or large-file hosting matters more than strict download control.

For a file key such as `dust-wave-digital-download`, the per-file variable is:

```bash
STORE_DOWNLOAD_URL_DUST_WAVE_DIGITAL_DOWNLOAD=https://drive.google.com/...
```

That URL must stay out of product markdown because product markdown is published into the static catalog. The Worker only reveals the URL through signed, order-scoped fulfillment links.
