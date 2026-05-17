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
