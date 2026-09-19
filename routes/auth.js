import express from "express";
import bcrypt from "bcryptjs";
import validator from "validator";
import rateLimit from "express-rate-limit";
import Streamer from "../model/streamer.js";
import {
  requireAuth,
  createSessionToken,
  setSessionCookie,
  clearSessionCookie,
} from "../middleware/auth.js";
 import crypto from "crypto";
import { sendVerificationEmail } from "../utils/email.js";

const router = express.Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: "Too many attempts. Please try again after 15 minutes.",
  },
});

const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,20}$/;

function publicStreamer(streamer) {
  return {
    id: streamer._id,
    email: streamer.email,
    username: streamer.username,
    displayName: streamer.displayName || streamer.username,
  };
}

router.post("/register", authLimiter, async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");
    const displayName = String(req.body.displayName || "").trim();

    if (!validator.isEmail(email)) {
      return res.status(400).json({
        message: "Enter a valid email address",
      });
    }

    if (!USERNAME_PATTERN.test(username)) {
      return res.status(400).json({
        message:
          "Username must be 3–20 characters and use only letters, numbers, or underscores",
      });
    }

    if (!validator.isLength(password, { min: 8, max: 128 })) {
      return res.status(400).json({
        message: "Password must be between 8 and 128 characters",
      });
    }

    const existing = await Streamer.findOne({
      $or: [
        { email },
        { username: username.toLowerCase() },
      ],
    });

    if (existing) {
      const takenField =
        existing.email === email ? "email" : "username";

      return res.status(409).json({
        message: `That ${takenField} is already in use`,
      });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    // Generate verification token
    const verificationToken = crypto.randomBytes(32).toString("hex");

    // Store only the hash in MongoDB
    const verificationTokenHash = crypto
      .createHash("sha256")
      .update(verificationToken)
      .digest("hex");

    // Token expires in 30 minutes
    const verificationExpires = new Date(
      Date.now() + 30 * 60 * 1000
    );

    const streamer = await Streamer.create({
      email,
      username,
      password: hashedPassword,
      displayName: displayName || username,

      emailVerified: false,
      emailVerificationToken: verificationTokenHash,
      emailVerificationExpires: verificationExpires,
    });

    // URL that the user receives in their email
    const verificationUrl =
      `${process.env.FRONTEND_URL}/verify-email?token=${verificationToken}`;

    // Send verification email
    await sendVerificationEmail(email, verificationUrl);

    // DO NOT log the user in yet
    return res.status(201).json({
      message:
        "Account created. Please check your email to verify your account.",
    });

  } catch (error) {
    console.error("Register error:", error);

    return res.status(500).json({
      message: "Could not create account",
    });
  }
});

router.post("/login", authLimiter, async (req, res) => {
  try {
    const identifier = String(req.body.identifier || req.body.email || "").trim();
    const password = String(req.body.password || "");

    if (!identifier || !password) {
      return res.status(400).json({
        message: "Email/username and password are required",
      });
    }

    const streamer = await Streamer.findOne({
      $or: [
        { email: identifier.toLowerCase() },
        { username: identifier.toLowerCase() },
      ],
    }).select("+password");

    if (!streamer) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const match = await bcrypt.compare(password, streamer.password);

if (!match) {
  return res.status(401).json({
    message: "Invalid credentials",
  });
}

if (!streamer.emailVerified) {
  return res.status(403).json({
    message: "Please verify your email before logging in.",
  });
}

const token = createSessionToken(streamer);
setSessionCookie(res, token);

return res.json({
  message: "Logged in successfully",
  streamer: publicStreamer(streamer),
});
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ message: "Could not log in" });
  }
});

router.post("/logout", (req, res) => {
  clearSessionCookie(res);
  return res.json({ message: "Logged out" });
});

router.get("/me", requireAuth, async (req, res) => {
  try {
    const streamer = await Streamer.findById(req.streamer.streamerId);

    if (!streamer) {
      clearSessionCookie(res);
      return res.status(401).json({ message: "Please log in" });
    }

    return res.json({
      authenticated: true,
      streamer: publicStreamer(streamer),
    });
  } catch (error) {
    console.error("Session check error:", error);
    return res.status(500).json({ message: "Could not verify session" });
  }
});

router.get("/verify-email", async (req, res) => {
  try {
    const { token } = req.query;

    if (!token || typeof token !== "string") {
      return res.status(400).json({
        message: "Invalid verification link",
      });
    }

    const tokenHash = crypto
      .createHash("sha256")
      .update(token)
      .digest("hex");

    const streamer = await Streamer.findOne({
      emailVerificationToken: tokenHash,
      emailVerificationExpires: { $gt: new Date() },
    });

    if (!streamer) {
      return res.status(400).json({
        message: "Verification link is invalid or expired",
      });
    }

    streamer.emailVerified = true;
    streamer.emailVerificationToken = null;
    streamer.emailVerificationExpires = null;

    await streamer.save();

    return res.status(200).json({
      message: "Email verified successfully",
    });
  } catch (error) {
    console.error("Email verification error:", error);

    return res.status(500).json({
      message: "Could not verify email",
    });
  }
});

export default router;
