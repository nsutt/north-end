import { after, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  closeDatabase,
  createGroup,
  createLifeScore,
  createUser,
  executeError,
  executeOk,
  prisma,
  resetDatabase,
} from './helpers';

beforeEach(resetDatabase);
after(closeDatabase);

const ADD_COMMENT = `#graphql
  mutation ($lifeScoreId: ID!, $groupId: ID!, $content: String!, $gifUrl: String) {
    addScoreComment(lifeScoreId: $lifeScoreId, groupId: $groupId, content: $content, gifUrl: $gifUrl) {
      id content gifUrl
    }
  }
`;
const SCORE_COMMENTS = `#graphql
  query ($lifeScoreId: ID!, $groupId: ID!) { scoreComments(lifeScoreId: $lifeScoreId, groupId: $groupId) { id } }
`;
const TOGGLE_SCORE_REACTION = `#graphql
  mutation ($lifeScoreId: ID!, $groupId: ID!, $emoji: String!) {
    toggleScoreReaction(lifeScoreId: $lifeScoreId, groupId: $groupId, emoji: $emoji) { action }
  }
`;
const TOGGLE_COMMENT_REACTION = `#graphql
  mutation ($commentId: ID!, $emoji: String!) {
    toggleCommentReaction(commentId: $commentId, emoji: $emoji) { action }
  }
`;

/** Owner + member in a group, a vibe by the owner shared with it, and an outsider. */
async function setup() {
  const owner = await createUser();
  const member = await createUser();
  const outsider = await createUser();
  const group = await createGroup(owner, [member]);
  const vibe = await createLifeScore(owner, [group.id]);
  return { owner, member, outsider, group, vibe };
}

describe('addScoreComment', () => {
  test("a non-member can't comment on a group's vibe", async () => {
    const { outsider, group, vibe } = await setup();
    const message = await executeError(ADD_COMMENT, { lifeScoreId: vibe.id, groupId: group.id, content: 'hi' }, outsider);
    assert.match(message, /must be a member/);
    assert.equal(await prisma.scoreComment.count(), 0);
  });

  test("a member of a different group can't comment by passing their own group's id", async () => {
    const { vibe } = await setup();
    const outsider = await createUser();
    const otherGroup = await createGroup(outsider);

    const message = await executeError(ADD_COMMENT, { lifeScoreId: vibe.id, groupId: otherGroup.id, content: 'hi' }, outsider);
    assert.match(message, /not posted to this group/);
    assert.equal(await prisma.scoreComment.count(), 0);
  });

  test('a pending (not yet accepted) invitee cannot comment', async () => {
    const { owner, outsider, group, vibe } = await setup();
    await prisma.groupMembership.create({ data: { groupId: group.id, userId: outsider.id, invitedById: owner.id } });

    const message = await executeError(ADD_COMMENT, { lifeScoreId: vibe.id, groupId: group.id, content: 'hi' }, outsider);
    assert.match(message, /must be a member/);
  });

  test('requires login', async () => {
    const { group, vibe } = await setup();
    assert.match(await executeError(ADD_COMMENT, { lifeScoreId: vibe.id, groupId: group.id, content: 'hi' }), /logged in/);
  });

  test('a member can comment, with a Giphy GIF', async () => {
    const { member, group, vibe } = await setup();
    const gifUrl = 'https://media2.giphy.com/media/abc/giphy.gif';
    const data = await executeOk(ADD_COMMENT, { lifeScoreId: vibe.id, groupId: group.id, content: '  nice  ', gifUrl }, member);
    assert.equal(data.addScoreComment.content, 'nice');
    assert.equal(data.addScoreComment.gifUrl, gifUrl);
  });

  test('rejects GIFs that are not from Giphy', async () => {
    const { member, group, vibe } = await setup();
    for (const gifUrl of [
      'https://evil.example/giphy.gif',
      'http://media.giphy.com/media/abc/giphy.gif',
      'https://media.giphy.com.evil.example/x.gif',
      'javascript:alert(1)',
    ]) {
      const message = await executeError(ADD_COMMENT, { lifeScoreId: vibe.id, groupId: group.id, content: 'x', gifUrl }, member);
      assert.match(message, /GIF must be from Giphy/, gifUrl);
    }
    assert.equal(await prisma.scoreComment.count(), 0);
  });

  test('rejects comments over 500 characters, and empty comments', async () => {
    const { member, group, vibe } = await setup();
    const vars = { lifeScoreId: vibe.id, groupId: group.id };

    assert.match(await executeError(ADD_COMMENT, { ...vars, content: 'a'.repeat(501) }, member), /500 characters/);
    assert.match(await executeError(ADD_COMMENT, { ...vars, content: '   ' }, member), /content or a GIF/);
    await executeOk(ADD_COMMENT, { ...vars, content: 'a'.repeat(500) }, member);
    assert.equal(await prisma.scoreComment.count(), 1);
  });
});

