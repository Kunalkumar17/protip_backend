import jwt from "jsonwebtoken";

const ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET;

export function requireAdmin(req, res, next) {
  try {
    if (!ADMIN_SESSION_SECRET) {
      console.error("ADMIN_SESSION_SECRET is missing");
      return res.status(500).json({
        message: "Admin session secret is not configured",
      });
    }

    const token = req.cookies?.adminSession;

    if (!token) {
      return res.status(401).json({
        message: "Admin authentication required",
      });
    }

    const decoded = jwt.verify(
      token,
      ADMIN_SESSION_SECRET
    );

    if (decoded.role !== "admin") {
      return res.status(403).json({
        message: "Admin access required",
      });
    }

    req.admin = decoded;

    next();
  } catch (error) {
    return res.status(401).json({
      message: "Invalid or expired admin session",
    });
  }
}