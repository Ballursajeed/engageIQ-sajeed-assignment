import mongoose from "mongoose";

const movieSchema = new mongoose.Schema(
    {
        externalMovieId: {
            type: String,
            required: true,
            unique: true,
            trim: true
        },
        title: {
            type: String,
            required: true,
            trim: true
        },
        poster: {
            type: String,
            default: null
        },
        imdbRating: {
            type: Number,
            min: 0,
            max: 10,
            default: null
        },
        publishedYear: {
            type: Number,
            default: null,
            validate: {
                validator: (value: number | null) =>
                    value === null || Number.isInteger(value),
                message: "Published year must be an integer"
            }
        }
    },
    { timestamps: true }
);

export const Movie = mongoose.model("Movie", movieSchema);