describe('scoreComments', () => {
  test("a non-member can't read a group's comments", async () => {
    const { member, outsider, group, vibe } = await setup();
    await executeOk(ADD_COMMENT, { lifeScoreId: vibe.id, groupId: group.id, content: 'secret' }, member);

    const message = await executeError(SCORE_COMMENTS, { lifeScoreId: vibe.id, groupId: group.id }, outsider);
    assert.match(message, /must be a member/);

    const data = await executeOk(SCORE_COMMENTS, { lifeScoreId: vibe.id, groupId: group.id }, member);
    assert.equal(data.scoreComments.length, 1);
  });
});

describe('reactions', () => {
  test("a non-member can't react to a group's vibe", async () => {
    const { outsider, group, vibe } = await setup();
    const message = await executeError(TOGGLE_SCORE_REACTION, { lifeScoreId: vibe.id, groupId: group.id, emoji: '🔥' }, outsider);
    assert.match(message, /must be a member/);
    assert.equal(await prisma.scoreReaction.count(), 0);
  });

  test('a member can react and toggle the reaction off', async () => {
    const { member, group, vibe } = await setup();
    const vars = { lifeScoreId: vibe.id, groupId: group.id, emoji: '🔥' };
    assert.equal((await executeOk(TOGGLE_SCORE_REACTION, vars, member)).toggleScoreReaction.action, 'ADDED');
    assert.equal((await executeOk(TOGGLE_SCORE_REACTION, vars, member)).toggleScoreReaction.action, 'REMOVED');
  });

  test("a non-member can't react to a comment in a group", async () => {
    const { member, outsider, group, vibe } = await setup();
    const { addScoreComment } = await executeOk(ADD_COMMENT, { lifeScoreId: vibe.id, groupId: group.id, content: 'hi' }, member);

    const message = await executeError(TOGGLE_COMMENT_REACTION, { commentId: addScoreComment.id, emoji: '👍' }, outsider);
    assert.match(message, /must be a member/);
    assert.equal(await prisma.commentReaction.count(), 0);

    const data = await executeOk(TOGGLE_COMMENT_REACTION, { commentId: addScoreComment.id, emoji: '👍' }, member);
    assert.equal(data.toggleCommentReaction.action, 'ADDED');
  });

  test('reactions require login', async () => {
    const { group, vibe } = await setup();
    const message = await executeError(TOGGLE_SCORE_REACTION, { lifeScoreId: vibe.id, groupId: group.id, emoji: '🔥' });
    assert.match(message, /logged in/);
  });
});

