# EngageIQ Movie Discovery Platform

A full-stack movie discovery application built with React, TypeScript, Express and MongoDB. Users can register, verify an OTP, sign in, search movies from IMDb236, and maintain a personal saved-movie collection.

## Links

- Frontend: https://engage-iq-sajeed-assignment.vercel.app
- Backend: https://engageiq-sajeed-assignment.onrender.com
- Health endpoint: https://engageiq-sajeed-assignment.onrender.com/api/health
- Repository: https://github.com/Ballursajeed/engageIQ-sajeed-assignment

## OTP integration status

**Real WhatsApp delivery is currently blocked and has not been verified successfully.**

The backend includes a Wapix integration using the request format provided by its dashboard. During testing on 9 October 2026:

- The OTP endpoint returned `success: false` with the message: `Please connect WhatsApp from the dashboard before sending OTP service`.
- Wapix's own dashboard could not start the WhatsApp session.
- Its `POST /api/v1/start/session` request returned HTTP 200 with `success: false` and `Request failed with status code 404` in the response body.
- Signing out and back in did not resolve the issue. The dashboard showed a stopped session, zero dispatches and an available balance.

These observations establish a session-startup blocker for the tested account; they do not establish a service-wide outage.

A simulated OTP mode is available for evaluation. In that mode, the API returns `devOtp` and the frontend displays it with a simulated-delivery notice. No WhatsApp message is sent and phone ownership is not established. The health endpoint reports the configured `otpMode`; it does not verify provider delivery.

**Use test details and a separate demo database for simulated OTP.** Anyone who knows an account's phone number can obtain its simulated login/reset code. Do not store real user accounts in a public fake-OTP demo. There is no fixed universal OTP.

## Features

- Signup with name, email, international phone number and password.
- Pending signup records; user accounts are created after successful challenge verification.
- Email/password and phone/OTP login flows.
- OTP-based password reset with a short-lived, single-use reset token.
- Profile information and logout.
- Backend movie retrieval from IMDb236 through RapidAPI.
- Movie cards with title, poster, year and rating when available.
- Debounced search with stale-request cancellation/ignoring.
- Cursor-based pagination that preserves the search query.
- Per-user saved movies, duplicate-save prevention and removal.
- Loading skeletons, empty states, error messages and missing-poster handling.

## Technology stack

| Area | Technology |
| --- | --- |
| Frontend | React, TypeScript, Vite, CSS |
| Backend | Node.js, Express 5, TypeScript |
| Database | MongoDB Atlas, Mongoose |
| Authentication | bcrypt, Node.js crypto, database-backed bearer sessions |
| OTP delivery | Wapix adapter; explicit simulated mode for development/demo |
| Movie data | IMDb236 on RapidAPI |
| Tests | Node.js test runner, mongodb-memory-server |
| Hosting | Vercel frontend, Render backend, MongoDB Atlas |

## Architecture

The React client calls the Express API. Express validates requests, checks sessions, accesses MongoDB and calls external providers. Provider keys stay on the backend.

Controllers coordinate requests, services contain authentication/provider logic, and Mongoose models define persisted data. Shared validation and error handling live in `lib/core.ts`.

```text
backend/
  src/
    app.ts
    server.ts
    config/db.ts
    controllers/
      user.controller.ts
      movie.controller.ts
      savedMovie.controller.ts
    services/
      auth.service.ts
      movie.service.ts
      wapix.service.ts
    models/
      user.model.ts
      pendingSignup.model.ts
      otpChallenge.model.ts
      authState.model.ts
      movie.model.ts
    lib/core.ts
  tests/
    auth.test.ts
    unit.test.ts
frontend/
  src/
    App.tsx
    Profile.tsx
    api.ts
    index.css
    main.tsx
README.md
```

### Data model

- **User:** profile fields, unique email/phone, password hash, authentication version and saved movie references.
- **PendingSignup:** registration details and password hash, with a one-hour expiry.
- **OtpChallenge:** phone, purpose, linked pending signup/user, keyed code hash, expiry and attempt count.
- **Session:** user, authentication version, token hash and expiry.
- **ResetGrant:** hashed reset token, user, authentication version and expiry.
- **RateBucket:** persistent counters and cooldown state.
- **Movie:** unique external IMDb ID and normalized metadata shared across users.

