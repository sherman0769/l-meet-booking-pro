import { NextResponse } from "next/server";
import { google } from "googleapis";

export async function POST(request: Request) {
  try {
    const { date } = await request.json();

    if (!date) {
      return NextResponse.json({ error: "Missing date" }, { status: 400 });
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

    const response = await calendar.freebusy.query({
      requestBody: {
        timeMin: `${date}T00:00:00+08:00`,
        timeMax: `${date}T23:59:59+08:00`,
        timeZone: "Asia/Taipei",
        items: [{ id: process.env.GOOGLE_CALENDAR_ID || "primary" }],
      },
    });

    const busy =
      response.data.calendars?.[process.env.GOOGLE_CALENDAR_ID || "primary"]?.busy || [];

    return NextResponse.json({ busy });
  } catch (error) {
    console.error("Read busy slots error:", error);
    return NextResponse.json(
      { error: "Failed to read busy slots" },
      { status: 500 }
    );
  }
}