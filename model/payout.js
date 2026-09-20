import mongoose from "mongoose";

const payoutSchema = new mongoose.Schema(
  {
    streamerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Streamer",
      required: true,
      index: true,
    },

    periodStart: {
      type: Date,
      required: true,
    },

    periodEnd: {
      type: Date,
      required: true,
    },

    totalTips: {
      type: Number,
      required: true,
      default: 0,
    },

    totalAmount: {
      type: Number,
      required: true,
      default: 0,
    },

    status: {
      type: String,
      enum: ["pending", "paid"],
      default: "pending",
      index: true,
    },

    paidAt: {
      type: Date,
      default: null,
    },

    paymentReference: {
      type: String,
      default: "",
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

// One payout per streamer per month
payoutSchema.index(
  {
    streamerId: 1,
    periodStart: 1,
    periodEnd: 1,
  },
  {
    unique: true,
  }
);

const Payout = mongoose.model("Payout", payoutSchema);

export default Payout;