import { NextRequest, NextResponse } from "next/server"

type PreferredTimeRange = "morning" | "afternoon" | "evening" | null

type BookingIntentPayload = {
  success: boolean
  source: "llm" | "rule"
  message: string
  rawText: string

  // 舊前端相容欄位（你目前 page.tsx 直接吃這些）
  name: string | null
  lineId: string | null
  phone: string | null
  service: string | null
  date: string | null
  time: string | null
  lessons: number | null

  // 新版結構化欄位
  booking: {
    serviceName: string | null
    date: string | null
    time: string | null
    durationMinutes: number | null
    sessions: number | null
    preferredTimeRange: PreferredTimeRange
    flexibilityMinutes: number
    isReschedule: boolean
    targetBookingId: string | null
  }

  missingFields: string[]
  needsRecommendation: boolean
  recommendationHints: string[]
}

type LLMParsedResult = {
  name?: string | null
  lineId?: string | null
  phone?: string | null
  serviceName?: string | null
  date?: string | null
  time?: string | null
  durationMinutes?: number | null
  sessions?: number | null
  preferredTimeRange?: PreferredTimeRange
  flexibilityMinutes?: number | null
  isReschedule?: boolean
  targetBookingId?: string | null
  missingFields?: string[]
  needsRecommendation?: boolean
  message?: string
}

const DEFAULT_PAYLOAD = (rawText: string): BookingIntentPayload => ({
  success: false,
  source: "rule",
  message: "無法解析預約資訊",
  rawText,

  name: null,
  lineId: null,
  phone: null,
  service: null,
  date: null,
  time: null,
  lessons: null,

  booking: {
    serviceName: null,
    date: null,
    time: null,
    durationMinutes: null,
    sessions: null,
    preferredTimeRange: null,
    flexibilityMinutes: 0,
    isReschedule: false,
    targetBookingId: null,
  },
  missingFields: [],
  needsRecommendation: false,
  recommendationHints: [],
})

function normalizeDate(value: unknown): string | null {
  if (typeof value !== "string") return null
  const v = value.trim()
  if (!v) return null
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null
}

function normalizeTime(value: unknown): string | null {
  if (typeof value !== "string") return null
  const v = value.trim()
  if (!v) return null
  return /^([01]\d|2[0-3]):(00|30)$/.test(v) ? v : null
}

function normalizePreferredTimeRange(value: unknown): PreferredTimeRange {
  if (value === "morning" || value === "afternoon" || value === "evening") {
    return value
  }
  return null
}

function normalizeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function toDateInTaipei(baseDate = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
  const parts = formatter.formatToParts(baseDate)
  const year = parts.find((p) => p.type === "year")?.value ?? "1970"
  const month = parts.find((p) => p.type === "month")?.value ?? "01"
  const day = parts.find((p) => p.type === "day")?.value ?? "01"
  return `${year}-${month}-${day}`
}

function addDays(dateStr: string, days: number) {
  const [y, m, d] = dateStr.split("-").map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() + days)
  const yyyy = dt.getFullYear()
  const mm = String(dt.getMonth() + 1).padStart(2, "0")
  const dd = String(dt.getDate()).padStart(2, "0")
  return `${yyyy}-${mm}-${dd}`
}

function parseChineseTime(rawText: string): string | null {
  const text = rawText
    .replace(/\s+/g, "")
    .replace(/點鐘/g, "點")
    .replace(/半小時/g, "半")

  // 先抓阿拉伯數字
  let match = text.match(/(上午|早上|中午|下午|晚上|傍晚)?(\d{1,2})(點半|點)/)
  if (match) {
    const period = match[1] ?? ""
    let hour = Number(match[2])
    const isHalf = match[3] === "點半"

    if ((period === "下午" || period === "晚上" || period === "傍晚") && hour < 12) {
      hour += 12
    }
    if (period === "中午" && hour < 11) {
      hour += 12
    }

    return `${String(hour).padStart(2, "0")}:${isHalf ? "30" : "00"}`
  }

  const zhMap: Record<string, number> = {
    一: 1,
    二: 2,
    兩: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
    十一: 11,
    十二: 12,
  }

  const zhKeys = Object.keys(zhMap).sort((a, b) => b.length - a.length)
  for (const key of zhKeys) {
    const re = new RegExp(`(上午|早上|中午|下午|晚上|傍晚)?${key}(點半|點)`)
    const m = text.match(re)
    if (m) {
      const period = m[1] ?? ""
      let hour = zhMap[key]
      const isHalf = m[2] === "點半"

      if ((period === "下午" || period === "晚上" || period === "傍晚") && hour < 12) {
        hour += 12
      }
      if (period === "中午" && hour < 11) {
        hour += 12
      }

      return `${String(hour).padStart(2, "0")}:${isHalf ? "30" : "00"}`
    }
  }

  // 1400 / 1430
  match = text.match(/\b([01]?\d|2[0-3])(00|30)\b/)
  if (match) {
    return `${String(Number(match[1])).padStart(2, "0")}:${match[2]}`
  }

  // 14:00 / 14:30
  match = text.match(/\b([01]?\d|2[0-3]):(00|30)\b/)
  if (match) {
    return `${String(Number(match[1])).padStart(2, "0")}:${match[2]}`
  }

  return null
}

