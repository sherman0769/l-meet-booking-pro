import { NextResponse } from "next/server";
import {
  DEFAULT_SERVICE_BUFFERS,
  readServiceBuffers,
} from "@/lib/server/service-buffers";

export async function GET() {
  try {
    const buffers = await readServiceBuffers();

    return NextResponse.json({
      success: true,
      buffers,
    });
  } catch (error) {
    console.error("[service-buffers][public][GET] error:", error);

    return NextResponse.json(
      {
        success: false,
        buffers: DEFAULT_SERVICE_BUFFERS,
        error: "讀取 service buffers 失敗",
      },
      { status: 500 }
    );
  }
}