import type { Request, Response } from "express";
import mongoose from "mongoose";
import { randomInt } from "node:crypto";
import bcrypt from "bcrypt";

import { User } from "../models/user.model.js";
import { PendingSignup } from "../models/pendingSignup.model.js";
import { OtpChallenge } from "../models/otpChallenge.model.js";

import {
  Session,
  ResetGrant,
} from "../models/authState.model.js";

import {
  ApiError,
  body,
  str,
  phone,
  email,
  password,
  objectId,
  digest,
  token,
} from "../lib/core.js";

import {
  checkOtp,
  consume,
  createSession,
  invalidOtp,
  issue,
  recipientLimit,
} from "../services/auth.service.js";

import type { Purpose } from "../services/auth.service.js";

const accepted = (res: Response, data: unknown) =>
  res.status(202).json({
    success: true,
    message:
      "If eligible, verification can continue. Development fake delivery only.",
    data,
  });

function dummyChallenge() {
  return {
    challengeId: String(new mongoose.Types.ObjectId()),
    otpExpiresAt: new Date(Date.now() + 5 * 60 * 1000),
    delivery: "fake",
    devOtp: randomInt(100_000, 1_000_000).toString(),
  };
}

const dummyHash = await bcrypt.hash(token(), 12);

export async function userRegister(req: Request, res: Response) {
  const input = body(req.body);
  const fullName = str(input.fullName, "Full name").trim();

  if (fullName.length < 2 || fullName.length > 100) {
    throw new ApiError(
      400,
      "INVALID_INPUT",
      "Name must have 2–100 characters",
    );
  }

  const normalizedEmail = email(input.email);
  const normalizedPhone = phone(input.phone);
  const plainPassword = password(input.password);

  await recipientLimit(normalizedPhone);

  const passwordHash = await bcrypt.hash(plainPassword, 12);
  const existingUser = await User.exists({
    $or: [
      { email: normalizedEmail },
      { phone: normalizedPhone },
    ],
  });

  // Keep the response shape the same for existing and new accounts.
  if (existingUser) {
    return accepted(res, dummyChallenge());
  }

  const pendingSignup = await PendingSignup.create({
    fullName,
    email: normalizedEmail,
    phone: normalizedPhone,
    passwordHash,
  });

  try {
    const challenge = await issue(
      normalizedPhone,
      "signup",
      pendingSignup._id,
    );

    return accepted(res, challenge);
  } catch (error) {
    await PendingSignup.deleteOne({ _id: pendingSignup._id });
    throw error;
  }
}

export async function resend(req: Request, res: Response) {
  const input = body(req.body);
  const challengeId = objectId(input.challengeId);
  const purpose = str(input.purpose, "Purpose");

  if (
    purpose !== "signup" &&
    purpose !== "login" &&
    purpose !== "password-reset"
  ) {
    throw new ApiError(400, "INVALID_INPUT", "Invalid purpose");
  }

  const previousChallenge = await OtpChallenge.findOne({
    _id: challengeId,
    purpose,
  });

  if (!previousChallenge) {
    return accepted(res, dummyChallenge());
  }

  await recipientLimit(previousChallenge.phone);

  if (purpose === "signup") {
    const pendingSignup = await PendingSignup.findOne({
      _id: previousChallenge.pendingSignupId,
      phone: previousChallenge.phone,
      expiresAt: { $gt: new Date() },
    });

    if (!pendingSignup) {
      return accepted(res, dummyChallenge());
    }

    const challenge = await issue(
      previousChallenge.phone,
      "signup",
      pendingSignup._id,
    );

    return accepted(res, challenge);
  }

  const user = await User.findOne({
    _id: previousChallenge.userId,
    authVersion: previousChallenge.authVersion,
  });

  if (!user) {
    return accepted(res, dummyChallenge());
  }

  const challenge = await issue(
    user.phone,
    purpose,
    undefined,
    user._id,
    user.authVersion,
  );

  return accepted(res, challenge);
}

function readOtpInput(req: Request) {
  const input = body(req.body);
  const challengeId = objectId(input.challengeId);
  const code = str(input.otp, "OTP");

  if (!/^\d{6}$/.test(code)) {
    throw new ApiError(
      400,
      "INVALID_INPUT",
      "OTP must be six digits",
    );
  }

  return { challengeId, code };
}

export async function verifyPhone(req: Request, res: Response) {
  const { challengeId, code } = readOtpInput(req);
  const challenge = await checkOtp(
    challengeId,
    code,
    "signup",
  );

  await mongoose.connection.transaction(async (session) => {
    await consume(challengeId, "signup", session);

    const pendingSignup = await PendingSignup.findOneAndDelete({
      _id: challenge.pendingSignupId,
      phone: challenge.phone,
      expiresAt: { $gt: new Date() },
    })
      .select("+passwordHash")
      .session(session);

    if (!pendingSignup) {
      throw invalidOtp();
    }

    await User.create(
      [
        {
          fullName: pendingSignup.fullName,
          email: pendingSignup.email,
          phone: pendingSignup.phone,
          passwordHash: pendingSignup.passwordHash,
        },
      ],
      { session },
    );

    await OtpChallenge.deleteMany({
      phone: pendingSignup.phone,
      purpose: "signup",
    }).session(session);

    await PendingSignup.deleteMany({
      phone: pendingSignup.phone,
    }).session(session);
  });

  res.status(201).json({
    success: true,
    data: { status: "verified" },
    message: "Account created. You can now log in.",
  });
}

