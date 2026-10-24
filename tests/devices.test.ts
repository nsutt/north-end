import { after, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeDatabase, createUser, executeError, executeOk, prisma, resetDatabase } from './helpers';

beforeEach(resetDatabase);
after(closeDatabase);

const REGISTER = `#graphql
  mutation ($token: String!, $environment: PushEnvironment!) {
    registerDeviceToken(token: $token, environment: $environment)
  }
`;
const UNREGISTER = `#graphql
  mutation ($token: String!) { unregisterDeviceToken(token: $token) }
`;

const TOKEN = 'a1'.repeat(32); // 64 hex chars, like a real APNs token

describe('registerDeviceToken', () => {
  test('requires login', async () => {
    assert.match(await executeError(REGISTER, { token: TOKEN, environment: 'PRODUCTION' }), /logged in/);
    assert.equal(await prisma.deviceToken.count(), 0);
  });

  test('rejects tokens that are not hex strings of a plausible length', async () => {
    const user = await createUser();
    for (const token of ['', 'abc', 'z'.repeat(64), `${TOKEN}<script>`, 'a'.repeat(201)]) {
      const message = await executeError(REGISTER, { token, environment: 'PRODUCTION' }, user);
      assert.match(message, /Invalid device token/, token);
    }
    assert.equal(await prisma.deviceToken.count(), 0);
  });

  test('registers a token for the caller', async () => {
    const user = await createUser();
    const data = await executeOk(REGISTER, { token: TOKEN, environment: 'SANDBOX' }, user);
    assert.equal(data.registerDeviceToken, true);

    const device = await prisma.deviceToken.findUniqueOrThrow({ where: { token: TOKEN } });
    assert.equal(device.userId, user.id);
    assert.equal(device.environment, 'sandbox');
  });

  test('re-registering a token moves it to the new user (device changed hands)', async () => {
    const first = await createUser();
    const second = await createUser();
    await executeOk(REGISTER, { token: TOKEN, environment: 'PRODUCTION' }, first);
    await executeOk(REGISTER, { token: TOKEN, environment: 'PRODUCTION' }, second);

    const device = await prisma.deviceToken.findUniqueOrThrow({ where: { token: TOKEN } });
    assert.equal(device.userId, second.id);
  });
});

describe('unregisterDeviceToken', () => {
  test('requires login', async () => {
    assert.match(await executeError(UNREGISTER, { token: TOKEN }), /logged in/);
  });

  test("does not remove someone else's token", async () => {
    const owner = await createUser();
    const mallory = await createUser();
    await executeOk(REGISTER, { token: TOKEN, environment: 'PRODUCTION' }, owner);

    await executeOk(UNREGISTER, { token: TOKEN }, mallory);
    const device = await prisma.deviceToken.findUnique({ where: { token: TOKEN } });
    assert.equal(device?.userId, owner.id);
  });

  test('removes your own token', async () => {
    const owner = await createUser();
    await executeOk(REGISTER, { token: TOKEN, environment: 'PRODUCTION' }, owner);

    await executeOk(UNREGISTER, { token: TOKEN }, owner);
    assert.equal(await prisma.deviceToken.count(), 0);
  });
});
