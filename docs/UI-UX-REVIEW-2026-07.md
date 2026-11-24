# UI/UX Review — Personal Tier (Live)

**Date:** 2026-07-29 · **Method:** 17 fresh production screenshots (desktop 1440px + iPhone-class 390px) across landing (en/vi), pricing, login/signup, dashboard, settings, billing, archived, and the document viewer (en/vi); axe-core WCAG 2.0 A/AA scans on 8 screens; plus behavioral notes from the two live E2E rounds. Complements `PERSONAL-UI-MAKEOVER.md` (palette work, shipped) and `UX-IMPROVEMENTS.md` (i18n fonts, shipped) — this review covers what those passes didn't: **mobile layout, accessibility, and flow friction**.

---

## What's working well

- **Brand coherence** — the teal `brand` + `slateish` system now holds across landing, auth, dashboard, viewer, and billing. The product reads as one product.
- **The viewer is the star.** Desktop: split document/field view, live color-matched field boxes drawn on the document, per-field bilingual labels (translated name primary, English secondary), plain-language explanations, Done/Empty chips, progress bar, big localized export CTA. Mobile: the same field cards adapt cleanly with zero horizontal overflow, fully localized ("Số Hóa Đơn / Invoice Number", "Xuất Tài Liệu").
- **Marketing pages** are clean and stack well on mobile; the language-chip row communicates the multilingual value prop immediately.
- **Waiting states** have personality (rotating messages, fun facts, the snake game) and now honest progress semantics after the F-7 fix.
- **The consent moment** ("Let Cô read your form? … never stored or shared") is clear, warm, and privacy-forward — genuinely good trust UX.

## Findings — prioritized

### P0 (breaks or blocks users)

1. **Mobile dashboard layout blows out the viewport.** On a 390px phone the layout viewport inflates to **607px** (measured) — the whole dashboard renders zoomed-out with the document list spilling off-screen. Root cause: `DocumentCard`'s inner flex row (`flex items-start gap-4`) has no `min-w-0` on its shrinkable children, so `truncate` never engages and the card's min-content width (~581px) stretches the page. Fix is one class on the flex children (`min-w-0` on the `flex-1` title container), plus checking the checkbox/icon/actions row.
2. **Per-document actions are unreachable on touch.** Download/Archive/Delete on cards are `opacity-0 group-hover:opacity-100` — hover doesn't exist on phones, so mobile users can't act on a single document at all (only bulk-select delete). Show the actions always on small screens (`opacity-100 md:opacity-0 md:group-hover:opacity-100`) or move them into a kebab menu.
3. **Unlabeled icon controls (axe: critical).** Every card's select-checkbox button and the mobile nav's archived link have no accessible name; the nav's icon buttons rely on icons alone. Six aria-labels fix all `button-name`/`link-name` violations found.

### P1 (high-leverage polish)

4. **Muted-gray text fails WCAG contrast on every screen** (axe `color-contrast`, serious: 22 nodes on landing, 9–10 on pricing/dashboard/billing, 5 on login). The culprit is `slateish-400`/`text-slateish-500`-on-light for body copy and card metadata. Darkening the *text-on-background* usages one step (≈`slateish-600`) clears the bulk of it without changing the look much.
5. **Setup-wizard loop.** For any document without rect-backed positions (every scanned image), the "Setup Required" modal reopens on **every field change** until completed — dismissing with X doesn't stick (observed repeatedly in live testing; it blocked automation the same way it interrupts users). Track dismissal in state/localStorage, and consider making setup optional for personal users (the audit's "lighter manual placement" follow-up).
6. **Desktop card titles truncate absurdly early** ("Single For…", "Sales Agre…") despite wide cards — same missing `min-w-0`/layout issue as #1; fixing that frees the title space.
7. **Mobile viewer has no document tab.** Only Fields and Chat exist on phones — users can never see the form they're filling. Add a third tab (or a collapsible preview) with the same PdfViewer.
8. **Upload zone microcopy mismatch.** The big drop target's subtitle is about *language selection* ("Select which language to translate form fields into…") rather than uploading; the actual language picker is a separate control (labeled "English (only)", which reads oddly). Swap in upload-focused copy ("Drag & drop PDF, PNG, or JPEG — up to 20MB") and rename the picker option to "English — no translation".

### P2 (nice-to-have)

9. The sidebar progress row clips its "remaining" counter on 390px ("còn 6" → "cò…"); tab label "Trò Chuyện Với Cô" also touches the edge — give the row `flex-wrap` or tighter text.
10. The "Read this form in another language?" prompt reappears every visit once dismissed with "Keep English" — remember the choice per document.
11. Live field-box overlay can sit on top of the document's own printed text when OCR positions land on a busy area (seen on the invoice's number block) — a slight transparency or outline-only style for the box would keep the underlying text readable.
12. Landing page is very long on mobile (~11k px) — consider collapsing "The Concept" cards into an accordion below the fold.
13. Field inputs still emit invalid HTML `type` values (`ssn`, `address`) and a native `date` picker that exports ISO format — carried over from the audit's low-priority list.

## Axe-core summary (WCAG 2.0 A/AA)

| Screen | Critical | Serious |
|---|---|---|
| Landing | — | color-contrast ×22 |
| Pricing | — | color-contrast ×9 |
| Login | — | color-contrast ×5 |
| Dashboard (desktop) | button-name ×3 | color-contrast ×9 |
| Dashboard (mobile) | button-name ×3 | color-contrast ×8, link-name ×1 |
| Billing | — | color-contrast ×10 |
| Viewer/Archived | — | color-contrast ×2 |

No keyboard-trap, focus-order, or ARIA-structure violations were flagged — the issues are contained to naming and contrast, both cheap to fix.

## Suggested fix order

1. `min-w-0` card layout fix (#1/#6) + always-visible mobile actions (#2) + the six aria-labels (#3) — one small PR, immediately testable.
2. Contrast pass on muted text (#4) — one shared class change, re-run axe to confirm.
3. Setup-wizard dismissal memory (#5) and the mobile document tab (#7) — the two real UX projects; scope before building.
4. Copy fixes (#8) — trivial, bundle with any of the above.
