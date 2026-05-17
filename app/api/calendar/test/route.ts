import { NextRequest, NextResponse } from "next/server";
import { createGoogleCalendarClient } from "@/lib/server/calendar-client";

function isAuthorizedCalendarTestRequest(request: NextRequest) {
  const expectedSecret = process.env.CRON_SECRET?.trim();
  if (!expectedSecret) return false;

  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return false;

  const token = authHeader.slice("Bearer ".length).trim();
  return token === expectedSecret;
}

export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "Calendar test is not allowed in production" },
      { status: 403 }
    );
  }

  if (!isAuthorizedCalendarTestRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { calendar, calendarId } = await createGoogleCalendarClient();

    const response = await calendar.events.insert({
      calendarId,
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
