import { after, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { User } from '@prisma/client';
import { closeDatabase, createUser, executeError, executeOk, prisma, resetDatabase } from './helpers';

beforeEach(resetDatabase);
after(closeDatabase);

const INVITES = `#graphql
  { invites { id code createdBy { id } } }
`;
const INVITE = `#graphql
  query ($code: String!) { invite(code: $code) { id code useCount usedBy { id } createdBy { id displayName } } }
`;
const DELETE_INVITE = `#graphql
  mutation ($id: ID!) { deleteInvite(id: $id) }
`;

let inviteCounter = 0;
async function createInvite(creator: User) {
  inviteCounter += 1;
  return await prisma.invite.create({ data: { code: `signup-${process.pid}-${inviteCounter}`, createdById: creator.id } });
}

describe('Query.invites', () => {
  test("returns only the caller's own invites", async () => {
    const alice = await createUser();
    const bob = await createUser();
    const mine = await createInvite(alice);
    await createInvite(bob);

    const data = await executeOk(INVITES, {}, alice);
    assert.deepEqual(data.invites, [{ id: mine.id, code: mine.code, createdBy: { id: alice.id } }]);
  });

  test('requires login', async () => {
    assert.match(await executeError(INVITES), /logged in/);
  });
});

describe('Query.invite (public claim flow)', () => {
  test('anyone can look up an invite by code, but only its creator sees who used it', async () => {
    const creator = await createUser();
    const invite = await createInvite(creator);
    const claimer = await prisma.user.create({ data: { displayName: 'Claimer', usedInviteId: invite.id } });
    const stranger = await createUser();

    for (const viewer of [null, stranger, claimer]) {
      const data = await executeOk(INVITE, { code: invite.code.toUpperCase() }, viewer);
      assert.equal(data.invite.id, invite.id);
      assert.equal(data.invite.useCount, 1);
      assert.equal(data.invite.createdBy.id, creator.id);
      assert.deepEqual(data.invite.usedBy, [], `usedBy leaked to ${viewer?.displayName ?? 'signed-out'}`);
    }

    const own = await executeOk(INVITE, { code: invite.code }, creator);
    assert.deepEqual(own.invite.usedBy, [{ id: claimer.id }]);
  });
});

describe('deleteInvite', () => {
  test("can't delete someone else's invite", async () => {
    const alice = await createUser();
    const mallory = await createUser();
    const invite = await createInvite(alice);

    assert.match(await executeError(DELETE_INVITE, { id: invite.id }, mallory), /only delete your own invites/);
    assert.ok(await prisma.invite.findUnique({ where: { id: invite.id } }));
  });

  test('the creator can delete their invite', async () => {
    const alice = await createUser();
    const invite = await createInvite(alice);

    const data = await executeOk(DELETE_INVITE, { id: invite.id }, alice);
    assert.equal(data.deleteInvite, true);
    assert.equal(await prisma.invite.findUnique({ where: { id: invite.id } }), null);
  });

  test('an unknown id and signed-out callers are rejected', async () => {
    const alice = await createUser();
    const invite = await createInvite(alice);
    assert.match(
      await executeError(DELETE_INVITE, { id: '00000000-0000-0000-0000-000000000000' }, alice),
      /Invite not found/
    );
    assert.match(await executeError(DELETE_INVITE, { id: invite.id }), /logged in/);
    assert.ok(await prisma.invite.findUnique({ where: { id: invite.id } }));
  });
});

describe('User.invites and User.usedInvite', () => {
  test('are only visible to the user themselves', async () => {
    const alice = await createUser();
    const bob = await createUser();
    const invite = await createInvite(alice);
    const aliceUsed = await createInvite(bob);
    await prisma.user.update({ where: { id: alice.id }, data: { usedInviteId: aliceUsed.id } });

    const fields = 'id invites { id } usedInvite { id code }';
    const mine = await executeOk(`{ me { ${fields} } }`, {}, alice);
    assert.deepEqual(mine.me.invites, [{ id: invite.id }]);
    assert.deepEqual(mine.me.usedInvite, { id: aliceUsed.id, code: aliceUsed.code });

    const theirs = await executeOk(`query ($id: ID!) { user(id: $id) { ${fields} } }`, { id: alice.id }, bob);
    assert.deepEqual(theirs.user, { id: alice.id, invites: [], usedInvite: null });
  });
});
