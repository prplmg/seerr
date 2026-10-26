import type { MovieDetails } from './Movie';
import type { TvDetails } from './Tv';

type SharedFields =
  | 'id'
  | 'posterPath'
  | 'overview'
  | 'voteAverage'
  | 'mediaInfo';
export type MoviePosterCard = Pick<
  MovieDetails,
  SharedFields | 'title' | 'releaseDate'
>;
export type TvPosterCard = Pick<
  TvDetails,
  SharedFields | 'name' | 'firstAirDate'
>;

// Keep the already-authorized media information and localized fallback text.
// Only omit detail-page metadata; no shared user-response cache is introduced.
export function posterCard(
  data: MovieDetails | TvDetails
): MoviePosterCard | TvPosterCard {
  const common = {
    id: data.id,
    posterPath: data.posterPath,
    overview: data.overview,
    voteAverage: data.voteAverage,
    mediaInfo: data.mediaInfo,
  };
  return 'title' in data
    ? { ...common, title: data.title, releaseDate: data.releaseDate }
    : {
        ...common,
        overview: data.overview,
        name: data.name,
        firstAirDate: data.firstAirDate,
      };
}
