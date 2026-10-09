import { test } from 'node:test';
import assert from 'node:assert/strict';
import { password, phone, email, objectId, body, fakeMode, otpHash } from '../src/lib/core.js';
import { PendingSignup } from '../src/models/pendingSignup.model.js';
import { OtpChallenge } from '../src/models/otpChallenge.model.js';
process.env.OTP_SECRET = 'test-only-strong-secret-for-unit-tests-12345';
test('input validators reject operator objects and malformed input', () => {
  for (const value of [{ $ne: null }, [], null, 123]) {
    assert.throws(() => email(value)); assert.throws(() => phone(value)); assert.throws(() => password(value));
  }
  assert.throws(() => body([])); assert.throws(() => objectId('invalid'));
  assert.equal(email(' TEST@EXAMPLE.COM '), 'test@example.com');
  assert.equal(phone('+919876543210'), '+919876543210');
});
test('password limits use UTF-8 bytes and preserve intentional spaces', () => {
  assert.throws(() => password('short'));
  assert.throws(() => password('é'.repeat(37)));
  assert.equal(password(' long password here '), ' long password here ');
  assert.equal(password('é'.repeat(36)), 'é'.repeat(36));
});
test('OTP verification hashes are bound to challenge and purpose', () => {
  assert.equal(otpHash('a', 'signup', '123456'), otpHash('a', 'signup', '123456'));
  assert.notEqual(otpHash('a', 'signup', '123456'), otpHash('b', 'signup', '123456'));
  assert.notEqual(otpHash('a', 'signup', '123456'), otpHash('a', 'login', '123456'));
});
test('fake OTP mode cannot run in production or without explicit configuration', () => {
  process.env.OTP_MODE = 'fake'; process.env.NODE_ENV = 'production'; assert.throws(fakeMode);
  process.env.NODE_ENV = 'development'; assert.doesNotThrow(fakeMode);
  process.env.OTP_MODE = 'live'; assert.throws(fakeMode);
});
test('pending signup defaults to one hour and excludes stored password hash', async () => {
  const start = Date.now();
  const pending = new PendingSignup({ fullName: 'Tester', email: 'TEST@EXAMPLE.COM', phone: '+919876543210', passwordHash: 'hash' });
  await pending.validate();
  assert.equal(pending.email, 'test@example.com');
  assert.ok(pending.expiresAt.getTime() >= start + 3599000);
  assert.equal(PendingSignup.schema.path('passwordHash').options.select, false);
});
test('OTP model rejects unsupported purpose and defaults attempt counter', async () => {
  const challenge = new OtpChallenge({ phone: '+919876543210', purpose: 'signup', codeHash: 'hash', expiresAt: new Date() });
  await challenge.validate(); assert.equal(challenge.attempts, 0);
  const invalid = new OtpChallenge({ phone: '+919876543210', purpose: 'other', codeHash: 'hash', expiresAt: new Date() });
  await assert.rejects(invalid.validate());
  assert.equal(OtpChallenge.schema.path('codeHash').options.select, false);
});
