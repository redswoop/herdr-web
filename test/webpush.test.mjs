// RFC 8291 Appendix A test vectors — proves the hand-rolled aes128gcm
// matches the spec byte-for-byte. Run: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encrypt, vapidAuthHeader, genVapidKeys, b64u } from '../lib/webpush.js';

const V = {
  plaintext: 'V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  authSecret: 'BTBZMqHH6r4Tts7J_aSIgg',
  header: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  ciphertext: '8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ',
};

test('aes128gcm matches RFC 8291 Appendix A', () => {
  const out = encrypt(b64u.dec(V.plaintext), V.uaPublic, V.authSecret, {
    asPrivate: V.asPrivate, salt: V.salt,
  });
  const expected = Buffer.concat([b64u.dec(V.header), b64u.dec(V.ciphertext)]);
  assert.equal(b64u.enc(out), b64u.enc(expected));
});

test('vapid header shape + verifiable signature', async () => {
  const keys = genVapidKeys();
  const h = vapidAuthHeader('https://fcm.googleapis.com/fcm/send/xyz', 'mailto:x@y.z', keys);
  const m = h.match(/^vapid t=([\w-]+\.[\w-]+\.[\w-]+), k=([\w-]+)$/);
  assert.ok(m, 'header format');
  const [head, body] = m[1].split('.');
  const claims = JSON.parse(b64u.dec(body));
  assert.equal(claims.aud, 'https://fcm.googleapis.com');
  assert.ok(claims.exp > Date.now() / 1000);
  const { createPublicKey, verify } = await import('node:crypto');
  const pub = b64u.dec(keys.publicKey);
  const key = createPublicKey({
    format: 'jwk',
    key: { kty: 'EC', crv: 'P-256', x: b64u.enc(pub.subarray(1, 33)), y: b64u.enc(pub.subarray(33, 65)) },
  });
  const sig = b64u.dec(m[1].split('.')[2]);
  assert.ok(verify('sha256', Buffer.from(`${head}.${body}`), { key, dsaEncoding: 'ieee-p1363' }, sig));
});
