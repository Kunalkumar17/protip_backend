import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

import Admin from "../model/admin.js";
import Streamer from "../model/streamer.js";
import Tips from "../model/tips.js";
import { requireAdmin } from "../middleware/adminAuth.js";
import Payout from "../model/payout.js";

const router = express.Router();

const ADMIN_SESSION_SECRET =
  process.env.ADMIN_SESSION_SECRET;


// =====================================================
// ADMIN LOGIN
// =====================================================

router.post("/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        message: "Username and password are required",
      });
    }

    const admin = await Admin
      .findOne({
        username: String(username)
          .toLowerCase()
          .trim(),
      })
      .select("+password");

    if (!admin) {
      return res.status(401).json({
        message: "Invalid username or password",
      });
    }

    const passwordValid = await bcrypt.compare(
      password,
      admin.password
    );

    if (!passwordValid) {
      return res.status(401).json({
        message: "Invalid username or password",
      });
    }

    const token = jwt.sign(
      {
        id: admin._id.toString(),
        username: admin.username,
        role: "admin",
      },
      ADMIN_SESSION_SECRET,
      {
        expiresIn: "7d",
      }
    );

    res.cookie("adminSession", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite:
        process.env.NODE_ENV === "production"
          ? "none"
          : "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: "/",
    });

    return res.json({
      message: "Admin login successful",
      admin: {
        id: admin._id,
        username: admin.username,
      },
    });
  } catch (error) {
    console.error("Admin login error:", error);

    return res.status(500).json({
      message: "Login failed",
    });
  }
});


// =====================================================
// ADMIN LOGOUT
// =====================================================

router.post(
  "/auth/logout",
  requireAdmin,
  (req, res) => {
    res.clearCookie("adminSession", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite:
        process.env.NODE_ENV === "production"
          ? "none"
          : "lax",
      path: "/",
    });

    return res.json({
      message: "Logged out successfully",
    });
  }
);


// =====================================================
// CHECK ADMIN SESSION
// =====================================================

router.get(
  "/auth/me",
  requireAdmin,
  async (req, res) => {
    return res.json({
      authenticated: true,
      admin: {
        id: req.admin.id,
        username: req.admin.username,
      },
    });
  }
);


// =====================================================
// DASHBOARD OVERVIEW
// =====================================================

router.get(
  "/overview",
  requireAdmin,
  async (req, res) => {
    try {
      const now = new Date();

      const startOfToday = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate()
      );

      const startOfMonth = new Date(
        now.getFullYear(),
        now.getMonth(),
        1
      );

      const [
        totalStreamers,
        verifiedStreamers,
        totalTips,
        successfulTips,
        todayTips,
        monthTips,
      ] = await Promise.all([
        Streamer.countDocuments(),

        Streamer.countDocuments({
          emailVerified: true,
        }),

        Tips.countDocuments(),

        Tips.countDocuments({
          payment: true,
        }),

        Tips.find({
          payment: true,
          createdAt: {
            $gte: startOfToday,
          },
        }).lean(),

        Tips.find({
          payment: true,
          createdAt: {
            $gte: startOfMonth,
          },
        }).lean(),
      ]);


      const totalAmount = await Tips.aggregate([
        {
          $match: {
            payment: true,
          },
        },
        {
          $group: {
            _id: null,
            amount: {
              $sum: "$convertedAmount",
            },
          },
        },
      ]);

      const todayAmount = todayTips.reduce(
        (sum, tip) =>
          sum + Number(tip.convertedAmount || 0),
        0
      );

      const monthAmount = monthTips.reduce(
        (sum, tip) =>
          sum + Number(tip.convertedAmount || 0),
        0
      );


      return res.json({
        streamers: {
          total: totalStreamers,
          verified: verifiedStreamers,
        },

        tips: {
          total: totalTips,
          successful: successfulTips,
        },

        revenue: {
          total: totalAmount[0]?.amount || 0,
          today: todayAmount,
          thisMonth: monthAmount,
        },
      });
    } catch (error) {
      console.error(
        "Admin overview error:",
        error
      );

      return res.status(500).json({
        message: "Failed to load dashboard",
      });
    }
  }
);


// =====================================================
// STREAMERS
// =====================================================

router.get(
  "/streamers",
  requireAdmin,
  async (req, res) => {
    try {
      const streamers = await Streamer
        .find({})
        .select(
          "-password -emailVerificationToken -emailVerificationExpires"
        )
        .sort({
          createdAt: -1,
        })
        .lean();


      const streamerIds = streamers.map(
        (streamer) => streamer._id
      );


      const tipStats = await Tips.aggregate([
        {
          $match: {
            streamerId: {
              $in: streamerIds,
            },
            payment: true,
          },
        },

        {
          $group: {
            _id: "$streamerId",

            totalTips: {
              $sum: 1,
            },

            totalAmount: {
              $sum: "$convertedAmount",
            },
          },
        },
      ]);


      const statsMap = new Map(
        tipStats.map((item) => [
          item._id.toString(),
          item,
        ])
      );


      const result = streamers.map(
        (streamer) => {
          const stats =
            statsMap.get(
              streamer._id.toString()
            ) || {};

          return {
            ...streamer,

            totalTips:
              stats.totalTips || 0,

            totalAmount:
              stats.totalAmount || 0,
          };
        }
      );


      return res.json({
        streamers: result,
      });
    } catch (error) {
      console.error(
        "Admin streamers error:",
        error
      );

      return res.status(500).json({
        message: "Failed to load streamers",
      });
    }
  }
);


