import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    console.log("[line.webhook] body", body);

    const events = Array.isArray(body?.events) ? body.events : [];
    for (const event of events) {
      const userId =
        event &&
        typeof event === "object" &&
        event.source &&
        typeof event.source === "object" &&
        typeof event.source.userId === "string"
          ? event.source.userId
          : null;

      console.log("[line.webhook] event.source.userId", userId);
    }
  } catch (error) {
    console.error("[line.webhook] parse error", error);
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
