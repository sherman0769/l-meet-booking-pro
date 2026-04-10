import { NextRequest, NextResponse } from "next/server";
import { setAdminSessionCookie } from "@/lib/server/admin-session";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const password = String(body?.password ?? "");

    const adminPassword = process.env.ADMIN_PASSWORD;

    if (!adminPassword) {
      return NextResponse.json(
        { success: false, error: "ADMIN_PASSWORD 未設定" },
        { status: 500 }
      );
    }

    if (password !== adminPassword) {
      return NextResponse.json(
        { success: false, error: "密碼錯誤" },
        { status: 401 }
      );
    }

    const response = NextResponse.json({ success: true });
    setAdminSessionCookie(response);
    return response;
  } catch (error) {
    console.error("[admin.login] error:", error);
    return NextResponse.json(
      { success: false, error: "登入失敗" },
      { status: 500 }
    );
  }
}

