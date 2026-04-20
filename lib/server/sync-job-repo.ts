import "server-only";

import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/server/firebase-admin";

export type SyncJobAction = "create" | "update" | "delete" | "resync";
export type SyncJobStatus = "pending" | "resolved" | "dismissed";

export type UpsertPendingSyncJobInput = {
  action: SyncJobAction;
  bookingGroupId?: string;
  bookingId?: string;
  calendarEventId?: string;
  reason: string;
  lastError: string;
  date?: string;
};

export type SyncJobRecord = {
  id: string;
  action: SyncJobAction;
  status: SyncJobStatus;
  bookingGroupId?: string | null;
  bookingId?: string | null;
  calendarEventId?: string | null;
  reason?: string;
  lastError?: string;
  attemptCount: number;
  date?: string | null;
  lastTriedAt?: unknown;
  lastTriedBy?: string | null;
  resolvedBy?: string | null;
  leaseOwner?: string | null;
  leaseExpiresAt?: unknown;
  leaseUpdatedAt?: unknown;
};

export type ClaimSyncJobForRetryResult =
  | { claimed: true }
  | {
      claimed: false;
      reason: "not_found" | "not_pending" | "lease_active";
    };

function buildJobKey(input: UpsertPendingSyncJobInput) {
  const rawKey = [
    input.action,
    input.bookingGroupId || "",
    input.bookingId || "",
    input.calendarEventId || "",
    input.date || "",
  ].join("|");

  return createHash("sha256").update(rawKey).digest("hex");
}

function toMillis(value: unknown) {
  if (!value) return 0;
  if (typeof value === "string") {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? 0 : ms;
  }

  const ts = value as { toMillis?: () => number; seconds?: number };
  if (typeof ts.toMillis === "function") {
    return ts.toMillis();
  }
  if (typeof ts.seconds === "number") {
    return ts.seconds * 1000;
  }
  return 0;
}

export async function upsertPendingSyncJob(input: UpsertPendingSyncJobInput) {
  const jobKey = buildJobKey(input);
  const ref = adminDb.collection("sync_jobs").doc(jobKey);

  await adminDb.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    const previousAttemptCount = snap.exists
      ? Number(snap.data()?.attemptCount || 0)
      : 0;

    transaction.set(
      ref,
      {
        action: input.action,
        status: "pending" as SyncJobStatus,
        bookingGroupId: input.bookingGroupId || null,
        bookingId: input.bookingId || null,
        calendarEventId: input.calendarEventId || null,
        reason: input.reason,
        lastError: input.lastError,
        attemptCount: previousAttemptCount + 1,
        date: input.date || null,
        createdAt: snap.exists ? snap.data()?.createdAt || FieldValue.serverTimestamp() : FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        resolvedAt: null,
        lastTriedAt: null,
        lastTriedBy: null,
        resolvedBy: null,
        jobKey,
      },
      { merge: true }
    );
  });
}

export async function getSyncJobById(jobId: string): Promise<SyncJobRecord | null> {
  const snap = await adminDb.collection("sync_jobs").doc(jobId).get();
  if (!snap.exists) {
    return null;
  }

  const data = snap.data();
  return {
    id: snap.id,
    action: (data?.action || "create") as SyncJobAction,
    status: (data?.status || "pending") as SyncJobStatus,
    bookingGroupId: data?.bookingGroupId || null,
    bookingId: data?.bookingId || null,
    calendarEventId: data?.calendarEventId || null,
    reason: data?.reason || "",
    lastError: data?.lastError || "",
    attemptCount: Number(data?.attemptCount || 0),
    date: data?.date || null,
    lastTriedAt: data?.lastTriedAt || null,
    lastTriedBy: data?.lastTriedBy || null,
    resolvedBy: data?.resolvedBy || null,
    leaseOwner: data?.leaseOwner || null,
    leaseExpiresAt: data?.leaseExpiresAt || null,
    leaseUpdatedAt: data?.leaseUpdatedAt || null,
  };
}

