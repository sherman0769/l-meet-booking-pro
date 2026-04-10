"use client";

import { useEffect, useState } from "react";
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
    const busyResponse = await fetch("/api/calendar/busy", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ date: targetDate }),
    });

    const busyResult = await busyResponse.json();

    const busySlots =
      busyResponse.ok && Array.isArray(busyResult.busy)
        ? expandBusyToSlots(busyResult.busy, targetService)
        : [];

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
        const response = await fetch("/api/calendar/busy", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ date }),
        });

        const result = await response.json();

        if (response.ok && Array.isArray(result.busy)) {
          const busySlots = expandBusyToSlots(result.busy, service);
          setCalendarBusyTimes(busySlots);
        } else {
          setCalendarBusyTimes([]);
        }
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

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-6 bg-gray-50">
      <div className="w-full max-w-md bg-white shadow-md rounded-2xl p-6">
        <h1 className="text-3xl font-bold mb-2 text-center">L_meet booking pro</h1>
        <p className="text-center text-gray-600 mb-6">健身預約系統</p>

        <div className="space-y-4">
          <div className="bg-purple-50 p-4 rounded-xl border border-purple-100 mb-2">
            <label className="block text-sm font-medium mb-1 text-purple-800">AI 快速預約</label>
            <textarea
              value={naturalInput}
              onChange={(e) => setNaturalInput(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 bg-white"
              placeholder="例如：我想約 4/6 下午兩點 AI課 兩節"
              rows={3}
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
              className="w-full bg-purple-600 text-white py-2 mt-2 rounded-lg hover:opacity-90 transition-opacity text-sm font-medium"
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

                  const busyResponse = await fetch("/api/calendar/busy", {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                    },
                    body: JSON.stringify({ date: nextDate }),
                  });

                  const busyResult = await busyResponse.json();
                  const busySlots =
                    busyResponse.ok && Array.isArray(busyResult.busy)
                      ? expandBusyToSlots(busyResult.busy, nextService)
                      : [];

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
              className="w-full bg-fuchsia-700 text-white py-3 mt-2 rounded-lg hover:opacity-90"
            >
              AI 一鍵預約
            </button>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">服務類型</label>
            <select
              value={service}
              onChange={(e) => {
                setService(e.target.value);
                setTime("");
                setAiSuggestedTime("");
              }}
              className="w-full border rounded-lg px-3 py-2"
            >
              {services.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">預約節數</label>
            <select
              value={lessons}
              onChange={(e) => {
                setLessons(e.target.value);
                setTime("");
                setAiSuggestedTime("");
              }}
              className="w-full border rounded-lg px-3 py-2"
            >
              <option value="1">1 節</option>
              <option value="2">2 節</option>
              <option value="3">3 節</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">姓名</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full border rounded-lg px-3 py-2"
              placeholder="請輸入姓名"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">LINE ID</label>
            <input
              type="text"
              value={lineId}
              onChange={(e) => setLineId(e.target.value)}
              className="w-full border rounded-lg px-3 py-2"
              placeholder="請輸入 LINE ID"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">電話</label>
            <input
              type="text"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full border rounded-lg px-3 py-2"
              placeholder="請輸入電話"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">預約日期</label>
            <input
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                setTime("");
                setAiSuggestedTime("");
              }}
              className="w-full border rounded-lg px-3 py-2"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">預約時間</label>
            <select
              value={time}
              onChange={(e) => {
                setTime(e.target.value);
                setAiSuggestedTime("");
              }}
              className="w-full border rounded-lg px-3 py-2"
            >
              <option value="">請選擇時間</option>
              {selectableTimes.map((slot) => (
                <option key={slot} value={slot}>
                  {slot}
                </option>
              ))}
            </select>
            {aiSuggestedTime && (
              <div className="mt-2 bg-yellow-50 border border-yellow-200 text-yellow-800 text-sm rounded-lg p-3">
                AI 建議時間：<span className="font-semibold">{aiSuggestedTime}</span>
                <br />
                請從下拉選單確認目前可預約的時間。
              </div>
            )}
            {aiRecommendedTimes.length > 0 && (
              <div className="mt-2 bg-blue-50 border border-blue-200 text-blue-800 text-sm rounded-lg p-3">
                <div className="font-semibold mb-1">AI 推薦其他可選時間：</div>
                <div className="flex gap-2 flex-wrap">
                  {aiRecommendedTimes.map((t) => (
                    <span
                      key={t}
                      className="px-2 py-1 bg-blue-100 rounded cursor-pointer hover:bg-blue-200"
                      onClick={() => applyRecommendedDateTime(t)}
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">備註</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full border rounded-lg px-3 py-2"
              placeholder="可填寫需求或補充說明"
              rows={4}
            />
          </div>

          {previewRange && (
            <div className="bg-gray-100 p-4 rounded-lg text-sm">
              <p className="font-semibold mb-1">本次預約時間：</p>
              <p className="text-lg font-bold">
                {previewRange.start} ～ {previewRange.end}
              </p>
              <p className="text-gray-500 mt-1 text-xs">
                （已包含課程與準備時間）
              </p>
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={loading}
            className="w-full bg-black text-white py-3 rounded-lg hover:opacity-90 disabled:opacity-50"
          >
            {loading ? "送出中..." : "送出預約"}
          </button>

          <button
            type="button"
            onClick={async () => {
              try {
                const response = await fetch("/api/calendar/create-booking-event", {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({
                    name: "測試學員",
                    service: "AI課程",
                    date: "2026-04-06",
                    startTime: "14:00",
                    endTime: "16:30",
                    note: "這是一筆測試用預約事件",
                    phone: "0912345678",
                    lineId: "test_line_001",
                  }),
                });

                const result = await response.json();
                console.log(result);

                if (response.ok) {
                  alert("Google Calendar 預約事件建立成功！");
                } else {
                  if (result?.reauthRequired) {
                    alert("Google Calendar 授權已失效，請重新授權");
                  } else {
                    alert("建立失敗，請查看 console");
                  }
                }
              } catch (error) {
                console.error(error);
                alert("建立失敗，請查看 console");
              }
            }}
            className="w-full mt-3 bg-blue-600 text-white py-3 rounded-lg hover:opacity-90"
          >
            測試建立 Calendar 事件
          </button>

          <button
            type="button"
            onClick={async () => {
              try {
                const response = await fetch("/api/calendar/busy", {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({
                    date: "2026-04-02",
                  }),
                });

                const result = await response.json();
                console.log("Calendar busy result:", result);

                if (response.ok) {
                  alert("busy API 測試成功，請看 console");
                } else {
                  alert("busy API 測試失敗，請看 console");
                }
              } catch (error) {
                console.error(error);
                alert("busy API 測試失敗");
              }
            }}
            className="w-full mt-3 bg-green-600 text-white py-3 rounded-lg hover:opacity-90"
          >
            測試讀取 Calendar busy
          </button>

          <button
            type="button"
            onClick={() => {
              window.location.href = "/api/auth/google";
            }}
            className="w-full mt-3 bg-orange-600 text-white py-3 rounded-lg hover:opacity-90"
          >
            重新授權 Google Calendar
          </button>
        </div>
      </div>
    </main>
  );
}
