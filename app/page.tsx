"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  collection,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { parseApiResult } from "@/lib/shared/parse-api-result";

const timeToMinutes = (time: string) => {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
};

const minutesToTime = (minutes: number) => {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
};

const calculateOccupiedSlots = (
  service: string,
  startTime: string,
  lessons: number
) => {
  const start = timeToMinutes(startTime);

  const totalMinutes =
    service === "健身"
      ? 60 + 30
      : lessons * 60 + 30;

  const slots: string[] = [];

  for (let current = start; current < start + totalMinutes; current += 30) {
    slots.push(minutesToTime(current));
  }

  return slots;
};

const calculateRequiredSlots = (
  service: string,
  startTime: string,
  lessons: number
) => {
  const start = timeToMinutes(startTime);

  let preBuffer = 0;
  let lessonMinutes = 60;
  let postBuffer = 30;

  if (service === "健身") {
    preBuffer = 0;
    lessonMinutes = 60;
    postBuffer = 30;
  } else {
    preBuffer = 0;
    lessonMinutes = lessons * 60;
    postBuffer = 30;
  }

  const requiredStart = start - preBuffer;
  const requiredEnd = start + lessonMinutes + postBuffer;

  const slots: string[] = [];

  for (let current = requiredStart; current < requiredEnd; current += 30) {
    slots.push(minutesToTime(current));
  }

  return slots;
};

type AvailabilityItem = {
  date: string;
  availableCount: number;
  status: "available" | "limited" | "full";
  firstAvailableTime: string;
};

const weekdayLabels = ["日", "一", "二", "三", "四", "五", "六"];

const toLocalDateString = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const generateNextDays = (days: number) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return Array.from({ length: days }, (_, index) => {
    const next = new Date(today);
    next.setDate(today.getDate() + index);
    return toLocalDateString(next);
  });
};

const getAvailabilityStatus = (
  availableCount: number
): AvailabilityItem["status"] => {
  if (availableCount === 0) return "full";
  if (availableCount <= 2) return "limited";
  return "available";
};

const formatDateWithWeekday = (dateString: string) => {
  const [year, month, day] = dateString.split("-");
  const parsedYear = Number(year);
  const parsedMonth = Number(month);
  const parsedDay = Number(day);

  if (!parsedYear || !parsedMonth || !parsedDay) return dateString;

  const date = new Date(parsedYear, parsedMonth - 1, parsedDay);
  const weekday = weekdayLabels[date.getDay()];
  return `${year}/${month}/${day}（週${weekday}）`;
};

