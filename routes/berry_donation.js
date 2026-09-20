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

router.post("/webhook", async (req, res) => {
  try {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const webhookSignature = req.headers["x-razorpay-signature"];

    if (!webhookSecret) {
      console.error("RAZORPAY_WEBHOOK_SECRET is missing");
      return res.status(500).json({
        message: "Webhook secret is not configured"
      });
    }

    if (!webhookSignature) {
      return res.status(400).json({
        message: "Missing webhook signature"
      });
    }

    if (!req.rawBody) {
      console.error("Raw webhook body is missing");

      return res.status(400).json({
        message: "Raw webhook body is required"
      });
    }

    // Verify Razorpay webhook signature
    const expectedSignature = crypto
      .createHmac("sha256", webhookSecret)
      .update(req.rawBody)
      .digest("hex");

    if (expectedSignature !== webhookSignature) {
      console.error("Invalid Razorpay webhook signature");

      return res.status(400).json({
        message: "Invalid webhook signature"
      });
    }

    const event = req.body;

    console.log("Razorpay webhook received:", event.event);

    // Only process successful payments
    if (
      event.event !== "payment.captured" &&
      event.event !== "order.paid"
    ) {
      return res.status(200).json({
        message: "Event ignored"
      });
    }

    const paymentEntity =
      event.payload?.payment?.entity;

    const orderEntity =
      event.payload?.order?.entity;

    const paymentId =
      paymentEntity?.id;

    const orderId =
      paymentEntity?.order_id ||
      orderEntity?.id;

    if (!paymentId || !orderId) {
      console.error("Webhook missing payment/order ID");

      return res.status(400).json({
        message: "Missing payment/order information"
      });
    }

    // Get the order from Razorpay
    const order =
      await razorpayInstance.orders.fetch(orderId);

    if (!order.receipt) {
      console.error("Order has no receipt:", orderId);

      return res.status(400).json({
        message: "Order has no receipt"
      });
    }

    // Get the actual payment
    const payment =
      await razorpayInstance.payments.fetch(paymentId);

    if (payment.status !== "captured") {
      console.log(
        "Webhook payment not captured:",
        paymentId,
        payment.status
      );

      return res.status(200).json({
        message: "Payment not captured"
      });
    }

    // Find our tip
    const tip =
      await Tips.findById(order.receipt);

    if (!tip) {
      console.error(
        "Tip not found:",
        order.receipt
      );

      return res.status(404).json({
        message: "Tip not found"
      });
    }

    // Already processed
    if (tip.payment === true) {
      console.log(
        "Webhook: tip already processed:",
        tip._id.toString()
      );

      return res.status(200).json({
        success: true,
        message: "Payment already processed"
      });
    }

    // Verify amount
    const expectedAmount =
      Math.round(Number(tip.amount) * 100);

    if (Number(payment.amount) !== expectedAmount) {
      console.error("Webhook amount mismatch");

      return res.status(400).json({
        message: "Payment amount does not match tip"
      });
    }

    // Verify currency
    if (
      payment.currency &&
      tip.currency &&
      payment.currency.toUpperCase() !==
        tip.currency.toUpperCase()
    ) {
      console.error("Webhook currency mismatch");

      return res.status(400).json({
        message: "Payment currency does not match tip"
      });
    }

    // Convert to INR
    const convertedAmount =
      await convertToINR(
        tip.amount,
        tip.currency
      );

    if (convertedAmount === null) {
      return res.status(500).json({
        message: "Could not convert payment amount to INR"
      });
    }

    // IMPORTANT:
    // Atomically mark payment as completed.
    // This prevents the webhook and frontend verification
    // from triggering two alerts.
    const updatedTip =
      await Tips.findOneAndUpdate(
        {
          _id: tip._id,
          payment: false
        },
        {
          $set: {
            payment: true,
            convertedAmount
          }
        },
        {
          new: true
        }
      );

    if (!updatedTip) {
      console.log(
        "Webhook: payment already claimed:",
        tip._id.toString()
      );

      return res.status(200).json({
        success: true,
        message: "Payment already processed"
      });
    }

    // Send alert to OBS
    const donation = {
      name: updatedTip.name,
      amount: updatedTip.amount,
      currency: updatedTip.currency,
      message: updatedTip.message || "",
      memeSound: updatedTip.memeSound || null,
      convertedAmount,
      streamerId: updatedTip.streamerId,
    };

    try {
      broadcastTip(
      donation.streamerId,
      donation
    );
    } catch (broadcastError) {
      console.error(
        "Payment recorded but OBS broadcast failed:",
        broadcastError
      );
    }

    console.log(
      "Webhook payment recorded:",
      updatedTip._id.toString()
    );

    return res.status(200).json({
      success: true,
      message: "Payment recorded successfully"
    });

  } catch (error) {
    console.error(
      "Razorpay webhook error:",
      error
    );

    // 500 tells Razorpay to retry
    return res.status(500).json({
      message: error.message
    });
  }
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

if (convertedAmount === null) {
  return res.status(500).json({
    message: "Could not convert payment amount to INR",
  });
}

const updatedTip = await Tips.findOneAndUpdate(
  {
    _id: tip._id,
    payment: false,
  },
  {
    $set: {
      payment: true,
      convertedAmount,
    },
  },
  {
    new: true,
  }
);

if (!updatedTip) {
  console.log(
    "🍓 Berry payment already processed:",
    tip._id.toString()
  );

  return res.status(200).json({
    success: true,
    message: "Payment already processed",
  });
}

const donation = {
  name: updatedTip.name,
  amount: updatedTip.amount,
  currency: updatedTip.currency,
  message: updatedTip.message || "",
  memeSound: updatedTip.memeSound || null,
  convertedAmount,
  streamerId: updatedTip.streamerId,
};

broadcastTip(
  donation.streamerId,
  donation
);

console.log(
  "🍓 Berry tip successfully processed:",
  updatedTip._id
);

return res.status(200).json({
  success: true,
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
