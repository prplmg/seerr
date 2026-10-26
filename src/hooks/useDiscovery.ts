import axios from 'axios';
import Link from 'next/link';
import { useRouter } from 'next/router';
import {
  createContext,
  createElement,
  useContext,
  type ComponentType,
  type ReactNode,
} from 'react';
import useSWR from 'swr';
import { useUser } from './useUser';
const PreviewContext = createContext<string | undefined>(undefined);
export function useDiscoveryPreviewReadOnly() {
  return useContext(PreviewContext) !== undefined;
}
export function withDiscoveryPreview(Page: ComponentType) {
  return function PreviewPage() {
    const { query } = useRouter();
    const target =
      query.previewUserId === undefined
        ? undefined
        : String(query.previewUserId);
    return createElement(
      PreviewContext.Provider,
      { value: target },
      createElement(PreviewContent, null, createElement(Page))
    );
  };
}
function PreviewContent({ children }: { children: ReactNode }) {
  const { previewUserId, preview, loading } = useDiscovery();
  if (previewUserId === undefined) return children;
  if (loading)
    return createElement(
      'p',
      { className: 'text-gray-300', role: 'status' },
      'Loading preview…'
    );
  if (!preview)
    return createElement(
      'p',
      { className: 'text-gray-300', role: 'alert' },
      'Preview unavailable. Administrator access and an existing user are required.'
    );
  return createElement(
    'div',
    null,
    createElement(
      'div',
      {
        className: 'mb-5 rounded-lg border border-purple-400 p-4 text-gray-300',
        role: 'status',
      },
      `Previewing as ${preview.name} · Read-only. Your admin session is unchanged. `,
      createElement(
        Link,
        { href: '/settings/account-mappings', className: 'text-purple-300' },
        'Exit preview'
      )
    ),
    children
  );
}
export default function useDiscovery() {
  const { user } = useUser();
  const previewUserId = useContext(PreviewContext);
  const read = async ([url]: [string, ...unknown[]]) =>
    (
      await axios.get(url, {
        headers:
          previewUserId === undefined
            ? {}
            : { 'X-Discovery-Preview-User': previewUserId },
      })
    ).data;
  const href = (url: string) =>
    previewUserId === undefined
      ? url
      : `${url}${url.includes('?') ? '&' : '?'}previewUserId=${encodeURIComponent(previewUserId)}`;
  const { data, error } = useSWR<{
    enabled: boolean;
    preview?: { id: number; name: string };
  }>(
    user && previewUserId !== undefined
      ? ['/api/v1/discovery-lists/features', user.id, previewUserId]
      : null,
    read,
    { refreshInterval: 60000, revalidateOnFocus: true }
  );
  return {
    enabled:
      !!user &&
      (previewUserId === undefined || (!error && data?.enabled === true)),
    loading: !!user && previewUserId !== undefined && !data && !error,
    previewUserId,
    preview: data?.preview,
    readOnly: previewUserId !== undefined,
    read,
    href,
  };
}
