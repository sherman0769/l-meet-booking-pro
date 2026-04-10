import { NextResponse } from "next/server";
import { google } from "googleapis";

type BookingPayload = {
  name: string;
  service: string;
  date: string;
  startTime: string;
  endTime: string;
  note?: string;
  phone?: string;
  lineId?: string;
};

export async function POST(request: Request) {
  try {
    const body: BookingPayload = await request.json();

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
        summary: `${body.service}｜${body.name}`,
        description: [
          `姓名：${body.name}`,
          `服務：${body.service}`,
          `電話：${body.phone || ""}`,
          `LINE ID：${body.lineId || ""}`,
          `備註：${body.note || ""}`,
        ].join("\n"),
        start: {
          dateTime: `${body.date}T${body.startTime}:00+08:00`,
          timeZone: "Asia/Taipei",
        },
        end: {
          dateTime: `${body.date}T${body.endTime}:00+08:00`,
          timeZone: "Asia/Taipei",
        },
      },
    });

    return NextResponse.json({
      message: "Booking event created successfully",
      eventId: response.data.id,
      htmlLink: response.data.htmlLink,
    });
  } catch (error: any) {
    console.error("Calendar create error:", error);

    const detail = error?.message || String(error);
    const isAuthError =
      detail.includes("invalid_grant") ||
      detail.includes("invalid_client") ||
      detail.includes("unauthorized") ||
      detail.includes("authentication");

    return NextResponse.json(
      {
        error: isAuthError
          ? "Google Calendar 授權已失效，請重新授權"
          : "Failed to create booking event",
        detail,
        reauthRequired: isAuthError,
      },
      { status: 500 }
    );
  }
}