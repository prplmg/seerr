export function stackLayout(
  count: number,
  size: number,
  available: number,
  vertical = false
) {
  return {
    step:
      count > 1
        ? Math.max(
            0,
            Math.min(
              vertical ? size * 0.32 : size + 3,
              (available - size) / (count - 1)
            )
          )
        : 0,
  };
}