Saving adds a movie reference to the authenticated user's collection using `$addToSet`. Removing a save removes that user's reference, not the shared movie document.

## Local setup

### Prerequisites

- Node.js 22.12 or newer and npm. Prefer a supported LTS version.
- MongoDB Atlas or a local MongoDB replica set. Standalone MongoDB does not support the transactions used by authentication.
- An IMDb236 RapidAPI subscription/key with an available allowance.
- Wapix credentials and a working connected session only when testing real delivery.

### 1. Clone and install

```bash
git clone https://github.com/Ballursajeed/engageIQ-sajeed-assignment.git
cd engageIQ-sajeed-assignment
cd backend
npm ci
cp .env.example .env
```

Configure `backend/.env` using the table below. For local simulated OTP, use `NODE_ENV=development` and `OTP_MODE=fake`. Generate an OTP secret:

```bash
openssl rand -hex 32
```

Store the output in `OTP_SECRET`. Never commit it.

### 2. Configure MongoDB

Create a database user and allow your development machine's IP in Atlas Network Access. Set `MONGO_URL` to the connection URI with the intended database name. URL-encode special characters in credentials.

Use separate development and public-demo databases. Mongoose initializes authentication indexes at startup; model definitions also declare the movie external-ID index. A fresh database needs no SQL migration. Verify unique indexes exist before accepting traffic; schema changes to an existing database need explicit review.

TTL indexes clean up expired records asynchronously. Authentication checks expiry directly rather than relying on immediate TTL deletion.

### 3. Start the backend

```bash
npm run typecheck
npm run dev
```

The local API uses port 8080 when configured that way. Check `http://localhost:8080/api/health`.

### 4. Start the frontend

In a second terminal, from the repository root:

```bash
cd frontend
npm ci
```

Create `frontend/.env.local` containing:

```env
VITE_API_BASE_URL=http://localhost:8080/api
```

Set backend `FRONTEND_ORIGIN` to `http://localhost:5173`, then run:

```bash
npm run dev -- --port 5173 --strictPort
```

Open `http://localhost:5173`.

## Environment variables

Actual secrets must be supplied locally or through the hosting provider. Commit only placeholder examples.

| Variable | Location | Purpose |
| --- | --- | --- |
| `PORT` | Backend | HTTP listening port; read from the hosting environment |
| `MONGO_URL` | Backend | MongoDB connection URI, including database name |
| `NODE_ENV` | Backend | `development`, `test` or `production` |
| `OTP_MODE` | Backend | `fake` for simulated delivery or `wapix` for real requests |
| `OTP_SECRET` | Backend | Secret of at least 32 characters used to HMAC OTPs |
| `ALLOW_DEMO_OTP` | Backend | Explicit `true` opt-in for fake OTP with `NODE_ENV=production`; omit for real delivery |
| `WAPIX_KEY` | Backend | Wapix API key; required in `wapix` mode |
| `RAPID_KEY` | Backend | IMDb236 RapidAPI key |
| `FRONTEND_ORIGIN` | Backend | Exact allowed frontend origin, without a trailing slash |
| `TRUST_PROXY_HOPS` | Backend | Optional proxy hop count; configure only for a verified hosting topology |
| `VITE_API_BASE_URL` | Frontend | Public backend URL ending in `/api`; embedded during the frontend build |

Never put Wapix, RapidAPI or database credentials in a `VITE_` variable. Frontend environment variables are public.

## Provider configuration

### Wapix

Official documentation: https://www.wapix.sbs/docs

The adapter sends JSON to `https://api.wapix.sbs/api/v1/send/otp` with `service`, `text`, `otp`, `api_key` and **`whatsaap_number`** (the spelling shown in the provider example). The application stores international phone numbers with `+`; the adapter removes that prefix for Wapix.

