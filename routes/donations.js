  import express from "express";
  import Tips from "../model/tips.js"
  import Razorpay from 'razorpay'
  import crypto from "crypto";
  import { broadcastTip, broadcast } from "../websocket.js";
  import Goal from "../model/goal.js";
  import rateLimit from "express-rate-limit";
  import { requireAuth } from "../middleware/auth.js";
  import Streamer from "../model/streamer.js";


  const router = express.Router();
  

  const razorpayInstance = new Razorpay({
    key_id: process.env.BERRY_RAZOR_KEY_ID,
    key_secret: process.env.BERRY_RAZOR_SECRET_KEY
})

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


router.use(apiLimiter);

async function convertToINR(amount, currency) {
  const base = currency.toUpperCase();

  if (base === "INR") {
    return Number(amount);
  }

  try {
    const response = await fetch(
      `https://api.frankfurter.dev/v2/rate/${base}/INR`
    );

    if (!response.ok) {
      throw new Error(
        `Could not get ${base}/INR exchange rate`
      );
    }

    const data = await response.json();

    return Number(amount) * Number(data.rate);

  } catch (error) {
    console.error(
      `Currency conversion failed for ${amount} ${base}:`,
      error.message
    );

    return null;
  }
}

  router.post("/verifyRazorpay",paymentLimiter, async (req, res) => {
  const {
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature
  } = req.body;

  try {
    const sign = razorpay_order_id + "|" + razorpay_payment_id;

    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZOR_SECRET_KEY)
      .update(sign)
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({ message: "Invalid signature" });
    }

    // Signature valid → payment is real
    // Signature valid → payment is real
const order =
  await razorpayInstance.orders.fetch(
    razorpay_order_id
  );

const tip =
  await Tips.findById(order.receipt);

if (!tip) {
  return res.status(404).json({
    message: "Tip not found"
  });
}


// Convert to INR for leaderboard
const convertedAmount =
  await convertToINR(
    tip.amount,
    tip.currency
  );


await Tips.findByIdAndUpdate(
  order.receipt,
  {
    payment: true,
    convertedAmount
  }
);


// Send original currency to overlay
const donation = {
  name: tip.name,
  amount: tip.amount,
  currency: tip.currency,
  message: tip.message || "",
  memeSound: tip.memeSound || null,
  convertedAmount,
  streamerId: tip.streamerId
};

broadcastTip(donation.streamerId, donation);

    return res.status(201).json({ message: "Payment verified" });

  } catch (error) {
    console.error("Verification error:", error);
    return res.status(500).json({ message: error.message });
  }
});


  router.post("/razorpay", paymentLimiter, async (req, res) => {
  try {
    const {
      name,
      amount,
      message,
      memeSound,
      currency,
      streamer,
    } = req.body;

    if (!name || !amount || !currency || !streamer) {
      return res.status(400).json({
        message: "Invalid donation data",
      });
    }

    const streamerAccount = await Streamer.findOne({
      username: String(streamer).toLowerCase().trim(),
    });

    if (!streamerAccount) {
      return res.status(404).json({
        message: "Streamer not found",
      });
    }

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

    const options = {
      amount: Math.round(Number(amount) * 100),
      currency,
      receipt: newTip._id.toString(),
    };

    const order = await razorpayInstance.orders.create(options);

    return res.status(201).json(order);
  } catch (error) {
    console.error("Error placing order:", error);

    return res.status(500).json({
      message: error.message,
    });
  }
});

router.get("/getTips", requireAuth, async (req, res) => {
  try {
    const streamerId = req.streamer.streamerId;

    const twentyFourHoursAgo = new Date(
      Date.now() - 24 * 60 * 60 * 1000
    );

    console.log(
      "Fetching tips for streamer:",
      streamerId,
      "since:",
      twentyFourHoursAgo
    );

    const tips = await Tips.find({
      streamerId: streamerId,
      payment: true,
      createdAt: { $gte: twentyFourHoursAgo },
    }).sort({ createdAt: -1 });

    console.log("Tips found:", tips.length);

    res.status(200).json(tips);
  } catch (error) {
    console.error("Get tips error:", error);

    res.status(500).json({
      message: "Failed to fetch tips",
    });
  }
});

// router.get("/myTips", requireAuth, async (req, res) => {
//   const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000);

//   try {
//     const tips = await Tips.find({
//       payment: true,
//       channelName: req.streamer.username,
//       createdAt: { $gte: twelveHoursAgo },
//     }).sort({ createdAt: -1 });

//     res.status(200).json(tips);
//   } catch (error) {
//     console.log(error.message);
//     res.status(400).json(error);
//   }
// });

