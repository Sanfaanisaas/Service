import { getAuth } from "@clerk/express";
import type { RequestHandler } from "express";

export const requireUser: RequestHandler = (req, res, next) => {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({
      success: false,
      error: { code: "UNAUTHORIZED", message: "Sign in is required to access SANFAANI Operations." },
    });
    return;
  }
  req.userId = userId;
  next();
};

declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}