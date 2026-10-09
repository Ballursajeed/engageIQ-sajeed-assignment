import mongoose from "mongoose";

export async function connectDB(): Promise<void> {
    const mongoURL = process.env.MONGO_URL;

    if (!mongoURL) {
        throw new Error("Missing required environment variable: MONGO_URL");
    }

    await mongoose.connect(mongoURL, {
        serverSelectionTimeoutMS: 10_000,
    });

    console.log("MongoDB connected");
}