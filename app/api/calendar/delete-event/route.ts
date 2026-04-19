import { NextResponse } from "next/server";
import { createGoogleCalendarClient } from "@/lib/server/calendar-client";

export async function POST(request: Request) {
  try {
    const { eventId } = await request.json();

    if (!eventId) {
      return NextResponse.json(
        { error: "Missing eventId" },
        { status: 400 }
      );
    }

    const { calendar, calendarId } = await createGoogleCalendarClient();

    await calendar.events.delete({
      calendarId,
      eventId,
    });

    return NextResponse.json({
      message: "Calendar event deleted successfully",
      eventId,
    });
  } catch (error) {
    console.error("Delete calendar event error:", error);
    return NextResponse.json(
      { error: "Failed to delete calendar event" },
      { status: 500 }
    );
  }
}
