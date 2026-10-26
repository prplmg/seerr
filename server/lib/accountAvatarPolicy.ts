export function avatarRedirectKind(
  source: string,
  location: string
): 'letter' | 'custom' {
  const original = new URL(source),
    target = new URL(location, source);
  if (
    original.protocol !== 'https:' ||
    original.hostname !== 'plex.tv' ||
    !/^\/users\/[a-f0-9]+\/avatar$/.test(original.pathname) ||
    [...original.searchParams.keys()].some((key) => key !== 'c')
  )
    throw Error('Unexpected Plex avatar source');
  if (
    target.protocol === 'https:' &&
    target.hostname === 'plex.tv' &&
    /^\/avatars\/[a-f0-9]{6}\/[a-f0-9]+\/\d+$/i.test(target.pathname)
  )
    return 'letter';
  if (
    target.protocol === 'https:' &&
    target.hostname === 'assets.plex.tv' &&
    /^\/avatars\/[a-f0-9]{40}\.(?:[a-z0-9]+)?$/i.test(target.pathname)
  )
    return 'custom';
  throw Error('Unexpected Plex avatar redirect');
}
