import { NextRequest, NextResponse } from "next/server";
import { createBooking, type CreateBookingInput } from "@/lib/server/booking-service";
import { checkCreateRateLimit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";

function getClientIp(request: NextRequest) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const firstIp = forwardedFor.split(",")[0]?.trim();
    if (firstIp) {
      return firstIp;
    }
  }

  return request.ip || "unknown";
}

export async function POST(request: NextRequest) {
  const clientIp = getClientIp(request);
  const rateLimitResult = await checkCreateRateLimit(clientIp);

  if (!rateLimitResult.allowed) {
    return NextResponse.json(
      {
        status: "rate_limited",
        code: "rate_limited",
        message: "Too many requests, please try again later",
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(rateLimitResult.retryAfter ?? 60),
        },
      }
    );
  }

  try {
    const body = (await request.json()) as Partial<CreateBookingInput>;

    const result = await createBooking({
      name: String(body?.name ?? "").trim(),
      lineId: String(body?.lineId ?? "").trim(),
      phone: String(body?.phone ?? "").trim(),
      note: String(body?.note ?? "").trim(),
      service: String(body?.service ?? "").trim(),
      lessons: Number(body?.lessons ?? 0),
      date: String(body?.date ?? "").trim(),
      time: String(body?.time ?? "").trim(),
    });

    if (result.status === "validation_error") {
      return NextResponse.json(
        {
          ...result,
          code: "validation_error",
          message: result.message || "預約資料格式錯誤",
        },
        { status: 400 }
      );
    }

    if (result.status === "conflict") {
      return NextResponse.json(
        {
          ...result,
          code: "slot_conflict",
          message: result.message || "所選時段中有部分已被預約，請選擇其他時間",
        },
        { status: 409 }
      );
    }

    return NextResponse.json(
      {
        ...result,
        message: result.message || "建立預約成功",
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[bookings.create][fatal-error]", error);
    return NextResponse.json(
      {
        status: "error",
        code: "internal_error",
        message: "建立預約失敗",
      },
      { status: 500 }
    );
  }
}
