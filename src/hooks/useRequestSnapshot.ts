import { useEffect } from 'react';
import type { KeyedMutator } from 'swr';

/** Fresh list responses must replace older per-card cache entries without a GET. */
export default function useRequestSnapshot<T>(
  visible: boolean,
  snapshot: T,
  mutate: KeyedMutator<T>
) {
  useEffect(() => {
    if (visible) void mutate(snapshot, { revalidate: false });
  }, [visible, snapshot, mutate]);
}
