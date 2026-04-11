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
    };
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
