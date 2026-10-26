import type { WatchingTitle } from '@server/interfaces/api/watchParty';

// Room membership survives completion so return/switch/replay controls keep working.
// Only activity displays exclude finished parties; real Plex sessions stay visible.
export function activeWatching(item: WatchingTitle): WatchingTitle | undefined {
  const parties = item.parties.filter((p) => !p.ended);
  return item.viewers.length || parties.length
    ? { ...item, parties }
    : undefined;
}
