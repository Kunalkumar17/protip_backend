import mongoose from "mongoose";

const goalSchema = new mongoose.Schema(
  {
    streamerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Streamer",
      required: true,
      unique: true,
      index: true,
    },

    name: {
      type: String,
      default: "Monthly Goal",
    },

    target: {
      type: Number,
      default: 10000,
    },

    total: {
      type: Number,
      default: 0,
    },

    channelName: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

const Goal = mongoose.model("Goal", goalSchema);

export default Goal;