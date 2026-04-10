import { NextResponse } from "next/server";
import { google } from "googleapis";

export async function GET() {
  try {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    oauth2Client.setCredentials({
      access_token: process.env.GOOGLE_ACCESS_TOKEN,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
    });

    const calendar = google.calendar({ version: "v3", auth: oauth2Client });

    const response = await calendar.events.insert({
      calendarId: process.env.GOOGLE_CALENDAR_ID || "primary",
      requestBody: {
        summary: "L_meet booking pro 測試事件",
        description: "這是一筆從 Next.js API 寫入的 Google Calendar 測試事件",
        start: {
          dateTime: "2026-04-05T10:00:00+08:00",
          timeZone: "Asia/Taipei",
        },
        end: {
          dateTime: "2026-04-05T11:00:00+08:00",
          timeZone: "Asia/Taipei",
        },
      },
    });

    return NextResponse.json({
      message: "Calendar event created successfully",
      eventId: response.data.id,
      htmlLink: response.data.htmlLink,
    });
  } catch (error) {
    console.error("Create calendar event error:", error);
    return NextResponse.json(
      { error: "Failed to create calendar event" },
      { status: 500 }
    );
  }
}