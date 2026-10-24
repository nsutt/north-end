import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { setAppleKeyResolverForTesting } from '../src/utils/appleAuth';
import { closeDatabase, createUser, executeError, executeOk, prisma, resetDatabase } from './helpers';

// A stand-in for Apple's signing key: tokens are minted locally and the verifier is
// pointed at the matching public key.
const KEY_ID = 'test-key';
const appleKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const otherKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });

const AUDIENCE = process.env.APPLE_CLIENT_ID!; // set in setup.ts
const NONCE = 'raw-nonce-from-the-app';

function mintToken(
  options: {
    sub?: string;
    email?: string;
    nonce?: string;
    audience?: string;
    issuer?: string;
    expiresIn?: number;
    privateKey?: crypto.KeyObject;
  } = {}
) {
  const payload: Record<string, unknown> = {
    sub: options.sub ?? 'apple-user-1',
    nonce: crypto.createHash('sha256').update(options.nonce ?? NONCE).digest('hex'),
  };
  if (options.email) payload.email = options.email;
  return jwt.sign(payload, options.privateKey ?? appleKey.privateKey, {
    algorithm: 'RS256',
    keyid: KEY_ID,
    issuer: options.issuer ?? 'https://appleid.apple.com',
    audience: options.audience ?? AUDIENCE,
    expiresIn: options.expiresIn ?? 600,
  });
}

const SIGN_IN = `#graphql
  mutation ($identityToken: String!, $nonce: String!, $displayName: String) {
    signInWithApple(identityToken: $identityToken, nonce: $nonce, displayName: $displayName) {
      token isNewUser user { id displayName hasAppleId }
    }
  }
`;
const CONNECT = `#graphql
  mutation ($identityToken: String!, $nonce: String!) {
    connectAppleId(identityToken: $identityToken, nonce: $nonce) { id hasAppleId }
  }
`;

before(() => {
  setAppleKeyResolverForTesting(async (kid) => {
    if (kid !== KEY_ID) throw new Error('Unknown Apple signing key');
    return appleKey.publicKey;
  });
});
beforeEach(resetDatabase);
after(async () => {
  setAppleKeyResolverForTesting(null);
  await closeDatabase();
});

describe('signInWithApple', () => {
  test('signs up a new user on first sign-in', async () => {
    const data = await executeOk(SIGN_IN, {
      identityToken: mintToken({ email: 'Person@PrivateRelay.AppleID.com' }),
      nonce: NONCE,
      displayName: '  Sam  ',
    });
    const result = data.signInWithApple;
    assert.equal(result.isNewUser, true);
    assert.ok(result.token);
    assert.equal(result.user.displayName, 'Sam');
    assert.equal(result.user.hasAppleId, true);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: result.user.id } });
    assert.equal(user.appleUserId, 'apple-user-1');
    assert.equal(user.email, 'person@privaterelay.appleid.com');
    assert.ok(user.uniqueCode);
  });

  test('signs the same user in again on a repeat sign-in', async () => {
    const first = await executeOk(SIGN_IN, { identityToken: mintToken(), nonce: NONCE });
    const second = await executeOk(SIGN_IN, { identityToken: mintToken(), nonce: NONCE });
    assert.equal(first.signInWithApple.user.displayName, 'Vibe Checker');
    assert.equal(second.signInWithApple.isNewUser, false);
    assert.equal(second.signInWithApple.user.id, first.signInWithApple.user.id);
    assert.equal(await prisma.user.count(), 1);
  });

  test("doesn't take over an existing account's email", async () => {
    await createUser({ email: 'shared@example.test' });
    const data = await executeOk(SIGN_IN, { identityToken: mintToken({ email: 'shared@example.test' }), nonce: NONCE });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: data.signInWithApple.user.id } });
    assert.equal(user.email, null);
  });

  const invalidCases: [string, () => { identityToken: string; nonce: string }][] = [
    ['wrong nonce', () => ({ identityToken: mintToken(), nonce: 'some-other-nonce' })],
    ['wrong audience', () => ({ identityToken: mintToken({ audience: 'com.someone.else' }), nonce: NONCE })],
    ['wrong issuer', () => ({ identityToken: mintToken({ issuer: 'https://evil.example' }), nonce: NONCE })],
    ['expired token', () => ({ identityToken: mintToken({ expiresIn: -60 }), nonce: NONCE })],
    ['bad signature', () => ({ identityToken: mintToken({ privateKey: otherKey.privateKey }), nonce: NONCE })],
    ['tampered payload', () => {
      const [header, , signature] = mintToken().split('.');
      const forged = Buffer.from(JSON.stringify({ sub: 'someone-else' })).toString('base64url');
      return { identityToken: `${header}.${forged}.${signature}`, nonce: NONCE };
    }],
    ['unsigned (alg: none) token', () => ({
      identityToken: jwt.sign(
        { sub: 'apple-user-1', nonce: crypto.createHash('sha256').update(NONCE).digest('hex') },
        '',
        { algorithm: 'none', keyid: KEY_ID, issuer: 'https://appleid.apple.com', audience: AUDIENCE }
      ),
      nonce: NONCE,
    })],
    ['garbage token', () => ({ identityToken: 'not-a-jwt', nonce: NONCE })],
  ];

  for (const [name, makeVars] of invalidCases) {
    test(`rejects a token with ${name}`, async () => {
      const message = await executeError(SIGN_IN, makeVars());
      assert.match(message, /Invalid Apple sign-in token/);
      assert.equal(await prisma.user.count(), 0);
    });
  }
});

describe('connectAppleId', () => {
  test('requires login', async () => {
    assert.match(await executeError(CONNECT, { identityToken: mintToken(), nonce: NONCE }), /logged in/);
  });

  test('connects an Apple ID to the signed-in account', async () => {
    const user = await createUser();
    const data = await executeOk(CONNECT, { identityToken: mintToken({ sub: 'apple-connect' }), nonce: NONCE }, user);
    assert.equal(data.connectAppleId.hasAppleId, true);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).appleUserId, 'apple-connect');
  });

  test('rejects an Apple ID already connected to another account', async () => {
    const owner = await createUser({ appleUserId: 'apple-taken' });
    const other = await createUser();

    const message = await executeError(CONNECT, { identityToken: mintToken({ sub: 'apple-taken' }), nonce: NONCE }, other);
    assert.match(message, /already connected to another/);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: other.id } })).appleUserId, null);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).appleUserId, 'apple-taken');
  });

  test('reconnecting your own Apple ID is fine', async () => {
    const user = await createUser({ appleUserId: 'apple-mine' });
    await executeOk(CONNECT, { identityToken: mintToken({ sub: 'apple-mine' }), nonce: NONCE }, user);
  });

  test('rejects an invalid token', async () => {
    const user = await createUser();
    const message = await executeError(CONNECT, { identityToken: mintToken(), nonce: 'wrong' }, user);
    assert.match(message, /Invalid Apple sign-in token/);
  });
});
