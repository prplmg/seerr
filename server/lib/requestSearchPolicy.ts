import { MediaRequestStatus } from '@server/constants/media';

export function hasPendingSeasonApproval(
  requests: { requiresSeasonApproval?: boolean; status: number }[] = []
): boolean {
  return requests.some(
    (request) =>
      request.requiresSeasonApproval &&
      request.status === MediaRequestStatus.PENDING
  );
}

export function canReceiveSeasonApprovalEmail(
  isSeasonApproval: boolean,
  userId: number
): boolean {
  return !isSeasonApproval || userId === 1;
}

export function requiresSeasonApproval(
  isAdmin: boolean,
  seasons: number[]
): boolean {
  return !isAdmin && new Set(seasons).size > 2;
}

export function shouldSearchInitially(
  preventSearch: boolean,
  skipInitialSearch: boolean
): boolean {
  return !preventSearch && !skipInitialSearch;
}
