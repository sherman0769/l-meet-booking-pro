import { NextResponse } from "next/server";
import { clearAdminSessionCookie } from "@/lib/server/admin-session";

export const runtime = "nodejs";

export async function POST() {
  const response = NextResponse.json({ success: true });
  clearAdminSessionCookie(response);
  return response;
}
