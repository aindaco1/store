# Design QA: RSVP admin order layout and question builder

## Evidence

- Source visual truth: `/var/folders/pq/k53r7k297k910qhn8h5q9jbw0000gn/T/codex-clipboard-c9a59049-582a-4c6d-a6e1-b58e978cfa04.png`
- Browser-rendered implementation: `http://127.0.0.1:4002/admin/`
- Order implementation screenshot: `/Users/aindaco1/.codex/visualizations/2026/08/18/01a015e6-2c1c-7223-8d33-ab3ea1fc7de4/rsvp-orders-final-normal.png`
- Builder implementation screenshots: `/Users/aindaco1/.codex/visualizations/2026/08/18/01a015e6-2c1c-7223-8d33-ab3ea1fc7de4/rsvp-builder-normal-viewport.png` and `/Users/aindaco1/.codex/visualizations/2026/08/18/01a015e6-2c1c-7223-8d33-ab3ea1fc7de4/rsvp-builder-controls.png`
- Combined focused comparison: `/Users/aindaco1/.codex/visualizations/2026/08/18/01a015e6-2c1c-7223-8d33-ab3ea1fc7de4/rsvp-orders-before-after.png`
- Source pixels: 1766 x 1012. Focused implementation pixels: 1116 x 720 from the in-app browser's visible pane at a 1280 x 720 CSS viewport; the browser reported device pixel ratio 2. The combined comparison thumbnail-normalizes each artifact into an equal 883 x 506 tile; density, pane crop, and surrounding-page differences were not treated as findings.
- Secondary desktop verification: 1766 x 1011 CSS viewport. At that size the expanded Actions cell measured 199 CSS pixels with equal client/scroll widths, and the page scroll width equaled the viewport width.
- State: authenticated local Admin Orders with party and both attendee response disclosures expanded; authenticated Products editor with a two-question RSVP schema and choice rows visible.

## Findings

- No actionable P0, P1, or P2 differences remain.
- Typography: existing Store display/body families, UI weights, letter spacing, and hierarchy are preserved. Long response labels wrap inside Actions without truncation; the Total header remains on one line.
- Spacing and layout rhythm: the desktop table keeps its six-column hierarchy, gives Actions a bounded 24% track, and contains every response and check-in control. The builder reuses existing admin surfaces, label rhythm, buttons, borders, radii, and grid gaps.
- Colors and visual tokens: the implementation uses existing Store foreground, secondary text, border, surface, focus, and button tokens. No new ad hoc palette or state color was introduced.
- Image quality and assets: this change adds no imagery, icon replacement, CSS art, inline SVG, or placeholder asset. Existing logo/product assets are unchanged.
- Copy and content: builder language is task-oriented and localized, distinguishes the guest-facing label from the stable stored ID, and explains why IDs remain stable.
- Accessibility and interaction: native labeled inputs/selects, fieldset legends, semantic buttons, disabled move/remove limits, visible counts, and English/Spanish runtime strings are present. The hidden JSON bridge is not exposed as an admin task. Keyboard-friendly add/move/remove and choice editing serialize correctly.
- Browser console: no warnings or errors were reported during local Orders and Products verification.

## Full-view comparison evidence

The source screenshot showed the Actions content escaping past the table's right border. The rendered full page preserves the existing admin composition and keeps expanded response text plus both check-in buttons within the table. The rest of the page is intentionally unchanged.

## Focused region comparison evidence

The combined comparison file places the supplied failure crop and the rendered first-row crop in one image. It shows the original clipped right edge beside the contained final Actions column. A separate focused builder screenshot was necessary because the supplied source did not depict product setup; it verifies the new question and answer-choice controls against the existing admin design language.

## Comparison history

1. Initial source finding: P1 desktop roster content and check-in buttons escaped the table boundary. Fix: replaced the fixed narrow Actions cell with a constrained grid, fixed desktop column tracks, wrapping response/list rules, and full-width bounded controls. Post-fix evidence: the focused before/after comparison plus measured `scrollWidth === clientWidth` and page width equal to viewport width.
2. First post-fix polish finding: P3 Total header wrapped because its initial 7% track was too narrow at the admin content width. Fix: rebalanced Customer from 22% to 20%, Total from 7% to 9%, and kept the Total header on one line. Post-fix evidence: 1280-pixel browser verification reports `white-space: nowrap`, a 205-pixel Actions cell with equal client/scroll widths, and no page overflow.

## Implementation checklist

- [x] Contain expanded party/attendee responses and check-in buttons on desktop.
- [x] Preserve tablet/mobile order cards.
- [x] Replace raw JSON administration with a guided serialization bridge.
- [x] Preserve the canonical repository and Worker schema.
- [x] Add English/Spanish copy and accessible control semantics.
- [x] Add focused browser regressions and inspect the local UI.

## Follow-up polish

- No P3 visual follow-up is required for this scope.

final result: passed
