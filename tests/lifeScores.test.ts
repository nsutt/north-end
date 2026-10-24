import { after, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeDatabase, createGroup, createUser, executeError, executeOk, prisma, resetDatabase } from './helpers';

beforeEach(resetDatabase);
after(closeDatabase);

const POST_LIFE_SCORE = `#graphql
  mutation ($score: Float!, $statusText: String, $gifUrl: String, $groupIds: [ID!]) {
    postLifeScore(score: $score, statusText: $statusText, gifUrl: $gifUrl, groupIds: $groupIds) {
      id score statusText groups { id }
    }
  }
`;

describe('postLifeScore', () => {
  test('requires login', async () => {
    assert.match(await executeError(POST_LIFE_SCORE, { score: 5 }), /logged in/);
  });

  test('accepts scores from 0 to 10 inclusive', async () => {
    const user = await createUser();
    for (const score of [0, 5.5, 10]) {
      const data = await executeOk(POST_LIFE_SCORE, { score }, user);
      assert.equal(data.postLifeScore.score, score);
    }
  });

  test('rejects scores outside 0-10', async () => {
    const user = await createUser();
    for (const score of [-0.1, -5, 10.1, 100]) {
      const message = await executeError(POST_LIFE_SCORE, { score }, user);
      assert.match(message, /between 0 and 10/, String(score));
    }
    assert.equal(await prisma.lifeScore.count(), 0);
  });

  test('posts to groups the user is a member of', async () => {
    const user = await createUser();
    const other = await createUser();
    const own = await createGroup(user);
    const joined = await createGroup(other, [user]);

    const data = await executeOk(POST_LIFE_SCORE, { score: 8, statusText: ' good ', groupIds: [own.id, joined.id] }, user);
    assert.equal(data.postLifeScore.statusText, 'good');
    assert.deepEqual(data.postLifeScore.groups.map((g: { id: string }) => g.id).sort(), [own.id, joined.id].sort());
  });

  test('must be a member of every group in groupIds', async () => {
    const user = await createUser();
    const stranger = await createUser();
    const own = await createGroup(user);
    const foreign = await createGroup(stranger);

    const message = await executeError(POST_LIFE_SCORE, { score: 8, groupIds: [own.id, foreign.id] }, user);
    assert.match(message, /member of all selected groups/);
    assert.equal(await prisma.lifeScore.count(), 0);
  });

  test('a pending invite does not count as membership', async () => {
    const user = await createUser();
    const owner = await createUser();
    const group = await createGroup(owner);
    await prisma.groupMembership.create({ data: { groupId: group.id, userId: user.id, invitedById: owner.id } });

    assert.match(await executeError(POST_LIFE_SCORE, { score: 8, groupIds: [group.id] }, user), /member of all/);
  });

  test('duplicate groupIds cannot smuggle in a foreign group', async () => {
    const user = await createUser();
    const stranger = await createUser();
    const own = await createGroup(user);
    const foreign = await createGroup(stranger);

    await executeError(POST_LIFE_SCORE, { score: 8, groupIds: [own.id, own.id, foreign.id] }, user);
    assert.equal(await prisma.lifeScoreGroup.count({ where: { groupId: foreign.id } }), 0);
  });

  test('rejects GIFs that are not from Giphy', async () => {
    const user = await createUser();
    const message = await executeError(POST_LIFE_SCORE, { score: 5, gifUrl: 'https://evil.example/x.gif' }, user);
    assert.match(message, /GIF must be from Giphy/);
  });
});