// =====================================================
// SINGLE STREAMER
// =====================================================

router.get(
  "/streamers/:id",
  requireAdmin,
  async (req, res) => {
    try {
      const streamer =
        await Streamer.findById(req.params.id)
          .select(
            "-password -emailVerificationToken -emailVerificationExpires"
          )
          .lean();

      if (!streamer) {
        return res.status(404).json({
          message: "Streamer not found",
        });
      }


      const tips = await Tips.find({
        streamerId: streamer._id,
        payment: true,
      })
        .sort({
          createdAt: -1,
        })
        .lean();


      const totalAmount = tips.reduce(
        (sum, tip) =>
          sum + Number(
            tip.convertedAmount || 0
          ),
        0
      );


      return res.json({
        streamer,

        stats: {
          totalTips: tips.length,
          totalAmount,
        },

        tips,
      });
    } catch (error) {
      console.error(
        "Admin streamer error:",
        error
      );

      return res.status(500).json({
        message: "Failed to load streamer",
      });
    }
  }
);


// =====================================================
// ALL TIPS
// =====================================================

router.get(
  "/tips",
  requireAdmin,
  async (req, res) => {
    try {
      const {
        page = 1,
        limit = 50,
        payment,
      } = req.query;

      const pageNumber =
        Math.max(Number(page), 1);

      const limitNumber =
        Math.min(
          Math.max(Number(limit), 1),
          100
        );


      const filter = {};

      if (
        payment === "true" ||
        payment === "false"
      ) {
        filter.payment =
          payment === "true";
      }


      const [tips, total] =
        await Promise.all([
          Tips.find(filter)
            .populate(
              "streamerId",
              "username channelName email"
            )
            .sort({
              createdAt: -1,
            })
            .skip(
              (pageNumber - 1) *
                limitNumber
            )
            .limit(limitNumber)
            .lean(),

          Tips.countDocuments(filter),
        ]);


      return res.json({
        tips,

        pagination: {
          page: pageNumber,
          limit: limitNumber,
          total,
          pages: Math.ceil(
            total / limitNumber
          ),
        },
      });
    } catch (error) {
      console.error(
        "Admin tips error:",
        error
      );

      return res.status(500).json({
        message: "Failed to load tips",
      });
    }
  }
);


// =====================================================
// PAYOUT SUMMARY
// =====================================================

router.get("/payouts", requireAdmin, async (req, res) => {
  try {
    const { month, year } = req.query;

    const now = new Date();

    const selectedYear = Number(year) || now.getFullYear();
    const selectedMonth =
      month !== undefined
        ? Number(month)
        : now.getMonth();

    const periodStart = new Date(
      selectedYear,
      selectedMonth,
      1
    );

    const periodEnd = new Date(
      selectedYear,
      selectedMonth + 1,
      1
    );

    const streamers = await Streamer.find()
      .select("username email channelName")
      .lean();

    const tips = await Tips.aggregate([
      {
        $match: {
          payment: true,
          createdAt: {
            $gte: periodStart,
            $lt: periodEnd,
          },
        },
      },
      {
        $group: {
          _id: "$streamerId",
          totalTips: { $sum: 1 },
          totalAmount: { $sum: "$convertedAmount" },
        },
      },
    ]);

    const tipMap = new Map(
      tips.map((tip) => [
        tip._id.toString(),
        tip,
      ])
    );

    const payouts = [];

    for (const streamer of streamers) {
      const stats = tipMap.get(
        streamer._id.toString()
      );

      const totalTips = stats?.totalTips || 0;
      const totalAmount = stats?.totalAmount || 0;

      if (totalTips === 0) {
        continue;
      }

      let payout = await Payout.findOne({
        streamerId: streamer._id,
        periodStart,
        periodEnd,
      });

      if (!payout) {
  payout = await Payout.create({
    streamerId: streamer._id,
    periodStart,
    periodEnd,
    totalTips,
    totalAmount,
  });
} else if (payout.status === "pending") {
  payout.totalTips = totalTips;
  payout.totalAmount = totalAmount;

  await payout.save();
}

      payouts.push({
        _id: payout._id,
        streamerId: streamer._id,
        username: streamer.username,
        email: streamer.email,
        channelName: streamer.channelName,

        totalTips: payout.totalTips,
        totalAmount: payout.totalAmount,

        status: payout.status,
        paidAt: payout.paidAt,
        paymentReference:
          payout.paymentReference,
      });
    }

    res.json({
      month: selectedMonth,
      year: selectedYear,
      periodStart,
      periodEnd,
      payouts,
    });
  } catch (error) {
    console.error("Admin payouts error:", error);

    res.status(500).json({
      message: "Failed to fetch payouts",
    });
  }
});

router.patch(
  "/payouts/:id/pay",
  requireAdmin,
  async (req, res) => {
    try {
      const { paymentReference = "" } = req.body;

      const payout = await Payout.findById(
        req.params.id
      );

      if (!payout) {
        return res.status(404).json({
          message: "Payout not found",
        });
      }

      if (payout.status === "paid") {
        return res.status(400).json({
          message: "Payout is already marked as paid",
        });
      }

      payout.status = "paid";
      payout.paidAt = new Date();
      payout.paymentReference =
        paymentReference.trim();

      await payout.save();

      res.json({
        message: "Payout marked as paid",
        payout,
      });
    } catch (error) {
      console.error("Mark payout paid error:", error);

      res.status(500).json({
        message: "Failed to mark payout as paid",
      });
    }
  }
);


export default router;