# EngageIQ — Movie Discovery Platform (auth milestone)

Express + TypeScript + MongoDB backend. This milestone implements signup, phone verification, email/password login, phone/OTP login, password reset, logout, and authenticated profile lookup. It is AI-assisted work based on the supplied starter; review the implementation before submitting and follow the recruiter's AI-use requirements.

**DEVELOPMENT ONLY: OTP delivery is fake. No WhatsApp message is sent. The app refuses to start in production.** Movie fetching, saved-movie APIs, frontend and deployment are the next milestone, not implemented here. Existing Movie model and User movie references are preserved.

## Quick start (Ubuntu)

Use Node.js 22.12+ and MongoDB Atlas (or a local replica set; transactions are required).

```bash
cd backend
npm ci
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Put the generated value in `OTP_SECRET`, and your own Atlas connection URI in `MONGO_URL`. In Atlas allow your current IP. Keep `NODE_ENV=development` and `OTP_MODE=fake`.

```bash
npm run typecheck
npm run dev
```

API listens on **127.0.0.1:8080** by default, deliberately not exposed to the network. A frontend on `http://localhost:5173` is allowed. `GET /api/health` checks database connectivity and labels fake OTP mode.

Build: `npm run build`; run compiled code: `npm start`. Production startup intentionally fails until real delivery is implemented and the guard is deliberately replaced.

## Environment variables

| Name | Purpose |
| --- | --- |
| `NODE_ENV` | `development` for local use; `test` for tests; production rejected |
| `PORT` | Local HTTP port, default 8080 |
| `MONGO_URL` | MongoDB connection URI; replica set/Atlas required |
| `OTP_MODE` | Must be `fake` in this milestone |
| `OTP_SECRET` | Random secret of at least 32 characters, used to HMAC OTPs |
| `FRONTEND_ORIGIN` | Exact allowed browser origin; default http://localhost:5173 |
| `TRUST_PROXY_HOPS` | Optional known proxy hop count; omitted by default; do not set for direct local access |
| `WAPIX_KEY` | Reserved; not used or verified yet |
| `RAPID_KEY` | Reserved; not used or verified yet |

No original `.env` is included in this deliverable. No live database was used in development/testing. If you distributed the original archive publicly, rotate the database credential it contained.

## API contract

Success: `{ "success": true, "data": ... }` with optional `message`. Error: `{ "success": false, "error": { "code": "...", "message": "..." } }`.

All mutation requests use `Content-Type: application/json`. OTP values are six-digit **strings**. Every request-OTP response includes `delivery: "fake"` and `devOtp`; use that value only for local testing. There is no fixed bypass code.

| Method | Route | JSON body / behavior |
| --- | --- | --- |
| POST | `/api/auth/signup` | `{fullName,email,phone,password}` → 202, challengeId, otpExpiresAt, devOtp |
| POST | `/api/auth/verify-phone` | `{challengeId,otp}` → 201 account created; then log in |
| POST | `/api/auth/login` | `{email,password}` → user, accessToken, tokenType, expiresIn |
| POST | `/api/auth/request-login-otp` | `{phone}` → 202 challenge data |
| POST | `/api/auth/verify-login-otp` | `{challengeId,otp}` → same session response as password login |
| POST | `/api/auth/request-password-reset` | `{phone}` → 202 challenge data |
| POST | `/api/auth/verify-password-reset` | `{challengeId,otp}` → resetToken, expiresIn |
| POST | `/api/auth/reset-password` | `{resetToken,password}` → password changed, all sessions revoked |
| POST | `/api/auth/resend-otp` | `{challengeId,purpose}` → replacement challenge data; purpose: signup/login/password-reset |
| GET | `/api/auth/me` | Requires `Authorization: Bearer <accessToken>` |
| POST | `/api/auth/logout` | Same authorization header; revokes current session |
| GET | `/api/health` | Connectivity check, no auth |

### Example flow

```bash
curl -s http://localhost:8080/api/auth/signup \
  -H 'Content-Type: application/json' \
  -d '{"fullName":"Local Tester","email":"tester@example.com","phone":"+919876543210","password":"example-password-123"}'
```

Use `data.challengeId` and `data.devOtp` from that response:

```bash
curl -s http://localhost:8080/api/auth/verify-phone \
  -H 'Content-Type: application/json' \
  -d '{"challengeId":"PASTE_CHALLENGE_ID","otp":"PASTE_DEV_OTP"}'

curl -s http://localhost:8080/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"tester@example.com","password":"example-password-123"}'

curl -s http://localhost:8080/api/auth/me \
  -H 'Authorization: Bearer PASTE_ACCESS_TOKEN'
```

