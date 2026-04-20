import { NextRequest, NextResponse } from "next/server";
import { sendLineAdminAlert } from "@/lib/server/line-messaging";

export const runtime = "nodejs";

const LINE_TEST_SECRET_HEADER = "x-line-test-secret";

function isAuthorizedCronRequest(request: NextRequest) {
  const expectedSecret = process.env.CRON_SECRET?.trim();
  if (!expectedSecret) return false;

  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return false;

  const token = authHeader.slice("Bearer ".length).trim();
  return token === expectedSecret;
}

function isAuthorizedLineTestRequest(request: NextRequest) {
  const expectedSecret = process.env.LINE_TEST_SECRET?.trim();
  if (!expectedSecret) return false;

  const providedSecret = request.headers.get(LINE_TEST_SECRET_HEADER)?.trim() || "";
  return providedSecret === expectedSecret;
}

function isLineTestAllowedByEnvironment() {
  if (process.env.NODE_ENV !== "production") {
    return true;
  }

  return process.env.LINE_TEST_ALLOW_PRODUCTION?.trim().toLowerCase() === "true";
}

export async function POST(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json(
      { status: "unauthorized", sent: false, message: "Unauthorized" },
      { status: 401 }
    );
  }

  if (!isLineTestAllowedByEnvironment()) {
    return NextResponse.json(
      {
        status: "forbidden",
        sent: false,
        message: "LINE test is not allowed in this environment",
      },
      { status: 403 }
    );
  }

  if (!process.env.LINE_TEST_SECRET?.trim()) {
    return NextResponse.json(
      {
        status: "error",
        sent: false,
        message: "LINE_TEST_SECRET is not configured",
      },
      { status: 500 }
    );
  }

  if (!isAuthorizedLineTestRequest(request)) {
    return NextResponse.json(
      { status: "unauthorized", sent: false, message: "Unauthorized line test secret" },
      { status: 401 }
    );
  }

  const message = `[STAGING TEST] LINE delivery verification\ntimestamp: ${new Date().toISOString()}`;
  const result = await sendLineAdminAlert(message);

  if (result.status === "sent") {
    return NextResponse.json({ status: "success", sent: true, message: "LINE test message sent" });
  }

  return NextResponse.json(
    {
      status: result.status === "failed" ? "failed" : "skipped",
      sent: false,
      message: result.reason,
    },
    { status: result.status === "failed" ? 502 : 400 }
  );
}
