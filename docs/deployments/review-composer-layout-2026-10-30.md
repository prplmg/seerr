# Review composer layout hardening — 2026-10-30

User screenshot shows stale No rating text alongside 2/5 and duplicated viewing label while iPhone keyboard is visible. Source renders one label. Exact iOS rendering failure not reproduced; do not claim confirmed root cause or Safari fix.

Pending, not deployed: StarPicker uses stable separate stars and value/clear rows; clear control stays mounted and disabled when empty. Composer uses explicit flex gaps; selector and textarea have explicit 16px text and line height at all widths to avoid focus zoom caused by smaller controls. No sync behavior or settings changes.

Offline actual-component markup checks passed 320/375/390/768/1440 widths with empty/2/4.5 ratings (15 cases): identical selector position across rating changes, one viewing label, one select and textarea, no overflow/clipped controls, 16px controls. Focused textarea and shortened 450px viewport exercised; this is Chromium geometry coverage, not an actual iPhone keyboard/compositor reproduction. Preview outputs/review-sync-layout/390-2.png. Prior static test missed the rating-state-dependent wrap and did not cover native iOS keyboard behavior.
