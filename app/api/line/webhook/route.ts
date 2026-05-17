import { NextResponse } from "next/server";
import { verifyLineSignature } from "@/lib/server/line-signature";

type LineWebhookBody = {
  events?: unknown;
};

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-line-signature");
  const channelSecret = process.env.LINE_CHANNEL_SECRET?.trim();

  if (!channelSecret) {
    return NextResponse.json(
      { ok: false, error: "LINE webhook is not configured" },
      { status: 500 }
    );
  }

  if (!verifyLineSignature(rawBody, signature, channelSecret)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = JSON.parse(rawBody) as LineWebhookBody;
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
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
