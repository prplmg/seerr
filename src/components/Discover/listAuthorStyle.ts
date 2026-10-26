export function listAuthorStyle(
  source?: 'catalogue' | 'letterboxd' | 'curated'
) {
  return source === 'catalogue'
    ? 'text-purple-300'
    : source === 'letterboxd'
      ? 'text-green-400'
      : 'text-gray-400';
}
