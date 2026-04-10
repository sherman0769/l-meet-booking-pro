import { google } from "googleapis";

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

export async function createCalendarBookingEvent(
  input: CreateCalendarBookingEventInput
) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

  oauth2Client.setCredentials({
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
  });

  const calendar = google.calendar({ version: "v3", auth: oauth2Client });

  const response = await calendar.events.insert({
    calendarId: process.env.GOOGLE_CALENDAR_ID || "primary",
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
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

  oauth2Client.setCredentials({
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
  });

  const calendar = google.calendar({ version: "v3", auth: oauth2Client });

  await calendar.events.delete({
    calendarId: process.env.GOOGLE_CALENDAR_ID || "primary",
    eventId: input.eventId,
  });
}

export async function updateCalendarBookingEvent(
  input: UpdateCalendarBookingEventInput
) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

  oauth2Client.setCredentials({
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
  });

  const calendar = google.calendar({ version: "v3", auth: oauth2Client });

  await calendar.events.patch({
    calendarId: process.env.GOOGLE_CALENDAR_ID || "primary",
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
