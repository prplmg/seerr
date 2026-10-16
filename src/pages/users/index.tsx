import UserDirectory from '@app/components/UserDirectory';
import UserList from '@app/components/UserList';
import { Permission, useUser } from '@app/hooks/useUser';
import type { NextPage } from 'next';

const UsersPage: NextPage = () => {
  const { hasPermission } = useUser();
  return hasPermission(Permission.MANAGE_USERS) ? (
    <UserList />
  ) : (
    <UserDirectory />
  );
};

export default UsersPage;