export async function listPendingSyncJobsByActions(params: {
  actions: SyncJobAction[];
  limit?: number;
}): Promise<SyncJobRecord[]> {
  const { actions, limit = 50 } = params;
  const filteredActions = actions.filter(Boolean);

  let query = adminDb.collection("sync_jobs").where("status", "==", "pending");

  if (filteredActions.length > 0 && filteredActions.length <= 10) {
    query = query.where("action", "in", filteredActions);
  }

  const snapshot = await query.limit(limit).get();

  return snapshot.docs.map((docSnap) => {
    const data = docSnap.data();
    return {
      id: docSnap.id,
      action: (data?.action || "create") as SyncJobAction,
      status: (data?.status || "pending") as SyncJobStatus,
      bookingGroupId: data?.bookingGroupId || null,
      bookingId: data?.bookingId || null,
      calendarEventId: data?.calendarEventId || null,
      reason: data?.reason || "",
      lastError: data?.lastError || "",
      attemptCount: Number(data?.attemptCount || 0),
      date: data?.date || null,
      lastTriedAt: data?.lastTriedAt || null,
      lastTriedBy: data?.lastTriedBy || null,
      resolvedBy: data?.resolvedBy || null,
      leaseOwner: data?.leaseOwner || null,
      leaseExpiresAt: data?.leaseExpiresAt || null,
      leaseUpdatedAt: data?.leaseUpdatedAt || null,
    };
  });
}

export async function claimSyncJobForRetry(params: {
  jobId: string;
  actor: string;
  leaseMs: number;
}): Promise<ClaimSyncJobForRetryResult> {
  const { jobId, actor, leaseMs } = params;
  const ref = adminDb.collection("sync_jobs").doc(jobId);
  const now = Date.now();
  const leaseExpiresAt = new Date(now + Math.max(0, leaseMs)).toISOString();

  return adminDb.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists) {
      return { claimed: false, reason: "not_found" } as ClaimSyncJobForRetryResult;
    }

    const data = snap.data();
    const status = (data?.status || "pending") as SyncJobStatus;
    if (status !== "pending") {
      return { claimed: false, reason: "not_pending" } as ClaimSyncJobForRetryResult;
    }

    const existingLeaseExpiresAtMs = toMillis(data?.leaseExpiresAt);
    if (existingLeaseExpiresAtMs > now) {
      return { claimed: false, reason: "lease_active" } as ClaimSyncJobForRetryResult;
    }

    transaction.set(
      ref,
      {
        leaseOwner: actor,
        leaseExpiresAt,
        leaseUpdatedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return { claimed: true } as ClaimSyncJobForRetryResult;
  });
}

export async function markSyncJobResolved(params: {
  jobId: string;
  actor: string;
}) {
  const { jobId, actor } = params;
  await adminDb.collection("sync_jobs").doc(jobId).update({
    status: "resolved",
    resolvedAt: FieldValue.serverTimestamp(),
    resolvedBy: actor,
    lastTriedAt: FieldValue.serverTimestamp(),
    lastTriedBy: actor,
    updatedAt: FieldValue.serverTimestamp(),
    lastError: "",
    leaseOwner: null,
    leaseExpiresAt: null,
    leaseUpdatedAt: null,
  });
}

export async function markSyncJobRetryFailed(params: {
  jobId: string;
  errorMessage: string;
  actor: string;
}) {
  const { jobId, errorMessage, actor } = params;

  await adminDb.collection("sync_jobs").doc(jobId).set(
    {
      status: "pending",
      attemptCount: FieldValue.increment(1),
      lastError: errorMessage,
      lastTriedAt: FieldValue.serverTimestamp(),
      lastTriedBy: actor,
      updatedAt: FieldValue.serverTimestamp(),
      resolvedAt: null,
      resolvedBy: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      leaseUpdatedAt: null,
    },
    { merge: true }
  );
}

export async function markSyncJobDismissed(params: {
  jobId: string;
  actor: string;
  reason?: string;
}) {
  const { jobId, actor, reason } = params;

  await adminDb.collection("sync_jobs").doc(jobId).set(
    {
      status: "dismissed" as SyncJobStatus,
      updatedAt: FieldValue.serverTimestamp(),
      resolvedAt: FieldValue.serverTimestamp(),
      resolvedBy: actor,
      ...(reason ? { dismissReason: reason } : {}),
    },
    { merge: true }
  );
}

export async function setSyncJobCalendarEventId(params: {
  jobId: string;
  calendarEventId: string;
}) {
  const { jobId, calendarEventId } = params;
  await adminDb.collection("sync_jobs").doc(jobId).set(
    {
      calendarEventId,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}
