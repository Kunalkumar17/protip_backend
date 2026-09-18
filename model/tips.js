import mongoose from "mongoose";

const tipsSchema = new mongoose.Schema(
  {
    streamerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Streamer",
      required: true,
      index: true,
    },

    name: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },

    amount: {
      type: Number,
      required: true,
      min: 1,
    },

    message: {
      type: String,
      lowercase: true,
      trim: true,
      default: "",
    },

    payment: {
      type: Boolean,
      default: false,
    },

    currency: {
      type: String,
      required: true,
      lowercase: true,
    },

    convertedAmount: {
      type: Number,
      default: 0,
    },

    memeSound: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

const Tips = mongoose.model("Tips", tipsSchema);

export default Tips;