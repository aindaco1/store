# October 4 dependency maintenance

This maintenance deployment retains application version 1.3.9 and uses an
immutable reviewed commit. It integrates PRs #90, #91 and #92: the pinned
Ruby setup action, Worker tooling, and root development tools. Wrangler advances
to 4.144.0 because its Miniflare dependency supplies patched Undici 7.29.1; the
obsolete override forcing 7.29.0 is removed.

PR #93 is declined under the contributor dependency policy. Platform's pinned
Release Core and current upstream manifest both require smol-toml 1.7.1. A future
upgrade must first be reviewed in Platform, then update Store's immutable gitlink,
manifest, lockfile and pin contract together. No pin assertion or security-update
visibility is weakened.

The failed #90 CI run exposed a local sidecar shutdown race: SIGTERM could leave
Ruby catalog generation writing after temporary repository cleanup. The service
now stops polling, closes its server and lets active work finish before exiting.
A controlled in-flight generation test fails against the prior service and passes
with the fix. Temporary fixtures remain isolated from the real catalog.

## Validation

- Local focused publishing, catalog-sync and Platform-pin suites: 15 tests passed.
- Root and Worker npm audits: zero known vulnerabilities after clean installs.
- Complete hosted Merge Smoke, deployment and production evidence: pending.

Ethical review: the changed surfaces are build/test tooling and local service
lifecycle. Existing canonical checkout, inventory, authorization, private-response,
localization and communication contracts remain covered by the release gate.
No new customer data, provider mutations, or messages are introduced.

## Deployment and rollback

Deploy Production will run from main with the reviewed full commit as its ref.
The prior production release is v1.3.9, deployed by run 36160431942, Worker version
1e72675b-ff74-4640-b3fb-11931facee62. Redeploy that immutable tag for rollback;
there is no data migration. Provider-specific skipped checks will be recorded
separately from configuration and HTTP verification.

## Local cleanup

Pending after deployment. Preserve local settings/secrets, dependency installs,
shared submodules, Podman tooling and simulated Worker state. Remove disposable
build/test output and only branches confirmed merged or explicitly declined.