export async function login(req: Request, res: Response) {
  const input = body(req.body);
  const normalizedEmail = email(input.email);
  const plainPassword = str(input.password, "Password");

  if (Buffer.byteLength(plainPassword) > 72) {
    throw new ApiError(
      401,
      "INVALID_CREDENTIALS",
      "Invalid email or password",
    );
  }

  const user = await User.findOne({
    email: normalizedEmail,
  }).select("+passwordHash");

  const passwordHash = user?.passwordHash ?? dummyHash;
  const passwordMatches = await bcrypt.compare(
    plainPassword,
    passwordHash,
  );

  if (!user || !passwordMatches) {
    throw new ApiError(
      401,
      "INVALID_CREDENTIALS",
      "Invalid email or password",
    );
  }

  const sessionData = await mongoose.connection.transaction(
    (session) =>
      createSession(user._id, user.authVersion, session),
  );

  res.json({
    success: true,
    data: sessionData,
  });
}

export function requestOtp(purpose: "login" | "password-reset") {
  return async (req: Request, res: Response) => {
    const input = body(req.body);
    const normalizedPhone = phone(input.phone);

    await recipientLimit(normalizedPhone);

    const user = await User.findOne({
      phone: normalizedPhone,
    });

    if (!user) {
      return accepted(res, dummyChallenge());
    }

    const challenge = await issue(
      normalizedPhone,
      purpose,
      undefined,
      user._id,
      user.authVersion,
    );

    return accepted(res, challenge);
  };
}

export async function verifyLogin(req: Request, res: Response) {
  const { challengeId, code } = readOtpInput(req);
  const challenge = await checkOtp(
    challengeId,
    code,
    "login",
  );

  const sessionData = await mongoose.connection.transaction(
    async (session) => {
      await consume(challengeId, "login", session);

      if (!challenge.userId) {
        throw invalidOtp();
      }

      return createSession(
        challenge.userId,
        challenge.authVersion,
        session,
      );
    },
  );

  res.json({
    success: true,
    data: sessionData,
  });
}

export async function verifyReset(req: Request, res: Response) {
  const { challengeId, code } = readOtpInput(req);
  const challenge = await checkOtp(
    challengeId,
    code,
    "password-reset",
  );

  const resetToken = token();

  await mongoose.connection.transaction(async (session) => {
    await consume(challengeId, "password-reset", session);

    const user = await User.findOneAndUpdate(
      {
        _id: challenge.userId,
        authVersion: challenge.authVersion,
      },
      { $inc: { sessionSerial: 1 } },
      { session },
    );

    if (!user) {
      throw invalidOtp();
    }

    await ResetGrant.deleteMany({
      userId: user._id,
    }).session(session);

    await ResetGrant.create(
      [
        {
          userId: user._id,
          authVersion: user.authVersion,
          tokenHash: digest(resetToken),
          expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        },
      ],
      { session },
    );
  });

  res.json({
    success: true,
    data: {
      resetToken,
      expiresIn: 300,
    },
  });
}

export async function resetPassword(req: Request, res: Response) {
  const input = body(req.body);
  const resetToken = str(input.resetToken, "Reset token");
  const newPassword = password(input.password);

  if (!/^[a-f0-9]{64}$/.test(resetToken)) {
    throw new ApiError(
      400,
      "INVALID_RESET",
      "Invalid or expired reset token",
    );
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);

  await mongoose.connection.transaction(async (session) => {
    const grant = await ResetGrant.findOneAndDelete({
      tokenHash: digest(resetToken),
      expiresAt: { $gt: new Date() },
    }).session(session);

    if (!grant) {
      throw new ApiError(
        400,
        "INVALID_RESET",
        "Invalid or expired reset token",
      );
    }

    const user = await User.findOneAndUpdate(
      {
        _id: grant.userId,
        authVersion: grant.authVersion,
      },
      {
        $set: { passwordHash },
        $inc: { authVersion: 1 },
      },
      { session },
    );

    if (!user) {
      throw new ApiError(
        400,
        "INVALID_RESET",
        "Invalid or expired reset token",
      );
    }

    await Session.deleteMany({
      userId: user._id,
    }).session(session);

    await ResetGrant.deleteMany({
      userId: user._id,
    }).session(session);

    await OtpChallenge.deleteMany({
      userId: user._id,
    }).session(session);
  });

  res.json({
    success: true,
    message: "Password reset. Log in again.",
    data: null,
  });
}

export async function logout(_req: Request, res: Response) {
  await Session.deleteOne({
    _id: res.locals.sessionId,
  });

  res.json({
    success: true,
    data: null,
    message: "Logged out",
  });
}