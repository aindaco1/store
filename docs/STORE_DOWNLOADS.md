# Store Digital Downloads

Digital products should keep private file details out of the public catalog. Product records store a stable object key only:

```yaml
download:
  file_key: dust-wave-digital-download
  filename: dust-wave-digital-download.pdf
  delivery: signed_link
  expires_hours: 72
```

The Worker signs order-scoped fulfillment links after checkout. Digital access defaults to the product's `download.expires_hours` value, counted from order confirmation. When a buyer opens a signed download link, the Worker first checks the stored order's per-item download access state, then looks for the object in the `STORE_DOWNLOADS` R2 binding and serves it with private no-store headers.

## R2 Buckets

`worker/wrangler.toml` binds:

- `store-downloads` for production
- `store-downloads-preview` for dev/preview

Object keys must match `_products/*` `download.file_key` values. For example, `_products/dust-wave-digital-download.md` currently expects an R2 object or Worker-only fallback URL mapped to `dust-wave-digital-download`.

Store admins can upload reusable library files from the admin Downloads tab, then attach the selected `file_key` to a product or digital variant in the product editor. Admins can also replace a configured product/variant object. Uploads are limited to 100 MB, require the Store fulfillment permission plus CSRF, write the object to `STORE_DOWNLOADS`, and record a short admin audit event in KV.

Download endpoints:

- `GET /admin/store/downloads`: readiness/library snapshot.
- `POST /admin/store/downloads/create`: upload a reusable library file.
- `POST /admin/store/downloads/upload`: replace a configured product/variant object.
- `POST /admin/store/downloads/delete`: delete a library object.

Admins can also expire or reissue access for a specific digital fulfillment row from the admin Orders tab. Expiring access updates the stored order immediately, so previously issued links fail on the next request. Reissuing access starts a fresh window using the product's configured expiry hours and records the admin action in KV audit history.

Use a dedicated `STORE_DOWNLOAD_SECRET` in production when possible. If it is absent, Store falls back through shared fulfillment/magic-link secrets, but dedicated download signing gives cleaner rotation boundaries.

## Fallback URL Map

For temporary migrations, the Worker still accepts `STORE_DOWNLOAD_URLS_JSON` or per-file `STORE_DOWNLOAD_URL_<KEY>` environment values. Prefer R2 for PDFs, images, audio, and downloadable archives. Use a Worker-only URL mapping for externally hosted files such as Google Drive videos when streaming or large-file hosting matters more than strict download control.

For the current starter product key, the per-file variable is:

```bash
STORE_DOWNLOAD_URL_DUST_WAVE_DIGITAL_DOWNLOAD=https://drive.google.com/...
```

That URL must stay out of product markdown because product markdown is published into the static catalog. The Worker only reveals the URL through signed, order-scoped fulfillment links.
