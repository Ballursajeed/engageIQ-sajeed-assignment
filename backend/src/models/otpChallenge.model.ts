import mongoose from "mongoose";

const otpChallengeSchema = new mongoose.Schema(
    {
        phone: {
            type: String,
            required: true
        },
        purpose: {
            type: String,
            enum: ["signup", "login", "password-reset"],
            required: true
        },
        pendingSignupId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "PendingSignup"
        },
        userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        authVersion: { type: Number, default: 0 },
        codeHash: {
            type: String,
            required: true,
            select: false
        },
        expiresAt: {
            type: Date,
            required: true
        },
        attempts: {
            type: Number,
            default: 0
        }
    },
    { timestamps: true }
);

otpChallengeSchema.index(
    { expiresAt: 1 },
    { expireAfterSeconds: 0 }
);

export const OtpChallenge = mongoose.model(
    "OtpChallenge",
    otpChallengeSchema
);