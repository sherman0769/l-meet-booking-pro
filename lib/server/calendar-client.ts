import "server-only";

import { google } from "googleapis";
import { getGoogleOauthConfig } from "@/lib/server/google-oauth-config";

export type CreateCalendarBookingEventInput = {
  name: string;
  service: string;
  date: string;
  startTime: string;
  endTime: string;
  note?: string;
  phone?: string;
  lineId?: string;
};

export type DeleteCalendarBookingEventInput = {
  eventId: string;
};

export type UpdateCalendarBookingEventInput = {
  eventId: string;
  date: string;
  startTime: string;
  endTime: string;
  name: string;
  service: string;
};

type CalendarCredentials = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  refreshToken: string;
  calendarId: string;
};

function isCompleteCredentials(value: Partial<CalendarCredentials> | null | undefined): value is CalendarCredentials {
  return Boolean(
    value?.clientId &&
      value.clientSecret &&
      value.redirectUri &&
      value.refreshToken &&
      value.calendarId
  );
}

function getEnvCredentials(): CalendarCredentials | null {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim() || "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim() || "";
  const redirectUri = process.env.GOOGLE_REDIRECT_URI?.trim() || "";
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN?.trim() || "";
  const calendarId = process.env.GOOGLE_CALENDAR_ID?.trim() || "primary";

  if (!isCompleteCredentials({ clientId, clientSecret, redirectUri, refreshToken, calendarId })) {
    return null;
  }

  return {
    clientId,
    clientSecret,
    redirectUri,
    refreshToken,
    calendarId,
  };
}

async function resolveCalendarCredentials(): Promise<CalendarCredentials> {
  const firestoreConfig = await getGoogleOauthConfig();

  if (firestoreConfig) {
    return {
      clientId: firestoreConfig.clientId,
      clientSecret: firestoreConfig.clientSecret,
      redirectUri: firestoreConfig.redirectUri,
      refreshToken: firestoreConfig.refreshToken,
      calendarId: firestoreConfig.calendarId || "primary",
    };
  }

  const envCredentials = getEnvCredentials();
  if (envCredentials) {
    return envCredentials;
  }

  throw new Error(
    "Google OAuth config missing: neither Firestore system_config/google_oauth nor environment variables are complete"
  );
}

export async function createGoogleCalendarClient() {
  const credentials = await resolveCalendarCredentials();

  const oauth2Client = new google.auth.OAuth2(
    credentials.clientId,
    credentials.clientSecret,
    credentials.redirectUri
  );

  oauth2Client.setCredentials({
    refresh_token: credentials.refreshToken,
  });

  const calendar = google.calendar({ version: "v3", auth: oauth2Client });

  return {
    calendar,
    calendarId: credentials.calendarId || "primary",
  };
}

export async function createCalendarBookingEvent(
  input: CreateCalendarBookingEventInput
) {
  const { calendar, calendarId } = await createGoogleCalendarClient();

  const response = await calendar.events.insert({
    calendarId,
    requestBody: {
      summary: `${input.service}｜${input.name}`,
      description: [
        `姓名：${input.name}`,
        `服務：${input.service}`,
        `電話：${input.phone || ""}`,
        `LINE ID：${input.lineId || ""}`,
        `備註：${input.note || ""}`,
      ].join("\n"),
      start: {
        dateTime: `${input.date}T${input.startTime}:00+08:00`,
        timeZone: "Asia/Taipei",
      },
      end: {
        dateTime: `${input.date}T${input.endTime}:00+08:00`,
        timeZone: "Asia/Taipei",
      },
    },
  });

  return {
    eventId: response.data.id || "",
    htmlLink: response.data.htmlLink || "",
  };
}

export async function deleteCalendarBookingEvent(
  input: DeleteCalendarBookingEventInput
) {
  const { calendar, calendarId } = await createGoogleCalendarClient();

  await calendar.events.delete({
    calendarId,
    eventId: input.eventId,
  });
}

export async function updateCalendarBookingEvent(
  input: UpdateCalendarBookingEventInput
) {
  const { calendar, calendarId } = await createGoogleCalendarClient();

  await calendar.events.patch({
    calendarId,
    eventId: input.eventId,
    requestBody: {
      summary: `${input.service}｜${input.name}`,
      start: {
        dateTime: `${input.date}T${input.startTime}:00+08:00`,
        timeZone: "Asia/Taipei",
      },
      end: {
        dateTime: `${input.date}T${input.endTime}:00+08:00`,
        timeZone: "Asia/Taipei",
      },
    },
  });
}
