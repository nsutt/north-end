import { after, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeDatabase, createGroup, createLifeScore, createUser, executeError, executeOk, prisma, resetDatabase } from './helpers';

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

describe('vibe visibility', () => {
  /**
   * The author shares one group with the viewer and has another the viewer isn't in.
   * Vibes, oldest first: shared (to the shared group), hidden (to the other group),
   * solo (to no group).
   */
  async function setup() {
    const author = await createUser();
    const viewer = await createUser();
    const shared = await createGroup(author, [viewer], 'Shared');
    const other = await createGroup(author, [], 'Other');
    const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000);

    const sharedVibe = await createLifeScore(author, [shared.id], { score: 6, statusText: 'shared' });
    const hiddenVibe = await createLifeScore(author, [other.id], { score: 2, statusText: 'hidden' });
    const soloVibe = await createLifeScore(author, [], { score: 9 });
    await prisma.lifeScore.update({ where: { id: sharedVibe.id }, data: { createdAt: at(30) } });
    await prisma.lifeScore.update({ where: { id: hiddenVibe.id }, data: { createdAt: at(20) } });
    await prisma.lifeScore.update({ where: { id: soloVibe.id }, data: { createdAt: at(10) } });

    return { author, viewer, shared, other, sharedVibe, hiddenVibe, soloVibe };
  }

  const LIFE_SCORE = `#graphql
    query ($id: ID!) { lifeScore(id: $id) { id statusText } }
  `;
  const PROFILE = `#graphql
    query ($id: ID!) { user(id: $id) { id currentScore { id } lifeScores { id } } }
  `;

  test('lifeScore(id): visible to a member of a group it was posted to, null otherwise', async () => {
    const { viewer, sharedVibe, hiddenVibe, soloVibe } = await setup();

    const visible = await executeOk(LIFE_SCORE, { id: sharedVibe.id }, viewer);
    assert.deepEqual(visible.lifeScore, { id: sharedVibe.id, statusText: 'shared' });

    for (const vibe of [hiddenVibe, soloVibe]) {
      const data = await executeOk(LIFE_SCORE, { id: vibe.id }, viewer);
      assert.equal(data.lifeScore, null);
    }
  });

  test('lifeScore(id): the owner sees all their vibes', async () => {
    const { author, sharedVibe, hiddenVibe, soloVibe } = await setup();
    for (const vibe of [sharedVibe, hiddenVibe, soloVibe]) {
      const data = await executeOk(LIFE_SCORE, { id: vibe.id }, author);
      assert.equal(data.lifeScore.id, vibe.id);
    }
  });

  test('lifeScore(id): a pending invitee of the group cannot see it, and login is required', async () => {
    const { author, other, hiddenVibe } = await setup();
    const invitee = await createUser();
    await prisma.groupMembership.create({ data: { groupId: other.id, userId: invitee.id, invitedById: author.id } });

    assert.equal((await executeOk(LIFE_SCORE, { id: hiddenVibe.id }, invitee)).lifeScore, null);
    assert.match(await executeError(LIFE_SCORE, { id: hiddenVibe.id }), /logged in/);
  });

  test("User.lifeScores and User.currentScore only include vibes the viewer can see", async () => {
    const { author, viewer, sharedVibe } = await setup();

    const data = await executeOk(PROFILE, { id: author.id }, viewer);
    assert.deepEqual(data.user, { id: author.id, currentScore: { id: sharedVibe.id }, lifeScores: [{ id: sharedVibe.id }] });

    // Someone who shares no group sees nothing
    const stranger = await createUser();
    const none = await executeOk(PROFILE, { id: author.id }, stranger);
    assert.deepEqual(none.user, { id: author.id, currentScore: null, lifeScores: [] });
  });

  test('the user themselves sees all their vibes via me and user(id)', async () => {
    const { author, sharedVibe, hiddenVibe, soloVibe } = await setup();
    const expected = { currentScore: { id: soloVibe.id }, lifeScores: [soloVibe, hiddenVibe, sharedVibe].map((v) => ({ id: v.id })) };

    const me = await executeOk(`{ me { id currentScore { id } lifeScores { id } } }`, {}, author);
    assert.deepEqual(me.me, { id: author.id, ...expected });

    const profile = await executeOk(PROFILE, { id: author.id }, author);
    assert.deepEqual(profile.user, { id: author.id, ...expected });
  });

  test('the group feed and Home still work for members', async () => {
    const { author, viewer, shared, sharedVibe } = await setup();

    const feed = await executeOk(
      `query ($groupId: ID!) { groupScores(groupId: $groupId) { id statusText user { id } } }`,
      { groupId: shared.id },
      viewer
    );
    assert.deepEqual(feed.groupScores, [{ id: sharedVibe.id, statusText: 'shared', user: { id: author.id } }]);

    const home = await executeOk(`{ myGroups { id recentActivity { user { id } score } } }`, {}, viewer);
    assert.deepEqual(home.myGroups, [{ id: shared.id, recentActivity: { user: { id: author.id }, score: 6 } }]);
  });
});

describe('User.features', () => {
  test('are only visible to the user themselves', async () => {
    const alice = await createUser({ features: ['can-delete-any-user', 'can-logout'] });
    const bob = await createUser();

    const mine = await executeOk(`{ me { features } }`, {}, alice);
    assert.deepEqual(mine.me.features, ['can-delete-any-user', 'can-logout']);

    const theirs = await executeOk(`query ($id: ID!) { user(id: $id) { features } }`, { id: alice.id }, bob);
    assert.deepEqual(theirs.user.features, []);

    const all = await executeOk(`{ allUsers { id features } }`, {}, bob);
    const aliceRow = all.allUsers.find((u: { id: string }) => u.id === alice.id);
    assert.deepEqual(aliceRow.features, []);
  });
});
