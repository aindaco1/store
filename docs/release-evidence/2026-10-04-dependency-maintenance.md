# Store v1.3.10: Platform images and dependency maintenance

Released October 4, 2026. Immutable tag `v1.3.10` points to
`5d142159bd0d64dfb7e5df316eeda1d5fbbc88d4`; its tree is identical to reviewed
PR head `77285a3f6e25c28b37ed452cc389e38f8226a8cc`.

## Changes

Store pins Dust Wave Platform 0.43.0 at
`2e5df578c08c4af0b827a08fefee8986acf5f24b`, including Admin Shell 0.13.0 and
Media Core 0.5.0. Settings, primary product images, image blocks and gallery items
consume the shared removal control directly. Removal retains alt text and captions,
clears previews and pending file selections, and rejects late upload selections.
Uploads and library selections follow their original block through reordering.
Opening the library after uploading still loads the full repository catalog.

File pickers share native-button handling, including CSV imports. Active mobile
blocks retain access to media settings; Escape restores focus to the settings button.
Lossless optimization compares decoded 16-bit RGBA frame hashes before replacing a
smaller candidate. The shared helper normalizes equivalent sample aspect ratios
while preserving pixel, geometry and timing evidence. Decode failures or mismatches
preserve the source and remove the candidate. Product publishing preserves sources.

PRs [90](https://github.com/aindaco1/store/pull/90),
[91](https://github.com/aindaco1/store/pull/91) and
[92](https://github.com/aindaco1/store/pull/92) merged through
[94](https://github.com/aindaco1/store/pull/94). Wrangler 4.144.0 supplies patched
Undici 7.29.1, so the obsolete 7.29.0 override is removed. Local publisher shutdown
now waits for active Ruby catalog generation before fixture cleanup; the regression
fails against the former service and passes with the fix.

[PR 93](https://github.com/aindaco1/store/pull/93) is closed: Platform 0.43.0 still
requires smol-toml 1.7.1. A coordinated upstream upgrade must precede a consumer bump.

## Verification

- [Hosted Merge Smoke](https://github.com/aindaco1/store/actions/runs/37221620179)
  passed the complete premerge gate on the reviewed head.
- Local validation: 620 unit tests, 22 security tests and all 68 browser tests passed.
  The browser rerun includes the corrected native CSV mobile layout; the temporary
  checkout's missing local Turnstile override was corrected before that run.
- Browser coverage includes English/Spanish image removal, late results, metadata,
  library selection and uploads across reordering, keyboard focus, mobile overflow,
  native image/CSV chooser activation and axe checks.
- Real FFmpeg accepted valid lossless PNG recompression (8,175 bytes saved) and
  rejected loss of 16-bit precision while preserving the original.
- Root and Worker clean installs/audits report zero known vulnerabilities.
- Release smoke passed launch readiness, rendered i18n/SEO, fulfillment, read-only
  provider readiness, payment contracts/boundaries, synthetic Podman restore and
  backup readiness. The already-completed premerge/browser/accessibility phases
  were not duplicated by the wrapper. Payment mutations were explicitly disabled.
- Data inventory covers all 48 Worker storage families; metadata-only backup planning passed.

All three local Lighthouse routes passed every configured category, timing and
transfer budget:

| Route | Performance | Accessibility | Best practices | SEO | Total bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
| `/` | 0.88 | 0.96 | 0.96 | 1.00 | 791,316 |
| `/products/fronteras-poster-big/` | 0.94 | 0.96 | 1.00 | 1.00 | 548,162 |
| `/terms/` | 0.97 | 0.96 | 1.00 | 1.00 | 360,899 |

## Production

[Deploy Production](https://github.com/aindaco1/store/actions/runs/37222283598)
succeeded from main against `v1.3.10`: Worker, Pages, cache purges, admin security
policy and crawl endpoint checks. Worker version is
`0b161d58-e505-4373-956d-6f0da3f8a189`.

[Cloudflare release evidence](https://github.com/aindaco1/store/actions/runs/37222259945)
and [Production Posture](https://github.com/aindaco1/store/actions/runs/37222435327)
passed. Live English/Spanish admin pages serve the shared image module and new native
CSV control with `private, no-store, no-transform`; unauthenticated Worker admin
access returns 401 with private/no-store caching.

All live transfer budgets pass (home: 515,852 total bytes, 296,374 image bytes).
Product and terms routes pass all Lighthouse checks. The first post-deploy home
sample scored 0.77 performance with 4.13 s LCP and 0.81 best practices; before this
release it scored 0.72 with 4.90 s LCP and the same 0.81 best-practices score.
The deprecated `StorageType.persistent` warning originates in Cloudflare's injected
`/cdn-cgi/challenge-platform/scripts/jsd/main.js`; console errors are absent.
A follow-up with installs finished scored 0.91 performance, 2.87 s LCP, 0.003 CLS
and 183.5 ms TBT. Every timing and transfer threshold passed; the sole remaining
Lighthouse failure is the same Cloudflare-script best-practices warning (0.81).

Evidence boundaries (owner: Codex, October 4, 2026): local Stripe CLI verification
confirmed both production and test webhook endpoints. Hosted Cloudflare checks
covered the locally unavailable Cloudflare credentials. Resend sender-domain and
USPS live quote probes remain unrun because their credentials were unavailable.
Hosted posture correctly retains optional Stripe/Resend/USPS manual checks.
No live payment, email send or customer-data restore was performed. The encrypted
snapshot receipt was unavailable to the audit; synthetic rehearsal does not certify
a live encrypted backup.

Ethical review: removal changes editor references and retains repository media and
authored descriptions. No new customer storage, access privilege or communication
is introduced. Canonical checkout, privacy, localization, keyboard access and source
preservation remain covered by the release gate.

## Rollback and cleanup

Rollback by dispatching Deploy Production from main with immutable ref `v1.3.9`.
Previous deployment: run 36160431942, Worker version
`1e72675b-ff74-4640-b3fb-11931facee62`. No data migration is required.

The main local checkout is updated, both dependency trees are installed, native
esbuild/workerd execute, and 17 local pin/version/lossless checks pass. All 31
preserved local configuration, credential, simulated-state and Jev evidence files
retain their original hashes. Nine Finder metadata files were removed. Only main
remains locally and remotely; merged/declined dependency and integration branches
are gone. Development dependencies, submodules, source/derived media, Podman images
and volumes, local overrides, credentials and simulated Worker state are retained.
The disposable release checkout and its generated build/test artifacts were removed
after verification output was recorded. No Store development containers remain.
