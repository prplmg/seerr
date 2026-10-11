import SettingsLayout from '@app/components/Settings/SettingsLayout';
import WatchPartyActivity from '@app/components/Settings/WatchPartyActivity';
import useRouteGuard from '@app/hooks/useRouteGuard';
import { Permission } from '@app/hooks/useUser';

export default function WatchPartyActivityPage() {
  useRouteGuard(Permission.ADMIN);
  return (
    <SettingsLayout>
      <WatchPartyActivity />
    </SettingsLayout>
  );
}