router.get("/topDonaters", async (req, res) => {
  try {
    const channel = String(
      req.query.channel || ""
    ).toLowerCase().trim();

    if (!channel) {
      return res.status(400).json({
        message: "Streamer is required",
      });
    }

    const streamer = await Streamer.findOne({
      username: channel,
    });

    if (!streamer) {
      return res.status(404).json({
        message: "Streamer not found",
      });
    }

    const topDonaters = await Tips.aggregate([
      {
        $match: {
          payment: true,
          streamerId: streamer._id,
        },
      },
      {
        $group: {
          _id: "$name",

          totalINR: {
            $sum: "$convertedAmount",
          },

          donationCount: {
            $sum: 1,
          },
        },
      },
      {
        $sort: {
          totalINR: -1,
        },
      },
      {
        $limit: 5,
      },
      {
        $project: {
          _id: 0,
          name: "$_id",
          totalINR: {
            $round: ["$totalINR", 2],
          },
          donationCount: 1,
        },
      },
    ]);

    res.status(200).json(topDonaters);
  } catch (error) {
    console.error(
      "Top donaters error:",
      error
    );

    res.status(500).json({
      message: error.message,
    });
  }
});

router.post("/unlockGoal", requireAuth, (req, res) => {
  return res.json({
    message: "Goal management unlocked"
  });
});

router.get("/checkGoalSession", requireAuth, (req, res) => {
  return res.status(200).json({
    unlocked: true
  });
});

router.get(
  "/checkSession",
  requireAuth,
  (req, res) => {
    res.json({
      authenticated: true,
      username: req.streamer.username,
    });
  }
);

router.post("/setGoal", requireAuth, async (req, res) => {
  try {
    const { name, target } = req.body;

    if (!name || !target || Number(target) <= 0) {
      return res.status(400).json({
        message: "Valid goal name and target are required",
      });
    }

    let goal = await Goal.findOne({
      streamerId: req.streamer.streamerId,
    });

    if (goal) {
      goal.name = name;
      goal.target = Number(target);
      goal.total = 0;
      goal.channelName = req.streamer.username;

      await goal.save();
    } else {
      goal = await Goal.create({
        streamerId: req.streamer.streamerId,
        channelName: req.streamer.username,
        name,
        target: Number(target),
        total: 0,
      });
    }

    console.log("Broadcasting goal reset for streamer:", req.streamer.streamerId),

    broadcast({
      type: "goalUpdate",
      goal,
      channelName: req.streamer.username,
    },
   req.streamer.streamerId);

    res.status(200).json({
      message: "Goal created successfully",
      goal,
    });

  } catch (error) {
    console.error("Set goal error:", error);

    res.status(500).json({
      message: error.message,
    });
  }
});

router.post("/resetGoal", requireAuth, async (req, res) => {
  try {
    let goal = await Goal.findOne({
      streamerId: req.streamer.streamerId,
    });

    if (!goal) {
      return res.status(404).json({
        message: "No goal found",
      });
    }

    // Reset goal to default values
    goal.name = "Monthly Goal";
    goal.target = 10000;
    goal.total = 0;

    await goal.save();

    broadcast(
      {
        type: "goalUpdate",
        goal,
        channelName: req.streamer.username,
      },
      req.streamer.streamerId
    );

    res.status(200).json({
      message: "Goal reset successfully",
      goal,
    });
  } catch (error) {
    console.error("Reset goal error:", error);

    res.status(500).json({
      message: "Failed to reset goal",
    });
  }
});

router.post("/replayTip", requireAuth, async (req, res) => {
  try {
    const { tipId } = req.body;
    const streamerId = req.streamer.streamerId;

    const tip = await Tips.findOne({
      _id: tipId,
      streamerId,          // Only this streamer's tips
      payment: true,
    });

    if (!tip) {
      return res.status(404).json({
        message: "Tip not found or doesn't belong to this streamer",
      });
    }

    const donation = {
      name: tip.name,
      amount: tip.amount,
      currency: tip.currency,
      message: tip.message || "",
      memeSound: tip.memeSound || null,
      convertedAmount: tip.convertedAmount,
      streamerId: tip.streamerId,
    };

    // Replay alert without increasing the goal
    broadcastTip(streamerId, donation, false);

    return res.status(200).json({
      message: "Tip replayed successfully",
    });
  } catch (error) {
    console.error("Replay tip error:", error);

    return res.status(500).json({
      message: "Failed to replay tip",
    });
  }
});

router.get("/monthlyTips", requireAuth, async (req, res) => {
  try {
    const streamerId = req.streamer.streamerId;

    const year = Number(req.query.year);
    const month = Number(req.query.month);

    if (!year || !month || month < 1 || month > 12) {
      return res.status(400).json({
        message: "Invalid year or month",
      });
    }

    // Start of selected month
    const startDate = new Date(year, month - 1, 1);

    // Start of next month
    const endDate = new Date(year, month, 1);

    const tips = await Tips.find({
      streamerId: streamerId,
      createdAt: {
        $gte: startDate,
        $lt: endDate,
      },
      payment: true,
    }).sort({ createdAt: -1 });

    console.log(
      `Monthly tips for streamer ${streamerId}:`,
      tips.length
    );

    res.status(200).json(tips);
  } catch (error) {
    console.error("Monthly tips error:", error);

    res.status(500).json({
      message: "Failed to fetch monthly tips",
    });
  }
});


export default router;
