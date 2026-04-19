import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/server/firebase-admin";
import { requireAdminSession } from "@/lib/server/admin-session";
import { getGoogleOauthConfig } from "@/lib/server/google-oauth-config";
import { createGoogleCalendarClient } from "@/lib/server/calendar-client";
import { listPendingSyncJobsByActions } from "@/lib/server/sync-job-repo";

export const runtime = "nodejs";

type CredentialSource = "firestore" | "env_fallback" | "missing";

type TimestampLike = {
  toDate?: () => Date;
  toMillis?: () => number;
  seconds?: number;
};

function toIsoString(value: unknown): string | null {
  if (!value) return null;

  if (typeof value === "string") {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : new Date(ms).toISOString();
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }

  const ts = value as TimestampLike;
  if (typeof ts.toDate === "function") {
    const date = ts.toDate();
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  if (typeof ts.toMillis === "function") {
    const ms = ts.toMillis();
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  }

  if (typeof ts.seconds === "number") {
    return new Date(ts.seconds * 1000).toISOString();
  }

  return null;
}

function getEnvCredentials() {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim() || "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim() || "";
  const redirectUri = process.env.GOOGLE_REDIRECT_URI?.trim() || "";
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN?.trim() || "";
  const calendarId = process.env.GOOGLE_CALENDAR_ID?.trim() || "primary";

  const complete = Boolean(
    clientId && clientSecret && redirectUri && refreshToken && calendarId
  );

  return {
    complete,
    refreshToken,
  };
}

export async function GET(request: NextRequest) {
  const unauthorized = requireAdminSession(request);
  if (unauthorized) {
    return unauthorized;
  }

  try {
    const [firestoreConfig, envCredentials, oauthDocSnap, pendingJobs] = await Promise.all([
      getGoogleOauthConfig(),
      Promise.resolve(getEnvCredentials()),
      adminDb.collection("system_config").doc("google_oauth").get(),
      listPendingSyncJobsByActions({
        actions: ["create", "update", "delete", "resync"],
        limit: 200,
      }),
    ]);

    const rawDocData = oauthDocSnap.exists ? oauthDocSnap.data() : null;
    const rawFirestoreRefreshToken =
      typeof rawDocData?.refreshToken === "string" ? rawDocData.refreshToken.trim() : "";
    const lastUpdatedAt = toIsoString(rawDocData?.updatedAt);

    let credentialSource: CredentialSource = "missing";
    if (firestoreConfig) {
      credentialSource = "firestore";
    } else if (envCredentials.complete) {
      credentialSource = "env_fallback";
    }

    const hasRefreshToken =
      credentialSource === "firestore"
        ? Boolean(firestoreConfig?.refreshToken)
        : credentialSource === "env_fallback"
          ? Boolean(envCredentials.refreshToken)
          : Boolean(rawFirestoreRefreshToken);

    let connected = false;
    let reauthRequired = !hasRefreshToken;

    if (credentialSource !== "missing" && hasRefreshToken) {
      try {
        const { calendar } = await createGoogleCalendarClient();
        await calendar.calendarList.list({ maxResults: 1 });
        connected = true;
        reauthRequired = false;
      } catch (error) {
        console.error("[admin.oauth-calendar-status][connectivity-check-failed]", error);
        connected = false;
        reauthRequired = true;
      }
    }

    return NextResponse.json({
      connected,
      credentialSource,
      hasRefreshToken,
      lastUpdatedAt,
      reauthRequired,
      pendingSyncJobs: pendingJobs.length,
    });
  } catch (error) {
    console.error("[admin.oauth-calendar-status][GET] error:", error);
    return NextResponse.json(
      {
        connected: false,
        credentialSource: "missing",
        hasRefreshToken: false,
        lastUpdatedAt: null,
        reauthRequired: true,
        pendingSyncJobs: 0,
      },
      { status: 500 }
    );
  }
}
