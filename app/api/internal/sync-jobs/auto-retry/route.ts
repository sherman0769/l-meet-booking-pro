import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/server/firebase-admin";
import {
  claimSyncJobForRetry,
  listPendingSyncJobsByActions,
  type SyncJobRecord,
} from "@/lib/server/sync-job-repo";
import { retrySyncJobById } from "@/lib/server/sync-job-retry";
import { getGoogleOauthConfig } from "@/lib/server/google-oauth-config";
import { createGoogleCalendarClient } from "@/lib/server/calendar-client";
import { evaluateAdminAlert } from "@/lib/server/admin-alert-evaluator";
import { sendLineAdminAlert } from "@/lib/server/line-messaging";

export const runtime = "nodejs";

const MAX_ATTEMPTS = 5;
const MIN_RETRY_INTERVAL_MS = 15 * 60 * 1000;
const MAX_BATCH_SIZE = 10;
const FETCH_LIMIT = 100;
const AUTO_RETRY_ACTOR = "cron";
const RETRY_LEASE_MS = 10 * 60 * 1000;
const LINE_ALERT_STATE_DOC = "line_alert_state";
const ALERT_COOLDOWN_MS = 60 * 60 * 1000;
const DRY_RUN_SECRET_HEADER = "x-auto-retry-dry-run-secret";

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

function isDryRunRequested(request: NextRequest) {
  const dryRun = request.nextUrl.searchParams.get("dryRun")?.trim().toLowerCase();
  return dryRun === "1" || dryRun === "true";
}

function isDryRunAllowedByEnvironment() {
  if (process.env.NODE_ENV !== "production") {
    return true;
  }

  return process.env.AUTO_RETRY_DRY_RUN_ALLOW_PRODUCTION?.trim().toLowerCase() === "true";
}

function isAuthorizedDryRunRequest(request: NextRequest) {
  const expectedSecret = process.env.AUTO_RETRY_DRY_RUN_SECRET?.trim();
  if (!expectedSecret) {
    return false;
  }

  const providedSecret = request.headers.get(DRY_RUN_SECRET_HEADER)?.trim() || "";
  return providedSecret === expectedSecret;
}

function getEnvCredentials() {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim() || "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim() || "";
  const redirectUri = process.env.GOOGLE_REDIRECT_URI?.trim() || "";
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN?.trim() || "";
  const calendarId = process.env.GOOGLE_CALENDAR_ID?.trim() || "primary";

  return {
    complete: Boolean(
      clientId && clientSecret && redirectUri && refreshToken && calendarId
    ),
    refreshToken,
  };
}

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

async function buildAdminAlertInput() {
  const checkedAt = new Date().toISOString();
  const [firestoreConfig, envCredentials, pendingJobs] = await Promise.all([
    getGoogleOauthConfig(),
    Promise.resolve(getEnvCredentials()),
    listPendingSyncJobsByActions({
      actions: ["create", "update", "delete", "resync"],
      limit: 500,
    }),
  ]);

  const credentialSource = firestoreConfig
    ? "firestore"
    : envCredentials.complete
      ? "env_fallback"
      : "missing";

  const hasRefreshToken =
    credentialSource === "firestore"
      ? Boolean(firestoreConfig?.refreshToken)
      : credentialSource === "env_fallback"
        ? Boolean(envCredentials.refreshToken)
        : false;

  let connected = false;
  let reauthRequired = !hasRefreshToken;

  if (credentialSource !== "missing" && hasRefreshToken) {
    try {
      const { calendar } = await createGoogleCalendarClient();
      await calendar.calendarList.list({ maxResults: 1 });
      connected = true;
      reauthRequired = false;
    } catch (error) {
      console.error("[internal.sync-jobs.auto-retry][alert-check][calendar-connectivity-failed]", error);
      connected = false;
      reauthRequired = true;
    }
  }

  return {
    connected,
    reauthRequired,
    credentialSource,
    pendingSyncJobs: pendingJobs.length,
    checkedAt,
  } as const;
}

