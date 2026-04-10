import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";

const ADMIN_SESSION_COOKIE_NAME = "admin_session";
const ADMIN_SESSION_MAX_AGE_SECONDS = 60 * 60 * 8;

function getSecret() {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) {
    throw new Error("ADMIN_SESSION_SECRET is not configured");
  }
  return secret;
}

function toBase64Url(input: string) {
  return Buffer.from(input, "utf8").toString("base64url");
}

function fromBase64Url(input: string) {
  return Buffer.from(input, "base64url").toString("utf8");
}

function sign(payloadBase64: string) {
  const secret = getSecret();
  return createHmac("sha256", secret).update(payloadBase64).digest("base64url");
}

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function createSessionToken() {
  const now = Date.now();
  const payload = {
    iat: now,
    exp: now + ADMIN_SESSION_MAX_AGE_SECONDS * 1000,
  };
  const payloadBase64 = toBase64Url(JSON.stringify(payload));
  const signature = sign(payloadBase64);
  return `${payloadBase64}.${signature}`;
}

function verifySessionToken(token?: string) {
  if (!token) return false;

  const [payloadBase64, signature] = token.split(".");
  if (!payloadBase64 || !signature) return false;

  let expectedSignature = "";
  try {
    expectedSignature = sign(payloadBase64);
  } catch {
    return false;
  }

  if (!safeEqual(signature, expectedSignature)) {
    return false;
  }

  try {
    const payload = JSON.parse(fromBase64Url(payloadBase64)) as {
      exp?: number;
    };
    if (!payload?.exp || typeof payload.exp !== "number") return false;
    return payload.exp > Date.now();
  } catch {
    return false;
  }
}

export function setAdminSessionCookie(response: NextResponse) {
  const token = createSessionToken();
  response.cookies.set({
    name: ADMIN_SESSION_COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ADMIN_SESSION_MAX_AGE_SECONDS,
  });
}

export function clearAdminSessionCookie(response: NextResponse) {
  response.cookies.set({
    name: ADMIN_SESSION_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

export function isAdminSessionValid(request: NextRequest) {
  const token = request.cookies.get(ADMIN_SESSION_COOKIE_NAME)?.value;
  return verifySessionToken(token);
}

export function requireAdminSession(request: NextRequest) {
  if (isAdminSessionValid(request)) {
    return null;
  }

  return NextResponse.json(
    { success: false, error: "Unauthorized" },
    { status: 401 }
  );
}

