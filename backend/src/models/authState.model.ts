import mongoose from 'mongoose';

const sessionSchema = new mongoose.Schema({
  tokenHash: { type: String, required: true, unique: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  authVersion: { type: Number, required: true },
  expiresAt: { type: Date, required: true }
}, { timestamps: true });

sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Session = mongoose.model('Session', sessionSchema);

const resetSchema = new mongoose.Schema({
  tokenHash: { type: String, required: true, unique: true },
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  authVersion: { type: Number, required: true },
  expiresAt: { type: Date, required: true }
});

resetSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const ResetGrant = mongoose.model('ResetGrant', resetSchema);

// Persistent counters survive restarts; recipient limits span purposes and challenges.

const rateSchema = new mongoose.Schema({
  _id: String, count: { type: Number, default: 0 }, expiresAt: { type: Date, required: true }
});

rateSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RateBucket = mongoose.model('RateBucket', rateSchema);
