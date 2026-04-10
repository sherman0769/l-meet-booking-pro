import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/server/firebase-admin";
import { requireAdminSession } from "@/lib/server/admin-session";

export const runtime = "nodejs";

type SortableTime = {
  seconds?: number;
  toMillis?: () => number;
};

function toMillis(value: unknown) {
  if (!value) return 0;
  if (typeof value === "string") {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? 0 : ms;
  }

  const ts = value as SortableTime;
  if (typeof ts.toMillis === "function") {
    return ts.toMillis();
  }
  if (typeof ts.seconds === "number") {
    return ts.seconds * 1000;
  }
  return 0;
}

function toIsoString(value: unknown) {
  const ms = toMillis(value);
  return ms > 0 ? new Date(ms).toISOString() : null;
}

export async function GET(request: NextRequest) {
  const unauthorized = requireAdminSession(request);
  if (unauthorized) {
    return unauthorized;
  }

  try {
    const snapshot = await adminDb
      .collection("sync_jobs")
      .where("status", "==", "pending")
      .get();

    const jobs = snapshot.docs
      .map((docSnap) => {
        const data = docSnap.data();
        return {
          id: docSnap.id,
          action: String(data?.action || ""),
          status: String(data?.status || "pending"),
          reason: String(data?.reason || ""),
          bookingGroupId: data?.bookingGroupId || null,
          bookingId: data?.bookingId || null,
          calendarEventId: data?.calendarEventId || null,
          attemptCount: Number(data?.attemptCount || 0),
          lastError: String(data?.lastError || ""),
          lastTriedAt: toIsoString(data?.lastTriedAt),
          lastTriedBy: data?.lastTriedBy || null,
          updatedAt: toIsoString(data?.updatedAt),
          createdAt: toIsoString(data?.createdAt),
        };
      })
      .sort((a, b) => {
        const aTime = Date.parse(a.updatedAt || a.createdAt || "");
        const bTime = Date.parse(b.updatedAt || b.createdAt || "");
        return (Number.isNaN(bTime) ? 0 : bTime) - (Number.isNaN(aTime) ? 0 : aTime);
      });

    return NextResponse.json({
      success: true,
      jobs,
    });
  } catch (error) {
    console.error("[admin.sync-jobs][GET] error:", error);
    return NextResponse.json(
      { success: false, error: "讀取待補償項目失敗" },
      { status: 500 }
    );
  }
}
