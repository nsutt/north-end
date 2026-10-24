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
