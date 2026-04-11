import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/server/admin-session";
import { getSyncJobById, markSyncJobDismissed } from "@/lib/server/sync-job-repo";

export const runtime = "nodejs";

const DISMISS_ACTOR = "admin";

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
    const body = (await request.json()) as {
      jobId?: unknown;
      reason?: unknown;
    };

    const jobId = String(body?.jobId ?? "").trim();
    const reason = String(body?.reason ?? "").trim();

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

    const job = await getSyncJobById(jobId);
    if (!job) {
      return NextResponse.json(
        {
          status: "not_found",
          code: "job_not_found",
          message: "找不到 sync job",
        },
        { status: 404 }
      );
    }

    if (job.status !== "pending") {
      return NextResponse.json(
        {
          status: "validation_error",
          code: "job_not_pending",
          message: "此 sync job 不是 pending 狀態，無法忽略",
        },
        { status: 400 }
      );
    }

    await markSyncJobDismissed({
      jobId,
      actor: DISMISS_ACTOR,
      reason: reason || undefined,
    });

    return NextResponse.json({
      status: "success",
      message: "已忽略此待補償項目",
    });
  } catch (error) {
    console.error("[admin.sync-jobs.dismiss][fatal-error]", error);
    return NextResponse.json(
      {
        status: "error",
        code: "internal_error",
        message: "忽略失敗",
      },
      { status: 500 }
    );
  }
}
