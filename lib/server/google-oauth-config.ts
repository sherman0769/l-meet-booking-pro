import "server-only";

import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/server/firebase-admin";

const GOOGLE_OAUTH_COLLECTION = "system_config";
const GOOGLE_OAUTH_DOC_ID = "google_oauth";

export type GoogleOauthConfig = {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  calendarId: string;
};

export type GoogleOauthConfigSource = "oauth_callback" | "manual_seed";

type UpsertGoogleOauthConfigInput = GoogleOauthConfig & {
  updatedBy: string;
  source: GoogleOauthConfigSource;
};

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function hasCompleteConfig(config: GoogleOauthConfig | null): config is GoogleOauthConfig {
  return Boolean(
    config &&
      config.refreshToken &&
      config.clientId &&
      config.clientSecret &&
      config.redirectUri &&
      config.calendarId
  );
}

export async function getGoogleOauthConfig(): Promise<GoogleOauthConfig | null> {
  const snap = await adminDb
    .collection(GOOGLE_OAUTH_COLLECTION)
    .doc(GOOGLE_OAUTH_DOC_ID)
    .get();

  if (!snap.exists) {
    return null;
  }

  const data = snap.data();
  const config: GoogleOauthConfig = {
    refreshToken: normalizeString(data?.refreshToken),
    clientId: normalizeString(data?.clientId),
    clientSecret: normalizeString(data?.clientSecret),
    redirectUri: normalizeString(data?.redirectUri),
    calendarId: normalizeString(data?.calendarId) || "primary",
  };

  if (!hasCompleteConfig(config)) {
    return null;
  }

  return config;
}

export async function upsertGoogleOauthConfig(input: UpsertGoogleOauthConfigInput) {
  const ref = adminDb
    .collection(GOOGLE_OAUTH_COLLECTION)
    .doc(GOOGLE_OAUTH_DOC_ID);

  await ref.set(
    {
      refreshToken: input.refreshToken,
      clientId: input.clientId,
      clientSecret: input.clientSecret,
      redirectUri: input.redirectUri,
      calendarId: input.calendarId || "primary",
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: input.updatedBy,
      source: input.source,
    },
    { merge: true }
  );
}
