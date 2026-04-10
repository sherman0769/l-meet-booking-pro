import { NextResponse } from "next/server";
import { google } from "googleapis";

export async function POST(request: Request) {
  try {
    const { eventId, date, startTime, endTime, name, service } =
      await request.json();

    if (!eventId) {
      return NextResponse.json(
        { error: "Missing eventId" },
        { status: 400 }
      );
    }

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
      eventId,
      requestBody: {
        summary: `${service}｜${name}`,
        start: {
          dateTime: `${date}T${startTime}:00+08:00`,
          timeZone: "Asia/Taipei",
        },
        end: {
          dateTime: `${date}T${endTime}:00+08:00`,
          timeZone: "Asia/Taipei",
        },
      },
    });

    return NextResponse.json({
      message: "Calendar event updated",
    });
  } catch (error) {
    console.error("Update calendar error:", error);
    return NextResponse.json(
      { error: "Failed to update calendar event" },
      { status: 500 }
    );
  }
}