describe('markCommentsRead', () => {
  const MARK_READ = `#graphql
    mutation ($lifeScoreId: ID!, $groupId: ID!) { markCommentsRead(lifeScoreId: $lifeScoreId, groupId: $groupId) }
  `;

  test('a member of the group can mark comments read', async () => {
    const { member, group, vibe } = await setup();
    const data = await executeOk(MARK_READ, { lifeScoreId: vibe.id, groupId: group.id }, member);
    assert.equal(data.markCommentsRead, true);
    assert.equal(await prisma.scoreCommentRead.count({ where: { userId: member.id } }), 1);
  });

  test('the vibe owner can mark comments read', async () => {
    const { owner, group, vibe } = await setup();
    await executeOk(MARK_READ, { lifeScoreId: vibe.id, groupId: group.id }, owner);
    assert.equal(await prisma.scoreCommentRead.count({ where: { userId: owner.id } }), 1);
  });

  test('a non-member or pending invitee cannot', async () => {
    const { owner, outsider, group, vibe } = await setup();
    const invitee = await createUser();
    await prisma.groupMembership.create({ data: { groupId: group.id, userId: invitee.id, invitedById: owner.id } });

    for (const user of [outsider, invitee]) {
      const message = await executeError(MARK_READ, { lifeScoreId: vibe.id, groupId: group.id }, user);
      assert.match(message, /must be a member/);
    }
    assert.equal(await prisma.scoreCommentRead.count(), 0);
  });

  test("the vibe must have been posted to the group (even the caller's own group)", async () => {
    const { vibe } = await setup();
    const outsider = await createUser();
    const otherGroup = await createGroup(outsider);

    const message = await executeError(MARK_READ, { lifeScoreId: vibe.id, groupId: otherGroup.id }, outsider);
    assert.match(message, /not posted to this group/);
    assert.equal(await prisma.scoreCommentRead.count(), 0);
  });

  test('an unknown vibe and signed-out callers are rejected', async () => {
    const { member, group } = await setup();
    const unknown = '00000000-0000-0000-0000-000000000000';
    assert.match(await executeError(MARK_READ, { lifeScoreId: unknown, groupId: group.id }, member), /not found/);
    assert.match(await executeError(MARK_READ, { lifeScoreId: unknown, groupId: group.id }), /logged in/);
  });
});

