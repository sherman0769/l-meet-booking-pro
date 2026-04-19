import "server-only";

export type SendLineAdminAlertResult =
  | { status: "sent" }
  | { status: "skipped"; reason: string }
  | { status: "failed"; reason: string };

function isLineAlertEnabled() {
  const flag = process.env.LINE_ALERT_ENABLED?.trim().toLowerCase();
  if (!flag) return true;
  return flag === "true";
}

export async function sendLineAdminAlert(message: string): Promise<SendLineAdminAlertResult> {
  if (!isLineAlertEnabled()) {
    return {
      status: "skipped",
      reason: "LINE alert disabled by LINE_ALERT_ENABLED",
    };
  }

  const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim() || "";
  const to = process.env.LINE_ADMIN_TO?.trim() || "";

  if (!channelAccessToken || !to) {
    return {
      status: "skipped",
      reason: "LINE env missing (LINE_CHANNEL_ACCESS_TOKEN or LINE_ADMIN_TO)",
    };
  }

  try {
    const response = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${channelAccessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to,
        messages: [
          {
            type: "text",
            text: message.slice(0, 5000),
          },
        ],
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      return {
        status: "failed",
        reason: `LINE API push failed (${response.status}): ${detail}`,
      };
    }

    return { status: "sent" };
  } catch (error) {
    return {
      status: "failed",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
