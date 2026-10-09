import express from 'express';
import mongoose from 'mongoose';
import { ApiError, digest, errors, fakeMode } from './lib/core.js';
import { limit, publicUser } from './services/auth.service.js';
import { Session } from './models/authState.model.js';
import { User } from './models/user.model.js';
import * as auth from './controllers/user.controller.js';
import { getMovies } from "./controllers/movie.controller.js";
import {
    saveMovie,
    getSavedMovies,
    removeSavedMovie
} from "./controllers/savedMovie.controller.js";

export function createApp() {

  fakeMode();

  const app = express();

  app.disable('x-powered-by');

  // Default trusts no proxy headers. Set only for a known reverse-proxy topology.
  if (process.env.TRUST_PROXY_HOPS) app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS));

  app.use((req, res, next) => {

    res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
    const origin = req.headers.origin;

    if (origin) {
      if (origin !== (process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173')) return next(new ApiError(403, 'ORIGIN_DENIED', 'Origin not allowed'));
      res.set('Access-Control-Allow-Origin', origin).vary('Origin');
      res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.set('Access-Control-Allow-Methods', 'GET, POST, DELETE ,OPTIONS');
    }

    if (req.method === 'OPTIONS') { 
      res.sendStatus(204); return; 
    }
    next();

  });

  app.use(express.json({ limit: '16kb' }));

  app.get('/api/health', (_req, res) => {
    const connected = mongoose.connection.readyState === 1;
    res.status(connected ? 200 : 503).json({ success: connected, data: { status: connected ? 'okay' : 'unavailable', otpMode: 'fake' } });
  });

   app.use('/api/auth', async (req, _res, next) => {
    await limit(`auth-ip:${req.ip}`, 60, 900);
    next();
  });

  app.post('/api/auth/signup', auth.userRegister);
  app.post('/api/auth/verify-phone', auth.verifyPhone);
  app.post('/api/auth/resend-otp', auth.resend);
  app.post('/api/auth/login', auth.login);
  app.post('/api/auth/request-login-otp', auth.requestOtp('login'));
  app.post('/api/auth/verify-login-otp', auth.verifyLogin);
  app.post('/api/auth/request-password-reset', auth.requestOtp('password-reset'));
  app.post('/api/auth/verify-password-reset', auth.verifyReset);
  app.post('/api/auth/reset-password', auth.resetPassword);

  app.use(['/api/auth', '/api/movies'], async (req, res, next) => {
    const header = req.headers.authorization ?? '';
    if (!/^Bearer [a-f0-9]{64}$/.test(header)) throw new ApiError(401, 'UNAUTHENTICATED', 'Authentication required');
    const session = await Session.findOne({ tokenHash: digest(header.slice(7)), expiresAt: { $gt: new Date() } });
    const user = session && await User.findOne({ _id: session.userId, authVersion: session.authVersion });
    if (!session || !user) throw new ApiError(401, 'UNAUTHENTICATED', 'Authentication required');
    res.locals.user = publicUser(user); res.locals.sessionId = session._id;
    next();
  });

  app.get('/api/auth/me', (_req, res) => res.json({ success: true, data: res.locals.user }));

  app.post('/api/auth/logout', auth.logout);

  app.get('/api/movies', getMovies);

  app.post('/api/movies/saved', saveMovie);
  app.get('/api/movies/saved', getSavedMovies);
  app.delete(
      '/api/movies/saved/:externalMovieId',
      removeSavedMovie
  );

  app.use((_req, _res, next) => next(new ApiError(404, 'NOT_FOUND', 'Route not found')));

  app.use(errors);
  
  return app;
}
