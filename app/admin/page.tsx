"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { verifyAdminAccess } from "@/lib/admin-auth";
import { parseApiResult } from "@/lib/shared/parse-api-result";

type Booking = {
  id: string;
  name: string;
  lineId: string;
  phone: string;
  note: string;
  service: string;
  lessons?: number;
  date: string;
  time: string;
  status: string;
  bookingGroupId?: string;
  calendarEventId?: string;
  calendarSyncStatus?: string;
  contactStatus?: string;
};

type PendingSyncJob = {
  id: string;
  action: string;
  reason: string;
  bookingGroupId?: string | null;
  bookingId?: string | null;
  calendarEventId?: string | null;
  attemptCount: number;
  lastError?: string | null;
  lastTriedAt?: string | null;
  updatedAt?: string | null;
  createdAt?: string | null;
};

const getStatusBadgeClass = (status: string) => {
  if (status === "synced") {
    return "inline-block px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800";
  }

  if (status === "pending") {
    return "inline-block px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800";
  }

  if (status === "failed") {
    return "inline-block px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800";
  }

  return "inline-block px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700";
};

const getServiceBadgeClass = (service: string) => {
  if (service === "健身") {
    return "inline-block px-2 py-1 rounded-full text-xs font-medium bg-orange-100 text-orange-800";
  }

  if (service === "AI課程") {
    return "inline-block px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800";
  }

  if (service === "咨詢") {
    return "inline-block px-2 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800";
  }

  if (service === "顧問") {
    return "inline-block px-2 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-800";
  }

  return "inline-block px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700";
};

const getContactStatusBadgeClass = (status: string) => {
  if (status === "已完成") {
    return "inline-block px-2 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800";
  }

  if (status === "已確認") {
    return "inline-block px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800";
  }

  if (status === "已聯絡") {
    return "inline-block px-2 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-800";
  }

  return "inline-block px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700";
};

const copyToClipboard = async (text: string, label: string) => {
  try {
    await navigator.clipboard.writeText(text);
    alert(`${label} 已複製`);
  } catch (error) {
    console.error("複製失敗：", error);
    alert("複製失敗");
  }
};

const generateMessage = (booking: Booking) => {
  if (booking.service === "健身") {
    return `您好，${booking.name}
提醒您健身課預約時間為 ${booking.date} ${booking.time}
請提前到場並自行完成熱身，若需改期請提前告知，謝謝`;
  }

  if (booking.service === "AI課程") {
    return `您好，${booking.name}
提醒您 AI課程 預約時間為 ${booking.date} ${booking.time}
請準時上線／到場，如需改期請提前告知，謝謝`;
  }

  if (booking.service === "咨詢") {
    return `您好，${booking.name}
提醒您咨詢預約時間為 ${booking.date} ${booking.time}
建議先整理想討論的問題，以利更有效率進行，若需改期請提前告知，謝謝`;
  }

  if (booking.service === "顧問") {
    return `您好，${booking.name}
提醒您顧問預約時間為 ${booking.date} ${booking.time}
若有需要討論的重點，建議提前整理，方便會談聚焦，謝謝`;
  }

  return `您好，${booking.name}
提醒您預約時間為 ${booking.date} ${booking.time}（${booking.service}）
如需改期請提前告知，謝謝`;
};

const generateConfirmMessage = (booking: Booking) => {
  return `您好，${booking.name}
已為您確認預約時間：${booking.date} ${booking.time}（${booking.service}）
若需改期請提前告知，謝謝`;
};

const generateCompletedMessage = (booking: Booking) => {
  return `您好，${booking.name}
今天的 ${booking.service} 預約已完成，謝謝您。
若之後還要安排時間，歡迎再與我聯繫。`;
};

