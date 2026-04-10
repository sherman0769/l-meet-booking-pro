import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/server/firebase-admin";
import { requireAdminSession } from "@/lib/server/admin-session";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const unauthorized = requireAdminSession(req);
  if (unauthorized) {
    return unauthorized;
  }

  try {
    const body = await req.json();

    const { calendarEventId, status } = body;

    if (!calendarEventId || !status) {
      return NextResponse.json(
        { success: false, error: "參數缺失" },
        { status: 400 }
      );
    }

    const snapshot = await adminDb
      .collection("bookings")
      .where("calendarEventId", "==", calendarEventId)
      .get();

    const updatePromises = snapshot.docs.map((docSnap) =>
      docSnap.ref.update({
        contactStatus: status,
      })
    );

    await Promise.all(updatePromises);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[update-contact-status] error:", error);
    return NextResponse.json(
      { success: false, error: "更新失敗" },
      { status: 500 }
    );
  }
}
