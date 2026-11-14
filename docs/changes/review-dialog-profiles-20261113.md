# Review dialogs and profile review rows — 2026-11-13

Implemented locally, not deployed. No notification settings or delivery semantics changed.

## Findings

Comment/reaction notifications currently target only the review author, excluding the actor. Commenting does not subscribe a participant. Existing Social Interactions channel preferences still apply.

Episode reviews use Common Modal; comments use a portaled Headless UI Dialog. Common Modal's capture-phase outside-click listener considered clicks in the comments portal outside the episode modal and could dismiss the parent, destroying both. Common Modal now leaves dismissal to an open Headless UI dialog. Additional closing paths hardened: transient feed refresh errors retain loaded cards, and notification-query changes no longer key/remount the comments footer.

## Changes

- Comments focus the close control on opening, not an input. Header stays outside the scrolling body; comments/composer scroll inside a contained area.
- Visible viewport resize/pan updates the sheet bounds when the keyboard appears. The background body is fixed while open and its original position is restored on close. No post-scroll correction loop.
- Review notification links do not scroll the background to the review while comments are opening.
- Each profile now has a Reviews row using existing review cards, episode metadata, reactions and comments. API userId filter selects written reviews for that member without the discovery date cutoff; existing visibility/deduplication rules and 20-item pagination remain. OpenAPI query parameter documented.

## Validation

TypeScript no-emit and scoped ESLint passed. Three regression tests passed: visible viewport/scroll-lock cleanup, actual feed-handler author filtering/date-window/invalid-ID behavior, and actual Common Modal parent-dismissal behavior with a child dialog open. Tests use mocked browser/DB boundaries; no production writes or notifications.

Physical iPhone keyboard behavior and the reported live notification sequence have not been replayed on-device. No deployment or production verification claimed.
