import mongoose from "mongoose";

const pendingSignupSchema = new mongoose.Schema(
    {
        fullName: {
            type: String,
            required: true,
            trim: true
        },
        email: {
            type: String,
            required: true,
            trim: true,
            lowercase: true
        },
        phone: {
            type: String,
            required: true,
            trim: true
        },
        passwordHash: {
            type: String,
            required: true,
            select: false
        },
        expiresAt: {
            type: Date,
            required: true,
            default: () => new Date(Date.now() + 60 * 60 * 1000)
        }
    },
    { timestamps: true }
);

pendingSignupSchema.index(
    { expiresAt: 1 },
    { expireAfterSeconds: 0 }
);

export const PendingSignup = mongoose.model(
    "PendingSignup",
    pendingSignupSchema
);