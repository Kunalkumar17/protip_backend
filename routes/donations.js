  import express from "express";
  import Tips from "../model/tips.js"
  import Razorpay from 'razorpay'
  import crypto from "crypto";
  import { broadcastTip, broadcast } from "../websocket.js";
  import jwt from "jsonwebtoken";
  import Goal from "../model/goal.js";


  const router = express.Router();

  const razorpayInstance = new Razorpay({
    key_id: process.env.RAZOR_KEY_ID,
    key_secret: process.env.RAZOR_SECRET_KEY
})

const requireDashboardSession = (req, res, next) => {
  const token = req.cookies.dashboardSession;

  if (!token) {
    return res.status(401).json({
      message: "Please log in"
    });
  }

  try {
    jwt.verify(token, process.env.GOAL_SESSION_SECRET);
    next();
  } catch {
    return res.status(401).json({
      message: "Session expired. Please log in again."
    });
  }
};

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

  router.post("/verifyRazorpay", async (req, res) => {
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
  convertedAmount
};

await broadcastTip(donation);

    return res.status(201).json({ message: "Payment verified" });

  } catch (error) {
    console.error("Verification error:", error);
    return res.status(500).json({ message: error.message });
  }
});


  router.post("/razorpay", async (req, res) => {
  const channelName = "Berry";
  const {
  name,
  amount,
  message,
  memeSound,
  currency
} = req.body;
   

  if (!name || !amount) {
    return res.status(400).json({ error: "Invalid donation data" });
  }

  try {
     const newTip = new Tips({
      name,
      amount,
      message: message || "",
      memeSound: memeSound || null,
      channelName,
      currency,
      payment: false,
    });

    await newTip.save();

    const options = {
      amount: amount * 100,
      currency,
      receipt: newTip._id.toString()
    };

    const order = await razorpayInstance.orders.create(options);

    return res.status(201).json(order);

  } catch (error) {
    console.error("Error placing order:", error);
    return res.status(500).json({ message: error.message });
  }
});

router.get('/getTips' , async(req,res) =>{
  const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000);
  try {
    const tips = await Tips.find({
      payment: true,
  createdAt: { $gte: twelveHoursAgo }
}).sort({ createdAt: -1 });
    res.status(200).json(tips);
  } catch (error) {
      console.log(error.message)
      res.status(400).json(error)
  }
})

router.get("/topDonaters", async (req, res) => {
  try {
    const topDonaters = await Tips.aggregate([
      {
        $match: {
          payment: true
        }
      },
      {
        $group: {
          _id: "$name",

          totalINR: {
            $sum: "$convertedAmount"
          },

          donationCount: {
            $sum: 1
          }
        }
      },
      {
        $sort: {
          totalINR: -1
        }
      },
      {
        $limit: 5
      },
      {
        $project: {
          _id: 0,
          name: "$_id",
          totalINR: {
            $round: ["$totalINR", 2]
          },
          donationCount: 1
        }
      }
    ]);

    res.status(200).json(topDonaters);

  } catch (error) {
    console.error(
      "Top donaters error:",
      error
    );

    res.status(500).json({
      message: error.message
    });
  }
});

router.post("/unlockGoal", (req, res) => {
  const { password } = req.body;

  if (!password || password !== process.env.GOAL_ADMIN_PASSWORD) {
    return res.status(401).json({
      message: "Incorrect password"
    });
  }

  const token = jwt.sign(
    {
      role: "goalAdmin"
    },
    process.env.GOAL_SESSION_SECRET,
    {
      expiresIn: "30d"
    }
  );

  res.cookie("goalSession", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 30 * 24 * 60 * 60 * 1000
  });

  return res.json({
    message: "Goal management unlocked"
  });
});

router.get("/checkGoalSession", requireDashboardSession, (req, res) => {
  return res.status(200).json({
    unlocked: true
  });
});

router.post("/login", (req, res) => {
  const { password } = req.body;

  if (password !== process.env.GOAL_ADMIN_PASSWORD) {
    return res.status(401).json({
      message: "Incorrect password"
    });
  }

  const token = jwt.sign(
    { role: "dashboardAdmin" },
    process.env.GOAL_SESSION_SECRET,
    { expiresIn: "30d" }
  );

  res.cookie("dashboardSession", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 30 * 24 * 60 * 60 * 1000
  });

  res.json({
    message: "Logged in successfully"
  });
});

router.get(
  "/checkSession",
  requireDashboardSession,
  (req, res) => {
    res.json({ authenticated: true });
  }
);

router.post("/setGoal",requireDashboardSession, async (req, res) => {
  try {
    const { name, target } = req.body;

    if (!name || !target || Number(target) <= 0) {
      return res.status(400).json({
        message: "Valid goal name and target are required",
      });
    }

    let goal = await Goal.findOne();

    if (goal) {
      goal.name = name;
      goal.target = Number(target);
      goal.total = 0;

      await goal.save();
    } else {
      goal = await Goal.create({
        name,
        target: Number(target),
        total: 0,
      });
    }

    broadcast({
      type: "goalUpdate",
      goal,
    });

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

router.post("/resetGoal", requireDashboardSession, async (req, res) => {
  try {
    let goal = await Goal.findOne();

    if (!goal) {
      return res.status(404).json({
        message: "No goal found",
      });
    }

    goal.total = 0;

    await goal.save();

    broadcast({
      type: "goalUpdate",
      goal,
    });

    res.status(200).json({
      message: "Goal reset successfully",
      goal,
    });

  } catch (error) {
    console.error("Reset goal error:", error);

    res.status(500).json({
      message: error.message,
    });
  }
});

export default router;
