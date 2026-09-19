import express from "express";
import Razorpay from "razorpay";
import crypto from "crypto";

import Tips from "../model/tips.js";
import Streamer from "../model/streamer.js";
import { broadcastTip } from "../websocket.js";
import rateLimit from "express-rate-limit";

// Import these if they already exist in your normal donation.js
// If convertToINR is not exported from donations.js,
import { convertToINR } from "../utils/currency.js";
// move it to a shared utility file instead.

const router = express.Router();

const razorpayInstance = new Razorpay({
  key_id: process.env.BERRY_RAZOR_KEY_ID,
  key_secret: process.env.BERRY_RAZOR_SECRET_KEY,
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,

  message: {
    message: "Too many requests. Please slow down."
  }
});

const paymentLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: "Too many payment requests. Please wait a moment."
  }
});


// =====================================================
// BERRY - VERIFY RAZORPAY PAYMENT
// =====================================================

router.post("/verifyRazorpay", paymentLimiter, async (req, res) => {
  const {
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
  } = req.body;

  try {
    const sign =
      razorpay_order_id + "|" + razorpay_payment_id;

    const expectedSignature = crypto
      .createHmac(
        "sha256",
        process.env.BERRY_RAZOR_SECRET_KEY
      )
      .update(sign)
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({
        message: "Invalid signature",
      });
    }

    console.log("🍓 Berry signature valid");

    // Fetch Berry Razorpay order
    const order =
      await razorpayInstance.orders.fetch(
        razorpay_order_id
      );

    console.log("🍓 Berry order:", order);

    // Find tip
    const tip =
      await Tips.findById(order.receipt);

    if (!tip) {
      return res.status(404).json({
        message: "Tip not found",
      });
    }

    console.log("🍓 Tip found:", tip._id);

    // Fetch payment
    const payment =
      await razorpayInstance.payments.fetch(
        razorpay_payment_id
      );

    console.log("🍓 Payment:", {
      id: payment.id,
      status: payment.status,
      amount: payment.amount,
    });

    // Make sure payment was captured
    if (payment.status !== "captured") {
      return res.status(400).json({
        message: "Payment has not been captured",
      });
    }

    // Verify amount
    const expectedAmount =
      Math.round(Number(tip.amount) * 100);

    if (payment.amount !== expectedAmount) {
      return res.status(400).json({
        message: "Payment amount mismatch",
      });
    }

        const convertedAmount = await convertToINR(
    tip.amount,
    tip.currency
    );

    await Tips.findByIdAndUpdate(
    tip._id,
    {
        payment: true,
        convertedAmount,
    }
    );

    // Send tip to OBS / WebSocket
    const donation = {
      name: tip.name,
      amount: tip.amount,
      currency: tip.currency,
      message: tip.message || "",
      memeSound: tip.memeSound || null,
      convertedAmount,
      streamerId: tip.streamerId,
    };

    broadcastTip(
      donation.streamerId,
      donation
    );

    console.log(
      "🍓 Berry tip successfully processed:",
      tip._id
    );

    return res.status(201).json({
      message: "Payment verified",
    });

  } catch (error) {
    console.error(
      "🍓 Berry verification error:",
      error
    );

    return res.status(500).json({
      message: error.message,
    });
  }
});


// =====================================================
// BERRY - CREATE RAZORPAY ORDER
// =====================================================

router.post("/razorpay", async (req, res) => {
  try {
    const {
      name,
      amount,
      message,
      memeSound,
      currency,
      streamer,
    } = req.body;


    // ---------------------------------------------
    // Validate donation data
    // ---------------------------------------------

    if (
      !name ||
      !amount ||
      !currency ||
      !streamer
    ) {
      return res.status(400).json({
        message: "Invalid donation data",
      });
    }


    // ---------------------------------------------
    // Find streamer
    // ---------------------------------------------

    const streamerAccount =
      await Streamer.findOne({
        username: String(streamer)
          .toLowerCase()
          .trim(),
      });

    if (!streamerAccount) {
      return res.status(404).json({
        message: "Streamer not found",
      });
    }


    // ---------------------------------------------
    // Create tip
    // ---------------------------------------------

    const newTip = new Tips({
      streamerId: streamerAccount._id,
      name,
      amount,
      message: message || "",
      memeSound: memeSound || null,
      currency: String(currency).toLowerCase(),
      payment: false,
    });

    await newTip.save();


    // ---------------------------------------------
    // Create BERRY Razorpay order
    // ---------------------------------------------

    const options = {
      amount: Math.round(
        Number(amount) * 100
      ),

      currency,

      receipt: newTip._id.toString(),
    };


    const order =
      await razorpayInstance.orders.create(
        options
      );


    console.log(
      "🍓 Berry Razorpay order created:",
      order.id
    );


    return res.status(201).json(order);

  } catch (error) {
    console.error(
      "🍓 Berry order creation error:",
      error
    );

    return res.status(500).json({
      message: error.message,
    });
  }
});


export default router;
