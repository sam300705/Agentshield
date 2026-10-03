import type { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { Role } from "@prisma/client";
import type { AuthenticatedRequest } from "../middleware/auth.js";

const devLoginSchema = z.object({
  email: z.string().email(),
  role: z.nativeEnum(Role).default(Role.VIEWER),
});

export async function devLoginController(req: Request, res: Response): Promise<void> {
  // Never expose dev-login in production!
  if (process.env.NODE_ENV === "production") {
    res.status(404).json({ error: "NOT_FOUND", message: "Route not found in production." });
    return;
  }

  const { email, role } = devLoginSchema.parse(req.body);

  const user = await prisma.user.upsert({
    where: { email },
    update: { role },
    create: { email, role },
  });

  const JWT_SECRET = process.env.JWT_SECRET;
  if (!JWT_SECRET) {
    throw new Error("FATAL: JWT_SECRET environment variable is missing.");
  }

  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: "1d" });

  res.cookie("token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 24 * 60 * 60 * 1000, // 1 day
  });

  res.json({ message: "Development login successful", user });
}

export function logoutController(_req: Request, res: Response): void {
  res.clearCookie("token");
  res.json({ message: "Logged out successfully" });
}

export function meController(req: AuthenticatedRequest, res: Response): void {
  // Requires authentication middleware before this controller
  res.json({ user: req.user });
}
