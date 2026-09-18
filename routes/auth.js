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
    const email = String(req.body.email || "").trim();
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");
    const displayName = String(req.body.displayName || "").trim();

    if (!validator.isEmail(email)) {
      return res.status(400).json({ message: "Enter a valid email address" });
    }

    if (!USERNAME_PATTERN.test(username)) {
      return res.status(400).json({
        message:
          "Username must be 3–20 characters and use only letters, numbers, or underscores",
      });
    }

    if (!validator.isLength(password, { min: 8 })) {
      return res.status(400).json({
        message: "Password must be at least 8 characters",
      });
    }

    const existing = await Streamer.findOne({
      $or: [
        { email: email.toLowerCase() },
        { username: username.toLowerCase() },
      ],
    });

    if (existing) {
      const takenField =
        existing.email === email.toLowerCase() ? "email" : "username";
      return res.status(409).json({
        message: `That ${takenField} is already in use`,
      });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const streamer = await Streamer.create({
      email,
      username,
      password: hashedPassword,
      displayName: displayName || username,
    });

    const token = createSessionToken(streamer);
    setSessionCookie(res, token);

    return res.status(201).json({
      message: "Account created",
      streamer: publicStreamer(streamer),
    });
  } catch (error) {
    console.error("Register error:", error);
    return res.status(500).json({ message: "Could not create account" });
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
      return res.status(401).json({ message: "Invalid credentials" });
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

export default router;