async function trySendLineAlertAfterAutoRetry() {
  try {
    const alertInput = await buildAdminAlertInput();
    const evaluation = evaluateAdminAlert(alertInput);

    if (!evaluation.shouldAlert || !evaluation.level || !evaluation.signature || !evaluation.message) {
      return;
    }

    const stateRef = adminDb.collection("system_config").doc(LINE_ALERT_STATE_DOC);
    const stateSnap = await stateRef.get();
    const stateData = stateSnap.exists ? stateSnap.data() : null;

    const lastSignature = normalizeString(stateData?.lastSignature);
    const lastSentAtMs = toMillis(stateData?.lastSentAt);
    const now = Date.now();
    const withinCooldown = lastSentAtMs > 0 && now - lastSentAtMs < ALERT_COOLDOWN_MS;

    if (lastSignature && lastSignature === evaluation.signature && withinCooldown) {
      console.info("[internal.sync-jobs.auto-retry][line-alert] skipped by cooldown", {
        signature: evaluation.signature,
        cooldownMs: ALERT_COOLDOWN_MS,
      });
      return;
    }

    const sendResult = await sendLineAdminAlert(evaluation.message);
    if (sendResult.status === "failed") {
      console.error("[internal.sync-jobs.auto-retry][line-alert] send failed", {
        reason: sendResult.reason,
      });
      return;
    }

    if (sendResult.status === "skipped") {
      console.info("[internal.sync-jobs.auto-retry][line-alert] skipped", {
        reason: sendResult.reason,
      });
      return;
    }

    await stateRef.set(
      {
        lastSignature: evaluation.signature,
        lastLevel: evaluation.level,
        lastSentAt: new Date().toISOString(),
      },
      { merge: true }
    );
  } catch (error) {
    console.error("[internal.sync-jobs.auto-retry][line-alert][fatal-error]", error);
  }
}

async function handleAutoRetry(request: NextRequest, options?: { allowDryRun?: boolean }) {
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
    const dryRun =
      Boolean(options?.allowDryRun) &&
      isDryRunRequested(request);

    if (dryRun && !isDryRunAllowedByEnvironment()) {
      return NextResponse.json(
        {
          status: "forbidden",
          code: "dry_run_not_allowed",
          message: "Dry-run is not allowed in this environment",
        },
        { status: 403 }
      );
    }

    if (dryRun && !isAuthorizedDryRunRequest(request)) {
      return NextResponse.json(
        {
          status: "unauthorized",
          code: "dry_run_unauthorized",
          message: "Unauthorized dry-run secret",
        },
        { status: 401 }
      );
    }

    const pendingJobs = await listPendingSyncJobsByActions({
      actions: ["create", "update"],
      limit: FETCH_LIMIT,
    });

    const now = Date.now();
    const eligibleJobs = pendingJobs.filter((job) => isReadyForRetry(job, now));
    const selectedJobs = eligibleJobs.slice(0, MAX_BATCH_SIZE);
    const jobResults: Array<{
      jobId: string;
      action: SyncJobRecord["action"];
      resultStatus: string;
      resultCode?: string;
      message?: string;
    }> = [];

    let processed = 0;
    let succeeded = 0;
    let failed = 0;

    if (dryRun) {
      for (const job of selectedJobs) {
        jobResults.push({
          jobId: job.id,
          action: job.action,
          resultStatus: "dry_run_not_executed",
          message: "dry-run mode: retry not executed",
        });
      }

      const alertInput = await buildAdminAlertInput();
      const alertEvaluation = evaluateAdminAlert(alertInput);
      const skipped = pendingJobs.length - selectedJobs.length;

      return NextResponse.json({
        status: "success",
        message: "auto retry dry-run completed",
        processed,
        succeeded,
        failed,
        skipped,
        selection: {
          fetched: pendingJobs.length,
          eligible: eligibleJobs.length,
          selected: selectedJobs.length,
        },
        jobResults,
        dryRun: true,
        executed: false,
        dryRunAlert: {
          input: alertInput,
          evaluation: {
            shouldAlert: alertEvaluation.shouldAlert,
            level: alertEvaluation.level,
            signature: alertEvaluation.signature,
            checkedAt: alertEvaluation.checkedAt,
          },
        },
      });
    }

    for (const job of selectedJobs) {
      const claimResult = await claimSyncJobForRetry({
        jobId: job.id,
        actor: AUTO_RETRY_ACTOR,
        leaseMs: RETRY_LEASE_MS,
      });
      if (!claimResult.claimed) {
        jobResults.push({
          jobId: job.id,
          action: job.action,
          resultStatus: "claim_failed",
          resultCode: claimResult.reason,
          message: "job claim failed",
        });
        continue;
      }

      const result = await retrySyncJobById({
        jobId: job.id,
        actor: AUTO_RETRY_ACTOR,
        allowedActions: ["create", "update"],
      });
      jobResults.push({
        jobId: job.id,
        action: job.action,
        resultStatus: result.status,
        resultCode: "code" in result ? result.code : undefined,
        message: result.message,
      });

      processed += 1;
      if (result.status === "success") {
        succeeded += 1;
      } else {
        failed += 1;
      }
    }

    const skipped = pendingJobs.length - selectedJobs.length;

    await trySendLineAlertAfterAutoRetry();

    return NextResponse.json({
      status: "success",
      message: "auto retry completed",
      processed,
      succeeded,
      failed,
      skipped,
      selection: {
        fetched: pendingJobs.length,
        eligible: eligibleJobs.length,
        selected: selectedJobs.length,
      },
      jobResults,
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
  return handleAutoRetry(request, { allowDryRun: true });
}

export async function POST(request: NextRequest) {
  return handleAutoRetry(request, { allowDryRun: false });
}
