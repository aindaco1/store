# Store v1.3.10: Platform images and dependency maintenance

This release pins Dust Wave Platform 0.43.0 at immutable commit
`2e5df578c08c4af0b827a08fefee8986acf5f24b`: Admin Shell 0.13.0 and Media Core
0.5.0. Settings, primary product images, image blocks and gallery items consume
the shared removal control directly. Removal preserves authored descriptions,
clears previews and pending file selections, and invalidates late upload results.
Block identities survive rerenders and reorders. Uploads retain the full media
catalog when the library is first opened after an upload. File pickers use native
buttons; mobile media settings stay reachable on active blocks, and Escape returns
focus to the settings button.

Lossless optimization compares decoded RGBA frame hashes before replacing source
images. The shared aspect-ratio helper accepts equivalent density ratios while
retaining pixel, geometry and timing evidence. Failure preserves the source;
product publication continues to preserve uploaded source bytes.

The release integrates PRs #90, #91 and #92: the Ruby setup action, Worker tooling
and root development tools. Wrangler advances to 4.144.0 because its Miniflare
dependency supplies patched Undici 7.29.1; the obsolete 7.29.0 override is removed.
The failed #90 CI run exposed a shutdown race: SIGTERM could leave Ruby catalog
generation writing after temporary repository cleanup. The sidecar now stops
polling, closes its server and lets active work finish before exiting. A controlled
in-flight generation test fails against the prior service and passes with the fix.

PR #93 is declined under the contributor dependency policy. Platform 0.43.0 still
requires smol-toml 1.7.1. A future upgrade must first be reviewed in Platform, then
update Store's immutable gitlink, manifest, lockfile and pin contract together.

## Validation

- Dependency-only candidate 24c0be6: full local premerge passed (612 unit,
  22 security and 65 browser tests); hosted Merge Smoke run 37218677502 passed.
- New image integration: focused pin/version/lossless suites passed (17 tests).
  Real FFmpeg decoded a padded source and unpadded candidate identically; the
  replacement retained exactly the original image bytes and saved 1,024 bytes.
- Root and Worker npm audits: zero known vulnerabilities after clean installs.
- Final image browser regression, complete release gate and deployment: pending.

Ethical review: image removal clears an editor reference and retains repository
media, alt text and captions. No new customer data, storage, provider mutations or
messages are introduced. Private admin responses, localized controls, keyboard
focus, canonical checkout and source-media preservation remain release contracts.

## Deployment and rollback

Deploy Production runs from main with the reviewed immutable ref. Prior production
is v1.3.9, deployed by run 36160431942, Worker version
1e72675b-ff74-4640-b3fb-11931facee62. Redeploy that tag for rollback; there is no data
migration. Provider-specific skipped checks are separate from configuration and
HTTP verification.

## Local cleanup

Pending after deployment. Preserve local settings/secrets, dependency installs,
shared submodules, Podman tooling and simulated Worker state. Remove disposable
build/test output and only branches confirmed merged or explicitly declined.
