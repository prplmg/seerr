# AI Search text and filter polish — local only

Fixes black history/popover/editor headings and action text with explicit foreground colors. The app body supplies a dark background but no foreground; earlier isolated previews added a white body foreground and omitted global component CSS, hiding the regression. History queries now override the global button-span nowrap rule and wrap inside their cards.

Only applied constraints get editable chips. Removed inactive Any variants and the constant media-type chip. A More filters pill opens an accessible Headless UI popover listing inactive constraints; selecting one opens its existing editor. Clearing a constraint removes its chip. Watched status reflects submitted filters, not pending people-selector edits. Existing filter processing, caches and model usage are unchanged.

Validation: client TypeScript, ESLint, formatting, and actual-component browser checks at 320/390/1440px. Preview now loads the complete production globals.css without a fake light body foreground. Checks cover explicit text colors, history wrapping, active-only chips, add/clear runtime, inactive options, Escape dismissal and horizontal overflow. Mock data only; no paid model calls.

Evidence: outputs/ai-search-filter-polish-20261107 (preview harness and screenshots). No deployment, push, toggle or credential changes. Existing unrelated next-env.d.ts excluded from commit. Live build remains GJjguarwnobjjSE90UZhY until a separate deployment.
