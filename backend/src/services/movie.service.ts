import { ApiError } from "../lib/core.js";
import { Movie } from "../models/movie.model.js";

export interface MovieResult {
    externalMovieId: string;
    title: string;
    poster: string | null;
    publishedYear: number | null;
    imdbRating: number | null;
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeMovie(value: unknown): MovieResult {
    if (
        !isObject(value) ||
        typeof value.id !== "string" ||
        !/^tt\d+$/.test(value.id) ||
        typeof value.primaryTitle !== "string" ||
        !value.primaryTitle.trim()
    ) {
        throw new ApiError(
            502,
            "INVALID_MOVIE_RESPONSE",
            "Movie provider returned an unexpected response"
        );
    }

    let poster: string | null = null;

    if (typeof value.primaryImage === "string") {
        try {
            const url = new URL(value.primaryImage);

            if (url.protocol === "https:") {
                poster = url.href;
            }
        } catch {
            // Invalid poster URLs use the frontend placeholder.
        }
    }

    return {
        externalMovieId: value.id,
        title: value.primaryTitle,
        poster,
        publishedYear:
            typeof value.startYear === "number" &&
            Number.isInteger(value.startYear)
                ? value.startYear
                : null,
        imdbRating:
            typeof value.averageRating === "number" &&
            Number.isFinite(value.averageRating) &&
            value.averageRating >= 0 &&
            value.averageRating <= 10
                ? value.averageRating
                : null
    };
}

export async function searchMovies(
    query: string = "",
    cursor?: string
) {
    const apiKey = process.env.RAPID_KEY?.trim();

    if (!apiKey) {
        throw new ApiError(
            503,
            "MOVIE_API_NOT_CONFIGURED",
            "Movie search is not configured"
        );
    }

    const url = new URL(
        "https://imdb236.p.rapidapi.com/api/imdb/search"
    );

    if (query) {
        url.searchParams.set("primaryTitleAutocomplete", query);
    }

    if (cursor) {
        url.searchParams.set("cursorMark", cursor);
    }

    url.searchParams.set("type", "movie");
    url.searchParams.set("rows", "25");
    url.searchParams.set("sortOrder", "ASC");
    url.searchParams.set("sortField", "id");

    // Do not add the zero-runtime filters from the playground.
    const signal = AbortSignal.timeout(10_000);

    try {
        const response = await fetch(url, {
            headers: {
                "x-rapidapi-host": "imdb236.p.rapidapi.com",
                "x-rapidapi-key": apiKey,
                Accept: "application/json"
            },
            signal
        });

        if (response.status === 429) {
            throw new ApiError(
                503,
                "MOVIE_PROVIDER_LIMIT",
                "Movie provider limit reached. Please try again later."
            );
        }

        if (response.status === 401 || response.status === 403) {
            throw new ApiError(
                503,
                "MOVIE_PROVIDER_ACCESS",
                "Movie provider access is unavailable"
            );
        }

        if (!response.ok) {
            throw new ApiError(
                502,
                "MOVIE_PROVIDER_ERROR",
                "Movie provider could not complete the request"
            );
        }

        const data: unknown = await response.json();

        if (
            !isObject(data) ||
            !Array.isArray(data.results) ||
            typeof data.numFound !== "number" ||
            !Number.isSafeInteger(data.numFound) ||
            data.numFound < 0
        ) {
            throw new ApiError(
                502,
                "INVALID_MOVIE_RESPONSE",
                "Movie provider returned an unexpected response"
            );
        }

        const movies = data.results.map(normalizeMovie);

        // Store provider-supplied details so saving only needs an IMDb ID.
        // This does not add these movies to any user's saved list.
        if (movies.length > 0) {
            await Movie.bulkWrite(
                movies.map((movie) => ({
                    updateOne: {
                        filter: {
                            externalMovieId: movie.externalMovieId
                        },
                        update: {
                            $set: movie
                        },
                        upsert: true
                    }
                }))
            );
        }

        const providerCursor =
            typeof data.nextCursorMark === "string"
                ? data.nextCursorMark
                : null;

        const nextCursor =
            movies.length === 25 &&
            providerCursor !== null &&
            providerCursor !== "*" &&
            providerCursor !== cursor
                ? providerCursor
                : null;

        return {
            movies,
            total: data.numFound,
            pageSize: 25,
            nextCursor,
            hasNextPage: nextCursor !== null
        };

    } 
    catch (error) {
        if (error instanceof ApiError) {
            throw error;
        }

        if (signal.aborted) {
            throw new ApiError(
                504,
                "MOVIE_PROVIDER_TIMEOUT",
                "Movie search timed out. Please try again."
            );
        }

        throw new ApiError(
            502,
            "MOVIE_PROVIDER_UNAVAILABLE",
            "Unable to load movies. Please try again."
        );
    }
}