import { ReleasePage } from '@app/components/Discover/ReleaseUpdates';
import { withDiscoveryPreview } from '@app/hooks/useDiscovery';
import type { GetServerSideProps } from 'next';
export const getServerSideProps: GetServerSideProps = async ({ query }) => {
  if (query.section === 'movies') return { props: {} };
  const preview =
    typeof query.previewUserId === 'string'
      ? `?previewUserId=${encodeURIComponent(query.previewUserId)}`
      : '';
  return { redirect: { destination: `/for-you${preview}`, permanent: false } };
};
export default withDiscoveryPreview(ReleasePage);
