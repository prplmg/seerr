import useSettings from '@app/hooks/useSettings';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect } from 'react';

interface PageTitleProps {
  title: string | (string | undefined)[];
}

const PageTitle = ({ title }: PageTitleProps) => {
  const settings = useSettings();
  const router = useRouter();
  const label = Array.isArray(title)
    ? title.filter(Boolean).join(' - ')
    : title;
  useEffect(() => {
    const path = router.asPath.split(/[?#]/)[0];
    const prefix = path.startsWith('/movie/')
      ? 'Movie: '
      : path.startsWith('/tv/')
        ? 'Series: '
        : path.startsWith('/lists/')
          ? 'List: '
          : '';
    document.documentElement.dataset.analyticsPath = path;
    document.documentElement.dataset.analyticsTitle = prefix + label;
    window.dispatchEvent(new Event('catalogue-page-ready'));
  }, [label, router.asPath]);

  const titleText = `${
    Array.isArray(title) ? title.filter(Boolean).join(' - ') : title
  } - ${settings.currentSettings.applicationTitle}`;

  return (
    <Head>
      <title>{titleText}</title>
    </Head>
  );
};

export default PageTitle;
