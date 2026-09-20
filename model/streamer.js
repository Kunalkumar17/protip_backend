import mongoose from "mongoose";

const streamerSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    username: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: true,
      select: false,
    },
    channelName: {
      type: String,
      trim: true,
      default: "",
    },
    emailVerified: {
      type: Boolean,
      default: false,
    },

    emailVerificationToken: {
      type: String,
      default: null,
    },

    emailVerificationExpires: {
      type: Date,
      default: null,
    },
    upiId: {
    type: String,
    default: "",
    trim: true,
    lowercase: true,
    },
  },
  {
    timestamps: true,
  }
);

const Streamer = mongoose.model("Streamer", streamerSchema);

export default Streamer;
