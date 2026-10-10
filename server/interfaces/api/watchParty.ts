export type WatchingPerson = { id: number; name: string; avatar: string };
export type WatchingParty = {
  id: string;
  members: WatchingPerson[];
  mine: boolean;
  position: number;
  duration: number;
  paused: boolean;
  ratingKey: string;
  switchStatus?: 'loading' | 'ready' | 'failed';
};
export type WatchingTitle = {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  viewers: WatchingPerson[];
  parties: WatchingParty[];
};
export type WatchingResponse = {
  extensionVersion?: string;
  enabled: boolean;
  partiesEnabled: boolean;
  activityAvailable: boolean;
  relayAvailable: boolean;
  results: WatchingTitle[];
};
