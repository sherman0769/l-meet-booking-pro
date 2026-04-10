import { NextRequest, NextResponse } from "next/server";
import { cancelBooking, type CancelBookingInput } from "@/lib/server/booking-service";
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
    const body = (await request.json()) as Partial<CancelBookingInput>;

    const result = await cancelBooking({
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
          message: result.message || "取消參數錯誤",
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        ...result,
        message: result.message || "取消完成",
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[bookings.cancel][fatal-error]", error);
    return NextResponse.json(
      {
        status: "error",
        code: "internal_error",
        message: "取消預約失敗",
      },
      { status: 500 }
    );
  }
}
