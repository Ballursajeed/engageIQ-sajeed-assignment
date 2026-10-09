import mongoose from "mongoose";
import { randomInt, timingSafeEqual } from "node:crypto";

import { User } from "../models/user.model.js";
import { PendingSignup } from "../models/pendingSignup.model.js";
import { OtpChallenge } from "../models/otpChallenge.model.js";

import {
  Session,
  ResetGrant,
  RateBucket,
} from "../models/authState.model.js";

import {
  ApiError,
  digest,
  validateOtpConfig,
  otpHash,
  token,
} from "../lib/core.js";

export type Purpose = "signup" | "login" | "password-reset";

import { sendWapixOtp } from "./wapix.service.js";


const OTP_EXPIRY_MS = 5 * 60 * 1000;
const SESSION_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

export function publicUser(user: {
  _id: unknown;
  fullName: string;
  email: string;
  phone: string;
}) {
  return {
    id: String(user._id),
    fullName: user.fullName,
    email: user.email,
    phone: user.phone,
  };
}

export async function limit(
  key: string,
  maximum: number,
  windowSeconds: number,
) {
  const windowNumber = Math.floor(
    Date.now() / (windowSeconds * 1000),
  );

  const bucketId = digest(
    `${key}:${windowSeconds}:${windowNumber}`,
  );

  let bucket;

  try {
    bucket = await RateBucket.findOneAndUpdate(
      { _id: bucketId },
      {
        $inc: { count: 1 },
        $setOnInsert: {
          expiresAt: new Date(
            (windowNumber + 2) * windowSeconds * 1000,
          ),
        },
      },
      {
        upsert: true,
        returnDocument: "after",
      },
    );
  } catch (error) {
    // Two simultaneous first requests can race to create the same bucket.
    if ((error as { code?: number }).code !== 11000) {
      throw error;
    }

    bucket = await RateBucket.findOneAndUpdate(
      { _id: bucketId },
      { $inc: { count: 1 } },
      { returnDocument: "after" },
    );
  }

  if (!bucket || bucket.count! > maximum) {
    throw new ApiError(
      429,
      "RATE_LIMITED",
      "Too many requests. Please wait and try again.",
    );
  }
}

export async function recipientLimit(phone: string) {
  const cooldownId = digest(`otp-cooldown:${phone}`);
  const now = new Date();

  try {
    await RateBucket.findOneAndUpdate(
      {
        _id: cooldownId,
        expiresAt: { $lte: now },
      },
      {
        $set: {
          expiresAt: new Date(Date.now() + 60_000),
          count: 1,
        },
      },
      { upsert: true },
    );
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      throw new ApiError(
        429,
        "RATE_LIMITED",
        "Wait 60 seconds before requesting another OTP",
      );
    }

    throw error;
  }

  await limit(`otp-hour:${phone}`, 5, 60 * 60);
}

export async function issue(
  phone: string,
  purpose: Purpose,
  pendingId?: mongoose.Types.ObjectId,
  userId?: mongoose.Types.ObjectId,
  authVersion = 0,
) {
  const mode = validateOtpConfig();

  const challengeId = new mongoose.Types.ObjectId();
  const code = randomInt(100_000, 1_000_000).toString();
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MS);

  await mongoose.connection.transaction(async (session) => {
    await OtpChallenge.deleteMany({ phone, purpose }).session(session);

    await OtpChallenge.create(
      [
        {
          _id: challengeId,
          phone,
          purpose,
          pendingSignupId: pendingId,
          userId,
          authVersion,
          codeHash: otpHash(String(challengeId), purpose, code),
          expiresAt,
        },
      ],
      { session },
    );
  });

  if (mode === "fake") {
    return {
      challengeId: String(challengeId),
      otpExpiresAt: expiresAt,
      delivery: "fake",
      devOtp: code,
    };
  }

  try {
    // Outside the transaction: transaction retries must not resend OTPs.
    await sendWapixOtp(phone, code);
  } catch (error) {
    // Invalidate this challenge if sending failed or was unconfirmed.
    await OtpChallenge.deleteOne({ _id: challengeId });
    throw error;
  }

  return {
    challengeId: String(challengeId),
    otpExpiresAt: expiresAt,
    delivery: "whatsapp",
  };
}

export function invalidOtp() {
  return new ApiError(
    400,
    "OTP_INVALID",
    "Invalid, expired or already used OTP",
  );
}

export async function checkOtp(
  id: string,
  code: string,
  purpose: Purpose,
) {
  // Increment before checking so concurrent guesses share the same limit.
  const challenge = await OtpChallenge.findOneAndUpdate(
    {
      _id: id,
      purpose,
      expiresAt: { $gt: new Date() },
      attempts: { $lt: 5 },
    },
    { $inc: { attempts: 1 } },
    { returnDocument: "after" },
  ).select("+codeHash");

  if (!challenge) {
    throw invalidOtp();
  }

  const expectedHash = Buffer.from(challenge.codeHash, "hex");
  const submittedHash = Buffer.from(
    otpHash(id, purpose, code),
    "hex",
  );

  const hashesMatch =
    expectedHash.length === submittedHash.length &&
    timingSafeEqual(expectedHash, submittedHash);

  if (!hashesMatch) {
    throw invalidOtp();
  }

  return challenge;
}

export async function consume(
  id: string,
  purpose: Purpose,
  session: mongoose.ClientSession,
) {
  const challenge = await OtpChallenge.findOneAndDelete({
    _id: id,
    purpose,
    expiresAt: { $gt: new Date() },
  }).session(session);

  if (!challenge) {
    throw invalidOtp();
  }
}

export async function createSession(
  userId: mongoose.Types.ObjectId,
  version: number,
  session: mongoose.ClientSession,
) {
  // Updating the user here serializes session creation with password reset.
  const user = await User.findOneAndUpdate(
    { _id: userId, authVersion: version },
    { $inc: { sessionSerial: 1 } },
    {
      returnDocument: "after",
      session,
    },
  );

  if (!user) {
    throw new ApiError(
      401,
      "INVALID_CREDENTIALS",
      "Authentication failed",
    );
  }

  const accessToken = token();

  await Session.create(
    [
      {
        userId,
        authVersion: version,
        tokenHash: digest(accessToken),
        expiresAt: new Date(Date.now() + SESSION_EXPIRY_MS),
      },
    ],
    { session },
  );

  return {
    user: publicUser(user),
    accessToken,
    tokenType: "Bearer",
    expiresIn: 7 * 24 * 60 * 60,
  };
}

export async function initializeModels() {
  const models = [
    User,
    PendingSignup,
    OtpChallenge,
    Session,
    ResetGrant,
    RateBucket,
  ];

  for (const model of models) {
    await model.init();
  }
}