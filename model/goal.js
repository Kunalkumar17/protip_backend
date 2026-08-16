import mongoose from "mongoose";

const goalSchema = new mongoose.Schema(
  {
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
  },
  {
    timestamps: true,
  }
);

const Goal = mongoose.model("Goal", goalSchema);

export default Goal;