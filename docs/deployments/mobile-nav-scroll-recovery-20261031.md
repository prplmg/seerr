> Withdrawn October 31: archived as patches/mobile-nav-scroll-recovery-20261031.patch. The source was restored to its pre-workaround state. Mock recovery tests did not establish the cause or prove an iPhone fix. See mobile-nav-diagnosis-20261031.md.

# Mobile navigation scroll recovery — October 31

User reports iPhone bottom bar stuck mid-screen when scrolling down, returning to bottom when scrolling up. Prior workaround only armed on native editor focus, so scrolling without a focus cycle never triggered recovery. Exact physical-iPhone compositor failure not reproduced.

Pending change: after scroll/visual-viewport resize/pageshow settles for350ms, compare the bar's bottom to visualViewport.offsetTop+height. Ignore hidden bars, focused editors and pinch zoom; retain existing keyboard-close guard. If misaligned by more than8px, remount only mobile nav. Maximum2 repairs until observed aligned; no polling, scrolling or guessed positional offsets. Passive scroll listener, cleanup on unmount. Does not guarantee recovery if iOS reports correct geometry while painting stale pixels; physical-device confirmation needed.

Five tests pass: existing keyboard/picker recovery, non-iOS/zoom exclusion, drift in either direction, bounded retries/reset, offset handling, hidden/focused elements and cleanup. Not deployed.
