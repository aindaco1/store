# Design QA: RSVP admin order layout and question builder

## Evidence

### Source visual truths

- Desktop order overflow: `/var/folders/pq/k53r7k297k910qhn8h5q9jbw0000gn/T/codex-clipboard-c9a59049-582a-4c6d-a6e1-b58e978cfa04.png`
- RSVP question builder: `/var/folders/pq/k53r7k297k910qhn8h5q9jbw0000gn/T/codex-clipboard-b9dea9d1-7563-4af9-b448-e335ae7edca9.png`
- Browser-rendered implementation: `http://127.0.0.1:4002/admin/`

### Rendered artifacts

- Order implementation: `/Users/aindaco1/.codex/visualizations/2026/08/18/01a015e6-2c1c-7223-8d33-ab3ea1fc7de4/rsvp-orders-final-normal.png`
- Initial builder implementation: `/Users/aindaco1/.codex/visualizations/2026/08/18/01a015e6-2c1c-7223-8d33-ab3ea1fc7de4/rsvp-builder-normal-viewport.png`
- Initial builder controls: `/Users/aindaco1/.codex/visualizations/2026/08/18/01a015e6-2c1c-7223-8d33-ab3ea1fc7de4/rsvp-builder-controls.png`
- Order before/after comparison: `/Users/aindaco1/.codex/visualizations/2026/08/18/01a015e6-2c1c-7223-8d33-ab3ea1fc7de4/rsvp-orders-before-after.png`
- Automatic-value builder: `/Users/aindaco1/.codex/visualizations/2026/08/18/01a015e6-2c1c-7223-8d33-ab3ea1fc7de4/rsvp-builder-auto-values.png`
- Automatic-value side-by-side comparison: `/Users/aindaco1/.codex/visualizations/2026/08/18/01a015e6-2c1c-7223-8d33-ab3ea1fc7de4/rsvp-builder-auto-values-comparison.png`
- Stable ID help interaction: `/Users/aindaco1/.codex/visualizations/2026/08/18/01a015e6-2c1c-7223-8d33-ab3ea1fc7de4/rsvp-builder-auto-values-help.png`

## Capture normalization

- The order source is 1766 x 1012 pixels. Its focused implementation is 1116 x 720 from the in-app browser at a reported 1280 x 720 CSS viewport and device pixel ratio 2. The combined comparison normalizes each artifact into an equal 883 x 506 tile; density, pane crop, and surrounding-page differences are not findings.
- Secondary order verification used a reported 1766 x 1011 CSS viewport. The expanded Actions cell measured 199 CSS pixels with equal client and scroll widths, and the page scroll width equaled the viewport width.
- The builder source is 1646 x 1288 pixels. The browser reported a 1646 x 1288 CSS viewport at device pixel ratio 2 and produced an 1116 x 1288 screenshot. The readable source region was cropped to 1400 x 1288, resized to 700 x 644, and extended on white to 700 x 723 for comparison with the 700 x 723 implementation crop.
- Compared states are authenticated Admin Orders with party and attendee responses expanded, and authenticated Products with two RSVP questions, choice rows, automatic read-only values, and the default closed-tooltip state.

## Findings

- No actionable P0, P1, or P2 differences remain.
- Fonts and typography: existing Store display and body families, UI weights, letter spacing, line height, hierarchy, and wrapping are preserved. Long order responses wrap without truncation, and builder help uses the established UI type.
- Spacing and layout rhythm: the desktop order table keeps its six-column hierarchy and bounded Actions track. The builder retains the existing fieldset, grid, gap, border, radius, and button rhythm. Field-level info controls intentionally add some vertical space without causing overflow.
- Colors and visual tokens: the implementation uses existing Store foreground, secondary text, border, surface, focus, read-only, and button tokens. Generated values use the same muted monospace treatment as SKU and variant identifiers.
- Image quality and assets: no product imagery changed. New help controls reuse Store's existing help-icon component; no placeholder asset, CSS art, inline SVG, or new drawing style was introduced.
- Copy and content: localized guidance distinguishes guest-facing labels from generated stable IDs and stored values, and explains audience, requirement, text-limit, and choice behavior.
- Accessibility and interaction: controls retain native labels, fieldset legends, semantic buttons, disabled move/remove limits, visible counts, focus behavior, and English/Spanish runtime strings. Every rendered question and choice control has linked tooltip help.
- Browser console: no warnings or errors were reported during local Orders or Products verification.

## Full-view comparison evidence

The order source showed Actions content escaping past the table's right border. The rendered page contains expanded response text and both check-in buttons within the table while preserving the rest of the admin composition.

The rendered product editor keeps the RSVP builder inside its existing surface. Both the page and builder report no horizontal overflow, and the automatic-value fields remain visually distinct without competing with the guest-facing labels.

## Focused region comparison evidence

The order comparison places the supplied failure crop beside the contained final Actions column. The builder comparison places the supplied two-question setup beside the implementation with automatic values and info controls. Typography, border color, control height, grid proportions, radii, section hierarchy, and button treatment continue to match the established Store admin design language.

## Interaction and accessibility checks

- Adding `Dietary restrictions?` generated `dietary_restrictions`.
- Changing the new question to a choice field and entering `Vegetarian` and `No restrictions` generated `vegetarian` and `no_restrictions`.
- Editing the published Accessibility question label preserved `accessibility_needs`.
- All 16 rendered question and choice controls referenced non-empty `role="tooltip"` content through `aria-describedby`.
- Stable IDs and stored values were read-only.
- Stable ID help opened from its button, was readable, and closed after focus moved away.
- The temporary browser-test question was removed without publishing.
- Keyboard-friendly add, move, remove, choice editing, and the hidden JSON bridge retain the canonical Worker-backed schema.

## Comparison history

1. Initial P1: desktop roster content and check-in buttons escaped the table. Fix: constrained desktop tracks, wrapping response rules, and bounded controls. Post-fix evidence shows equal Actions client and scroll widths with no page overflow.
2. Initial P3: the Total header wrapped in a 7% track. Fix: rebalanced Customer from 22% to 20% and Total from 7% to 9%. Post-fix evidence keeps Total on one line and Actions contained.
3. Automatic-value and help pass: no P0, P1, or P2 mismatch required another visual iteration. The requested info controls and read-only identifier treatment are intentional differences from the supplied builder screenshot.

## Implementation checklist

- [x] Contain expanded party and attendee responses on desktop.
- [x] Preserve tablet and mobile order cards.
- [x] Replace raw JSON administration with a guided serialization bridge.
- [x] Generate question IDs and stored values from visible labels.
- [x] Preserve published IDs and values when labels change.
- [x] Make generated values read-only like SKU and variant identifiers.
- [x] Add localized, keyboard-accessible help to every builder field.
- [x] Preserve the canonical repository and Worker schema.
- [x] Add focused browser regressions and inspect the live local UI.

## Follow-up polish

No P3 visual follow-up is required for this scope.

final result: passed
