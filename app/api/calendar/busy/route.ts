import { NextResponse } from "next/server";
import { createGoogleCalendarClient } from "@/lib/server/calendar-client";

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MAX_LOOKAHEAD_DAYS = 90;

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

function parseDateOnly(date: string) {
  const match = DATE_PATTERN.exec(date);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }

  return parsed;
}

function getTaipeiToday() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);

  return new Date(Date.UTC(year, month - 1, day));
}

function isWithinAllowedDateRange(date: Date) {
  const today = getTaipeiToday();
  const maxDate = new Date(today);
  maxDate.setUTCDate(today.getUTCDate() + MAX_LOOKAHEAD_DAYS);

  return date >= today && date <= maxDate;
}

export async function POST(request: Request) {
  try {
    const { date } = await request.json();

    if (!date) {
      return NextResponse.json({ error: "Missing date" }, { status: 400 });
    }

    if (typeof date !== "string") {
      return NextResponse.json({ error: "Invalid date" }, { status: 400 });
    }

    const parsedDate = parseDateOnly(date);
    if (!parsedDate || !isWithinAllowedDateRange(parsedDate)) {
      return NextResponse.json({ error: "Invalid date" }, { status: 400 });
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
