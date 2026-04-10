import type { ApiStatus } from "@/lib/shared/api-contract";

type ParsedApiResult<T extends Record<string, unknown>> = T & {
  status: ApiStatus;
  code?: string;
  message: string;
};

function isApiStatus(value: unknown): value is ApiStatus {
  return typeof value === "string" && [
    "success",
    "partial_success",
    "validation_error",
    "conflict",
    "unauthorized",
    "rate_limited",
    "not_found",
    "error",
  ].includes(value);
}

export async function parseApiResult<T extends Record<string, unknown> = Record<string, unknown>>(
  response: Response
): Promise<ParsedApiResult<T>> {
  let body: Record<string, unknown> = {};

  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const status: ApiStatus = isApiStatus(body.status)
    ? body.status
    : (response.ok ? "success" : "error");

  const code = typeof body.code === "string" ? body.code : undefined;
  const message =
    typeof body.message === "string"
      ? body.message
      : (typeof body.error === "string" ? body.error : "");

  return {
    ...(body as T),
    status,
    ...(code ? { code } : {}),
    message,
  };
}
