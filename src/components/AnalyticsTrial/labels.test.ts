import { strict as assert } from 'assert';
import { test } from 'node:test';
import { eventLabel } from './labels';
test('readable labels preserve stable event names and target details', () => {
  assert.equal(
    eventLabel('$pageview', { page_name: 'Discovery Page' }),
    'Visited Discovery Page'
  );
  assert.equal(
    eventLabel('media_requested', {
      media_type: 'tv',
      media_title: 'Chernobyl',
      release_year: 2019,
    }),
    'Requested Series: Chernobyl (2019)'
  );
  assert.equal(eventLabel('ai_search_used', {}), 'Used AI Search');
  assert.equal(
    eventLabel('list_action_completed', {
      endpoint: '/api/v1/discovery-lists/123/save',
      saved: false,
      list_title: 'Taskmovies',
    }),
    'Unsaved list: Taskmovies'
  );
  assert.equal(
    eventLabel('reaction_added', { comment_id: '1' }),
    'Added a reaction to a comment'
  );
  assert.equal(
    eventLabel('media_requested', { media_type: 'tv', media_id: 1 }),
    'Requested Series #1'
  );
});
