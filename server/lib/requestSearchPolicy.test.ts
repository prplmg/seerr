import { MediaRequestStatus } from '@server/constants/media';
import assert from 'node:assert/strict';
import { it } from 'node:test';
import {
  canReceiveSeasonApprovalEmail,
  hasPendingSeasonApproval,
  requiresSeasonApproval,
  shouldSearchInitially,
} from './requestSearchPolicy';

it('blocks further seasons until approval, decline or completion', () => {
  assert.equal(hasPendingSeasonApproval(), false);
  for (const status of [
    MediaRequestStatus.PENDING,
    MediaRequestStatus.APPROVED,
    MediaRequestStatus.DECLINED,
    MediaRequestStatus.COMPLETED,
  ]) {
    assert.equal(
      hasPendingSeasonApproval([{ status, requiresSeasonApproval: true }]),
      status === MediaRequestStatus.PENDING
    );
  }
  assert.equal(
    hasPendingSeasonApproval([
      { status: MediaRequestStatus.PENDING, requiresSeasonApproval: false },
    ]),
    false
  );
});
it('restricts multi-season approval email to the owner without changing unrelated mail', () => {
  assert.equal(canReceiveSeasonApprovalEmail(true, 1), true);
  for (const id of [2, 11, 13])
    assert.equal(canReceiveSeasonApprovalEmail(true, id), false);
  assert.equal(canReceiveSeasonApprovalEmail(false, 11), true);
});

it('holds three or more distinct seasons for non-admins only', () => {
  assert.equal(requiresSeasonApproval(false, [1, 2]), false);
  assert.equal(requiresSeasonApproval(false, [1, 2, 3]), true);
  assert.equal(requiresSeasonApproval(false, [1, 1, 2]), false);
  assert.equal(requiresSeasonApproval(true, [1, 2, 3, 4]), false);
});
it('skips initial searches without overriding the global prevent-search setting', () => {
  assert.equal(shouldSearchInitially(false, false), true);
  assert.equal(shouldSearchInitially(false, true), false);
  assert.equal(shouldSearchInitially(true, false), false);
  assert.equal(shouldSearchInitially(true, true), false);
});
