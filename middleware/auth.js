import jwt from "jsonwebtoken";

const isProd = process.env.NODE_ENV !== "development";

export const sessionSecret = () =>
  process.env.JWT_SECRET || process.env.GOAL_SESSION_SECRET;

export const cookieOptions = {
  httpOnly: true,
  secure: isProd,
  sameSite: isProd ? "none" : "lax",
  maxAge: 30 * 24 * 60 * 60 * 1000,
};

export function createSessionToken(streamer) {
  return jwt.sign(
    {
      streamerId: streamer._id.toString(),
      username: streamer.username,
    },
    sessionSecret(),
    { expiresIn: "30d" }
  );
}

export function setSessionCookie(res, token) {
  res.cookie("dashboardSession", token, cookieOptions);
}

export function clearSessionCookie(res) {
  res.clearCookie("dashboardSession", {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
  });
}

export function requireAuth(req, res, next) {
  const token = req.cookies.dashboardSession;

  if (!token) {
    return res.status(401).json({
      message: "Please log in",
    });
  }

  try {
    const payload = jwt.verify(token, sessionSecret());

    if (!payload.streamerId || !payload.username) {
      return res.status(401).json({
        message: "Session expired. Please log in again.",
      });
    }

    req.streamer = payload;
    next();
  } catch {
    return res.status(401).json({
      message: "Session expired. Please log in again.",
    });
  }
}