describe('per-group vibe fields', () => {
  /**
   * A vibe by `owner` posted to groups A and B. `viewer` is only in A, and also in C
   * (which the vibe was not posted to). Each of A and B has a comment and a reaction.
   */
  async function twoGroups() {
    const owner = await createUser();
    const viewer = await createUser();
    const bMember = await createUser();
    const groupA = await createGroup(owner, [viewer], 'A');
    const groupB = await createGroup(owner, [bMember], 'B');
    const groupC = await createGroup(viewer, [], 'C');
    const vibe = await createLifeScore(owner, [groupA.id, groupB.id]);

    const inA = await prisma.scoreComment.create({ data: { lifeScoreId: vibe.id, groupId: groupA.id, authorId: owner.id, content: 'in A' } });
    const inB = await prisma.scoreComment.create({ data: { lifeScoreId: vibe.id, groupId: groupB.id, authorId: bMember.id, content: 'in B' } });
    await prisma.scoreReaction.create({ data: { lifeScoreId: vibe.id, groupId: groupA.id, userId: viewer.id, emoji: '🔥' } });
    await prisma.scoreReaction.create({ data: { lifeScoreId: vibe.id, groupId: groupB.id, userId: bMember.id, emoji: '😢' } });
    // A reaction the viewer left in B before being removed from it
    await prisma.scoreReaction.create({ data: { lifeScoreId: vibe.id, groupId: groupB.id, userId: viewer.id, emoji: '👀' } });

    return { owner, viewer, bMember, groupA, groupB, groupC, vibe, inA, inB };
  }

  const PER_GROUP = `#graphql
    query ($id: ID!, $groupId: ID!) {
      lifeScore(id: $id) {
        comments(groupId: $groupId) { id }
        commentCount(groupId: $groupId)
        unreadCommentCount(groupId: $groupId)
        latestComment(groupId: $groupId) { id }
        reactionSummary(groupId: $groupId) { emoji count users { id } }
        myReaction(groupId: $groupId) { emoji }
      }
    }
  `;
  const EMPTY = { comments: [], commentCount: 0, unreadCommentCount: 0, latestComment: null, reactionSummary: [], myReaction: null };

  test("a member sees their group's comments and reactions", async () => {
    const { viewer, groupA, vibe, inA } = await twoGroups();
    const data = await executeOk(PER_GROUP, { id: vibe.id, groupId: groupA.id }, viewer);
    assert.deepEqual(data.lifeScore, {
      comments: [{ id: inA.id }],
      commentCount: 1,
      unreadCommentCount: 1,
      latestComment: { id: inA.id },
      reactionSummary: [{ emoji: '🔥', count: 1, users: [{ id: viewer.id }] }],
      myReaction: { emoji: '🔥' },
    });
  });

  test("nothing from a group the viewer isn't in, or one the vibe wasn't posted to", async () => {
    const { viewer, groupB, groupC, vibe } = await twoGroups();
    for (const group of [groupB, groupC]) {
      const data = await executeOk(PER_GROUP, { id: vibe.id, groupId: group.id }, viewer);
      assert.deepEqual(data.lifeScore, EMPTY, group.name);
    }
  });

  test('a pending invitee of the group sees nothing from it', async () => {
    const { owner, viewer, groupB, vibe } = await twoGroups();
    await prisma.groupMembership.create({ data: { groupId: groupB.id, userId: viewer.id, invitedById: owner.id } });
    const data = await executeOk(PER_GROUP, { id: vibe.id, groupId: groupB.id }, viewer);
    assert.deepEqual(data.lifeScore, EMPTY);
  });

  test('comments without groupId only include visible groups (and their group field)', async () => {
    const { owner, viewer, groupA, vibe, inA, inB } = await twoGroups();
    const legacy = await prisma.scoreComment.create({ data: { lifeScoreId: vibe.id, groupId: null, authorId: owner.id, content: 'old' } });
    const query = `query ($id: ID!) { lifeScore(id: $id) { comments { id group { id } } } }`;

    const seen = await executeOk(query, { id: vibe.id }, viewer);
    assert.deepEqual(seen.lifeScore.comments, [{ id: inA.id, group: { id: groupA.id } }]);

    // The owner (a member of both groups) sees both groups' comments and legacy ones
    const own = await executeOk(query, { id: vibe.id }, owner);
    assert.deepEqual(
      own.lifeScore.comments.map((c: { id: string }) => c.id).sort(),
      [inA.id, inB.id, legacy.id].sort()
    );
  });

  test("the owner doesn't see a group's thread after leaving it", async () => {
    const { owner, groupB, vibe } = await twoGroups();
    // Hand the group over and drop the owner's membership
    const other = await createUser();
    await prisma.group.update({ where: { id: groupB.id }, data: { createdById: other.id } });
    await prisma.groupMembership.delete({ where: { groupId_userId: { groupId: groupB.id, userId: owner.id } } });

    const data = await executeOk(PER_GROUP, { id: vibe.id, groupId: groupB.id }, owner);
    assert.deepEqual(data.lifeScore, EMPTY);
  });

  test('the group feed still shows per-group fields to members', async () => {
    const { viewer, groupA, vibe, inA } = await twoGroups();
    const data = await executeOk(
      `query ($groupId: ID!) { groupScores(groupId: $groupId) {
        id commentCount(groupId: $groupId) latestComment(groupId: $groupId) { id }
        reactionSummary(groupId: $groupId) { emoji } myReaction(groupId: $groupId) { emoji }
      } }`,
      { groupId: groupA.id },
      viewer
    );
    assert.deepEqual(data.groupScores, [
      { id: vibe.id, commentCount: 1, latestComment: { id: inA.id }, reactionSummary: [{ emoji: '🔥' }], myReaction: { emoji: '🔥' } },
    ]);
  });
});
