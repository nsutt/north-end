import crypto from 'crypto';
import jwt from 'jsonwebtoken';

// Verifies identity tokens from Sign in with Apple.
// https://developer.apple.com/documentation/sign_in_with_apple/sign_in_with_apple_rest_api/verifying_a_user

const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_KEYS_URL = 'https://appleid.apple.com/auth/keys';

// The app's bundle ID is the token's audience.
const APPLE_AUDIENCE = process.env.APPLE_CLIENT_ID || process.env.APNS_BUNDLE_ID || 'com.delight.vibecheck';

export interface AppleIdentity {
  sub: string;
  email?: string;
}

type KeyResolver = (kid: string) => Promise<crypto.KeyObject>;

// Apple rotates its signing keys rarely; cache them and refetch on an unknown key ID.
let cachedKeys: { keys: Map<string, crypto.KeyObject>; fetchedAt: number } | null = null;

async function fetchAppleKeys(): Promise<Map<string, crypto.KeyObject>> {
  const response = await fetch(APPLE_KEYS_URL);
  if (!response.ok) {
    throw new Error(`Couldn't fetch Apple sign-in keys (${response.status})`);
  }
  const { keys } = (await response.json()) as { keys: (crypto.JsonWebKeyInput['key'] & { kid: string })[] };
  return new Map(keys.map((jwk) => [jwk.kid, crypto.createPublicKey({ key: jwk, format: 'jwk' })]));
}

const appleKeyResolver: KeyResolver = async (kid) => {
  const fresh = cachedKeys !== null && Date.now() - cachedKeys.fetchedAt < 60 * 60 * 1000;
  if (!fresh || !cachedKeys?.keys.has(kid)) {
    cachedKeys = { keys: await fetchAppleKeys(), fetchedAt: Date.now() };
  }
  const key = cachedKeys?.keys.get(kid);
  if (!key) throw new Error('Unknown Apple signing key');
  return key;
};

let resolveKey: KeyResolver = appleKeyResolver;

/** For local scripts that exercise sign-in without real Apple tokens. */
export function setAppleKeyResolverForTesting(resolver: KeyResolver | null) {
  resolveKey = resolver ?? appleKeyResolver;
}

/**
 * Checks the token's signature, issuer, audience and expiry, and that its nonce
 * matches the raw nonce the app generated (Apple stores its SHA-256), so a captured
 * token can't be replayed by someone else.
 */
export async function verifyAppleIdentityToken(identityToken: string, rawNonce: string): Promise<AppleIdentity> {
  const decoded = jwt.decode(identityToken, { complete: true });
  const kid = decoded && typeof decoded === 'object' ? decoded.header.kid : undefined;
  if (!kid) {
    throw new Error('Invalid Apple sign-in token');
  }

  let payload: jwt.JwtPayload;
  try {
    payload = jwt.verify(identityToken, await resolveKey(kid), {
      algorithms: ['RS256'],
      issuer: APPLE_ISSUER,
      audience: APPLE_AUDIENCE,
    }) as jwt.JwtPayload;
  } catch {
    throw new Error('Invalid Apple sign-in token');
  }

  const expectedNonce = crypto.createHash('sha256').update(rawNonce).digest('hex');
  if (!payload.sub || payload.nonce !== expectedNonce) {
    throw new Error('Invalid Apple sign-in token');
  }

  return {
    sub: payload.sub,
    email: typeof payload.email === 'string' ? payload.email.toLowerCase() : undefined,
  };
}
