import AnalyticsTestSelector from '@app/components/AnalyticsTrial/TestSelector';
import UserSettings from '@app/components/UserProfile/UserSettings';
import UserGeneralSettings from '@app/components/UserProfile/UserSettings/UserGeneralSettings';
import type { NextPage } from 'next';

const UserSettingsPage: NextPage = () => {
  return (
    <UserSettings>
      <AnalyticsTestSelector />
      <UserGeneralSettings />
    </UserSettings>
  );
};

export default UserSettingsPage;
