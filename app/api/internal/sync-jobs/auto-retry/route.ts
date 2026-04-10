import { NextRequest, NextResponse } from "next/server";
import {
  listPendingSyncJobsByActions,
  type SyncJobRecord,
} from "@/lib/server/sync-job-repo";
import { retrySyncJobById } from "@/lib/server/sync-job-retry";

export const runtime = "nodejs";

const MAX_ATTEMPTS = 5;
const MIN_RETRY_INTERVAL_MS = 15 * 60 * 1000;
const MAX_BATCH_SIZE = 10;
const FETCH_LIMIT = 100;
const AUTO_RETRY_ACTOR = "cron";

type TimestampLike = {
  toMillis?: () => number;
  seconds?: number;
};

function toMillis(value: unknown) {
  if (!value) return 0;
  if (typeof value === "string") {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? 0 : ms;
  }

  const ts = value as TimestampLike;
  if (typeof ts.toMillis === "function") {
    return ts.toMillis();
  }
  if (typeof ts.seconds === "number") {
    return ts.seconds * 1000;
  }
  return 0;
}

function isReadyForRetry(job: SyncJobRecord, now: number) {
  const attempts = Number(job.attemptCount || 0);
  if (attempts >= MAX_ATTEMPTS) {
    return false;
  }

  const lastTriedAtMs = toMillis(job.lastTriedAt);
  if (!lastTriedAtMs) {
    return true;
  }

  return now - lastTriedAtMs >= MIN_RETRY_INTERVAL_MS;
}

function isAuthorizedCronRequest(request: NextRequest) {
  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret) {
    return false;
  }

  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return false;
  }

  const token = authHeader.slice("Bearer ".length).trim();
  return token === expectedSecret;
}

async function handleAutoRetry(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) {
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
    const pendingJobs = await listPendingSyncJobsByActions({
      actions: ["create", "update"],
      limit: FETCH_LIMIT,
    });

    const now = Date.now();
    const eligibleJobs = pendingJobs.filter((job) => isReadyForRetry(job, now));
    const selectedJobs = eligibleJobs.slice(0, MAX_BATCH_SIZE);

    let processed = 0;
    let succeeded = 0;
    let failed = 0;

    for (const job of selectedJobs) {
      const result = await retrySyncJobById({
        jobId: job.id,
        actor: AUTO_RETRY_ACTOR,
        allowedActions: ["create", "update"],
      });

      processed += 1;
      if (result.status === "success") {
        succeeded += 1;
      } else {
        failed += 1;
      }
    }

    const skipped = pendingJobs.length - selectedJobs.length;

    return NextResponse.json({
      status: "success",
      message: "auto retry completed",
      processed,
      succeeded,
      failed,
      skipped,
    });
  } catch (error) {
    console.error("[internal.sync-jobs.auto-retry][fatal-error]", error);
    return NextResponse.json(
      {
        status: "error",
        code: "internal_error",
        message: "auto retry failed",
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  return handleAutoRetry(request);
}

export async function POST(request: NextRequest) {
  return handleAutoRetry(request);
}
