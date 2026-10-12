export type WatchingPerson = { id: number; name: string; avatar: string };
export type PartyExternalVideo = {
  provider: 'youtube';
  videoId: string;
  title: string;
  url: string;
  thumbnail: string;
};
export type WatchingParty = {
  id: string;
  members: WatchingPerson[];
  mine: boolean;
  position: number;
  duration: number;
  paused: boolean;
  ratingKey: string;
  switchStatus?: 'loading' | 'ready' | 'failed';
  canReturn?: boolean;
  canControl?: boolean;
  external?: PartyExternalVideo;
};
export type WatchingTitle = {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  viewers: WatchingPerson[];
  parties: WatchingParty[];
  external?: PartyExternalVideo;
};
export type WatchingResponse = {
  extensionVersion?: string;
  enabled: boolean;
  partiesEnabled: boolean;
  activityAvailable: boolean;
  relayAvailable: boolean;
  results: WatchingTitle[];
};
