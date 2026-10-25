import { after, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { GroupRole, MembershipStatus } from '@prisma/client';
import { closeDatabase, createGroup, createLifeScore, createUser, executeError, executeOk, prisma, resetDatabase } from './helpers';

beforeEach(resetDatabase);
after(closeDatabase);

const UPDATE_GROUP = `#graphql
  mutation ($id: ID!, $name: String!) { updateGroup(id: $id, name: $name) { id name } }
`;
const DELETE_GROUP = `#graphql
  mutation ($id: ID!) { deleteGroup(id: $id) }
`;
const REMOVE_FROM_GROUP = `#graphql
  mutation ($groupId: ID!, $userId: ID!) { removeFromGroup(groupId: $groupId, userId: $userId) }
`;
const LEAVE_GROUP = `#graphql
  mutation ($groupId: ID!) { leaveGroup(groupId: $groupId) }
`;
const JOIN_GROUP_BY_CODE = `#graphql
  mutation ($code: String!) { joinGroupByCode(code: $code) { groupId userId role status } }
`;
const CREATE_ACCOUNT_AND_JOIN = `#graphql
  mutation ($code: String!, $displayName: String!, $email: String!) {
    createAccountAndJoinGroup(code: $code, displayName: $displayName, email: $email) {
      token
      user { id displayName }
      membership { groupId role status }
    }
  }
`;

async function membershipOf(groupId: string, userId: string) {
  return await prisma.groupMembership.findUnique({ where: { groupId_userId: { groupId, userId } } });
}

describe('group owner permissions', () => {
  test('a member who is not the owner cannot rename the group', async () => {
    const owner = await createUser();
    const member = await createUser();
    const group = await createGroup(owner, [member], 'Original');

    const message = await executeError(UPDATE_GROUP, { id: group.id, name: 'Renamed' }, member);
    assert.match(message, /Only the group owner/);
    assert.equal((await prisma.group.findUniqueOrThrow({ where: { id: group.id } })).name, 'Original');
  });

  test('the owner can rename the group', async () => {
    const owner = await createUser();
    const group = await createGroup(owner, [], 'Original');
    const data = await executeOk(UPDATE_GROUP, { id: group.id, name: '  Renamed  ' }, owner);
    assert.equal(data.updateGroup.name, 'Renamed');
  });

  test('renaming requires login', async () => {
    const owner = await createUser();
    const group = await createGroup(owner);
    assert.match(await executeError(UPDATE_GROUP, { id: group.id, name: 'Renamed' }), /logged in/);
  });

  test('a non-owner cannot delete the group', async () => {
    const owner = await createUser();
    const member = await createUser();
    const outsider = await createUser();
    const group = await createGroup(owner, [member]);

    for (const user of [member, outsider]) {
      const message = await executeError(DELETE_GROUP, { id: group.id }, user);
      assert.match(message, /Only the group owner/);
    }
    assert.ok(await prisma.group.findUnique({ where: { id: group.id } }));
  });

  test('the owner can delete the group', async () => {
    const owner = await createUser();
    const group = await createGroup(owner);
    const data = await executeOk(DELETE_GROUP, { id: group.id }, owner);
    assert.equal(data.deleteGroup, true);
    assert.equal(await prisma.group.findUnique({ where: { id: group.id } }), null);
  });

  test('a non-owner cannot remove members', async () => {
    const owner = await createUser();
    const member = await createUser();
    const other = await createUser();
    const group = await createGroup(owner, [member, other]);

    const message = await executeError(REMOVE_FROM_GROUP, { groupId: group.id, userId: other.id }, member);
    assert.match(message, /Only the group owner/);
    assert.ok(await membershipOf(group.id, other.id));

    // Including the owner themselves
    await executeError(REMOVE_FROM_GROUP, { groupId: group.id, userId: owner.id }, member);
    assert.ok(await membershipOf(group.id, owner.id));
  });

  test('the owner can remove a member', async () => {
    const owner = await createUser();
    const member = await createUser();
    const group = await createGroup(owner, [member]);

    const data = await executeOk(REMOVE_FROM_GROUP, { groupId: group.id, userId: member.id }, owner);
    assert.equal(data.removeFromGroup, true);
    assert.equal(await membershipOf(group.id, member.id), null);
  });
});

describe('leaveGroup', () => {
  test('the owner cannot leave', async () => {
    const owner = await createUser();
    const group = await createGroup(owner);

    const message = await executeError(LEAVE_GROUP, { groupId: group.id }, owner);
    assert.match(message, /owner cannot leave/);
    assert.ok(await membershipOf(group.id, owner.id));
  });

  test('a member can leave', async () => {
    const owner = await createUser();
    const member = await createUser();
    const group = await createGroup(owner, [member]);

    const data = await executeOk(LEAVE_GROUP, { groupId: group.id }, member);
    assert.equal(data.leaveGroup, true);
    assert.equal(await membershipOf(group.id, member.id), null);
  });

  test('a non-member gets an error', async () => {
    const owner = await createUser();
    const outsider = await createUser();
    const group = await createGroup(owner);
    assert.match(await executeError(LEAVE_GROUP, { groupId: group.id }, outsider), /not a member/);
  });
});

describe('joinGroupByCode', () => {
  test('joins as an accepted member (code is case-insensitive)', async () => {
    const owner = await createUser();
    const joiner = await createUser();
    const group = await createGroup(owner);

    const data = await executeOk(JOIN_GROUP_BY_CODE, { code: ` ${group.inviteCode!.toUpperCase()} ` }, joiner);
    assert.deepEqual(data.joinGroupByCode, {
      groupId: group.id,
      userId: joiner.id,
      role: GroupRole.MEMBER,
      status: MembershipStatus.ACCEPTED,
    });
  });

  test('accepts a pending invite instead of duplicating it', async () => {
    const owner = await createUser();
    const invitee = await createUser();
    const group = await createGroup(owner);
    await prisma.groupMembership.create({ data: { groupId: group.id, userId: invitee.id, invitedById: owner.id } });

    const data = await executeOk(JOIN_GROUP_BY_CODE, { code: group.inviteCode }, invitee);
    assert.equal(data.joinGroupByCode.status, MembershipStatus.ACCEPTED);
    assert.equal(await prisma.groupMembership.count({ where: { groupId: group.id, userId: invitee.id } }), 1);
  });

  test('rejects an invalid code, an existing member, and signed-out callers', async () => {
    const owner = await createUser();
    const member = await createUser();
    const group = await createGroup(owner, [member]);

    assert.match(await executeError(JOIN_GROUP_BY_CODE, { code: 'no-such-code' }, member), /Invalid invite code/);
    assert.match(await executeError(JOIN_GROUP_BY_CODE, { code: group.inviteCode }, member), /already a member/);
    assert.match(await executeError(JOIN_GROUP_BY_CODE, { code: group.inviteCode }), /logged in/);
  });
});

describe('createAccountAndJoinGroup', () => {
  test('creates the user and an accepted membership', async () => {
    const owner = await createUser();
    const group = await createGroup(owner);

    const data = await executeOk(CREATE_ACCOUNT_AND_JOIN, {
      code: group.inviteCode,
      displayName: ' New Person ',
      email: 'New.Person@Example.test',
    });
    const result = data.createAccountAndJoinGroup;
    assert.ok(result.token);
    assert.equal(result.user.displayName, 'New Person');
    assert.deepEqual(result.membership, { groupId: group.id, role: GroupRole.MEMBER, status: MembershipStatus.ACCEPTED });

    const user = await prisma.user.findUniqueOrThrow({ where: { id: result.user.id } });
    assert.equal(user.email, 'new.person@example.test');
  });

  test('rejects an invalid code without creating a user', async () => {
    const message = await executeError(CREATE_ACCOUNT_AND_JOIN, {
      code: 'no-such-code',
      displayName: 'New Person',
      email: 'new@example.test',
    });
    assert.match(message, /Invalid invite code/);
    assert.equal(await prisma.user.count(), 0);
  });

  test('rejects an email that is already in use', async () => {
    const owner = await createUser({ email: 'taken@example.test' });
    const group = await createGroup(owner);
    const message = await executeError(CREATE_ACCOUNT_AND_JOIN, {
      code: group.inviteCode,
      displayName: 'Impostor',
      email: 'TAKEN@example.test',
    });
    assert.match(message, /already exists/);
  });

  test('rejects a blank display name', async () => {
    const owner = await createUser();
    const group = await createGroup(owner);
    const message = await executeError(CREATE_ACCOUNT_AND_JOIN, {
      code: group.inviteCode,
      displayName: '   ',
      email: 'new@example.test',
    });
    assert.match(message, /Display name is required/);
  });
});

describe('Query.group access', () => {
  const GROUP = `#graphql
    query ($id: ID!) { group(id: $id) { id name inviteCode members { userId } } }
  `;

  test('an accepted member can read the group, including its invite code', async () => {
    const owner = await createUser();
    const member = await createUser();
    const group = await createGroup(owner, [member]);

    for (const user of [owner, member]) {
      const data = await executeOk(GROUP, { id: group.id }, user);
      assert.equal(data.group.id, group.id);
      assert.equal(data.group.inviteCode, group.inviteCode);
    }
  });

  test('a non-member or pending invitee gets "Group not found", same as a missing group', async () => {
    const owner = await createUser();
    const outsider = await createUser();
    const invitee = await createUser();
    const group = await createGroup(owner);
    await prisma.groupMembership.create({ data: { groupId: group.id, userId: invitee.id, invitedById: owner.id } });

    for (const user of [outsider, invitee]) {
      assert.match(await executeError(GROUP, { id: group.id }, user), /^Group not found$/);
    }
    assert.match(
      await executeError(GROUP, { id: '00000000-0000-0000-0000-000000000000' }, outsider),
      /^Group not found$/
    );
  });

  test('requires login', async () => {
    const owner = await createUser();
    const group = await createGroup(owner);
    assert.match(await executeError(GROUP, { id: group.id }), /logged in/);
  });
});

describe('Group.inviteCode', () => {
  test('is null for a pending invitee (via myPendingGroupInvites)', async () => {
    const owner = await createUser();
    const invitee = await createUser();
    const group = await createGroup(owner, [], 'Invited');
    await prisma.groupMembership.create({ data: { groupId: group.id, userId: invitee.id, invitedById: owner.id } });

    const data = await executeOk(`{ myPendingGroupInvites { group { id name memberCount inviteCode } } }`, {}, invitee);
    assert.deepEqual(data.myPendingGroupInvites, [{ group: { id: group.id, name: 'Invited', memberCount: 1, inviteCode: null } }]);
  });

  test('is visible to members through myGroups and generateGroupInviteCode', async () => {
    const owner = await createUser();
    const member = await createUser();
    const group = await createGroup(owner, [member]);

    const mine = await executeOk(`{ myGroups { id inviteCode } }`, {}, member);
    assert.deepEqual(mine.myGroups, [{ id: group.id, inviteCode: group.inviteCode }]);

    const generated = await executeOk(
      `mutation ($groupId: ID!) { generateGroupInviteCode(groupId: $groupId) { inviteCode } }`,
      { groupId: group.id },
      member
    );
    assert.ok(generated.generateGroupInviteCode.inviteCode);
  });

  test('a member of one group cannot reach another group (or its code) through a vibe', async () => {
    const author = await createUser();
    const viewer = await createUser();
    const shared = await createGroup(author, [viewer], 'Shared');
    const privateGroup = await createGroup(author, [], 'Private');
    const vibe = await createLifeScore(author, [shared.id, privateGroup.id]);

    const query = `query ($id: ID!) { lifeScore(id: $id) { groups { id inviteCode } } }`;
    const seen = await executeOk(query, { id: vibe.id }, viewer);
    assert.deepEqual(seen.lifeScore.groups, [{ id: shared.id, inviteCode: shared.inviteCode }]);

    // The author sees every group they posted to
    const own = await executeOk(query, { id: vibe.id }, author);
    assert.deepEqual(own.lifeScore.groups.map((g: { id: string }) => g.id).sort(), [shared.id, privateGroup.id].sort());
  });
});

describe('User.groups and User.pendingGroupInvites', () => {
  const FIELDS = 'id groups { id } pendingGroupInvites { groupId status }';

  test('resolve for the user themselves', async () => {
    const owner = await createUser();
    const alice = await createUser();
    const joined = await createGroup(owner, [alice]);
    const pending = await createGroup(owner);
    await prisma.groupMembership.create({ data: { groupId: pending.id, userId: alice.id, invitedById: owner.id } });

    const data = await executeOk(`{ me { ${FIELDS} } }`, {}, alice);
    assert.deepEqual(data.me.groups, [{ id: joined.id }]);
    assert.deepEqual(data.me.pendingGroupInvites, [{ groupId: pending.id, status: MembershipStatus.PENDING }]);
  });

  test('are empty when looking at someone else', async () => {
    const owner = await createUser();
    const alice = await createUser();
    const bob = await createUser();
    await createGroup(owner, [alice, bob]);
    const pending = await createGroup(owner);
    await prisma.groupMembership.create({ data: { groupId: pending.id, userId: alice.id, invitedById: owner.id } });

    const data = await executeOk(`query ($id: ID!) { user(id: $id) { ${FIELDS} } }`, { id: alice.id }, bob);
    assert.deepEqual(data.user, { id: alice.id, groups: [], pendingGroupInvites: [] });
  });
});

describe('Group fields for pending invitees', () => {
  const PENDING = `#graphql
    {
      myPendingGroupInvites {
        id groupId invitedBy { id displayName }
        group {
          id name memberCount inviteCode myRole
          members { userId }
          recentActivity { score }
          myLatestScore { id }
          unreadCommentCount
          createdBy { id displayName email uniqueCode features lifeScores { id } currentScore { id } groups { id } }
        }
      }
    }
  `;

  test('see only the invite preview (id, name, memberCount, inviter)', async () => {
    const owner = await createUser({ displayName: 'Owner', email: 'owner@example.test', features: ['can-logout'] });
    const member = await createUser();
    const invitee = await createUser();
    const group = await createGroup(owner, [member], 'Secret Club');
    const vibe = await createLifeScore(owner, [group.id]);
    await prisma.scoreComment.create({ data: { lifeScoreId: vibe.id, groupId: group.id, authorId: member.id, content: 'hi' } });
    const invite = await prisma.groupMembership.create({ data: { groupId: group.id, userId: invitee.id, invitedById: owner.id } });

    const data = await executeOk(PENDING, {}, invitee);
    assert.deepEqual(data.myPendingGroupInvites, [
      {
        id: invite.id,
        groupId: group.id,
        invitedBy: { id: owner.id, displayName: 'Owner' },
        group: {
          id: group.id,
          name: 'Secret Club',
          memberCount: 2,
          inviteCode: null,
          myRole: null,
          members: [],
          recentActivity: null,
          myLatestScore: null,
          unreadCommentCount: 0,
          createdBy: {
            id: owner.id,
            displayName: 'Owner',
            email: null,
            uniqueCode: null,
            features: [],
            lifeScores: [],
            currentScore: null,
            groups: [],
          },
        },
      },
    ]);
  });

  test('the same fields resolve once the invite is accepted', async () => {
    const owner = await createUser();
    const invitee = await createUser();
    const group = await createGroup(owner);
    await createLifeScore(owner, [group.id], { score: 4 });
    await prisma.groupMembership.create({ data: { groupId: group.id, userId: invitee.id, invitedById: owner.id } });

    const accepted = await executeOk(
      `mutation ($groupId: ID!) { acceptGroupInvite(groupId: $groupId) { group { members { userId } recentActivity { score } } } }`,
      { groupId: group.id },
      invitee
    );
    assert.equal(accepted.acceptGroupInvite.group.members.length, 2);
    assert.deepEqual(accepted.acceptGroupInvite.group.recentActivity, { score: 4 });
  });
});
