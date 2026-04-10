import { NextRequest, NextResponse } from "next/server";
import {
  rescheduleBooking,
  type RescheduleBookingInput,
} from "@/lib/server/booking-service";
import { requireAdminSession } from "@/lib/server/admin-session";

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
    const body = (await request.json()) as Partial<RescheduleBookingInput>;

    const result = await rescheduleBooking({
      bookingId: String(body?.bookingId ?? "").trim(),
      bookingGroupId: String(body?.bookingGroupId ?? "").trim() || undefined,
      calendarEventId: String(body?.calendarEventId ?? "").trim() || undefined,
      name: String(body?.name ?? "").trim(),
      service: String(body?.service ?? "").trim(),
      lessons: Number(body?.lessons ?? 1),
      lineId: String(body?.lineId ?? "").trim(),
      phone: String(body?.phone ?? "").trim(),
      note: String(body?.note ?? "").trim(),
      status: String(body?.status ?? "pending").trim(),
      contactStatus: String(body?.contactStatus ?? "").trim() || undefined,
      calendarSyncStatus:
        String(body?.calendarSyncStatus ?? "").trim() || undefined,
      oldDate: String(body?.oldDate ?? "").trim() || undefined,
      newDate: String(body?.newDate ?? "").trim(),
      newTime: String(body?.newTime ?? "").trim(),
    });

    if (result.status === "validation_error") {
      return NextResponse.json(
        {
          ...result,
          code: "validation_error",
          message: result.message || "改期參數錯誤",
        },
        { status: 400 }
      );
    }

    if (result.status === "conflict") {
      return NextResponse.json(
        {
          ...result,
          code: "slot_conflict",
          message: result.message || "新時段已被預約",
        },
        { status: 409 }
      );
    }

    return NextResponse.json(
      {
        ...result,
        message: result.message || "改期完成",
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[bookings.reschedule][fatal-error]", error);
    return NextResponse.json(
      {
        status: "error",
        code: "internal_error",
        message: "改期失敗",
      },
      { status: 500 }
    );
  }
}
