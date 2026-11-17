# Shared block editor release — 2026-11-17

Runtime source: `f7cdecdce868ad65de4b53aa2d679155591ca43c`, based on current
production source `384e81125d19019c63dfb20abdd1d57e7b875898`. Platform:
`fa363d72d3e5c15dbdb6f9596bb80c41ebbbda8d` (v0.50.0; Admin Shell 0.15.0).
The following approval record changes documentation only.

Store now uses the shared block model, toolbar, composition commands, slash
splitting and event routing. Its Markdown projection, empty-block filtering,
media/clipboard policies, preview and save/publish behavior remain in Store.
The original dirty checkout's older work is not part of this release.

## Verification

- Complete local `npm run test:premerge` passed: 878 unit, 22 security and
  115 browser tests, plus content, localization, syntax, template drift,
  build/performance and Worker smoke checks. Node 26.12.1; isolated test state.
- [Remote Merge Smoke](https://github.com/aindaco1/store/actions/runs/44181122649)
  passed on the runtime source.
- Before/after characterization and same-input DOM/JSON comparison match across
  all eight blocks, reorder, text/quote conversion, slash commands and toolbar
  accessibility. Real Chromium fixtures also passed at desktop/mobile sizes.
- Platform's 401 tests and clean-checkout recipes passed on the pinned commit.
- Browser/provider fixtures are simulated or test-only. No production checkout,
  email, content publishing or customer-data mutation was used as a test.

## Approved development dependency exception

On November 17, 2026, the repository owner explicitly authorized: “Approve a
scoped development-only exception and deploy.” This approval is limited to
this shared block editor release and its existing locked picomatch 4.0.7
Vite/Vitest development dependency chain, covering
[GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf).
It expires December 1, 2026. Subsequent releases must recheck for a supported
fix; this is not a standing waiver or permission for later dependency changes.

Both root production audits and full Worker audits are clean. The refactor
changes no dependency versions. The affected package is development tooling,
not deployed application code, and authored content does not supply its glob
patterns. The remaining risk is tooling denial of service from malicious glob
patterns. The advisory currently lists no patched release.

The full root audit remains a failed check and must remain visible. Its CI job,
threshold and classification are unchanged. The owner's approval authorizes
this specific exception to the normal all-audits-pass release rule. Deployment
still requires the remaining smoke checks to pass. No live payment, email or
content mutation is part of the release validation.

Rollback: redeploy previous Store source `384e81125d19019c63dfb20abdd1d57e7b875898`
with its recorded Platform pin, or revert the consumer adapter/gitlink together.
There is no data migration. Production deployment uses the reviewed exact merge
commit through the existing manual Deploy Production workflow.
