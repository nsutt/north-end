import http2 from 'http2';
import jwt from 'jsonwebtoken';

// Apple Push Notification service (APNs) sender using token-based (.p8) auth.
// Configure with APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID and APNS_PRIVATE_KEY
// (the .p8 file contents; "\n" escapes are allowed). Without them, sends are skipped.

const KEY_ID = process.env.APNS_KEY_ID;
const TEAM_ID = process.env.APNS_TEAM_ID;
const BUNDLE_ID = process.env.APNS_BUNDLE_ID || 'com.delight.vibecheck';
const PRIVATE_KEY = process.env.APNS_PRIVATE_KEY?.replace(/\\n/g, '\n');

const HOSTS = {
  production: 'https://api.push.apple.com',
  sandbox: 'https://api.sandbox.push.apple.com',
} as const;

export type ApnsEnvironment = keyof typeof HOSTS;

export interface PushMessage {
  title: string;
  body: string;
  // Extra keys delivered alongside "aps" (e.g. ids the app uses to open the right screen)
  data?: Record<string, string>;
  threadId?: string;
}

export interface PushTarget {
  token: string;
  environment: ApnsEnvironment;
}

export const apnsConfigured = Boolean(KEY_ID && TEAM_ID && PRIVATE_KEY);

// Apple accepts a provider token for up to an hour; refresh well before that.
let cachedJwt: { value: string; issuedAt: number } | null = null;
function providerToken(): string {
  const now = Math.floor(Date.now() / 1000);
  if (!cachedJwt || now - cachedJwt.issuedAt > 50 * 60) {
    cachedJwt = {
      value: jwt.sign({ iss: TEAM_ID, iat: now }, PRIVATE_KEY!, { algorithm: 'ES256', keyid: KEY_ID }),
      issuedAt: now,
    };
  }
  return cachedJwt.value;
}

const sessions: Partial<Record<ApnsEnvironment, http2.ClientHttp2Session>> = {};
function session(environment: ApnsEnvironment): http2.ClientHttp2Session {
  const existing = sessions[environment];
  if (existing && !existing.closed && !existing.destroyed) return existing;
  const created = http2.connect(HOSTS[environment]);
  created.on('error', (err) => console.error(`[push] APNs ${environment} connection error:`, err.message));
  created.on('close', () => delete sessions[environment]);
  created.unref();
  sessions[environment] = created;
  return created;
}

/**
 * Sends one notification to each target. Resolves with the tokens Apple
 * reported as no longer valid, so callers can delete them.
 */
export async function sendPush(targets: PushTarget[], message: PushMessage): Promise<string[]> {
  if (targets.length === 0) return [];

  if (!apnsConfigured) {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[push] APNs not configured; would send to ${targets.length} device(s):`, message.title, '-', message.body);
    }
    return [];
  }

  const payload = JSON.stringify({
    aps: {
      alert: { title: message.title, body: message.body },
      sound: 'default',
      ...(message.threadId ? { 'thread-id': message.threadId } : {}),
    },
    ...message.data,
  });

  const results = await Promise.all(targets.map((target) => sendOne(target, payload)));
  return results.filter((token): token is string => token !== null);
}

// Returns the token if Apple says it's dead, otherwise null.
function sendOne(target: PushTarget, payload: string): Promise<string | null> {
  return new Promise((resolve) => {
    let request: http2.ClientHttp2Stream;
    try {
      request = session(target.environment).request({
        ':method': 'POST',
        ':path': `/3/device/${target.token}`,
        authorization: `bearer ${providerToken()}`,
        'apns-topic': BUNDLE_ID,
        'apns-push-type': 'alert',
        'apns-priority': '10',
        'content-type': 'application/json',
      });
    } catch (err) {
      console.error('[push] Failed to start APNs request:', err);
      return resolve(null);
    }

    let status = 0;
    let body = '';
    request.setEncoding('utf8');
    request.on('response', (headers) => {
      status = Number(headers[':status']);
    });
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      if (status === 200) return resolve(null);
      const reason = safeReason(body);
      if (status === 410 || reason === 'BadDeviceToken' || reason === 'Unregistered') {
        return resolve(target.token);
      }
      console.error(`[push] APNs rejected notification (${status}): ${reason}`);
      resolve(null);
    });
    request.on('error', (err) => {
      console.error('[push] APNs request error:', err.message);
      resolve(null);
    });
    request.setTimeout(10_000, () => request.close(http2.constants.NGHTTP2_CANCEL));
    request.end(payload);
  });
}

function safeReason(body: string): string {
  try {
    return JSON.parse(body).reason ?? 'Unknown';
  } catch {
    return body || 'Unknown';
  }
}
