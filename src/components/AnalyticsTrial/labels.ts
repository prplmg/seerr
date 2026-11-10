export function eventLabel(event: string, p: Record<string, unknown>): string {
  const kind = p.media_type === 'tv' ? 'Series' : 'Movie';
  const media = p.media_title
    ? `${kind}: ${p.media_title}${p.release_year ? ` (${p.release_year})` : ''}`
    : p.media_id
      ? `${kind} #${p.media_id}`
      : 'media';
  const list = p.list_title ? `list: ${p.list_title}` : 'list';
  const endpoint = String(p.endpoint || '');
  const listVerb = endpoint.endsWith('/save')
    ? p.saved
      ? 'Saved'
      : 'Unsaved'
    : endpoint.endsWith('/sharing')
      ? 'Updated sharing for'
      : endpoint.endsWith('/import')
        ? 'Started importing'
        : p.method === 'delete'
          ? 'Deleted'
          : endpoint.endsWith('/created') && p.method === 'post'
            ? 'Created'
            : 'Updated';
  const labels: Record<string, string> = {
    $pageview: `Visited ${p.page_name || p.page || 'page'}`,
    media_requested: `Requested ${media}`,
    ai_search_used: 'Used AI Search',
    ai_search_refined: 'Refined AI Search',
    rating_created: `Rated ${media}`,
    rating_updated: `Updated rating for ${media}`,
    review_created: `Reviewed ${media}`,
    review_updated: `Updated review of ${media}`,
    comment_created: 'Commented on a review',
    comment_updated: 'Edited a comment',
    comment_deleted: 'Deleted a comment',
    reaction_added: `Added a reaction to ${p.comment_id ? 'a comment' : 'a review'}`,
    reaction_removed: `Removed a reaction from ${p.comment_id ? 'a comment' : 'a review'}`,
    settings_saved: `Updated ${String(p.section || 'settings')
      .split('/settings/')
      .pop()!
      .replaceAll('/', ' ')} settings`,
    catalogue_action:
      (
        {
          open_comments: 'Opened comments',
          open_reaction_picker: 'Opened reaction picker',
          edit_review: 'Opened review editor',
        } as Record<string, string>
      )[String(p.action)] || 'Interacted with catalogue',
    list_action_completed: `${listVerb} ${list}`,
    $identify: 'Identified user',
    $set: 'Updated user properties',
    $opt_in: 'Enabled analytics',
  };
  return labels[event] || event.replace(/^\$/, '').replaceAll('_', ' ');
}
