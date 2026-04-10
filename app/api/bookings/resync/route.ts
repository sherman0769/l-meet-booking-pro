import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/server/admin-session";
import { resyncBooking } from "@/lib/server/booking-service";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const unauthorized = requireAdminSession(request);
  if (unauthorized) {
    return NextResponse.json(
      {
        status: "unauthorized",
        code: "unauthorized",
        message: "Unauthorized",
      },
      { status: 401 }
    );
  }

  try {
    const body = (await request.json()) as {
      bookingId?: unknown;
      bookingGroupId?: unknown;
      calendarEventId?: unknown;
      date?: unknown;
    };

    const result = await resyncBooking({
      bookingId: String(body?.bookingId ?? "").trim(),
      bookingGroupId: String(body?.bookingGroupId ?? "").trim() || undefined,
      calendarEventId: String(body?.calendarEventId ?? "").trim() || undefined,
      date: String(body?.date ?? "").trim() || undefined,
    });

    if (result.status === "validation_error") {
      return NextResponse.json(
        {
          ...result,
          code: "validation_error",
          message: result.message || "補同步參數錯誤",
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        ...result,
        message: result.message || "補同步完成",
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[bookings.resync][fatal-error]", error);
    return NextResponse.json(
      {
        status: "error",
        code: "internal_error",
        message: "補同步失敗",
      },
      { status: 500 }
    );
  }
}
