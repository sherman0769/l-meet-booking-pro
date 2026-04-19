import { NextResponse } from "next/server";
import { createGoogleCalendarClient } from "@/lib/server/calendar-client";

export async function POST(request: Request) {
  try {
    const { date } = await request.json();

    if (!date) {
      return NextResponse.json({ error: "Missing date" }, { status: 400 });
    }

    const { calendar, calendarId } = await createGoogleCalendarClient();

    const response = await calendar.freebusy.query({
      requestBody: {
        timeMin: `${date}T00:00:00+08:00`,
        timeMax: `${date}T23:59:59+08:00`,
        timeZone: "Asia/Taipei",
        items: [{ id: calendarId }],
      },
    });

    const busy = response.data.calendars?.[calendarId]?.busy || [];

    return NextResponse.json({ busy });
  } catch (error) {
    console.error("Read busy slots error:", error);
    return NextResponse.json(
      { error: "Failed to read busy slots" },
      { status: 500 }
    );
  }
}
