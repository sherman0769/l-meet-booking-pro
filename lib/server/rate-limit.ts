import "server-only";

type RateLimitBucket = {
  count: number;
  resetTime: number;
};

type RateLimitResult = {
  allowed: boolean;
  retryAfter?: number;
};

const CREATE_LIMIT = 5;
const CREATE_WINDOW_MS = 10 * 60 * 1000;
const CREATE_WINDOW_SECONDS = CREATE_WINDOW_MS / 1000;
const createRateLimitStore = new Map<string, RateLimitBucket>();

function checkCreateRateLimitInMemory(ip: string): RateLimitResult {
  const now = Date.now();
  const key = ip || "unknown";
  const bucket = createRateLimitStore.get(key);

  if (!bucket || now >= bucket.resetTime) {
    createRateLimitStore.set(key, {
      count: 1,
      resetTime: now + CREATE_WINDOW_MS,
    });
    return { allowed: true };
  }

  if (bucket.count >= CREATE_LIMIT) {
    return {
      allowed: false,
      retryAfter: Math.max(1, Math.ceil((bucket.resetTime - now) / 1000)),
    };
  }

  bucket.count += 1;
  createRateLimitStore.set(key, bucket);
  return { allowed: true };
}

function getUpstashConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    return null;
  }

  return { url, token };
}

function toRateLimitKey(ip: string) {
  return `rl:create:${ip || "unknown"}`;
}

async function checkCreateRateLimitWithUpstash(
  ip: string,
  url: string,
  token: string
): Promise<RateLimitResult> {
  const key = toRateLimitKey(ip);

  const response = await fetch(`${url}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([
      ["INCR", key],
      ["EXPIRE", key, CREATE_WINDOW_SECONDS, "NX"],
      ["TTL", key],
    ]),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`UPSTASH_PIPELINE_FAILED:${response.status}`);
  }

  const results = (await response.json()) as Array<{
    result?: unknown;
    error?: string;
  }>;

  if (!Array.isArray(results) || results.length < 3) {
    throw new Error("UPSTASH_PIPELINE_INVALID_RESULT");
  }

  if (results.some((item) => item?.error)) {
    throw new Error("UPSTASH_PIPELINE_COMMAND_ERROR");
  }

  const count = Number(results[0]?.result ?? 0);
  const ttlRaw = Number(results[2]?.result ?? CREATE_WINDOW_SECONDS);
  const ttl = ttlRaw > 0 ? ttlRaw : CREATE_WINDOW_SECONDS;

  if (count > CREATE_LIMIT) {
    return {
      allowed: false,
      retryAfter: ttl,
    };
  }

  return { allowed: true };
}

export async function checkCreateRateLimit(ip: string): Promise<RateLimitResult> {
  const upstash = getUpstashConfig();

  if (!upstash) {
    return checkCreateRateLimitInMemory(ip);
  }

  try {
    return await checkCreateRateLimitWithUpstash(ip, upstash.url, upstash.token);
  } catch (error) {
    console.error("[rate-limit][upstash-fallback-to-memory]", error);
    return checkCreateRateLimitInMemory(ip);
  }
}