function parseDateText(rawText: string): string | null {
  const text = rawText.replace(/\s+/g, "")
  const today = toDateInTaipei()

  if (text.includes("今天")) return today
  if (text.includes("明天")) return addDays(today, 1)
  if (text.includes("後天")) return addDays(today, 2)

  let match = text.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/)
  if (match) {
    return `${match[1]}-${String(Number(match[2])).padStart(2, "0")}-${String(
      Number(match[3])
    ).padStart(2, "0")}`
  }

  match = text.match(/\b(20\d{2})\/(\d{1,2})\/(\d{1,2})\b/)
  if (match) {
    return `${match[1]}-${String(Number(match[2])).padStart(2, "0")}-${String(
      Number(match[3])
    ).padStart(2, "0")}`
  }

  match = text.match(/\b(\d{1,2})\/(\d{1,2})\b/)
  if (match) {
    const year = today.slice(0, 4)
    return `${year}-${String(Number(match[1])).padStart(2, "0")}-${String(
      Number(match[2])
    ).padStart(2, "0")}`
  }

  return null
}

function parseLessons(rawText: string): number | null {
  const text = rawText.replace(/\s+/g, "")

  let match = text.match(/(\d+)節/)
  if (match) return Number(match[1])

  if (text.includes("一節")) return 1
  if (text.includes("兩節") || text.includes("二節")) return 2
  if (text.includes("三節")) return 3

  return null
}

function parseService(rawText: string): string | null {
  if (rawText.includes("健身")) return "健身"
  if (rawText.includes("AI課") || rawText.includes("AI課程")) return "AI課程"
  if (rawText.includes("咨詢")) return "咨詢"
  if (rawText.includes("顧問")) return "顧問"
  return null
}

function parsePreferredTimeRange(rawText: string): PreferredTimeRange {
  if (rawText.includes("早上") || rawText.includes("上午")) return "morning"
  if (rawText.includes("下午")) return "afternoon"
  if (rawText.includes("晚上") || rawText.includes("傍晚")) return "evening"
  return null
}

function parseNeedsRecommendation(rawText: string): boolean {
  return /都可以|附近|最快|幫我推薦|推薦|可用時間|最接近/.test(rawText)
}

function parseByRule(rawText: string): BookingIntentPayload {
  const service = parseService(rawText)
  const date = parseDateText(rawText)
  const time = parseChineseTime(rawText)
  const lessons = parseLessons(rawText) ?? 1
  const preferredTimeRange = parsePreferredTimeRange(rawText)
  const needsRecommendation = parseNeedsRecommendation(rawText) || (!time && !!preferredTimeRange)

  const missingFields: string[] = []
  if (!service) missingFields.push("service")
  if (!date) missingFields.push("date")
  if (!time && !preferredTimeRange) missingFields.push("time")

  return {
    success: !!service && !!date && (!!time || !!preferredTimeRange),
    source: "rule",
    message: "已使用規則 parser 解析",
    rawText,

    name: null,
    lineId: null,
    phone: null,
    service,
    date,
    time,
    lessons,

    booking: {
      serviceName: service,
      date,
      time,
      durationMinutes: lessons ? lessons * 60 : null,
      sessions: lessons,
      preferredTimeRange,
      flexibilityMinutes: 0,
      isReschedule: false,
      targetBookingId: null,
    },
    missingFields,
    needsRecommendation,
    recommendationHints: [],
  }
}

