import { after, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { GroupRole, MembershipStatus } from '@prisma/client';
import {
  closeDatabase,
  createGroup,
  createLifeScore,
  createUser,
  execute,
  executeError,
  executeOk,
  prisma,
  resetDatabase,
} from './helpers';

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
  test('User.uniqueCode and User.email are only visible to the user themselves', async () => {
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

describe('deleteUser cleanup', () => {
  const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000);

  test('hands a group to the longest-standing accepted member', async () => {
    const owner = await createUser();
    const veteran = await createUser();
    const newcomer = await createUser();
    const invitee = await createUser();
    const group = await createGroup(owner, [newcomer, veteran]);
    await prisma.groupMembership.update({
      where: { groupId_userId: { groupId: group.id, userId: veteran.id } },
      data: { joinedAt: minutesAgo(60) },
    });
    await prisma.groupMembership.update({
      where: { groupId_userId: { groupId: group.id, userId: newcomer.id } },
      data: { joinedAt: minutesAgo(5) },
    });
    // A pending invite created long ago doesn't count (it isn't an accepted member)
    await prisma.groupMembership.create({
      data: { groupId: group.id, userId: invitee.id, invitedById: owner.id, createdAt: minutesAgo(600) },
    });
    const vibe = await createLifeScore(veteran, [group.id]);

    await executeOk(DELETE_USER, { id: owner.id }, owner);

    const after = await prisma.group.findUniqueOrThrow({ where: { id: group.id }, include: { memberships: true } });
    assert.equal(after.createdById, veteran.id);
    const roles = Object.fromEntries(after.memberships.map((m) => [m.userId, [m.role, m.status]]));
    assert.deepEqual(roles, {
      [veteran.id]: [GroupRole.OWNER, MembershipStatus.ACCEPTED],
      [newcomer.id]: [GroupRole.MEMBER, MembershipStatus.ACCEPTED],
      [invitee.id]: [GroupRole.MEMBER, MembershipStatus.PENDING],
    });
    // The invite the old owner sent survives without an inviter
    assert.equal(after.memberships.find((m) => m.userId === invitee.id)!.invitedById, null);
    // Members' vibes stay in the group
    assert.equal(await prisma.lifeScoreGroup.count({ where: { groupId: group.id, lifeScoreId: vibe.id } }), 1);

    // The new owner can now manage the group
    const renamed = await executeOk(
      `mutation ($id: ID!) { updateGroup(id: $id, name: "Renamed") { name } }`,
      { id: group.id },
      veteran
    );
    assert.equal(renamed.updateGroup.name, 'Renamed');
  });

  test('breaks a joinedAt tie by membership creation time', async () => {
    const owner = await createUser();
    const first = await createUser();
    const second = await createUser();
    const group = await createGroup(owner);
    const joinedAt = minutesAgo(30);
    await prisma.groupMembership.create({
      data: { groupId: group.id, userId: second.id, status: MembershipStatus.ACCEPTED, joinedAt, createdAt: minutesAgo(40) },
    });
    await prisma.groupMembership.create({
      data: { groupId: group.id, userId: first.id, status: MembershipStatus.ACCEPTED, joinedAt, createdAt: minutesAgo(50) },
    });

    await executeOk(DELETE_USER, { id: owner.id }, owner);
    assert.equal((await prisma.group.findUniqueOrThrow({ where: { id: group.id } })).createdById, first.id);
  });

  test('deletes groups with no other accepted members, and everything in them', async () => {
    const owner = await createUser();
    const invitee = await createUser();
    const solo = await createGroup(owner);
    await prisma.groupMembership.create({ data: { groupId: solo.id, userId: invitee.id, invitedById: owner.id } });
    const vibe = await createLifeScore(owner, [solo.id]);
    await prisma.scoreComment.create({ data: { lifeScoreId: vibe.id, groupId: solo.id, authorId: owner.id, content: 'hi' } });
    await prisma.scoreCommentRead.create({ data: { userId: invitee.id, lifeScoreId: vibe.id, groupId: solo.id } });

    await executeOk(DELETE_USER, { id: owner.id }, owner);

    assert.equal(await prisma.group.findUnique({ where: { id: solo.id } }), null);
    assert.equal(await prisma.groupMembership.count({ where: { groupId: solo.id } }), 0);
    assert.equal(await prisma.scoreCommentRead.count(), 0);
    assert.ok(await prisma.user.findUnique({ where: { id: invitee.id } }));
  });

  test("deletes the user's own content and memberships in other people's groups", async () => {
    const alice = await createUser();
    const bob = await createUser();
    const bobsGroup = await createGroup(bob, [alice]);
    const aliceVibe = await createLifeScore(alice, [bobsGroup.id]);
    const bobVibe = await createLifeScore(bob, [bobsGroup.id]);
    await prisma.scoreComment.create({ data: { lifeScoreId: bobVibe.id, groupId: bobsGroup.id, authorId: alice.id, content: 'hey' } });
    await prisma.scoreReaction.create({ data: { lifeScoreId: bobVibe.id, groupId: bobsGroup.id, userId: alice.id, emoji: '🔥' } });
    await prisma.deviceToken.create({ data: { token: `token-${alice.id}`, userId: alice.id } });
    await prisma.scoreCommentRead.create({ data: { userId: alice.id, lifeScoreId: bobVibe.id, groupId: bobsGroup.id } });

    await executeOk(DELETE_USER, { id: alice.id }, alice);

    assert.equal(await prisma.lifeScore.findUnique({ where: { id: aliceVibe.id } }), null);
    assert.equal(await prisma.scoreComment.count({ where: { authorId: alice.id } }), 0);
    assert.equal(await prisma.scoreReaction.count({ where: { userId: alice.id } }), 0);
    assert.equal(await prisma.deviceToken.count({ where: { userId: alice.id } }), 0);
    assert.equal(await prisma.groupMembership.count({ where: { userId: alice.id } }), 0);
    assert.equal(await prisma.scoreCommentRead.count({ where: { userId: alice.id } }), 0);
    // Bob's group and vibe are untouched
    assert.equal((await prisma.group.findUniqueOrThrow({ where: { id: bobsGroup.id } })).createdById, bob.id);
    assert.ok(await prisma.lifeScore.findUnique({ where: { id: bobVibe.id } }));
  });

  test('works for a user who created sign-up invites (people who used them keep their accounts)', async () => {
    const alice = await createUser();
    const invite = await prisma.invite.create({ data: { code: `signup-${alice.id}`, createdById: alice.id } });
    const claimer = await prisma.user.create({ data: { displayName: 'Claimer', usedInviteId: invite.id } });

    const data = await executeOk(DELETE_USER, { id: alice.id }, alice);
    assert.equal(data.deleteUser, true);
    assert.equal(await prisma.user.findUnique({ where: { id: alice.id } }), null);
    assert.equal(await prisma.invite.count(), 0);
    const remaining = await prisma.user.findUniqueOrThrow({ where: { id: claimer.id } });
    assert.equal(remaining.usedInviteId, null);
  });

  test('an admin with can-delete-any-user can delete a group owner too', async () => {
    const owner = await createUser();
    const member = await createUser();
    const admin = await createUser({ features: ['can-delete-any-user'] });
    const group = await createGroup(owner, [member]);

    await executeOk(DELETE_USER, { id: owner.id }, admin);
    assert.equal((await prisma.group.findUniqueOrThrow({ where: { id: group.id } })).createdById, member.id);
  });
});
