export type SearchPerson = { id: number; name: string; avatar?: string };
export function searchPeople(
  userId: number,
  requested: unknown,
  query: string,
  users: SearchPerson[],
  resolvePromptNames = true
) {
  const selected = requested ?? [];
  if (
    !Array.isArray(selected) ||
    selected.length > 5 ||
    selected.some((id) => !Number.isSafeInteger(id))
  )
    throw Object.assign(Error('Choose up to five people.'), { status: 400 });
  const ids = new Set<number>([userId, ...selected]);
  // Deliberately narrow grammar: identities are resolved locally, never by a model.
  const cleaned = query.replace(
    /\bunwatched by\s+([^,.;\n]+)/gi,
    (_whole, phrase: string) => {
      const names = phrase
        .split(/\s+(?:and|&)\s+|\s*\+\s*/i)
        .map((s) => s.trim().replace(/^@/, ''));
      for (const name of resolvePromptNames ? names : []) {
        if (/^(?:i|me|myself)$/i.test(name)) continue;
        const matches = users.filter(
          (u) => u.name.toLocaleLowerCase() === name.toLocaleLowerCase()
        );
        if (matches.length !== 1)
          throw Object.assign(
            Error(
              'Choose the people in the selector; a name in your search could not be matched.'
            ),
            { status: 400 }
          );
        ids.add(matches[0].id);
      }
      return 'unwatched';
    }
  );
  if (ids.size > 6 || [...ids].some((id) => !users.some((u) => u.id === id)))
    throw Object.assign(
      Error('A selected person is unavailable. Refresh the people selector.'),
      { status: 400 }
    );
  return { ids: [...ids], query: cleaned };
}