function buildPayloadFromLLM(rawText: string, parsed: LLMParsedResult): BookingIntentPayload {
  const serviceName =
    typeof parsed.serviceName === "string" && parsed.serviceName.trim()
      ? parsed.serviceName.trim()
      : null

  const date = normalizeDate(parsed.date)
  const time = normalizeTime(parsed.time)
  const durationMinutes = normalizeNumber(parsed.durationMinutes)
  const sessions = normalizeNumber(parsed.sessions)
  const preferredTimeRange =
    normalizePreferredTimeRange(parsed.preferredTimeRange) ||
    parsePreferredTimeRange(rawText)
  const flexibilityMinutes = normalizeNumber(parsed.flexibilityMinutes) ?? 0
  const isReschedule = Boolean(parsed.isReschedule)
  const targetBookingId =
    typeof parsed.targetBookingId === "string" && parsed.targetBookingId.trim()
      ? parsed.targetBookingId.trim()
      : null

  const missingFields = Array.isArray(parsed.missingFields)
    ? parsed.missingFields.filter((x): x is string => typeof x === "string" && !!x.trim())
    : []

  const needsRecommendation =
    Boolean(parsed.needsRecommendation) || (!time && !!preferredTimeRange)

  return {
    success: !!serviceName && !!date && (!!time || needsRecommendation || !!preferredTimeRange),
    source: "llm",
    message:
      typeof parsed.message === "string" && parsed.message.trim()
        ? parsed.message.trim()
        : "已完成 LLM 預約解析",
    rawText,

    name: typeof parsed.name === "string" && parsed.name.trim() ? parsed.name.trim() : null,
    lineId:
      typeof parsed.lineId === "string" && parsed.lineId.trim() ? parsed.lineId.trim() : null,
    phone: typeof parsed.phone === "string" && parsed.phone.trim() ? parsed.phone.trim() : null,
    service: serviceName,
    date,
    time,
    lessons: sessions,

    booking: {
      serviceName,
      date,
      time,
      durationMinutes,
      sessions,
      preferredTimeRange,
      flexibilityMinutes,
      isReschedule,
      targetBookingId,
    },
    missingFields,
    needsRecommendation,
    recommendationHints: [],
  }
}

function buildSystemPrompt(nowDate: string) {
  return `
你是一個 AI 預約排程解析器。
你的唯一任務是把使用者自然語言轉成 JSON。
你只能輸出 JSON，不可輸出任何其他文字。

今天日期：${nowDate}

請輸出：
{
  "name": string | null,
  "lineId": string | null,
  "phone": string | null,
  "serviceName": string | null,
  "date": string | null,
  "time": string | null,
  "durationMinutes": number | null,
  "sessions": number | null,
  "preferredTimeRange": "morning" | "afternoon" | "evening" | null,
  "flexibilityMinutes": number,
  "isReschedule": boolean,
  "targetBookingId": string | null,
  "missingFields": string[],
  "needsRecommendation": boolean,
  "message": string
}

規則：
1. date 必須是 YYYY-MM-DD
2. time 必須是 HH:mm，且分鐘只能是 00 或 30
3. 明天、後天要換成實際日期
4. 兩點=14:00，兩點半=14:30
5. 沒有明確時間但有早上/下午/晚上時，填 preferredTimeRange
6. 若有「都可以、最快、幫我推薦、附近」則 needsRecommendation=true
7. 無法確定就填 null，不要亂猜
8. 缺欄位請填入 missingFields
9. serviceName 只允許：健身、AI課程、咨詢、顧問
`.trim()
}

async function callLLM(rawText: string): Promise<LLMParsedResult> {
  const apiKey = process.env.LLM_API_KEY
  const baseUrl = process.env.LLM_API_URL
  const model = process.env.LLM_MODEL

  if (!apiKey || !baseUrl || !model) {
    throw new Error("LLM env vars missing")
  }

  const nowDate = toDateInTaipei()
  const systemPrompt = buildSystemPrompt(nowDate)

  const response = await fetch(baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: rawText },
      ],
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`LLM request failed: ${response.status} ${errorText}`)
  }

  const data = await response.json()

  const content =
    data?.choices?.[0]?.message?.content ??
    data?.output?.[0]?.content?.[0]?.text ??
    ""

  if (!content || typeof content !== "string") {
    throw new Error("LLM returned empty content")
  }

  return JSON.parse(content)
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const rawText = String(body?.text ?? "").trim()

    if (!rawText) {
      return NextResponse.json({ error: "text is required" }, { status: 400 })
    }

    try {
      const llmParsed = await callLLM(rawText)
      const payload = buildPayloadFromLLM(rawText, llmParsed)

      const hasMeaningfulResult =
        payload.service ||
        payload.date ||
        payload.time ||
        payload.booking.preferredTimeRange ||
        payload.needsRecommendation

      if (hasMeaningfulResult) {
        return NextResponse.json(payload)
      }

      return NextResponse.json(parseByRule(rawText))
    } catch (llmError) {
      console.error("[parse-booking][llm-error]", llmError)
      return NextResponse.json(parseByRule(rawText))
    }
  } catch (error) {
    console.error("[parse-booking][fatal-error]", error)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}