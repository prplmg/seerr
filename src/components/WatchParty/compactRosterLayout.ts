export const ROSTER_AVATAR_SIZE = 20;
export const ROSTER_GAP = 4;

/** Reserve overflow only when needed, so four faces at 92px never become +1. */
export function compactRosterLayout(
  count: number,
  width: number,
  overflowWidth: number
) {
  const allWidth = count * (ROSTER_AVATAR_SIZE + ROSTER_GAP) - ROSTER_GAP;
  const visible =
    allWidth <= width
      ? count
      : Math.max(
          0,
          Math.min(
            count - 1,
            Math.floor(
              (width - overflowWidth) / (ROSTER_AVATAR_SIZE + ROSTER_GAP)
            )
          )
        );
  return { visible, hidden: count - visible };
}