The server generates the OTP and stores its keyed hash before making the external request. Sending happens outside the database transaction to avoid duplicate sends when transactions retry. Automatic delivery retries are disabled because an ambiguous timeout could otherwise spend credits twice. Failed/unconfirmed sends invalidate the new challenge.

Set `OTP_MODE=wapix`, configure `WAPIX_KEY`, and establish the WhatsApp session using the provider dashboard. Real mode omits `devOtp` from responses. HTTP 200 alone does not prove delivery; the adapter also checks explicit failure fields. The complete provider success schema and end-to-end delivery remain unverified.

### IMDb236 / RapidAPI

Subscribe to the assigned IMDb236 API using the available allowance and set `RAPID_KEY` on the backend. The service calls the `imdb236.p.rapidapi.com` host, normalizes movie fields and stores returned metadata for saving.

Search uses `primaryTitleAutocomplete`; pagination forwards the provider's `cursorMark`. The client receives an opaque `nextCursor` and must preserve the query when using it. A request without a query retrieves a general movie listing, not a curated popularity ranking. Missing metadata is represented as `null`.

## API documentation

Success responses use `success: true` and `data`, with an optional `message`. Errors use:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Readable explanation"
  }
}
```

Send JSON bodies with `Content-Type: application/json`. Protected routes require `Authorization: Bearer <accessToken>`. OTPs are six-digit strings.

| Method | Route | Body or behaviour | Auth |
| --- | --- | --- | --- |
| GET | `/api/health` | Database connectivity and configured OTP mode | No |
| POST | `/api/auth/signup` | `fullName`, `email`, `phone`, `password`; returns challenge metadata | No |
| POST | `/api/auth/verify-phone` | `challengeId`, `otp`; creates account after verification | No |
| POST | `/api/auth/login` | `email`, `password`; returns user and access token | No |
| POST | `/api/auth/request-login-otp` | `phone`; requests login challenge | No |
| POST | `/api/auth/verify-login-otp` | `challengeId`, `otp`; returns session | No |
| POST | `/api/auth/request-password-reset` | `phone`; requests reset challenge | No |
| POST | `/api/auth/verify-password-reset` | `challengeId`, `otp`; returns `resetToken` | No |
| POST | `/api/auth/reset-password` | `resetToken`, `password`; changes password and revokes sessions | No |
| POST | `/api/auth/resend-otp` | `challengeId`, `purpose` (`signup`, `login`, `password-reset`) | No |
| GET | `/api/auth/me` | Current public user profile | Yes |
| POST | `/api/auth/logout` | Revokes current session | Yes |
| GET | `/api/movies` | Optional `q` and `cursor` query parameters | Yes |
| POST | `/api/movies/saved` | `externalMovieId` from a fetched movie | Yes |
| GET | `/api/movies/saved` | Current user's saved movies | Yes |
| DELETE | `/api/movies/saved/:externalMovieId` | Removes current user's save | Yes |

Movie listing responses contain `movies`, `total`, `pageSize`, `nextCursor` and `hasNextPage`. Cards contain `externalMovieId`, `title`, `poster`, `publishedYear` and `imdbRating`.

OTP request responses use HTTP 202. Successful signup verification uses 201. A new save uses 201; an existing save uses 200. Successful removal uses 204 with no JSON body. Validation/authentication/rate-limit/provider failures use appropriate error responses such as 400, 401, 429 and 502/503/504.

## Authentication and security decisions

- Passwords use bcrypt with cost 12; validation requires at least 12 characters and at most 72 UTF-8 bytes.
- OTPs are generated with Node crypto and hashed with HMAC-SHA256 bound to challenge ID and purpose.
- Challenges expire after five minutes and allow at most five verification attempts. Attempts are reserved atomically.
- Recipient throttling includes a 60-second cooldown and five requests per fixed hour across purposes. Authentication also has an IP-based limit.
- Sessions use random opaque bearer tokens, not JWTs. Only token hashes are stored; sessions expire after seven days.
- Password-reset grants expire after five minutes, are single-use and revoke previous sessions when consumed successfully.
- Frontend access tokens are held in memory; reloading the page requires login again.
- Request responses are generic for existing/unknown accounts. Timing and provider-error differences are not fully equalized.
- Provider failures produce controlled client errors. Diagnostic provider messages are redacted; keys, passwords and raw OTPs must not be logged.

## Deployment

### Backend: Render

- Root directory: `backend`
- Build command: `npm ci --include=dev && npm run build`
- Start command: `node dist/server.js`
- Bind the HTTP server to `0.0.0.0` and use the `PORT` environment variable.
- Configure backend environment variables in Render.
- Add the service's outbound IP ranges to Atlas Network Access.
- Set `FRONTEND_ORIGIN` to the deployed frontend origin.

For real delivery, use `NODE_ENV=production` and `OTP_MODE=wapix`. For an explicitly labelled public demo, use `NODE_ENV=production`, `OTP_MODE=fake` and `ALLOW_DEMO_OTP=true`, with the matching configuration guard and a separate demo database. Never silently fall back to fake mode after provider failure.

### Frontend: Vercel

- Root directory: `frontend`
- Framework: Vite
- Build command: `npm run build`
- Output directory: `dist`
- Set `VITE_API_BASE_URL` to `https://engageiq-sajeed-assignment.onrender.com/api`.

