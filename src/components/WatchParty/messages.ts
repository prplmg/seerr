import { useIntl } from 'react-intl';

// All Spanish regional variants intentionally share this feature's copy.
export function usePartyText() {
  const { locale } = useIntl();
  const es = /^es(?:-|$)/i.test(locale);
  return (english: string, spanish: string) => (es ? spanish : english);
}
