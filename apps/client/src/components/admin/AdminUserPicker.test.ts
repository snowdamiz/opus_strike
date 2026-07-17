import assert from 'node:assert/strict';
import {
  toggleAdminUserSelection,
  type AdminUserChoice,
} from './AdminUserPicker';

const alice: AdminUserChoice = {
  id: 'user-alice',
  name: 'Alice',
  walletAddress: 'alice-wallet',
};
const bob: AdminUserChoice = {
  id: 'user-bob',
  name: 'Bob',
  walletAddress: null,
};

const empty: AdminUserChoice[] = [];
const withAlice = toggleAdminUserSelection(empty, alice);
assert.deepEqual(withAlice, [alice], 'clicking an unselected player selects them');
assert.deepEqual(empty, [], 'selection updates do not mutate the previous array');

const withBoth = toggleAdminUserSelection(withAlice, bob);
assert.deepEqual(withBoth, [alice, bob], 'multiple players can be selected');

const withoutAlice = toggleAdminUserSelection(withBoth, {
  ...alice,
  name: 'Alice Renamed',
});
assert.deepEqual(withoutAlice, [bob], 'clicking a selected player removes them by stable id');
assert.deepEqual(withBoth, [alice, bob], 'removal does not mutate the previous array');

console.log('admin user picker tests passed');
