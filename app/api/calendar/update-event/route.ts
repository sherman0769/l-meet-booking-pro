import { NextRequest, NextResponse } from "next/server";
import { createGoogleCalendarClient } from "@/lib/server/calendar-client";
import { requireAdminSession } from "@/lib/server/admin-session";

// Deprecated: direct calendar write route kept for admin-only legacy checks.
export async function POST(request: NextRequest) {
  const unauthorized = requireAdminSession(request);
  if (unauthorized) {
    return unauthorized;
  }

  try {
    const { eventId, date, startTime, endTime, name, service } =
      await request.json();

    if (!eventId) {
      return NextResponse.json(
        { error: "Missing eventId" },
        { status: 400 }
      );
    }

    const { calendar, calendarId } = await createGoogleCalendarClient();

    await calendar.events.patch({
      calendarId,
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
