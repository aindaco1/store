# Store Security Tests

This directory contains Worker security checks for the Store API.

## Run Locally

```bash
npm run test:secrets
cd worker && npx wrangler dev --env dev --ip 127.0.0.1 --port 8989
npm run test:security
```

With the full local stack running, the root command is enough:

```bash
npm run test:security
```

Run against another Worker:

```bash
WORKER_URL=https://checkout-staging.dustwave.xyz npm run test:security
```

## Coverage

- Store admin reads and writes require an authenticated admin session.
- Deleted legacy routes return `404`.
- Store cart validation rejects tampered prices and malicious product IDs.
- Store checkout fails closed for malformed payloads.
- Store order lookup rejects malformed email input.
- Shipping and tax quote endpoints reject or safely handle hostile destination fields.
- Oversized Store and Stripe webhook bodies return `413`.
- Stripe webhooks require a valid signature before processing order metadata.
- Cart-validation and admin-auth bursts return bounded success, rejection, or rate-limit responses without server errors.
- Rapid CORS preflight checks remain bounded and do not expose private wildcard CORS.

## Environment

| Variable | Default | Description |
| --- | --- | --- |
| `WORKER_URL` | `http://127.0.0.1:8989` | Worker endpoint under test |
| `PROD_MODE` | `false` | Reserved for read-only production test modes |
| `SECURITY_FETCH_TIMEOUT_MS` | `8000` | Per-request timeout |

The local Worker needs the `RATELIMIT` KV binding configured. `worker/wrangler.toml` includes the local dev binding.
