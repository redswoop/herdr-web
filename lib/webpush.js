// Zero-dep Web Push: VAPID (RFC 8292) + aes128gcm payload encryption
// (RFC 8291/8188), node:crypto only. Validated against the RFC 8291
// Appendix A test vectors (test/webpush.test.mjs).
import crypto from 'node:crypto';

export const b64u = {
  enc: (buf) => Buffer.from(buf).toString('base64url'),
  dec: (s) => Buffer.from(s, 'base64url'),
};

// ---------- VAPID keys ----------

// {publicKey, privateKey} as base64url: raw uncompressed P-256 point (65B)
// and raw scalar d (32B) — the format push subscriptions speak.
export function genVapidKeys() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  return { publicKey: b64u.enc(ecdh.getPublicKey()), privateKey: b64u.enc(ecdh.getPrivateKey()) };
}

function vapidKeyObject({ publicKey, privateKey }) {
  const pub = b64u.dec(publicKey);
  return crypto.createPrivateKey({
    format: 'jwk',
    key: {
      kty: 'EC', crv: 'P-256',
      x: b64u.enc(pub.subarray(1, 33)),
      y: b64u.enc(pub.subarray(33, 65)),
      d: privateKey,
    },
  });
}

export function vapidAuthHeader(endpoint, subject, keys) {
  const aud = new URL(endpoint).origin;
  // Apple APNs rejects {"typ":"JWT","alg":"ES256"} with BadJwtToken;
  // RFC 7519/8292 only require alg — keep the header minimal.
  const head = b64u.enc(JSON.stringify({ alg: 'ES256' }));
  const body = b64u.enc(JSON.stringify({
    aud, sub: subject, exp: Math.floor(Date.now() / 1000) + 12 * 3600,
  }));
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`), {
    key: vapidKeyObject(keys), dsaEncoding: 'ieee-p1363',
  });
  return `vapid t=${head}.${body}.${b64u.enc(sig)}, k=${keys.publicKey}`;
}

// ---------- aes128gcm ----------

const hkdf = (ikm, salt, info, len) =>
  Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, len));

// Encrypt one push payload for a subscription's (p256dh, auth) pair.
// `test` injects the app-server ECDH key + salt for the RFC vectors.
export function encrypt(plaintext, p256dh, auth, test = {}) {
  const uaPublic = b64u.dec(p256dh);
  const authSecret = b64u.dec(auth);
  const ecdh = crypto.createECDH('prime256v1');
  if (test.asPrivate) ecdh.setPrivateKey(b64u.dec(test.asPrivate));
  else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const ecdhSecret = ecdh.computeSecret(uaPublic);
  const salt = test.salt ? b64u.dec(test.salt) : crypto.randomBytes(16);

  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = hkdf(ecdhSecret, authSecret, keyInfo, 32);
  const cek = hkdf(ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12);

  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const ct = Buffer.concat([
    cipher.update(Buffer.concat([Buffer.from(plaintext), Buffer.from([2])])),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  const header = Buffer.concat([
    salt,
    Buffer.from([0, 0, 16, 0]), // rs = 4096
    Buffer.from([asPublic.length]),
    asPublic,
  ]);
  return Buffer.concat([header, ct]);
}

// ---------- send ----------

// POST an encrypted payload to a push service. `topic` is the service-side
// collapse key: an offline device gets only the LATEST message per topic on
// reconnect, not a replay of every herd transition (stolen from collie).
export async function sendPush(sub, payload, { ttl = 21_600, topic, urgency = 'high', timeoutMs = 10_000 } = {}, vapid, subject) {
  const body = encrypt(JSON.stringify(payload), sub.keys.p256dh, sub.keys.auth);
  const headers = {
    'content-type': 'application/octet-stream',
    'content-encoding': 'aes128gcm',
    ttl: String(ttl),
    urgency,
    authorization: vapidAuthHeader(sub.endpoint, subject, vapid),
  };
  if (topic) headers.topic = topic;
  // Without a signal this inherits undici's 300s header timeout — and the
  // Coordinator serializes emits, so one stalled endpoint would block every
  // later notification (including retractions) for up to 5 minutes.
  const res = await fetch(sub.endpoint, {
    method: 'POST', headers, body, signal: AbortSignal.timeout(timeoutMs),
  });
  // drain so the socket is reusable
  await res.arrayBuffer().catch(() => {});
  return res.status;
}
