import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Server } from 'node:http';

process.env.NODE_ENV = 'test';
process.env.OTP_MODE = 'fake';
process.env.OTP_SECRET = 'test-only-secret-never-use-in-production-123';

const { createApp } = await import('../src/app.js');
const { initializeModels } = await import('../src/services/auth.service.js');
const { OtpChallenge } = await import('../src/models/otpChallenge.model.js');
const { User } = await import('../src/models/user.model.js');
const { RateBucket, Session } = await import('../src/models/authState.model.js');
const { PendingSignup } = await import('../src/models/pendingSignup.model.js');

let mongo: MongoMemoryReplSet, server: Server, base: string;

before(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 }, binary: { version: '7.0.24' } });
  await mongoose.connect(mongo.getUri()); await initializeModels();
  server = createApp().listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

after(async () => {
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  await mongoose.disconnect(); if (mongo) await mongo.stop();
});

beforeEach(async () => { for (const c of Object.values(mongoose.connection.collections)) await c.deleteMany({}); });

const details = { fullName: 'Test User', email: 'test@example.com', phone: '+919876543210', password: 'my-test-password-123' };

async function call(path: string, payload?: unknown, bearer?: string) {
  const response = await fetch(`${base}/api/auth/${path}`, { method: payload === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
    ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}) });
  return { status: response.status, body: await response.json() as any };
}

async function signup() { const r = await call('signup', details); assert.equal(r.status, 202); return r.body.data; }

async function registered() {
  const d = await signup();
  assert.equal((await call('verify-phone', { challengeId: d.challengeId, otp: d.devOtp })).status, 201);
  await RateBucket.deleteMany({});
}

test('signup remains pending; phone verification creates user once; password login and logout', async () => {
  const d = await signup();
  assert.equal(await User.countDocuments(), 0);
  assert.equal((await call('login', { email: details.email, password: details.password })).status, 401);
  assert.match(d.devOtp, /^\d{6}$/);
  assert.ok(!JSON.stringify(d).includes('codeHash'));
  const payload = { challengeId: d.challengeId, otp: d.devOtp };
  const responses = await Promise.all([call('verify-phone', payload), call('verify-phone', payload)]);
  assert.deepEqual(responses.map(r => r.status).sort(), [201, 400]);
  assert.equal(await User.countDocuments(), 1);
  assert.equal(await PendingSignup.countDocuments(), 0);
  const logged = await call('login', { email: ' TEST@EXAMPLE.COM ', password: details.password });
  assert.equal(logged.status, 200);
  const access = logged.body.data.accessToken;
  assert.equal((await call('me', undefined, access)).status, 200);
  assert.notEqual((await Session.findOne())!.tokenHash, access);
  assert.equal((await call('logout', {}, access)).status, 200);
  assert.equal((await call('me', undefined, access)).status, 401);
});

test('five wrong codes lock out correct code, including concurrent guesses', async () => {
  const d = await signup(); const wrong = d.devOtp === '100000' ? '100001' : '100000';
  const results = await Promise.all(Array.from({ length: 8 }, () => call('verify-phone', { challengeId: d.challengeId, otp: wrong })));
  assert.ok(results.every(r => r.status === 400));
  assert.equal((await OtpChallenge.findById(d.challengeId))!.attempts, 5);
  assert.equal((await call('verify-phone', { challengeId: d.challengeId, otp: d.devOtp })).status, 400);
});

test('expired OTP and wrong-purpose OTP are rejected', async () => {
  const d = await signup();
  assert.equal((await call('verify-login-otp', { challengeId: d.challengeId, otp: d.devOtp })).status, 400);
  await OtpChallenge.updateOne({ _id: d.challengeId }, { expiresAt: new Date(Date.now() - 1000) });
  assert.equal((await call('verify-phone', { challengeId: d.challengeId, otp: d.devOtp })).status, 400);
});

test('resend is throttled and invalidates prior challenge after cooldown', async () => {
  const d = await signup();
  assert.equal((await call('resend-otp', { challengeId: d.challengeId, purpose: 'signup' })).status, 429);
  await RateBucket.deleteMany({}); // simulate elapsed rate window without sleeping
  const r = await call('resend-otp', { challengeId: d.challengeId, purpose: 'signup' });
  assert.equal(r.status, 202);
  assert.equal((await call('verify-phone', { challengeId: d.challengeId, otp: d.devOtp })).status, 400);
  assert.equal((await call('verify-phone', { challengeId: r.body.data.challengeId, otp: r.body.data.devOtp })).status, 201);
});

test('phone login OTP is single use', async () => {
  await registered(); const r = await call('request-login-otp', { phone: details.phone });
  const payload = { challengeId: r.body.data.challengeId, otp: r.body.data.devOtp };
  assert.equal((await call('verify-login-otp', payload)).status, 200);
  assert.equal((await call('verify-login-otp', payload)).status, 400);
});

test('password reset requires OTP, consumes grant, revokes sessions and old password', async () => {
  await registered();
  const old = await call('login', { email: details.email, password: details.password });
  const request = await call('request-password-reset', { phone: details.phone });
  const d = request.body.data;
  const verify = await call('verify-password-reset', { challengeId: d.challengeId, otp: d.devOtp });
  assert.equal(verify.status, 200);
  const payload = { resetToken: verify.body.data.resetToken, password: 'new-test-password-456' };
  assert.equal((await call('reset-password', { ...payload, resetToken: '0'.repeat(64) })).status, 400);
  assert.equal((await call('reset-password', payload)).status, 200);
  assert.equal((await call('reset-password', payload)).status, 400);
  assert.equal((await call('me', undefined, old.body.data.accessToken)).status, 401);
  assert.equal((await call('login', { email: details.email, password: details.password })).status, 401);
  assert.equal((await call('login', { email: details.email, password: payload.password })).status, 200);
});

test('invalid inputs are rejected without database writes', async () => {
  for (const patch of [{ email: { $ne: null } }, { phone: 1234 }, { password: 'short' }, { password: 'é'.repeat(37) }, { fullName: ' ' }]) {
    assert.equal((await call('signup', { ...details, ...patch })).status, 400);
  }
  assert.equal(await PendingSignup.countDocuments(), 0);
});

test('unknown and existing account requests have same response shape', async () => {
  await registered();
  const known = await call('request-password-reset', { phone: details.phone });
  const unknown = await call('request-password-reset', { phone: '+919876543211' });
  assert.equal(known.status, unknown.status);
  assert.equal(known.body.message, unknown.body.message);
  assert.deepEqual(Object.keys(known.body.data), Object.keys(unknown.body.data));
});

test('fake mode fails closed in production and unconfigured modes', () => {
  process.env.NODE_ENV = 'production'; assert.throws(() => createApp());
  process.env.NODE_ENV = 'test'; process.env.OTP_MODE = 'live'; assert.throws(() => createApp());
  process.env.OTP_MODE = 'fake';
});

test('expired pending signup cannot activate; unknown route and malformed JSON are controlled', async () => {
  const d = await signup();
  await PendingSignup.updateMany({}, { expiresAt: new Date(Date.now() - 1000) });
  assert.equal((await call('verify-phone', { challengeId: d.challengeId, otp: d.devOtp })).status, 400);
  assert.equal(await User.countDocuments(), 0);
  const r = await fetch(`${base}/api/auth/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' });
  assert.equal(r.status, 400);
  assert.equal((await fetch(`${base}/missing`)).status, 404);
});
