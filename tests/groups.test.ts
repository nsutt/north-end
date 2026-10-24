import { after, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { GroupRole, MembershipStatus } from '@prisma/client';
import { closeDatabase, createGroup, createUser, executeError, executeOk, prisma, resetDatabase } from './helpers';

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
