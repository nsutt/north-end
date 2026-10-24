import { after, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeDatabase, createUser, execute, executeError, executeOk, prisma, resetDatabase } from './helpers';

const UPDATE_USER = `#graphql
  mutation ($id: ID!, $input: UpdateUserInput!) {
    updateUser(id: $id, input: $input) { id displayName }
  }
`;

const DELETE_USER = `#graphql
  mutation ($id: ID!) { deleteUser(id: $id) }
`;

beforeEach(resetDatabase);
after(closeDatabase);

describe('updateUser', () => {
  test('requires login', async () => {
    const alice = await createUser();
    const message = await executeError(UPDATE_USER, { id: alice.id, input: { displayName: 'Hacked' } });
    assert.match(message, /logged in/);
  });

  test("rejects updating someone else's profile", async () => {
    const alice = await createUser({ displayName: 'Alice' });
    const mallory = await createUser();

    const message = await executeError(UPDATE_USER, { id: alice.id, input: { displayName: 'Hacked' } }, mallory);
    assert.match(message, /only update your own profile/);

    const unchanged = await prisma.user.findUniqueOrThrow({ where: { id: alice.id } });
    assert.equal(unchanged.displayName, 'Alice');
  });

  test('allows updating your own profile', async () => {
    const alice = await createUser({ displayName: 'Alice' });
    const data = await executeOk(UPDATE_USER, { id: alice.id, input: { displayName: 'Alice B' } }, alice);
    assert.equal(data.updateUser.displayName, 'Alice B');
  });
});

describe('deleteUser', () => {
  test('requires login', async () => {
    const alice = await createUser();
    const message = await executeError(DELETE_USER, { id: alice.id });
    assert.match(message, /logged in/);
    assert.ok(await prisma.user.findUnique({ where: { id: alice.id } }));
  });

  test("rejects deleting someone else's account", async () => {
    const alice = await createUser();
    const mallory = await createUser();

    const message = await executeError(DELETE_USER, { id: alice.id }, mallory);
    assert.match(message, /only delete your own account/);
    assert.ok(await prisma.user.findUnique({ where: { id: alice.id } }));
  });

  test('allows deleting your own account', async () => {
    const alice = await createUser();
    const data = await executeOk(DELETE_USER, { id: alice.id }, alice);
    assert.equal(data.deleteUser, true);
    assert.equal(await prisma.user.findUnique({ where: { id: alice.id } }), null);
  });

  test('an unrelated feature flag does not grant deleting others', async () => {
    const alice = await createUser();
    const mallory = await createUser({ features: ['some-other-feature'] });

    await executeError(DELETE_USER, { id: alice.id }, mallory);
    assert.ok(await prisma.user.findUnique({ where: { id: alice.id } }));
  });

  test('the can-delete-any-user feature allows deleting others', async () => {
    const alice = await createUser();
    const admin = await createUser({ features: ['can-delete-any-user'] });

    const data = await executeOk(DELETE_USER, { id: alice.id }, admin);
    assert.equal(data.deleteUser, true);
    assert.equal(await prisma.user.findUnique({ where: { id: alice.id } }), null);
  });
});

describe('User field privacy', () => {
  // TODO(privacy): enable once the User field privacy fix (src/resolvers/user.ts) is merged.
  test.skip('TODO: User.uniqueCode and User.email are only visible to the user themselves', async () => {
    const alice = await createUser({ email: 'alice@example.test' });
    const bob = await createUser();
    const fields = 'id email uniqueCode';

    // The user themselves can see both
    const mine = await executeOk(`{ me { ${fields} } }`, {}, alice);
    assert.equal(mine.me.email, 'alice@example.test');
    assert.equal(mine.me.uniqueCode, alice.uniqueCode);

    // Nobody else can, signed in or not, through any query that returns users
    for (const viewer of [bob, null]) {
      for (const query of [`{ user(id: "${alice.id}") { ${fields} } }`, `{ users { ${fields} } }`]) {
        const result = await execute(query, {}, viewer);
        const users = [result.data?.user, ...((result.data?.users as any[]) ?? [])].filter(Boolean);
        for (const user of users.filter((u: any) => u.id === alice.id)) {
          assert.notEqual(user.email, 'alice@example.test', `email leaked via ${query}`);
          assert.notEqual(user.uniqueCode, alice.uniqueCode, `uniqueCode leaked via ${query}`);
        }
      }
    }
  });
});
