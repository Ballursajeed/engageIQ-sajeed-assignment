import type { Request, Response } from "express";
import { ApiError } from "../lib/core.js";
import { Movie } from "../models/movie.model.js";
import { User } from "../models/user.model.js";
import { limit } from "../services/auth.service.js";
import type { MovieResult } from "../services/movie.service.js";

function getUserId(res: Response): string {
    const userId = res.locals.user?.id;

    if (typeof userId !== "string") {
        throw new ApiError(
            401,
            "UNAUTHENTICATED",
            "Authentication required"
        );
    }

    return userId;
}

function validateMovieId(value: unknown): string {
    if (
        typeof value !== "string" ||
        !/^tt\d{7,12}$/.test(value)
    ) {
        throw new ApiError(
            400,
            "INVALID_MOVIE_ID",
            "Provide a valid IMDb movie ID"
        );
    }

    return value;
}

export async function saveMovie(req: Request, res: Response) {
    const userId = getUserId(res);
    const externalMovieId = validateMovieId(
        req.body?.externalMovieId
    );

    await limit(`saved-movie-write:${userId}`, 60, 60);

    const movie = await Movie.findOne({
        externalMovieId
    }).select("_id");

    if (!movie) {
        throw new ApiError(
            404,
            "MOVIE_NOT_FOUND",
            "Search for this movie before saving it"
        );
    }

    // Atomic: repeated or concurrent saves do not add duplicates.
    const result = await User.updateOne(
        { _id: userId },
        { $addToSet: { movies: movie._id } }
    );

    if (result.matchedCount === 0) {
        throw new ApiError(
            401,
            "UNAUTHENTICATED",
            "Authentication required"
        );
    }

    const added = result.modifiedCount > 0;

    res.status(added ? 201 : 200).json({
        success: true,
        message: added
            ? "Movie saved"
            : "Movie is already saved",
        data: {
            externalMovieId,
            saved: true
        }
    });
}

export async function getSavedMovies(
    _req: Request,
    res: Response
) {
    const userId = getUserId(res);

    const user = await User.findById(userId)
        .select("movies")
        .populate<{ movies: MovieResult[] }>({
            path: "movies",
            select:
                "externalMovieId title poster publishedYear imdbRating -_id"
        });

    if (!user) {
        throw new ApiError(
            401,
            "UNAUTHENTICATED",
            "Authentication required"
        );
    }

    const movies = user.movies.map((movie) => ({
        externalMovieId: movie.externalMovieId,
        title: movie.title,
        poster: movie.poster,
        publishedYear: movie.publishedYear,
        imdbRating: movie.imdbRating
    }));

    res.status(200).json({
        success: true,
        data: {
            movies,
            total: movies.length
        }
    });
}

export async function removeSavedMovie(
    req: Request,
    res: Response
) {
    const userId = getUserId(res);
    const externalMovieId = validateMovieId(
        req.params.externalMovieId
    );

    await limit(`saved-movie-write:${userId}`, 60, 60);

    const movie = await Movie.findOne({
        externalMovieId
    }).select("_id");

    if (movie) {
        await User.updateOne(
            { _id: userId },
            { $pull: { movies: movie._id } }
        );
    }

    // Removing an already-absent movie is also successful.
    // Keep the shared Movie document for other users.
    res.status(204).end();
}