import type { Request, Response } from "express";
import { ApiError } from "../lib/core.js";
import { limit } from "../services/auth.service.js";
import { searchMovies } from "../services/movie.service.js";

export async function getMovies(req: Request, res: Response) {
    const userId = res.locals.user?.id;

    if (typeof userId !== "string") {
        throw new ApiError(
            401,
            "UNAUTHENTICATED",
            "Authentication required"
        );
    }

    const rawQuery = req.query.q;
    const rawCursor = req.query.cursor;

    if (
        rawQuery !== undefined &&
        typeof rawQuery !== "string"
    ) {
        throw new ApiError(
            400,
            "INVALID_QUERY",
            "Search must be a string"
        );
    }

    const query = (rawQuery ?? "").trim();

    // Empty search loads the default list.
    if (
        query.length > 100 ||
        (query.length > 0 && query.length < 2)
    ) {
        throw new ApiError(
            400,
            "INVALID_QUERY",
            "Search must contain between 2 and 100 characters"
        );
    }

    if (
        rawCursor !== undefined &&
        (
            typeof rawCursor !== "string" ||
            rawCursor.length === 0 ||
            rawCursor.length > 2048 ||
            /\s/.test(rawCursor)
        )
    ) {
        throw new ApiError(
            400,
            "INVALID_CURSOR",
            "Invalid pagination cursor"
        );
    }

    await limit(`movie-search:${userId}`, 30, 60);

    const data = await searchMovies(query, rawCursor);

    res.status(200).json({
        success: true,
        data
    });
}