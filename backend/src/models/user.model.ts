import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
    {
        fullName:{
            type:String,
            required: true,
            trim: true
        },
        email:{
            type:String,
            unique:true,
            required:true,
            trim: true,
            lowercase:true
        },
        phone: {
            type: String,
            unique: true,
            required: true,
            trim: true
        },
        passwordHash: {
            type: String,
            required: true,
            select: false
        },
        authVersion: { type: Number, default: 0 },
        sessionSerial: { type: Number, default: 0 },
        movies:[
            {
            type: mongoose.Schema.Types.ObjectId,
            ref:"Movie"
        }
        ]
    },
    {
        timestamps: true
    }
)

export const User = mongoose.model("User",userSchema); 