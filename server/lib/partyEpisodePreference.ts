type Episode = { key: string; season: number; episode: number };
type Progress = { rating_key: string; percent_complete?: number | string };

// Shared playback profiles are preferences, never evidence that every linked
// catalogue user watched a session. Keep this separate from avatar attribution.
export function preferredPartyEpisode(
  episodes: Episode[],
  active: Progress[],
  recent?: Progress
): string | undefined {
  const keys = new Set(episodes.map((e) => e.key));
  const playing = [
    ...new Set(
      active.map((row) => String(row.rating_key)).filter((key) => keys.has(key))
    ),
  ];
  if (playing.length === 1) return playing[0];
  if (playing.length > 1 || !recent || !keys.has(String(recent.rating_key)))
    return undefined;
  if (!Number.isFinite(Number(recent.percent_complete))) return undefined;
  if (Number(recent.percent_complete) < 85) return String(recent.rating_key);
  const ordered = episodes
    .filter((e) => e.season > 0)
    .sort((a, b) => a.season - b.season || a.episode - b.episode);
  const index = ordered.findIndex((e) => e.key === String(recent.rating_key));
  return index >= 0 ? ordered[index + 1]?.key : undefined;
}
