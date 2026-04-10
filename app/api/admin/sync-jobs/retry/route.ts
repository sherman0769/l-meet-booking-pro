import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/server/admin-session";
import { retrySyncJobById } from "@/lib/server/sync-job-retry";

export const runtime = "nodejs";

const RETRY_ACTOR = "admin";

export async function POST(request: NextRequest) {
  const unauthorized = requireAdminSession(request);
  if (unauthorized) {
    return NextResponse.json(
      {
        status: "unauthorized",
        code: "unauthorized",
        message: "Unauthorized",
      },
      { status: 401 }
    );
  }

  try {
    const body = (await request.json()) as { jobId?: unknown };
    const jobId = String(body?.jobId ?? "").trim();

    if (!jobId) {
      return NextResponse.json(
        {
          status: "validation_error",
          code: "validation_error",
          message: "缺少 jobId",
        },
        { status: 400 }
      );
    }

    const result = await retrySyncJobById({
      jobId,
      actor: RETRY_ACTOR,
      allowedActions: ["delete", "update", "create"],
    });

    if (result.status === "success") {
      return NextResponse.json(result, { status: 200 });
    }

    if (result.status === "not_found") {
      return NextResponse.json(result, { status: 404 });
    }

    if (result.status === "validation_error") {
      return NextResponse.json(result, { status: 400 });
    }

    return NextResponse.json(result, { status: 500 });
  } catch (error) {
    console.error("[admin.sync-jobs.retry][fatal-error]", error);
    return NextResponse.json(
      { status: "error", code: "internal_error", message: "重試失敗" },
      { status: 500 }
    );
  }
}