Redeploy the frontend after changing its build-time environment variables. The backend CORS origin must match the frontend URL exactly.

## Tests and verification

From `backend`:

```bash
npm run typecheck
npm run test:unit
npm run test:integration
npm run build
```

From `frontend`:

```bash
npm run build
```

Authentication integration tests use a disposable MongoDB replica set and fake OTP. The first run downloads a MongoDB binary. They should not use the live Atlas database or spend Wapix credits.

The local authentication integration suite previously passed all 10 tests, covering pending signup, verification, login/logout, concurrent attempt limits, expiry/purpose checks, resend behaviour, single-use login codes, reset/session revocation, invalid inputs, generic response shapes and configuration guards. That run preceded the later Wapix adapter and public-demo changes; it is not proof that those newer changes pass all tests.

Manual local checks confirmed movie retrieval, cursor pagination and save/list/remove operations. Real Wapix delivery has not succeeded. A complete test of the latest deployed demo and setup from a clean clone remains to be recorded.

### Manual evaluation checklist

1. In fake mode, register with unused test details and enter the displayed development OTP.
2. Log in using email/password, then separately exercise phone/OTP login.
3. Reset the password and verify that the old password and previous session no longer work.
4. Search for a movie, move between pages and change the query; confirm pagination resets.
5. Save a movie, attempt a duplicate save, open Saved Movies and remove it.
6. Use a second test account to confirm saved collections are isolated.
7. Confirm unauthenticated movie requests are rejected and logout revokes access.
8. Check incorrect/expired OTPs, empty search results, loading/errors, mobile layout and keyboard navigation.

## Known limitations and trade-offs

- Simulated OTP does not meet the assignment's real WhatsApp verification requirement. Acceptance of that fallback requires evaluator agreement.
- Wapix session startup is blocked for the tested account; its complete success response and delivery behaviour remain unverified.
- Expired, incorrect and already-used OTPs currently share a generic `OTP_INVALID` response.
- Dummy challenges preserve generic account-existence responses; they cannot be verified. An already-registered user should log in rather than repeat signup.
- Resend requires the previous challenge to still exist. After TTL cleanup, restart the corresponding request flow.
- Provider availability and free allowances constrain live testing. There is no automatic resend or paid-service fallback.
- The app does not include movie-detail pages, session rotation or a dedicated search cache.
- Automated saved-movie API coverage has not been confirmed; basic CRUD was checked manually.
- The current release still needs a final dependency audit, repository secret scan and deployed end-to-end verification.

## Development approach

The candidate designed the initial data models and worked through implementation and debugging decisions. AI assistance was used for code generation, refactoring, frontend implementation and troubleshooting, including backend code. This is disclosed because the assignment distinguishes frontend AI assistance from independent backend implementation.
