import "server-only";

import { createHmac, timingSafeEqual } from "crypto";

export function verifyLineSignature(
  rawBody: string,
  signature: string | null,
  channelSecret: string | undefined
): boolean {
  if (!signature || !channelSecret) {
    return false;
  }

  const expectedSignature = createHmac("sha256", channelSecret)
    .update(rawBody, "utf8")
    .digest("base64");

  const signatureBuffer = Buffer.from(signature.trim(), "utf8");
  const expectedSignatureBuffer = Buffer.from(expectedSignature, "utf8");

  if (signatureBuffer.length !== expectedSignatureBuffer.length) {
    return false;
  }

  return timingSafeEqual(signatureBuffer, expectedSignatureBuffer);
}
