import { adminDb } from "@/lib/server/firebase-admin";

const DOC_PATH = ["system_settings", "service_buffers"] as const;

type ServiceName = "健身" | "AI課程" | "咨詢" | "顧問";

export type ServiceBuffers = Record<ServiceName, number>;

export const DEFAULT_SERVICE_BUFFERS: ServiceBuffers = {
  健身: 30,
  AI課程: 0,
  咨詢: 0,
  顧問: 0,
};

export function normalizeBuffer(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  return Math.floor(n);
}

export function normalizeServiceBuffers(raw: Record<string, unknown> | undefined | null): ServiceBuffers {
  const buffers = raw ?? {};

  return {
    健身: normalizeBuffer(buffers["健身"] ?? DEFAULT_SERVICE_BUFFERS.健身),
    AI課程: normalizeBuffer(buffers["AI課程"] ?? DEFAULT_SERVICE_BUFFERS.AI課程),
    咨詢: normalizeBuffer(buffers["咨詢"] ?? DEFAULT_SERVICE_BUFFERS.咨詢),
    顧問: normalizeBuffer(buffers["顧問"] ?? DEFAULT_SERVICE_BUFFERS.顧問),
  };
}

export async function readServiceBuffers(): Promise<ServiceBuffers> {
  const ref = adminDb.collection(DOC_PATH[0]).doc(DOC_PATH[1]);
  const snap = await ref.get();

  if (!snap.exists) {
    return { ...DEFAULT_SERVICE_BUFFERS };
  }

  const data = snap.data();
  return normalizeServiceBuffers((data?.buffers as Record<string, unknown>) ?? null);
}