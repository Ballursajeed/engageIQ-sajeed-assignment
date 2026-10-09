import { createHash, createHmac, randomBytes } from 'node:crypto';
import type { ErrorRequestHandler } from 'express';
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export function fakeMode() {
  if (process.env.OTP_MODE !== 'fake' || !['development', 'test'].includes(process.env.NODE_ENV ?? '')) {
    throw new Error('This build requires OTP_MODE=fake and NODE_ENV=development or test. Live delivery is not implemented.');
  }
  if (!process.env.OTP_SECRET || process.env.OTP_SECRET.length < 32) throw new Error('OTP_SECRET must contain at least 32 characters');
}
export const token = () => randomBytes(32).toString('hex');
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export function otpHash(id: string, purpose: string, code: string) {
  return createHmac('sha256', process.env.OTP_SECRET!).update(`${id}:${purpose}:${code}`).digest('hex');
}
export function body(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(400, 'INVALID_INPUT', 'JSON object required');
  return value as Record<string, unknown>;
}
export function str(value: unknown, label: string) {
  if (typeof value !== 'string' || !value.length) throw new ApiError(400, 'INVALID_INPUT', `${label} is required`);
  return value;
}
export function phone(value: unknown) {
  const result = str(value, 'Phone').trim();
  if (!/^\+[1-9]\d{7,14}$/.test(result)) throw new ApiError(400, 'INVALID_INPUT', 'Use an international phone number, e.g. +919876543210');
  return result;
}
export function email(value: unknown) {
  const result = str(value, 'Email').trim().toLowerCase();
  if (result.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) throw new ApiError(400, 'INVALID_INPUT', 'Invalid email');
  return result;
}
export function password(value: unknown) {
  const result = str(value, 'Password');
  if (Array.from(result).length < 12 || Buffer.byteLength(result) > 72 || !result.trim()) {
    throw new ApiError(400, 'INVALID_INPUT', 'Password must have at least 12 characters and at most 72 UTF-8 bytes');
  }
  return result;
}
export function objectId(value: unknown) {
  const result = str(value, 'Challenge ID');
  if (!/^[a-f\d]{24}$/i.test(result)) throw new ApiError(400, 'INVALID_INPUT', 'Invalid challenge ID');
  return result;
}
export const errors: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ApiError) {
    if (err.status === 429) res.set('Retry-After', '60');
    res.status(err.status).json({ success: false, error: { code: err.code, message: err.message } });
  } else if (err?.code === 11000) {
    res.status(409).json({ success: false, error: { code: 'CONFLICT', message: 'Unable to complete this request. Try signing in or restarting verification.' } });
  } else if (err?.type === 'entity.parse.failed' || err?.type === 'entity.too.large') {
    res.status(err.type === 'entity.too.large' ? 413 : 400).json({ success: false, error: { code: 'INVALID_BODY', message: 'Invalid JSON or request too large' } });
  } else {
    console.error('Request failed:', err?.name ?? 'UnknownError');
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  }
};