export default function AdminPage() {
  const router = useRouter();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [filterDate, setFilterDate] = useState("");
  const [filterService, setFilterService] = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | "failed">("all");
  const [filterContactStatus, setFilterContactStatus] = useState("");
  const [searchKeyword, setSearchKeyword] = useState("");
  const [pendingSyncJobs, setPendingSyncJobs] = useState<PendingSyncJob[]>([]);
  const [syncJobsLoading, setSyncJobsLoading] = useState(false);
  const [retryingSyncJobId, setRetryingSyncJobId] = useState<string | null>(null);
  const [dismissingSyncJobId, setDismissingSyncJobId] = useState<string | null>(null);

  // 改期相關狀態
  const [editId, setEditId] = useState<string | null>(null);
  const [newDate, setNewDate] = useState("");
  const [newTime, setNewTime] = useState("");
  const [resyncingId, setResyncingId] = useState<string | null>(null);

  const formatDate = (date: Date) => {
    return date.toISOString().slice(0, 10);
  };

  const today = formatDate(new Date());

  const tomorrow = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return formatDate(d);
  })();

  useEffect(() => {
    const checkAuth = async () => {
      const ok = await verifyAdminAccess();

      if (ok) {
        setAuthorized(true);
      }
    };

    checkAuth();
  }, []);

  const handleCancel = async (booking: Booking) => {
    try {
      const confirmed = confirm("確定要取消這筆預約嗎？");
      if (!confirmed) {
        return;
      }

      const response = await fetch("/api/bookings/cancel", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          bookingId: booking.id,
          bookingGroupId: booking.bookingGroupId || "",
          calendarEventId: booking.calendarEventId || "",
          date: booking.date,
        }),
      });

      const result = await parseApiResult(response);

      if (result.status === "validation_error") {
        alert(result.message || "取消參數錯誤");
        return;
      }

      if (result.status === "error" || result.status === "unauthorized") {
        alert(result.message || "取消失敗");
        return;
      }

      const deletedSlotIds: string[] = Array.isArray(result?.deletedSlotIds)
        ? result.deletedSlotIds
        : [booking.id];
      const targetIdSet = new Set(deletedSlotIds);
      setBookings((prev) =>
        prev.filter((b) => !targetIdSet.has(b.id))
      );

      if (result.status === "success") {
        alert(result.message || "已取消預約，Google Calendar 已同步刪除");
      } else if (result.status === "partial_success") {
        alert(result.message || "預約已取消，但 Calendar 未完全同步");
      } else {
        alert("取消完成");
      }
    } catch (error) {
      console.error("取消預約失敗：", error);
      alert("取消失敗");
    }
  };

  const handleUpdateContactStatus = async (
    booking: Booking,
    nextStatus: string
  ) => {
    try {
      const calendarEventId = booking.calendarEventId;

      if (!calendarEventId) {
        alert("缺少 calendarEventId，無法更新聯絡狀態");
        return;
      }

      const res = await fetch("/api/admin/update-contact-status", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          calendarEventId,
          status: nextStatus,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data?.success) {
        throw new Error(data?.error || "更新失敗");
      }

      setBookings((prev) =>
        prev.map((item) =>
          item.calendarEventId === calendarEventId
            ? { ...item, contactStatus: nextStatus }
            : item
        )
      );
    } catch (error) {
      console.error("更新聯絡狀態失敗：", error);
      alert("更新聯絡狀態失敗");
    }
  };

  const handleResyncCalendar = async (booking: Booking) => {
    const actionId = booking.bookingGroupId || booking.id;
    setResyncingId(actionId);

    try {
      const response = await fetch("/api/bookings/resync", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          bookingId: booking.id,
          bookingGroupId: booking.bookingGroupId || "",
          calendarEventId: booking.calendarEventId || "",
          date: booking.date,
        }),
      });

      const result = await parseApiResult(response);
      const eventId =
        typeof result.eventId === "string" ? result.eventId : undefined;

      if (result.status === "validation_error") {
        alert(result.message || "補同步參數錯誤");
        return;
      }

      if (
        result.status === "error" ||
        result.status === "unauthorized" ||
        !eventId
      ) {
        console.error("[calendar][admin-resync][failed]", {
          status: response.status,
          result,
          bookingId: booking.id,
          bookingGroupId: booking.bookingGroupId || null,
        });
        alert(result.message || "補同步失敗");
        return;
      }

      const updatedSlotIds: string[] = Array.isArray(result?.updatedSlotIds)
        ? result.updatedSlotIds
        : [booking.id];
      const targetIds = new Set(updatedSlotIds);

      setBookings((prev) =>
        prev.map((item) =>
          targetIds.has(item.id)
            ? {
                ...item,
                ...(eventId ? { calendarEventId: eventId } : {}),
                calendarSyncStatus: "synced",
              }
            : item
        )
      );
      alert(result?.message || "Google Calendar 補同步成功");
    } catch (error) {
      console.error("[calendar][admin-resync][failed]", {
        error,
        bookingId: booking.id,
        bookingGroupId: booking.bookingGroupId || null,
      });
      alert("補同步失敗");
    } finally {
      setResyncingId(null);
    }
  };

  const handleCopyMessage = async (booking: Booking) => {
    try {
      await navigator.clipboard.writeText(generateMessage(booking));

      const currentStatus = booking.contactStatus || "未聯絡";

      if (currentStatus === "未聯絡") {
        await handleUpdateContactStatus(booking, "已聯絡");
      }

      alert("訊息 已複製");
    } catch (error) {
      console.error("複製訊息失敗：", error);
      alert("複製訊息失敗");
    }
  };

  const handleCopyCustomMessage = async (
    booking: Booking,
    message: string,
    nextStatus?: string
  ) => {
    try {
      await navigator.clipboard.writeText(message);

      if (nextStatus) {
        const currentStatus = booking.contactStatus || "未聯絡";

        const order = ["未聯絡", "已聯絡", "已確認", "已完成"];
        const currentIndex = order.indexOf(currentStatus);
        const nextIndex = order.indexOf(nextStatus);

        if (nextIndex > currentIndex) {
          await handleUpdateContactStatus(booking, nextStatus);
        }
      }

      alert("訊息 已複製");
    } catch (error) {
      console.error("複製訊息失敗：", error);
      alert("複製訊息失敗");
    }
  };

  useEffect(() => {
    const fetchBookings = async () => {
      try {
        const q = query(collection(db, "bookings"), orderBy("createdAt", "desc"));
        const snapshot = await getDocs(q);

        const data: Booking[] = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...(doc.data() as Omit<Booking, "id">),
        }));

        setBookings(data);
      } catch (error) {
        console.error("讀取預約資料失敗：", error);
      } finally {
        setLoading(false);
      }
    };

    fetchBookings();
  }, []);

  const fetchPendingSyncJobs = async () => {
    setSyncJobsLoading(true);
    try {
      const response = await fetch("/api/admin/sync-jobs", {
        method: "GET",
      });

      const result = await response.json();

      if (!response.ok || !result?.success) {
        throw new Error(result?.error || "讀取待補償項目失敗");
      }

      const jobs: PendingSyncJob[] = Array.isArray(result?.jobs) ? result.jobs : [];
      setPendingSyncJobs(jobs);
    } catch (error) {
      console.error("讀取待補償項目失敗：", error);
    } finally {
      setSyncJobsLoading(false);
    }
  };

  useEffect(() => {
    if (!authorized) {
      return;
    }

    fetchPendingSyncJobs();
  }, [authorized]);

  const handleRetrySyncJob = async (job: PendingSyncJob) => {
    setRetryingSyncJobId(job.id);
    try {
      const response = await fetch("/api/admin/sync-jobs/retry", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          jobId: job.id,
        }),
      });

      const result = await parseApiResult(response);

      if (result.status !== "success") {
        alert(result.message || "重試失敗");
        return;
      }

      alert(result.message || "重試成功");
      await fetchPendingSyncJobs();
    } catch (error) {
      console.error("重試待補償項目失敗：", error);
      alert("重試失敗");
    } finally {
      setRetryingSyncJobId(null);
    }
  };

  const handleDismissSyncJob = async (job: PendingSyncJob) => {
    setDismissingSyncJobId(job.id);
    try {
      const response = await fetch("/api/admin/sync-jobs/dismiss", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          jobId: job.id,
        }),
      });

      const result = await parseApiResult(response);

      if (result.status !== "success") {
        alert(result.message || "忽略失敗");
        return;
      }

      alert(result.message || "已忽略此待補償項目");
      await fetchPendingSyncJobs();
    } catch (error) {
      console.error("忽略待補償項目失敗：", error);
      alert("忽略失敗");
    } finally {
      setDismissingSyncJobId(null);
    }
  };

  const filteredBookings = bookings.filter((booking) => {
    const matchDate = filterDate ? booking.date === filterDate : true;
    const matchService = filterService ? booking.service === filterService : true;
    const matchStatus =
      filterStatus === "failed"
        ? booking.calendarSyncStatus === "failed"
        : true;

    const matchContactStatus = filterContactStatus
      ? (booking.contactStatus || "未聯絡") === filterContactStatus
      : true;

    const keyword = searchKeyword.trim();
    const matchKeyword = keyword
      ? booking.name.includes(keyword) ||
        booking.phone.includes(keyword) ||
        booking.lineId.includes(keyword)
      : true;

    return (
      matchDate &&
      matchService &&
      matchStatus &&
      matchContactStatus &&
      matchKeyword
    );
  });

  const groupedBookings = Object.values(
    filteredBookings.reduce((acc, booking) => {
      const key = booking.bookingGroupId || booking.calendarEventId || booking.id;

      if (!acc[key]) {
        acc[key] = [];
      }

      acc[key].push(booking);
      return acc;
    }, {} as Record<string, Booking[]>)
  );

  const stats = groupedBookings.reduce(
    (acc, group) => {
      const booking = group[0];
      const service = booking?.service || "";
      const contactStatus = booking?.contactStatus || "未聯絡";

      acc.total += 1;
      acc.totalLessons += Number(booking?.lessons || 1);
      acc.totalSlots += group.length;

      if (service === "健身") acc.健身 += 1;
      if (service === "AI課程") acc.AI課程 += 1;
      if (service === "咨詢") acc.咨詢 += 1;
      if (service === "顧問") acc.顧問 += 1;

      if (contactStatus === "未聯絡") acc.未聯絡 += 1;
      if (contactStatus === "已聯絡") acc.已聯絡 += 1;
      if (contactStatus === "已確認") acc.已確認 += 1;
      if (contactStatus === "已完成") acc.已完成 += 1;

      return acc;
    },
    {
      total: 0,
      totalLessons: 0,
      totalSlots: 0,
      健身: 0,
      AI課程: 0,
      咨詢: 0,
      顧問: 0,
      未聯絡: 0,
      已聯絡: 0,
      已確認: 0,
      已完成: 0,
    }
  );

  const sortedGroupedBookings = [...groupedBookings].sort((groupA, groupB) => {
    const bookingA = [...groupA].sort((a, b) => a.time.localeCompare(b.time))[0];
    const bookingB = [...groupB].sort((a, b) => a.time.localeCompare(b.time))[0];

    if (bookingA.date !== bookingB.date) {
      return bookingA.date.localeCompare(bookingB.date);
    }

    return bookingA.time.localeCompare(bookingB.time);
  });

  const syncStats = {
    failedBookingsCount: groupedBookings.filter((group) => {
      const firstBooking = group[0];
      return firstBooking?.calendarSyncStatus === "failed";
    }).length,
    pendingSyncJobsCount: pendingSyncJobs.length,
    pendingDeleteJobsCount: pendingSyncJobs.filter((job) => job.action === "delete").length,
    highRetryJobsCount: pendingSyncJobs.filter((job) => Number(job.attemptCount || 0) >= 3).length,
  };

  if (!authorized) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div>驗證中...</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-3xl font-bold">管理後台｜預約列表</h1>

          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => router.push("/")}
              className="bg-gray-200 text-gray-800 px-4 py-2 rounded-lg hover:bg-gray-300"
            >
              返回前台
            </button>

            <button
              onClick={() => {
                window.location.href = "/api/auth/google";
              }}
              className="bg-orange-600 text-white px-4 py-2 rounded-lg hover:opacity-90"
            >
              重新授權 Calendar
            </button>

            <button
              onClick={() => router.push("/admin/service-buffers")}
              className="bg-purple-600 text-white px-4 py-2 rounded-lg hover:opacity-90"
            >
              服務 Buffer 設定
            </button>
          </div>
        </div>

        <div className="mb-6 flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">篩選日期</label>
            <input
              type="date"
              value={filterDate}
              onChange={(e) => setFilterDate(e.target.value)}
              className="border rounded-lg px-3 py-2 bg-white"
            />
            <div className="flex gap-2 mt-2">
              <button
                type="button"
                onClick={() => setFilterDate(today)}
                className="bg-blue-100 text-blue-800 px-3 py-1 rounded hover:bg-blue-200 text-xs"
              >
                今天
              </button>

              <button
                type="button"
                onClick={() => setFilterDate(tomorrow)}
                className="bg-blue-100 text-blue-800 px-3 py-1 rounded hover:bg-blue-200 text-xs"
              >
                明天
              </button>

              <button
                type="button"
                onClick={() => setFilterDate("")}
                className="bg-gray-200 text-gray-800 px-3 py-1 rounded hover:bg-gray-300 text-xs"
              >
                全部
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">服務類型</label>
            <select
              value={filterService}
              onChange={(e) => setFilterService(e.target.value)}
              className="border rounded-lg px-3 py-2 bg-white"
            >
              <option value="">全部服務</option>
              <option value="健身">健身</option>
              <option value="AI課程">AI課程</option>
              <option value="咨詢">咨詢</option>
              <option value="顧問">顧問</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">搜尋</label>
            <input
              type="text"
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
              placeholder="姓名 / 電話 / LINE ID"
              className="border rounded-lg px-3 py-2 bg-white"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">同步狀態</label>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as "all" | "failed")}
              className="border rounded-lg px-3 py-2 bg-white"
            >
              <option value="all">all</option>
              <option value="failed">failed</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">聯絡狀態</label>
            <select
              value={filterContactStatus}
              onChange={(e) => setFilterContactStatus(e.target.value)}
              className="border rounded-lg px-3 py-2 bg-white"
            >
              <option value="">全部聯絡狀態</option>
              <option value="未聯絡">未聯絡</option>
              <option value="已聯絡">已聯絡</option>
              <option value="已確認">已確認</option>
              <option value="已完成">已完成</option>
            </select>
          </div>

          <button
            type="button"
            onClick={() => {
              setFilterDate("");
              setFilterService("");
              setFilterStatus("all");
              setFilterContactStatus("");
              setSearchKeyword("");
            }}
            className="bg-gray-200 text-gray-800 px-4 py-2 rounded-lg hover:bg-gray-300"
          >
            清除篩選
          </button>
        </div>

        <div className="mb-6 grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
          <div className="bg-white rounded-xl shadow p-4 border">
            <div className="text-sm text-gray-500">總預約數</div>
            <div className="text-2xl font-bold">{stats.total}</div>
          </div>

          <div className="bg-white rounded-xl shadow p-4 border">
            <div className="text-sm text-gray-500">總堂數</div>
            <div className="text-2xl font-bold">{stats.totalLessons}</div>
          </div>

          <div className="bg-white rounded-xl shadow p-4 border">
            <div className="text-sm text-gray-500">總占用格數</div>
            <div className="text-2xl font-bold">{stats.totalSlots}</div>
          </div>

          <div className="bg-white rounded-xl shadow p-4 border">
            <div className="text-sm text-gray-500">健身</div>
            <div className="text-2xl font-bold">{stats.健身}</div>
          </div>

          <div className="bg-white rounded-xl shadow p-4 border">
            <div className="text-sm text-gray-500">AI課程</div>
            <div className="text-2xl font-bold">{stats.AI課程}</div>
          </div>

          <div className="bg-white rounded-xl shadow p-4 border">
            <div className="text-sm text-gray-500">咨詢</div>
            <div className="text-2xl font-bold">{stats.咨詢}</div>
          </div>

          <div className="bg-white rounded-xl shadow p-4 border">
            <div className="text-sm text-gray-500">顧問</div>
            <div className="text-2xl font-bold">{stats.顧問}</div>
          </div>

          <div className="bg-white rounded-xl shadow p-4 border">
            <div className="text-sm text-gray-500">未聯絡</div>
            <div className="text-2xl font-bold">{stats.未聯絡}</div>
          </div>

          <div className="bg-white rounded-xl shadow p-4 border">
            <div className="text-sm text-gray-500">已聯絡</div>
            <div className="text-2xl font-bold">{stats.已聯絡}</div>
          </div>

          <div className="bg-white rounded-xl shadow p-4 border">
            <div className="text-sm text-gray-500">已確認</div>
            <div className="text-2xl font-bold">{stats.已確認}</div>
          </div>

          <div className="bg-white rounded-xl shadow p-4 border">
            <div className="text-sm text-gray-500">已完成</div>
            <div className="text-2xl font-bold">{stats.已完成}</div>
          </div>

          <div className="bg-white rounded-xl shadow p-4 border">
            <div className="text-sm text-gray-500">Failed Bookings</div>
            <div className="text-2xl font-bold text-red-700">
              {syncStats.failedBookingsCount}
            </div>
          </div>

          <div className="bg-white rounded-xl shadow p-4 border">
            <div className="text-sm text-gray-500">Pending Sync Jobs</div>
            <div className="text-2xl font-bold text-amber-700">
              {syncStats.pendingSyncJobsCount}
            </div>
          </div>

          <div className="bg-white rounded-xl shadow p-4 border">
            <div className="text-sm text-gray-500">Pending Delete Jobs</div>
            <div className="text-2xl font-bold text-orange-700">
              {syncStats.pendingDeleteJobsCount}
            </div>
          </div>

          <div className="bg-white rounded-xl shadow p-4 border">
            <div className="text-sm text-gray-500">High Retry Jobs</div>
            <div className="text-2xl font-bold text-purple-700">
              {syncStats.highRetryJobsCount}
            </div>
          </div>
        </div>

        <div className="mb-6 bg-white rounded-xl shadow p-4 border">
          <h2 className="text-lg font-bold mb-3">待補償項目</h2>

          {syncJobsLoading ? (
            <p className="text-sm text-gray-500">讀取中...</p>
          ) : pendingSyncJobs.length === 0 ? (
            <p className="text-sm text-gray-500">目前沒有待補償項目</p>
          ) : (
            <div className="space-y-3">
              {pendingSyncJobs.map((job) => (
                <div key={job.id} className="rounded-lg border bg-gray-50 p-3 text-sm">
                  <p><span className="font-semibold">action：</span>{job.action || "-"}</p>
                  <p><span className="font-semibold">reason：</span>{job.reason || "-"}</p>
                  <p><span className="font-semibold">bookingGroupId：</span>{job.bookingGroupId || "-"}</p>
                  <p><span className="font-semibold">bookingId：</span>{job.bookingId || "-"}</p>
                  <p><span className="font-semibold">calendarEventId：</span>{job.calendarEventId || "-"}</p>
                  <p><span className="font-semibold">attemptCount：</span>{job.attemptCount}</p>
                  {job.lastError ? (
                    <p><span className="font-semibold">lastError：</span>{job.lastError}</p>
                  ) : null}
                  {job.lastTriedAt ? (
                    <p><span className="font-semibold">lastTriedAt：</span>{job.lastTriedAt}</p>
                  ) : null}
                  <p>
                    <span className="font-semibold">updatedAt：</span>
                    {job.updatedAt || job.createdAt || "-"}
                  </p>
                  {(job.action === "delete" || job.action === "update" || job.action === "create") && (
                    <button
                      onClick={() => handleRetrySyncJob(job)}
                      disabled={retryingSyncJobId === job.id}
                      className="mt-2 px-3 py-1 rounded bg-blue-600 text-white hover:opacity-90 disabled:opacity-50"
                    >
                      {retryingSyncJobId === job.id ? "重試中..." : "重試"}
                    </button>
                  )}
                  <button
                    onClick={() => handleDismissSyncJob(job)}
                    disabled={dismissingSyncJobId === job.id}
                    className="mt-2 ml-2 px-3 py-1 rounded bg-gray-500 text-white hover:opacity-90 disabled:opacity-50"
                  >
                    {dismissingSyncJobId === job.id ? "忽略中..." : "忽略"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {loading ? (
          <p>載入中...</p>
        ) : sortedGroupedBookings.length === 0 ? (
          <p>目前沒有預約資料</p>
        ) : (
          <div className="space-y-4">
            {sortedGroupedBookings.map((group) => {
              const booking = [...group].sort((a, b) => a.time.localeCompare(b.time))[0];
              const cardId = booking.calendarEventId || booking.id;

              return (
                <div key={cardId} className="bg-white rounded-2xl shadow p-5 border">
                  <div className="flex items-center justify-between mb-4 pb-4 border-b">
                    <div>
                      <div className="text-xl font-bold text-gray-900">{booking.name}</div>
                      <div className="flex items-center gap-2 text-sm text-gray-500">
                        <a
                          href={`tel:${booking.phone}`}
                          className="text-blue-600 hover:underline"
                        >
                          {booking.phone}
                        </a>
                        <button
                          onClick={() => copyToClipboard(booking.phone, "電話")}
                          className="text-xs px-2 py-1 bg-gray-200 rounded hover:bg-gray-300"
                        >
                          複製
                        </button>
                      </div>
                    </div>

                    <div className={getServiceBadgeClass(booking.service)}>
                      {booking.service}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <p>
                      <span className="font-semibold">LINE ID：</span>
                      <a
                        href={`https://line.me/R/ti/p/~${booking.lineId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline"
                      >
                        {booking.lineId}
                      </a>
                      <button
                        onClick={() => copyToClipboard(booking.lineId, "LINE ID")}
                        className="ml-2 text-xs px-2 py-1 bg-gray-200 rounded hover:bg-gray-300"
                      >
                        複製
                      </button>
                    </p>
                    <p><span className="font-semibold">節數：</span>{booking.lessons || 1}</p>
                    <p><span className="font-semibold">占用格數：</span>{group.length}</p>
                    <p>
                      <span className="font-semibold">bookingGroupId：</span>
                      {booking.bookingGroupId || "legacy"}
                    </p>
                    <div className="md:col-span-2 bg-gray-50 rounded-xl p-3 border">
                      <div className="text-sm text-gray-500 mb-1">預約時段</div>
                      <div className="text-lg font-bold text-gray-900">
                        {booking.date}　{booking.time}
                      </div>
                    </div>
                    <p>
                      <span className="font-semibold">狀態：</span>
                      <span className={getStatusBadgeClass(booking.status)}>
                        {booking.status}
                      </span>
                    </p>
                    <p>
                      <span className="font-semibold">Google Calendar：</span>
                      <span
                        className={getStatusBadgeClass(
                          booking.calendarSyncStatus || "unknown"
                        )}
                      >
                        {booking.calendarSyncStatus || "unknown"}
                      </span>
                    </p>
                    <p className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold">聯絡狀態：</span>

                      <span
                        className={getContactStatusBadgeClass(
                          booking.contactStatus || "未聯絡"
                        )}
                      >
                        {booking.contactStatus || "未聯絡"}
                      </span>

                      <select
                        value={booking.contactStatus || "未聯絡"}
                        onChange={(e) => handleUpdateContactStatus(booking, e.target.value)}
                        className="border rounded-lg px-2 py-1 text-sm bg-white"
                      >
                        <option value="未聯絡">未聯絡</option>
                        <option value="已聯絡">已聯絡</option>
                        <option value="已確認">已確認</option>
                        <option value="已完成">已完成</option>
                      </select>
                    </p>
                  </div>

                  <div className="mt-3">
                    <p className="font-semibold">備註：</p>
                    <p className="text-gray-700 mt-1">{booking.note || "無"}</p>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      onClick={() => handleCopyMessage(booking)}
                      className="px-4 py-2 rounded-lg bg-gray-800 text-white hover:opacity-90"
                    >
                      複製訊息
                    </button>

                    <button
                      onClick={() =>
                        handleCopyCustomMessage(
                          booking,
                          generateConfirmMessage(booking),
                          "已確認"
                        )
                      }
                      className="px-4 py-2 rounded-lg bg-blue-700 text-white hover:opacity-90"
                    >
                      複製確認訊息
                    </button>

                    <button
                      onClick={() =>
                        handleCopyCustomMessage(
                          booking,
                          generateCompletedMessage(booking),
                          "已完成"
                        )
                      }
                      className="px-4 py-2 rounded-lg bg-green-700 text-white hover:opacity-90"
                    >
                      複製完成訊息
                    </button>

                    <button
                      onClick={() => handleCancel(booking)}
                      className="px-4 py-2 rounded-lg bg-red-600 text-white hover:opacity-90"
                    >
                      取消預約
                    </button>
                    {booking.calendarSyncStatus === "failed" && (
                      <button
                        onClick={() => handleResyncCalendar(booking)}
                        disabled={resyncingId === (booking.bookingGroupId || booking.id)}
                        className="px-4 py-2 rounded-lg bg-amber-600 text-white hover:opacity-90"
                      >
                        {resyncingId === (booking.bookingGroupId || booking.id)
                          ? "補同步中..."
                          : "補同步 Calendar"}
                      </button>
                    )}
                    <button
                      onClick={() => {
                        setEditId(cardId);
                        setNewDate(booking.date);
                        setNewTime(booking.time);
                      }}
                      className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:opacity-90"
                    >
                      改期
                    </button>
                  </div>

                  {editId === cardId && (
                    <div className="mt-4 p-4 bg-gray-100 rounded-lg space-y-3">
                      <div>
                        <label className="block text-sm mb-1">新日期</label>
                        <input
                          type="date"
                          value={newDate}
                          onChange={(e) => setNewDate(e.target.value)}
                          className="border px-3 py-2 rounded w-full"
                        />
                      </div>

                      <div>
                        <label className="block text-sm mb-1">新時間</label>
                        <input
                          type="time"
                          value={newTime}
                          onChange={(e) => setNewTime(e.target.value)}
                          className="border px-3 py-2 rounded w-full"
                        />
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={async () => {
                            try {
                              if (!newDate || !newTime) {
                                alert("請選擇新日期與時間");
                                return;
                              }

                              const response = await fetch("/api/bookings/reschedule", {
                                method: "POST",
                                headers: {
                                  "Content-Type": "application/json",
                                },
                                body: JSON.stringify({
                                  bookingId: booking.id,
                                  bookingGroupId: booking.bookingGroupId || "",
                                  calendarEventId: booking.calendarEventId || "",
                                  name: booking.name,
                                  service: booking.service,
                                  lessons: booking.lessons || 1,
                                  lineId: booking.lineId,
                                  phone: booking.phone,
                                  note: booking.note || "",
                                  status: booking.status,
                                  contactStatus: booking.contactStatus || "未聯絡",
                                  calendarSyncStatus: booking.calendarSyncStatus || "pending",
                                  oldDate: booking.date,
                                  newDate,
                                  newTime,
                                }),
                              });

                              const result = await parseApiResult(response);

                              if (result.status === "validation_error") {
                                alert(result.message || "改期參數錯誤");
                                return;
                              }

                              if (result.status === "conflict") {
                                alert(result.message || "新時段已被預約");
                                return;
                              }

                              if (result.status === "error" || result.status === "unauthorized") {
                                alert(result.message || "改期失敗");
                                return;
                              }

                              if (result.status === "success") {
                                alert(result.message || "改期成功，Google Calendar 已同步更新");
                              } else if (result.status === "partial_success") {
                                alert(result.message || "改期成功，但 Google Calendar 未完全同步");
                              } else {
                                alert("改期完成");
                              }
                              location.reload();
                            } catch (error) {
                              console.error(error);
                              alert("改期失敗");
                            }
                          }}
                          className="bg-green-600 text-white px-4 py-2 rounded-lg hover:opacity-90"
                        >
                          確認改期
                        </button>
                        <button
                          onClick={() => setEditId(null)}
                          className="bg-gray-400 text-white px-4 py-2 rounded-lg hover:opacity-90"
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
