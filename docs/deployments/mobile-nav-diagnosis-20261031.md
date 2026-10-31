# Mobile bottom navigation diagnosis — October 31, 2026

## Conclusion
The underlying cause of the reported physical-iPhone failure is not confirmed. No incorrect fixed-position CSS or containing-block ancestor was found in the inspected source and isolated computed-style test. iOS viewport/rendering state is the leading hypothesis, not a proven diagnosis. The proposed post-scroll JavaScript remount workaround is withdrawn and archived; nothing deployed or production settings changed.

## Symptom
User screenshot: the bottom navigation floats roughly halfway up the actor page. Scrolling upward restores it; scrolling downward raises it again. Similar symptoms were previously reported on user settings. No keyboard is visible in this screenshot; prior keyboard use and device accessibility settings are unknown.

## Source trace and confirmed findings
- MobileMenu outer element already has fixed/bottom-0/left-0/right-0. It has no positioning transform or scroll-direction animation.
- Ancestors: sm:hidden wrapper → Layout flex container → __next → body → html. None introduces transform, filter, backdrop-filter, containment or will-change positioning in the isolated computed-style audit.
- The search bar is a sibling in a separate content wrapper. Its scroll listener changes background/blur after 20px; it does not reposition the bottom bar.
- The expanded menu translates a child above the nav. That is not an ancestor transform of the fixed bar.
- Bottom-bar blur is on a child. It is a possible compositor variable, but is not proof of a containing-block problem or a rendering defect.
- Root HTML adds safe-area padding and bottom content clearance; the nav adds bottom safe-area padding. This can affect spacing, but the tests do not show it moving the fixed anchor mid-screen. There is no 100vh height on the navbar to replace with dvh.
- PWA manifest uses standalone display; viewport uses width=device-width, initial-scale=1, viewport-fit=cover. Screenshot is compatible with standalone mode, but the user has not confirmed mode/version.
- Existing deployed recovery only remounts after native-editor focus/blur/viewport resize and restored height. It neither measures nor corrects scroll position. A viewport that remains smaller than the stored baseline prevents that recovery. This is a possible reason the old workaround misses a failure, not evidence for why the failure starts.

## Confirmed separate defect: pull-to-refresh cleanup
PullToRefresh sets body touchAction=none and overscrollBehavior=none and root overscrollBehaviorY=none when touch starts at the top. It handles touchend but not touchcancel. Its effect cleanup removes listeners without restoring those styles. An isolated execution of the actual component effect confirmed the styles remain after unmount. The normal finish path also writes auto instead of restoring previous values and restores only Y after setting the body's shorthand. This can interfere with scrolling and other scroll locks. It does not directly set the navbar geometry; no causal link to the screenshot has been established. No fix applied during this diagnosis.

## Tests and limits
- bin/diagnose-mobile-nav.cjs: renders actual Layout and MobileMenu markup with mocked data/siblings, actual compiled Tailwind/global CSS. Closed menu, no React effects. Chromium widths 320/390/430; heights 844→450→844; scroll positions 0→600→1200→600→0; reduced-motion off/on. 90 samples; maximum bottom-position error 0px. All ancestor computed transforms/filters/containment neutral.
- Resizing desktop Chromium is NOT a native iOS keyboard simulation, and reduced-motion emulation is NOT Apple's Prefer Cross-Fade Transitions setting. These tests rule out ordinary layout drift in this fixture, not device-specific compositing problems.
- bin/diagnose-pull-cleanup.cjs executes the actual effect with mocked state/DOM, confirming missing cancellation/unmount restoration.
- Evidence: workspace outputs/mobile-nav-diagnosis/measurements.json and fixture.html. No signed-in live runtime inspection or physical-iPhone reproduction was available. No iOS simulator devices installed (simctl list devices available returned none).

## External evidence, explicitly not proof for this device
WebKit bug 297779 describes fixed elements shifting as scroll direction changes. A WebKit engineer identified a system-component defect; reports include keyboard-triggered viewport mismatch. This is historical evidence from 2025, not proof the user's current iOS version has that bug. Some reports concern only 24px offsets, much smaller than this screenshot.
https://bugs.webkit.org/show_bug.cgi?id=297779
Apple Developer Forums thread 800125 includes a report of bottom elements appearing halfway up the screen with Reduce Motion and Prefer Cross-Fade Transitions. That is a user report, not a confirmed diagnosis of this installation. The original reporter also corrected an initial offsetTop explanation to a viewport-height mismatch; do not assume offsetTop alone is the cause.
https://developer.apple.com/forums/thread/800125

## Why not a simple CSS rule or the proposed JS check?
The basic CSS rule is already present. Reapplying bottom:0 or changing z-index does not address a measured defect. translateZ(0), removing blur, or moving the nav into a portal would be experiments until tested in the failing state. A post-scroll remount can cause churn, may trust an already-wrong visualViewport value, and cannot detect a paint-only error when DOM geometry remains correct. Mocked remount tests did not justify shipping it.

## Remaining diagnostic steps
Obtain iOS version, standalone/Safari mode, Reduce Motion/Prefer Cross-Fade settings, and whether keyboard/search preceded the problem. While the phone is failing, record innerHeight, root clientHeight, visualViewport height/offsetTop/scale, navbar bounding rect/computed bottom/transform, focused element and body/root scroll styles for each scroll direction. Compare pixels to geometry. Correct geometry with wrong pixels implicates paint/compositing; wrong geometry with inconsistent viewport metrics implicates viewport state; an unexpected ancestor style implicates application CSS. Only then A/B one CSS variable (blur/layering) or apply a narrowly justified viewport recovery. Do not silently change the user's accessibility preferences.

## State
The three speculative source/test files were restored/removed against checkpoint 00d8b32; patch preserved. Other pending work retained. No deployment, sync toggles or live data changes.
