import { NextResponse } from "next/server";
import { createGoogleCalendarClient } from "@/lib/server/calendar-client";

function getBusyCalendarIds(primaryCalendarId: string) {
  const raw = process.env.GOOGLE_BLOCKING_CALENDAR_IDS?.trim() || "";

  if (!raw) {
    return [primaryCalendarId];
  }

  const ids = raw
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  return [...new Set([primaryCalendarId, ...ids])];
}

export async function POST(request: Request) {
  try {
    const { date } = await request.json();

    if (!date) {
      return NextResponse.json({ error: "Missing date" }, { status: 400 });
    }

    const { calendar, calendarId } = await createGoogleCalendarClient();
    const targetCalendarIds = getBusyCalendarIds(calendarId);
    const timeMin = `${date}T00:00:00+08:00`;
    const timeMax = `${date}T23:59:59+08:00`;

    const responses = await Promise.all(
      targetCalendarIds.map((id) =>
        calendar.events.list({
          calendarId: id,
          timeMin,
          timeMax,
          singleEvents: true,
          orderBy: "startTime",
          timeZone: "Asia/Taipei",
        })
      )
    );

    const mergedBusy = responses.flatMap((response) =>
      (response.data.items || []).flatMap((event) => {
        const start = event.start?.dateTime;
        const end = event.end?.dateTime;

        if (!start || !end) {
          return [];
        }

        return [{ start, end }];
      })
    );

    const busy = mergedBusy.sort((a, b) => {
      const startA = Date.parse(a.start || "");
      const startB = Date.parse(b.start || "");
      return startA - startB;
    });

    return NextResponse.json({ busy });
  } catch (error) {
    console.error("Read busy slots error:", error);
    return NextResponse.json(
      { error: "Failed to read busy slots" },
      { status: 500 }
    );
  }
}