Phone login and reset use the request → verify sequence from the table. Wait at least 60 seconds between OTP requests to the same phone, regardless of purpose. After reset verification, pass `resetToken` to reset-password; an OTP alone cannot change a password.

## Architecture

- `src/app.ts`: middleware and route wiring; Express 5 forwards rejected async handlers to centralized errors.
- `src/server.ts`: environment loading, startup, database/index initialization and graceful shutdown.
- `src/controllers/user.controller.ts`: validates inputs and orchestrates auth flows.
- `src/services/auth.service.ts`: OTP issuance/comparison, session creation, persistent rate limits.
- `src/lib/core.ts`: validators, error handling, token/hash helpers and fake-mode guard.
- `src/models/`: original User, PendingSignup, Movie and OtpChallenge models, plus small Session/ResetGrant/RateBucket models.
- `tests/auth.test.ts`: HTTP integration tests with disposable MongoDB replica set.

### Data and security decisions

- Pending signup details expire after one hour. OTPs expire after five minutes. Expiry is checked in queries; TTL indexes only clean up records later.
- Only verified signups create Users. Unique email/phone indexes are initialized at startup; concurrent conflicts are handled.
- Passwords use bcrypt work factor 12. Policy: 12+ characters, up to 72 UTF-8 bytes. Email normalization occurs before uniqueness checks. Phone format requires an international +number; format validation does not prove a working number.
- OTPs use Node crypto randomness and a keyed SHA-256 hash bound to challenge ID and purpose. Codes/hashes are not logged. Fake response exposes the test code intentionally, so this build must stay local.
- Five verification attempts per challenge are atomically reserved, including parallel requests. One use consumes the challenge inside a transaction together with the associated action.
- Resend invalidates the previous challenge. Recipient limits span all purposes: rolling 60-second cooldown and five requests per fixed hour. IP limit: 60 auth requests per 15-minute window. Counters are in MongoDB, not process memory.
- Sessions are random opaque bearer tokens, **not JWTs**. Only their SHA-256 hashes are stored. Seven-day absolute expiry; logout removes a session. No refresh token is needed for this milestone.
- Reset OTP produces a five-minute, single-use reset grant. Successful reset revokes all sessions, grants and existing user OTPs. An auth version plus transactional user write serializes resets with concurrent session issuance.
- Keep bearer tokens in frontend memory for now. Page refresh requires login again. Do not put tokens in URLs. Cookie-based persistence can be designed with CSRF handling when building the frontend.
- Same generic request response shape for existing/unknown accounts. Fake mode is a developer diagnostic facility, not an account-privacy guarantee against a tester who receives OTPs. Timing differences are not fully equalized.

### Database setup

Mongoose creates collections/indexes at startup with `model.init()`. No manual migration is needed for a fresh database. Use a separate development database. Transactions require Atlas or a replica set; standalone MongoDB is unsupported. Existing verified User documents from older code may need `authVersion: 0` and `sessionSerial: 0`; do not migrate unverified users as verified. This build never issues or uses the old raw `refreshToken` field.

## Tests

```bash
cd backend
npm test
npm run typecheck
npm run build
```

Tests download MongoDB 7.0.24 on first run (internet required), launch a temporary replica set and remove it afterwards. They do not connect to your Atlas database or spend OTP credit. They exercise actual HTTP handlers and database transactions.

## Verification results in the build environment

- `npm run typecheck`: passed.
- `npm run build`: passed.
- `npm run test:unit`: 6 tests passed.
- `npm run test:integration`: **blocked**, not passed. The downloaded MongoDB test process exits with `open: Operation not permitted` in this execution environment, before the HTTP assertions run. Run this suite on your Ubuntu machine; no end-to-end database success is claimed here.
- No Wapix/RapidAPI requests, live OTP messages, Atlas mutations or deployments were performed.

## Known limitations / next phase

- Wapix and IMDb236 are NOT integrated/tested. Keys are reserved only.
- Fake OTPs are returned in local responses; live delivery and production configuration are still required by the assignment.
- Resending requires the previous challenge to still exist. After TTL cleanup, restart signup or request a fresh login/reset OTP.
- Rate-limit windows can temporarily reject a legitimate retry; retries do not bypass recipient limits by making new pending signups.
- Pending signup storage has TTL cleanup; request/IP limits bound growth, but no global denial-of-service protection is claimed.
- The frontend folder remains empty. Movie fetching and saved-movie routes are not implemented in this auth milestone.
- No deployment URL, GitHub remote or demo credentials exist yet. No live-service verification is claimed.
- AI assistance must be disclosed honestly; the PDF requests independent backend implementation.

## Reference documentation

- https://mongoosejs.com/docs/transactions.html
- https://expressjs.com/en/guide/error-handling/
- https://www.wapix.sbs/docs (real delivery still pending)
