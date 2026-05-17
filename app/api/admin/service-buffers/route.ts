import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/server/firebase-admin";
import { requireAdminSession } from "@/lib/server/admin-session";
import {
  DEFAULT_SERVICE_BUFFERS,
  normalizeBuffer,
  normalizeServiceBuffers,
} from "@/lib/server/service-buffers";

export const runtime = "nodejs";

const DOC_PATH = ["system_settings", "service_buffers"] as const;

export async function GET(req: NextRequest) {
  const unauthorized = requireAdminSession(req);
  if (unauthorized) {
    return unauthorized;
  }

  try {
    const ref = adminDb.collection(DOC_PATH[0]).doc(DOC_PATH[1]);
    const snap = await ref.get();

    if (!snap.exists) {
      await ref.set({
        buffers: DEFAULT_SERVICE_BUFFERS,
        updatedAt: new Date().toISOString(),
      });

      return NextResponse.json({
        success: true,
        buffers: DEFAULT_SERVICE_BUFFERS,
      });
    }

    const data = snap.data();
    const buffers = normalizeServiceBuffers(data?.buffers as Record<string, unknown>);

    return NextResponse.json({
      success: true,
      buffers,
    });
  } catch (error) {
    console.error("[service-buffers][GET] error:", error);
    return NextResponse.json(
      { success: false, error: "讀取 service buffers 失敗" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const unauthorized = requireAdminSession(req);
  if (unauthorized) {
    return unauthorized;
  }

  try {
    const body = await req.json();

    const buffers = {
      健身: normalizeBuffer(body?.buffers?.健身 ?? DEFAULT_SERVICE_BUFFERS.健身),
      AI課程: normalizeBuffer(body?.buffers?.AI課程 ?? DEFAULT_SERVICE_BUFFERS.AI課程),
      咨詢: normalizeBuffer(body?.buffers?.咨詢 ?? DEFAULT_SERVICE_BUFFERS.咨詢),
      顧問: normalizeBuffer(body?.buffers?.顧問 ?? DEFAULT_SERVICE_BUFFERS.顧問),
    };

    const ref = adminDb.collection(DOC_PATH[0]).doc(DOC_PATH[1]);
    await ref.set(
      {
        buffers,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );

    return NextResponse.json({
      success: true,
      buffers,
    });
  } catch (error) {
    console.error("[service-buffers][POST] error:", error);
    return NextResponse.json(
      { success: false, error: "寫入 service buffers 失敗" },
      { status: 500 }
    );
  }
}