export default function Home() {
  const router = useRouter();
  const services = ["健身", "AI課程", "咨詢", "顧問"];

  const [service, setService] = useState("健身");
  const [lessons, setLessons] = useState("1");
  const [name, setName] = useState("");
  const [lineId, setLineId] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [naturalInput, setNaturalInput] = useState("");
  const [aiSuggestedTime, setAiSuggestedTime] = useState("");
  const [aiRecommendedTimes, setAiRecommendedTimes] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [bookedTimes, setBookedTimes] = useState<string[]>([]);
  const [calendarBusyTimes, setCalendarBusyTimes] = useState<string[]>([]);
  const [serviceBuffers, setServiceBuffers] = useState<Record<string, number>>({});
  const [availability30Days, setAvailability30Days] = useState<AvailabilityItem[]>([]);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const timeSectionRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const fetchBuffers = async () => {
      try {
        const res = await fetch("/api/admin/service-buffers");
        const data = await res.json();

        if (res.ok && data?.buffers) {
          setServiceBuffers(data.buffers);
        }
      } catch (error) {
        console.error("讀取 service buffers 失敗：", error);
      }
    };

    fetchBuffers();
  }, []);

  const expandBusyToSlots = (
    busy: { start: string; end: string }[],
    targetService: string
  ) => {
    const slots: string[] = [];

    const toMinutes = (iso: string) => {
      const date = new Date(iso);
      return date.getHours() * 60 + date.getMinutes();
    };

    const toTime = (mins: number) => {
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    };

    const buffer = serviceBuffers[targetService] ?? 0;

    for (const item of busy) {
      let current = toMinutes(item.start);
      const end = toMinutes(item.end) + buffer;

      while (current < end) {
        slots.push(toTime(current));
        current += 30;
      }
    }

    return slots;
  };

  const generateHalfHourSlots = (start: string, end: string) => {
    const result: string[] = [];
  
    const toMinutes = (t: string) => {
      const [h, m] = t.split(":").map(Number);
      return h * 60 + m;
    };
  
    const toTime = (mins: number) => {
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    };
  
    let current = toMinutes(start);
    const endMin = toMinutes(end);
  
    while (current <= endMin) {
      result.push(toTime(current));
      current += 30;
    }
  
    return result;
  };

  const baseSlots = generateHalfHourSlots("08:00", "20:30");

  const fetchBusySlotsWithFailSafe = async ({
    targetDate,
    targetService,
  }: {
    targetDate: string;
    targetService: string;
  }) => {
    try {
      const response = await fetch("/api/calendar/busy", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ date: targetDate }),
      });

      const result = await response.json();

      if (response.ok && Array.isArray(result?.busy)) {
        return expandBusyToSlots(result.busy, targetService);
      }

      return [...baseSlots];
    } catch (error) {
      console.error("讀取 Calendar busy 失敗，啟用 fail-safe 全時段封鎖：", error);
      return [...baseSlots];
    }
  };

  const fitnessStartTimes = [
    "08:00",
    "09:30",
    "11:00",
    "13:30",
    "15:00",
    "16:30",
    "18:00",
    "19:30",
  ];

  const generalStartTimes = generateHalfHourSlots("08:00", "20:30");

  const teachingStartTimes = service === "健身" ? fitnessStartTimes : generalStartTimes;
  const blockedTimes = [...new Set([...bookedTimes, ...calendarBusyTimes])];

  const selectableTimes = teachingStartTimes.filter((startTime) => {
    const requiredSlots = calculateRequiredSlots(
      service,
      startTime,
      Number(lessons)
    );

    return requiredSlots.every((slot) => !blockedTimes.includes(slot));
  });

  const pickRecommendedTime = ({
    service,
    selectableTimes,
    requestedTime,
    preferredTimeRange,
    needsRecommendation,
  }: {
    service: string;
    selectableTimes: string[];
    requestedTime?: string;
    preferredTimeRange?: "morning" | "afternoon" | "evening" | null;
    needsRecommendation?: boolean;
  }) => {
    if (!selectableTimes.length) return "";

    const sorted = [...selectableTimes].sort();

    // 1. 有指定明確時間：先找最接近且不早於該時間的 slot
    if (requestedTime) {
      if (sorted.includes(requestedTime)) return requestedTime;
      return sorted.find((t) => t >= requestedTime) || sorted[0] || "";
    }

    // 2. 沒指定時間，但有推薦需求或時段偏好
    if (needsRecommendation || preferredTimeRange) {
      let candidates = [...sorted];

      if (preferredTimeRange === "morning") {
        candidates = candidates.filter((t) => t >= "08:00" && t < "12:00");
      } else if (preferredTimeRange === "afternoon") {
        if (service === "健身") {
          candidates = candidates.filter((t) => t >= "13:30" && t < "18:00");
        } else {
          candidates = candidates.filter((t) => t >= "13:00" && t < "18:00");
        }
      } else if (preferredTimeRange === "evening") {
        candidates = candidates.filter((t) => t >= "18:00" && t <= "20:30");
      }

      if (preferredTimeRange && candidates.length === 0) {
        return "";
      }

      return candidates[0] || sorted[0] || "";
    }

    // 3. 什麼都沒指定：回最早可用時間
    return sorted[0] || "";
  };

  const pickRecommendedTimes = ({
    service,
    selectableTimes,
    requestedTime,
    preferredTimeRange,
    needsRecommendation,
    limit = 3,
  }: {
    service: string;
    selectableTimes: string[];
    requestedTime?: string;
    preferredTimeRange?: "morning" | "afternoon" | "evening" | null;
    needsRecommendation?: boolean;
    limit?: number;
  }) => {
    if (!selectableTimes.length) return [];

    const sorted = [...selectableTimes].sort();

    // 1. 有指定明確時間：從最接近且不早於該時間的 slot 開始往後取
    if (requestedTime) {
      const startIndex = sorted.findIndex((t) => t >= requestedTime);
      if (startIndex >= 0) {
        return sorted.slice(startIndex, startIndex + limit);
      }
      return sorted.slice(0, limit);
    }

    // 2. 沒指定時間，但有推薦需求或時段偏好
    if (needsRecommendation || preferredTimeRange) {
      let candidates = [...sorted];

      if (preferredTimeRange === "morning") {
        candidates = candidates.filter((t) => t >= "08:00" && t < "12:00");
      } else if (preferredTimeRange === "afternoon") {
        if (service === "健身") {
          candidates = candidates.filter((t) => t >= "13:30" && t < "18:00");
        } else {
          candidates = candidates.filter((t) => t >= "13:00" && t < "18:00");
        }
      } else if (preferredTimeRange === "evening") {
        candidates = candidates.filter((t) => t >= "18:00" && t <= "20:30");
      }

      if (preferredTimeRange && candidates.length === 0) {
        return [];
      }

      return (candidates.length ? candidates : sorted).slice(0, limit);
    }

    // 3. 什麼都沒指定：回最早的幾個可用時間
    return sorted.slice(0, limit);
  };

  const getSelectableTimesFor = async ({
    targetService,
    targetDate,
    targetLessons,
  }: {
    targetService: string;
    targetDate: string;
    targetLessons: number;
  }) => {
    if (!targetDate) return [];

    // 1. 讀 Firestore 已預約 slot
    const bookingsRef = collection(db, "bookings");
    const q = query(bookingsRef, where("date", "==", targetDate));
    const snapshot = await getDocs(q);

    const firestoreTimes = snapshot.docs
      .map((doc) => doc.data().time as string)
      .filter(Boolean);

    // 2. 讀 Google Calendar busy 區間
    const busySlots = await fetchBusySlotsWithFailSafe({
      targetDate,
      targetService,
    });

    const blocked = [...new Set([...firestoreTimes, ...busySlots])];
    // 3. 依服務取得候選開始時間
    const targetTeachingStartTimes =
      targetService === "健身" ? fitnessStartTimes : generalStartTimes;

    // 4. 用最新 blocked times 即時計算 selectableTimes
    return targetTeachingStartTimes.filter((startTime) => {
      const requiredSlots = calculateRequiredSlots(
        targetService,
        startTime,
        targetLessons
      );

      return requiredSlots.every((slot) => !blocked.includes(slot));
    });
  };

  useEffect(() => {
    let cancelled = false;

    const fetchAvailability30Days = async () => {
      setAvailabilityLoading(true);
      const next30Days = generateNextDays(30);
      const targetLessons = Number(lessons);
      const items: AvailabilityItem[] = [];

      for (const targetDate of next30Days) {
        try {
          const selectable = await getSelectableTimesFor({
            targetService: service,
            targetDate,
            targetLessons,
          });

          const availableCount = selectable.length;
          items.push({
            date: targetDate,
            availableCount,
            status: getAvailabilityStatus(availableCount),
            firstAvailableTime: selectable[0] || "",
          });
        } catch (error) {
          console.error("計算 30 天可用性失敗：", targetDate, error);
          items.push({
            date: targetDate,
            availableCount: 0,
            status: "full",
            firstAvailableTime: "",
          });
        }
      }

      if (!cancelled) {
        setAvailability30Days(items);
        setAvailabilityLoading(false);
      }
    };

    fetchAvailability30Days().catch((error) => {
      console.error("讀取 30 天可用性失敗：", error);
      if (!cancelled) {
        setAvailability30Days([]);
        setAvailabilityLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [service, lessons]);

  const getNextDaysRecommendations = async ({
    service,
    startDate,
    lessons,
    preferredTimeRange,
    limit = 3,
  }: {
    service: string;
    startDate: string;
    lessons: number;
    preferredTimeRange?: "morning" | "afternoon" | "evening" | null;
    limit?: number;
  }) => {
    const results: { date: string; time: string }[] = [];

    const addDays = (dateStr: string, days: number) => {
      const [y, m, d] = dateStr.split("-").map(Number);
      const dt = new Date(y, m - 1, d);
      dt.setDate(dt.getDate() + days);
      const yyyy = dt.getFullYear();
      const mm = String(dt.getMonth() + 1).padStart(2, "0");
      const dd = String(dt.getDate()).padStart(2, "0");
      return `${yyyy}-${mm}-${dd}`;
    };

    for (let i = 1; i <= 7; i++) {
      const nextDate = addDays(startDate, i);

      const selectable = await getSelectableTimesFor({
        targetService: service,
        targetDate: nextDate,
        targetLessons: lessons,
      });

      if (!selectable.length) continue;

      const times = pickRecommendedTimes({
        service,
        selectableTimes: selectable,
        preferredTimeRange,
        needsRecommendation: true,
      });

      for (const t of times) {
        results.push({ date: nextDate, time: t });
        if (results.length >= limit) return results;
      }
    }

    return results;
  };

  const applyRecommendedDateTime = (value: string) => {
    const trimmed = value.trim();

    // 跨日格式：2026-04-04 13:30
    const match = trimmed.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})$/);

    if (match) {
      const [, nextDate, nextTime] = match;
      setDate(nextDate);
      setTime(nextTime);
      setAiSuggestedTime(nextTime);
      return;
    }

    // 同日格式：16:30
    setTime(trimmed);
    setAiSuggestedTime(trimmed);
  };

  useEffect(() => {
    const fetchBlockedTimes = async () => {
      if (!date) {
        setBookedTimes([]);
        setCalendarBusyTimes([]);
        return;
      }

      try {
        // 1. 讀 Firestore 已預約 slot
        const bookingsRef = collection(db, "bookings");
        const q = query(bookingsRef, where("date", "==", date));
        const snapshot = await getDocs(q);

        const firestoreTimes = snapshot.docs
          .map((doc) => doc.data().time as string)
          .filter(Boolean);

        setBookedTimes(firestoreTimes);

        // 2. 讀 Google Calendar busy 區間
        const busySlots = await fetchBusySlotsWithFailSafe({
          targetDate: date,
          targetService: service,
        });
        setCalendarBusyTimes(busySlots);
      } catch (error) {
        console.error("讀取 blocked times 失敗：", error);
        setBookedTimes([]);
        setCalendarBusyTimes([]);
      }
    };

    fetchBlockedTimes();
  }, [date]);

  const handleSubmit = async () => {
    if (!name || !lineId || !phone || !date || !time) {
      alert("請先填寫姓名、LINE ID、電話、預約日期、預約時間");
      return;
    }

    try {
      setLoading(true);
      const response = await fetch("/api/bookings/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name,
          lineId,
          phone,
          note,
          service,
          lessons: Number(lessons),
          date,
          time,
        }),
      });

      const result = await parseApiResult(response);

      if (result?.status === "success") {
        router.push("/success");
        setName("");
        setLineId("");
        setPhone("");
        setNote("");
        setDate("");
        setTime("");
        return;
      }

      if (result?.status === "partial_success") {
        alert(result.message || "預約已建立，但 Google Calendar 同步失敗");
        return;
      }

      if (result.status === "conflict") {
        alert(result.message || "所選時段中有部分已被預約，請選擇其他時間");
        return;
      }

      if (result.status === "validation_error") {
        alert(result.message || "預約資料格式錯誤");
        return;
      }

      alert(result.message || "送出失敗，請查看 console");
    } catch (error) {
      console.error("送出失敗：", error);
      alert("送出失敗，請查看 console");
    } finally {
      setLoading(false);
    }
  };

  const occupiedSlotsPreview =
    time && lessons
      ? calculateOccupiedSlots(service, time, Number(lessons))
      : [];

  const previewRange =
    occupiedSlotsPreview.length > 0
      ? {
          start: occupiedSlotsPreview[0],
          end:
            occupiedSlotsPreview[occupiedSlotsPreview.length - 1],
        }
      : null;
  const availabilityStatusText: Record<AvailabilityItem["status"], string> = {
    available: "可預約",
    limited: "少量",
    full: "已滿",
  };
  const selectedAvailability = availability30Days.find((item) => item.date === date);
  const isDevelopment = process.env.NODE_ENV !== "production";

  return (
    <main className="min-h-screen bg-gradient-to-b from-indigo-50 via-white to-purple-50 p-4 sm:p-6">
      <div className="mx-auto w-full max-w-md rounded-3xl border border-white/70 bg-white/85 p-4 shadow-xl shadow-indigo-100/70 backdrop-blur sm:p-6">
        <h1 className="mb-3 text-center text-3xl font-bold tracking-tight text-gray-950 sm:text-4xl">
          Li’s Meet 課程預約
        </h1>
        <p className="mb-8 text-center text-sm font-medium text-indigo-700">
          你的專屬訓練時段，由你選擇
        </p>

        <div className="flex flex-col gap-6 sm:gap-7">
          <section className="order-4 rounded-2xl border border-gray-200/70 bg-gray-50/80 p-3.5 shadow-none sm:p-4">
            <h2 className="text-xs font-medium text-gray-600">
              快速預約（進階）
            </h2>
            <p className="mt-0.5 text-[11px] text-gray-500">
              也可以直接手動填寫下方表單
            </p>
            <label className="mt-2 block text-[11px] font-medium text-gray-500">
              AI 快速預約內容
            </label>
            <textarea
              value={naturalInput}
              onChange={(e) => setNaturalInput(e.target.value)}
              className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-xs"
              placeholder="例如：我想約 4/6 下午兩點 AI課 兩節"
              rows={2}
            />
            <button
              type="button"
              onClick={async () => {
                try {
                  setAiRecommendedTimes([]);

                  const response = await fetch("/api/ai/parse-booking", {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                      text: naturalInput,
                    }),
                  });

                  const result = await response.json();
                  console.log("AI 解析結果：", result);

                  if (!response.ok) {
                    alert("AI 解析失敗，請查看 console");
                    return;
                  }

                  if (result.service) setService(result.service);
                  if (result.date) setDate(result.date);
                  if (result.lessons) setLessons(String(result.lessons));

                  const preferredTimeRange = result?.booking?.preferredTimeRange || null;
                  const needsRecommendation = Boolean(result?.needsRecommendation);

                  const latestSelectableTimes = await getSelectableTimesFor({
                    targetService: result.service || service,
                    targetDate: result.date || date,
                    targetLessons: Number(result.lessons || lessons),
                  });

                  const recommended = pickRecommendedTime({
                    service: result.service || service,
                    selectableTimes: latestSelectableTimes,
                    requestedTime: result.time || "",
                    preferredTimeRange,
                    needsRecommendation,
                  });

                  let recommendedTimes = pickRecommendedTimes({
                    service: result.service || service,
                    selectableTimes: latestSelectableTimes,
                    requestedTime: result.time || "",
                    preferredTimeRange,
                    needsRecommendation,
                  });

                  // 🔥 若當天候選不足，補跨日
                  if (recommendedTimes.length < 3) {
                    const extra = await getNextDaysRecommendations({
                      service: result.service || service,
                      startDate: result.date || date,
                      lessons: Number(result.lessons || lessons),
                      preferredTimeRange,
                      limit: 3 - recommendedTimes.length,
                    });

                    // 格式轉成字串顯示（含日期）
                    const extraFormatted = extra.map(
                      (item) => `${item.date} ${item.time}`
                    );

                    recommendedTimes = [
                      ...recommendedTimes,
                      ...extraFormatted,
                    ];
                  }

                  console.log("AI 推薦候選時間 Top 3：", recommendedTimes);
                  setAiRecommendedTimes(recommendedTimes);

                  if (recommended) {
                    setTime(recommended);
                    setAiSuggestedTime(recommended);

                    if (result.time) {
                      alert(`AI 建議 ${result.time}，已自動選擇最接近可用時間 ${recommended}`);
                    } else if (needsRecommendation || preferredTimeRange) {
                      alert(`AI 未指定明確時間，已依偏好時段自動推薦可用時間 ${recommended}`);
                    } else {
                      alert("AI 已解析並填入表單！");
                    }
                  } else {
                    setTime("");
                    setAiSuggestedTime("");
                    alert("目前沒有可預約時間");
                  }
                } catch (error) {
                  console.error("AI 解析失敗：", error);
                  alert("AI 解析失敗，請查看 console");
                }
              }}
              className="mt-2 min-h-[42px] w-full rounded-lg bg-purple-600 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
            >
              AI 解析預約內容
            </button>

            <button
              type="button"
              onClick={async () => {
                try {
                  if (!naturalInput.trim()) {
                    alert("請先輸入 AI 預約內容");
                    return;
                  }

                  // 1. AI 解析
                  const parseResponse = await fetch("/api/ai/parse-booking", {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                      text: naturalInput,
                    }),
                  });

                  const parseResult = await parseResponse.json();
                  console.log("AI Auto Book 解析結果：", parseResult);

                  if (!parseResponse.ok) {
                    alert("AI 解析失敗，請查看 console");
                    return;
                  }

                  const finalName = parseResult.name || name;
                  const finalLineId = parseResult.lineId || lineId;
                  const finalPhone = parseResult.phone || phone;

                  if (!finalName || !finalLineId || !finalPhone) {
                    alert("AI 解析後仍缺少姓名、LINE ID 或電話");
                    return;
                  }

                  const nextService = parseResult.service || service;
                  const nextDate = parseResult.date || date;
                  const nextLessons = Number(parseResult.lessons || lessons);
                  const requestedTime = parseResult.time || "";

                  if (!nextService || !nextDate) {
                    alert("AI 解析結果不完整，至少需要服務類型與日期");
                    return;
                  }

                  // 2. 先取得該日期 blocked times
                  const bookingsRef = collection(db, "bookings");
                  const q = query(bookingsRef, where("date", "==", nextDate));
                  const snapshot = await getDocs(q);

                  const firestoreTimes = snapshot.docs
                    .map((doc) => doc.data().time as string)
                    .filter(Boolean);

                  const busySlots = await fetchBusySlotsWithFailSafe({
                    targetDate: nextDate,
                    targetService: nextService,
                  });

                  const blocked = [...new Set([...firestoreTimes, ...busySlots])];

                  // 3. 依服務取得候選開始時間
                  const nextTeachingStartTimes =
                    nextService === "健身" ? fitnessStartTimes : generalStartTimes;

                  const nextSelectableTimes = nextTeachingStartTimes.filter((startTime) => {
                    const requiredSlots = calculateRequiredSlots(
                      nextService,
                      startTime,
                      nextLessons
                    );

                    return requiredSlots.every((slot) => !blocked.includes(slot));
                  });

                  if (nextSelectableTimes.length === 0) {
                    alert("該日期目前沒有可預約時間");
                    return;
                  }

                  // 4. 決定最終時間
                  const preferredTimeRange = parseResult?.booking?.preferredTimeRange || null;
                  const needsRecommendation = Boolean(parseResult?.needsRecommendation);

                  const finalTime = pickRecommendedTime({
                    service: nextService,
                    selectableTimes: nextSelectableTimes,
                    requestedTime,
                    preferredTimeRange,
                    needsRecommendation,
                  });

                  if (!finalTime) {
                    alert("目前沒有可預約時間");
                    return;
                  }

                  // 5. 回填畫面
                  setName(finalName);
                  setLineId(finalLineId);
                  setPhone(finalPhone);
                  setService(nextService);
                  setDate(nextDate);
                  setLessons(String(nextLessons));
                  setTime(finalTime);
                  setAiSuggestedTime(requestedTime || finalTime);

                  // 6. 透過後端統一建立預約（Firestore + Calendar）
                  const bookingResponse = await fetch("/api/bookings/create", {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                      name: finalName,
                      lineId: finalLineId,
                      phone: finalPhone,
                      note,
                      service: nextService,
                      date: nextDate,
                      time: finalTime,
                      lessons: nextLessons,
                    }),
                  });

                  const bookingResult = await parseApiResult(bookingResponse);

                  if (bookingResult.status === "partial_success") {
                    alert(
                      bookingResult.message ||
                        "預約已建立，但 Google Calendar 同步失敗，請稍後通知管理員處理。"
                    );
                    return;
                  }

                  if (bookingResult.status === "conflict") {
                    alert(
                      bookingResult.message ||
                        "所選時段中有部分已被預約，請選擇其他時間"
                    );
                    return;
                  }

                  if (bookingResult.status === "validation_error") {
                    alert(bookingResult.message || "預約資料格式錯誤");
                    return;
                  }

                  if (bookingResult.status === "rate_limited") {
                    alert(
                      bookingResult.message ||
                        "請稍後再試，預約請求過於頻繁"
                    );
                    return;
                  }

                  if (bookingResult.status === "error") {
                    alert(bookingResult.message || "AI 一鍵預約失敗，請稍後再試");
                    return;
                  }

                  if (bookingResult.status !== "success") {
                    alert(bookingResult.message || "AI 一鍵預約失敗，請查看 console");
                    return;
                  }

                  // 清理表單與 AI 狀態
                  setNaturalInput("");
                  setAiSuggestedTime("");
                  setName("");
                  setLineId("");
                  setPhone("");
                  setNote("");
                  setTime("");

                  router.push("/success");
                } catch (error) {
                  console.error("AI Auto Book 失敗：", error);
                  alert("AI 一鍵預約失敗，請查看 console");
                }
              }}
              className="mt-2 min-h-[42px] w-full rounded-lg bg-fuchsia-700 py-2.5 text-sm text-white hover:opacity-90"
            >
              AI 一鍵預約
            </button>
          </section>

          <section className="order-1 flex flex-col gap-4 rounded-2xl border border-indigo-100 bg-white p-4 shadow-lg shadow-indigo-100/70">
            <h2 className="text-sm font-semibold text-gray-800">預約資訊</h2>
            <p className="-mt-2 text-xs text-gray-500">流程：先選日期，再選時間</p>

            <div className="order-3">
              <label className="mb-1 block text-sm font-medium">服務類型</label>
              <select
                value={service}
                onChange={(e) => {
                  setService(e.target.value);
                  setTime("");
                  setAiSuggestedTime("");
                }}
                className="w-full rounded-lg border px-3 py-2"
              >
                {services.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>

            <div className="order-4">
              <label className="mb-1 block text-sm font-medium">預約節數</label>
              <select
                value={lessons}
                onChange={(e) => {
                  setLessons(e.target.value);
                  setTime("");
                  setAiSuggestedTime("");
                }}
                className="w-full rounded-lg border px-3 py-2"
              >
                <option value="1">1 節</option>
                <option value="2">2 節</option>
                <option value="3">3 節</option>
              </select>
            </div>

            <div className="order-1">
              <div className="mb-1 block text-sm font-semibold text-gray-800">選擇日期</div>
              <p className="mb-1 text-xs text-gray-500">先選一天，再選時間</p>

                    {availabilityLoading ? (
                      <div className="space-y-3">
                        <div className="rounded-xl border border-indigo-100 bg-indigo-50/70 p-3 shadow-sm shadow-indigo-100/40">
                          <div className="flex items-start gap-3">
                            <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-indigo-600 shadow-sm">
                              <div className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-600" />
                            </div>
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-gray-800">
                                正在讀取可預約日期
                              </div>
                              <p className="mt-1 text-xs leading-5 text-gray-500">
                                系統正在比對行事曆忙碌時段，請稍候
                              </p>
                            </div>
                          </div>
                        </div>
                        <div className="grid grid-cols-4 gap-2 sm:grid-cols-4">
                          {Array.from({ length: 9 }).map((_, index) => (
                            <div
                              key={index}
                              className="min-h-[58px] rounded-lg border border-gray-200 bg-gray-100/80 p-2"
                            >
                              <div className="h-3.5 w-12 animate-pulse rounded-full bg-gray-200" />
                              <div className="mt-2 h-3 w-8 animate-pulse rounded-full bg-gray-200" />
                              <div className="mt-2 h-3 w-10 animate-pulse rounded-full bg-gray-200" />
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="grid grid-cols-4 gap-2 sm:grid-cols-4">
                  {availability30Days.map((item) => {
                    const isFull = item.status === "full";
                    const selected = date === item.date && !isFull;
                    const weekday =
                      weekdayLabels[new Date(`${item.date}T00:00:00`).getDay()];
                    const monthDay = item.date.slice(5).replace("-", "/");

                    return (
                      <button
                        key={item.date}
                        type="button"
                        disabled={isFull}
                        onClick={() => {
                          if (isFull) return;
                          setDate(item.date);
                          setTime("");
                          setAiSuggestedTime("");
                          timeSectionRef.current?.scrollIntoView({
                            behavior: "smooth",
                            block: "start",
                          });
                        }}
                        className={`min-h-[58px] rounded-lg border px-2 py-1.5 text-left transition-colors active:scale-95 ${
                          selected
                            ? "border-indigo-600 bg-indigo-600 text-white shadow-md ring-2 ring-indigo-200"
                            : isFull
                              ? "cursor-not-allowed border-gray-200 bg-gray-100 text-gray-400 opacity-55"
                              : item.status === "limited"
                                ? "border-amber-200 bg-amber-50/80 text-amber-700 hover:bg-amber-100"
                                : "border-indigo-100 bg-gradient-to-br from-indigo-50 to-purple-50 text-gray-800 hover:border-indigo-200 hover:from-indigo-100 hover:to-purple-100"
                        }`}
                      >
                        <div className="text-xs font-semibold leading-5 tracking-tight">
                          {monthDay}
                        </div>
                        <div className="text-[10px] text-gray-500">
                          週{weekday}
                        </div>
                        <div className="mt-0.5 text-[10px] font-medium">
                          {availabilityStatusText[item.status]}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              <p className="mt-2 text-xs font-medium text-gray-700">
                {date
                  ? `目前已選日期：${formatDateWithWeekday(date)}`
                  : "尚未選擇日期"}
              </p>

              {!availabilityLoading && date && (
                <p className="mt-1 text-xs text-gray-500">
                  {!selectedAvailability || !selectedAvailability.firstAvailableTime
                    ? "下一步：請在下方挑選可預約時間"
                    : `下一步：可先參考 ${selectedAvailability.firstAvailableTime}（仍以下方時間為準）`}
                </p>
              )}
            </div>

            <div className="order-1 rounded-lg border border-gray-200 bg-gray-50/60 p-3">
              <label className="mb-1 block text-xs font-medium text-gray-600">手動指定日期（補充）</label>
              <p className="mb-2 text-xs text-gray-500">若上方卡片未選，或想直接指定日期，可在此手動選擇</p>
              <input
                type="date"
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                  setTime("");
                  setAiSuggestedTime("");
                }}
                className="w-full rounded-lg border px-3 py-2"
              />
            </div>

            <div className="order-2" ref={timeSectionRef}>
              <label className="mb-1 block text-sm font-semibold text-gray-800">選擇時間</label>
              <p className="mb-2 text-xs text-gray-500">請選擇當天可預約開始時間</p>
              {!date ? (
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-500">
                  請先從上方選擇日期
                </div>
              ) : selectableTimes.length === 0 ? (
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-500">
                  當日目前沒有可預約時間
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
                  {selectableTimes.map((slot) => {
                    const selected = time === slot;

                    return (
                      <button
                        key={slot}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => {
                          setTime(slot);
                          setAiSuggestedTime("");
                        }}
                        className={`min-h-[44px] rounded-lg border px-2 py-2 text-sm font-medium transition-colors ${
                          selected
                            ? "border-indigo-600 bg-indigo-600 text-white shadow-md ring-2 ring-indigo-200"
                            : "border-gray-200 bg-gray-50 text-gray-700 hover:border-gray-300 hover:bg-white"
                        }`}
                      >
                        {slot}
                      </button>
                    );
                  })}
                </div>
              )}
              {aiSuggestedTime && (
                <div className="mt-2 rounded-lg border border-yellow-200 bg-yellow-50 p-2.5 text-xs text-yellow-800">
                  AI 建議可參考：<span className="font-semibold">{aiSuggestedTime}</span>
                  <br />
                  仍請以上方可選時間按鈕為準。
                </div>
              )}
              {aiRecommendedTimes.length > 0 && (
                <div className="mt-2 rounded-lg border border-blue-200 bg-blue-50 p-2.5 text-xs text-blue-800">
                  <div className="mb-2 font-semibold">AI 推薦其他可選時間</div>
                  <div className="flex flex-wrap gap-2">
                    {aiRecommendedTimes.map((t) => (
                      <button
                        key={t}
                        type="button"
                        className="min-h-[38px] rounded-lg bg-blue-100 px-3 py-2 text-xs font-medium text-blue-900 hover:bg-blue-200"
                        onClick={() => applyRecommendedDateTime(t)}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>

          <section className="order-2 space-y-4 rounded-2xl border border-purple-100 bg-white p-4 shadow-lg shadow-purple-100/60">
            <h2 className="text-sm font-semibold text-gray-800">聯絡資料</h2>

            <div>
              <label className="mb-1 block text-sm font-medium">姓名</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg border px-3 py-2"
                placeholder="請輸入姓名"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">LINE ID</label>
              <input
                type="text"
                value={lineId}
                onChange={(e) => setLineId(e.target.value)}
                className="w-full rounded-lg border px-3 py-2"
                placeholder="請輸入 LINE ID"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">電話</label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full rounded-lg border px-3 py-2"
                placeholder="請輸入電話"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">備註</label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="w-full rounded-lg border px-3 py-2"
                placeholder="可填寫需求或補充說明"
                rows={4}
              />
            </div>

            {previewRange && (
              <div className="rounded-lg bg-gray-100 p-4 text-sm">
                <p className="mb-1 font-semibold">本次預約時間：</p>
                <p className="text-lg font-bold">
                  {previewRange.start} ～ {previewRange.end}
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  （已包含課程與準備時間）
                </p>
              </div>
            )}

            <button
              onClick={handleSubmit}
              disabled={loading}
              className="min-h-[52px] w-full rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 py-3.5 font-semibold text-white shadow-lg shadow-indigo-200/70 hover:opacity-90 disabled:opacity-50"
            >
              {loading ? "送出中..." : "送出預約"}
            </button>
          </section>
        </div>
      </div>
    </main>
  );
}
