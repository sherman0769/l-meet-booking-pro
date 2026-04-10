import {
  createBookingSlotsInTransaction,
  deleteBookingSlotsByIds,
  type BookingSlotRecord,
  findBookingSlotsByCalendarEvent,
  findBookingSlotsByGroupId,
  findBookingSlotIdsByCalendarEvent,
  findBookingSlotIdsByGroupId,
  getBookingSlotsByIds,
  markBookingSlotIdsFailed,
  markBookingSlotIdsSynced,
  markBookingSlotsFailed,
  markBookingSlotsSynced,
  rewriteBookingSlotsInTransaction,
} from "@/lib/server/booking-repo";
import {
  createCalendarBookingEvent,
  deleteCalendarBookingEvent,
  updateCalendarBookingEvent,
} from "@/lib/server/calendar-client";
import { upsertPendingSyncJob } from "@/lib/server/sync-job-repo";

export type CreateBookingInput = {
  name: string;
  lineId: string;
  phone: string;
  note?: string;
  service: string;
  lessons: number;
  date: string;
  time: string;
};

export type CreateBookingResult =
  | {
      status: "success";
      bookingGroupId: string;
      eventId: string;
      message: string;
    }
  | {
      status: "partial_success";
      bookingGroupId: string;
      message: string;
    }
  | {
      status: "conflict";
      message: string;
    }
  | {
      status: "validation_error";
      message: string;
    };

export type CancelBookingInput = {
  bookingId: string;
  bookingGroupId?: string;
  calendarEventId?: string;
  date?: string;
};

export type CancelBookingResult =
  | {
      status: "success";
      deletedSlotIds: string[];
      message: string;
    }
  | {
      status: "partial_success";
      deletedSlotIds: string[];
      message: string;
      reason: "calendar_delete_failed" | "calendar_not_linked";
    }
  | {
      status: "validation_error";
      message: string;
    };

export type RescheduleBookingInput = {
  bookingId: string;
  bookingGroupId?: string;
  calendarEventId?: string;
  name: string;
  service: string;
  lessons?: number;
  lineId: string;
  phone: string;
  note?: string;
  status: string;
  contactStatus?: string;
  calendarSyncStatus?: string;
  oldDate?: string;
  newDate: string;
  newTime: string;
};

export type RescheduleBookingResult =
  | {
      status: "success";
      message: string;
    }
  | {
      status: "partial_success";
      message: string;
      reason: "calendar_update_failed" | "calendar_not_linked";
    }
  | {
      status: "conflict";
      message: string;
    }
  | {
      status: "validation_error";
      message: string;
    };

export type ResyncBookingInput = {
  bookingId: string;
  bookingGroupId?: string;
  calendarEventId?: string;
  date?: string;
};

export type ResyncBookingResult =
  | {
      status: "success";
      eventId: string;
      updatedSlotIds: string[];
      message: string;
    }
  | {
      status: "validation_error";
      message: string;
    };

function timeToMinutes(time: string) {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

function minutesToTime(minutes: number) {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function calculateOccupiedSlots(service: string, startTime: string, lessons: number) {
  const start = timeToMinutes(startTime);
  const totalMinutes = service === "健身" ? 60 + 30 : lessons * 60 + 30;
  const slots: string[] = [];

  for (let current = start; current < start + totalMinutes; current += 30) {
    slots.push(minutesToTime(current));
  }

  return slots;
}

function validateInput(input: CreateBookingInput) {
  if (!input.name || !input.lineId || !input.phone || !input.date || !input.time) {
    return "請先填寫姓名、LINE ID、電話、預約日期、預約時間";
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
    return "預約日期格式錯誤";
  }

  if (!/^([01]\d|2[0-3]):(00|30)$/.test(input.time)) {
    return "預約時間格式錯誤，僅支援整點或半點";
  }

  if (!Number.isFinite(input.lessons) || input.lessons <= 0) {
    return "預約節數格式錯誤";
  }

  return null;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export async function createBooking(input: CreateBookingInput): Promise<CreateBookingResult> {
  const validationError = validateInput(input);
  if (validationError) {
    return {
      status: "validation_error",
      message: validationError,
    };
  }

  const occupiedSlots = calculateOccupiedSlots(input.service, input.time, input.lessons);
  const bookingGroupId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

  try {
    await createBookingSlotsInTransaction({
      booking: input,
      occupiedSlots,
      bookingGroupId,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "SLOT_ALREADY_BOOKED") {
      return {
        status: "conflict",
        message: "所選時段中有部分已被預約，請選擇其他時間",
      };
    }
    throw error;
  }

  try {
    const startTime = input.time;
    const lastSlot = occupiedSlots[occupiedSlots.length - 1];
    const endTime = minutesToTime(timeToMinutes(lastSlot) + 30);

    const calendarResult = await createCalendarBookingEvent({
      name: input.name,
      service: input.service,
      date: input.date,
      startTime,
      endTime,
      note: input.note,
      phone: input.phone,
      lineId: input.lineId,
    });

    if (!calendarResult.eventId) {
      throw new Error("CALENDAR_EVENT_ID_MISSING");
    }

    await markBookingSlotsSynced({
      date: input.date,
      occupiedSlots,
      eventId: calendarResult.eventId,
    });

    return {
      status: "success",
      bookingGroupId,
      eventId: calendarResult.eventId,
      message: "預約與 Google Calendar 同步成功",
    };
  } catch (error) {
    console.error("[bookings.create][calendar-sync-failed]", error);

    try {
      await markBookingSlotsFailed({
        date: input.date,
        occupiedSlots,
      });
    } catch (updateError) {
      console.error("[bookings.create][mark-failed-error]", updateError);
    }

    try {
      await upsertPendingSyncJob({
        action: "create",
        bookingGroupId,
        bookingId: `${input.date}_${occupiedSlots[0]}`,
        calendarEventId: undefined,
        reason: "calendar_create_failed",
        lastError: getErrorMessage(error),
        date: input.date,
      });
    } catch (jobError) {
      console.error("[bookings.create][sync-job-upsert-failed]", jobError);
    }

    return {
      status: "partial_success",
      bookingGroupId,
      message: "預約已建立，但 Google Calendar 同步失敗，請稍後通知管理員處理。",
    };
  }
}

export async function cancelBooking(
  input: CancelBookingInput
): Promise<CancelBookingResult> {
  if (!input.bookingId) {
    return {
      status: "validation_error",
      message: "缺少 bookingId",
    };
  }

  let targetSlotIds: string[] = [];

  if (input.bookingGroupId) {
    targetSlotIds = await findBookingSlotIdsByGroupId(input.bookingGroupId);
  }

  if (targetSlotIds.length === 0 && input.calendarEventId) {
    targetSlotIds = await findBookingSlotIdsByCalendarEvent({
      calendarEventId: input.calendarEventId,
      date: input.date,
    });
  }

  if (targetSlotIds.length === 0) {
    targetSlotIds = [input.bookingId];
  }

  let calendarDeleteState: "skipped" | "deleted" | "failed" = "skipped";

  if (input.calendarEventId) {
    try {
      await deleteCalendarBookingEvent({
        eventId: input.calendarEventId,
      });
      calendarDeleteState = "deleted";
    } catch (error) {
      calendarDeleteState = "failed";
      console.error("[bookings.cancel][calendar-delete-failed]", {
        error,
        bookingId: input.bookingId,
        bookingGroupId: input.bookingGroupId || null,
        calendarEventId: input.calendarEventId,
      });

      try {
        await upsertPendingSyncJob({
          action: "delete",
          bookingGroupId: input.bookingGroupId,
          bookingId: input.bookingId,
          calendarEventId: input.calendarEventId,
          reason: "calendar_delete_failed",
          lastError: getErrorMessage(error),
          date: input.date,
        });
      } catch (jobError) {
        console.error("[bookings.cancel][sync-job-upsert-failed]", jobError);
      }
    }
  }

  await deleteBookingSlotsByIds(targetSlotIds);

  if (calendarDeleteState === "deleted") {
    return {
      status: "success",
      deletedSlotIds: targetSlotIds,
      message: "已取消預約，Google Calendar 已同步刪除",
    };
  }

  if (calendarDeleteState === "failed") {
    return {
      status: "partial_success",
      deletedSlotIds: targetSlotIds,
      reason: "calendar_delete_failed",
      message: "已取消預約，但 Google Calendar 刪除失敗",
    };
  }

  return {
    status: "partial_success",
    deletedSlotIds: targetSlotIds,
    reason: "calendar_not_linked",
    message: "已取消預約（此筆預約未綁定 Google Calendar event）",
  };
}

export async function rescheduleBooking(
  input: RescheduleBookingInput
): Promise<RescheduleBookingResult> {
  if (!input.bookingId || !input.newDate || !input.newTime) {
    return {
      status: "validation_error",
      message: "缺少必要改期參數",
    };
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.newDate)) {
    return {
      status: "validation_error",
      message: "新日期格式錯誤",
    };
  }

  if (!/^([01]\d|2[0-3]):(00|30)$/.test(input.newTime)) {
    return {
      status: "validation_error",
      message: "新時間格式錯誤，僅支援整點或半點",
    };
  }

  let targetSlotIds: string[] = [];

  if (input.bookingGroupId) {
    targetSlotIds = await findBookingSlotIdsByGroupId(input.bookingGroupId);
  }

  if (targetSlotIds.length === 0 && input.calendarEventId) {
    targetSlotIds = await findBookingSlotIdsByCalendarEvent({
      calendarEventId: input.calendarEventId,
      date: input.oldDate,
    });
  }

  if (targetSlotIds.length === 0) {
    targetSlotIds = [input.bookingId];
  }

  const lessons = input.lessons || 1;
  const newSlots = calculateOccupiedSlots(input.service, input.newTime, lessons);

  try {
    await rewriteBookingSlotsInTransaction({
      targetSlotIds,
      newDate: input.newDate,
      newSlots,
      bookingData: {
        name: input.name,
        lineId: input.lineId,
        phone: input.phone,
        note: input.note,
        service: input.service,
        lessons,
        status: input.status || "pending",
        calendarEventId: input.calendarEventId || "",
        calendarSyncStatus: input.calendarSyncStatus || "pending",
        contactStatus: input.contactStatus || "未聯絡",
        bookingGroupId: input.bookingGroupId,
        date: input.newDate,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "SLOT_ALREADY_BOOKED") {
      return {
        status: "conflict",
        message: "新時段已被預約",
      };
    }
    throw error;
  }

  const startTime = input.newTime;
  const lastSlot = newSlots[newSlots.length - 1];
  const endTime = minutesToTime(timeToMinutes(lastSlot) + 30);

  if (!input.calendarEventId) {
    return {
      status: "partial_success",
      reason: "calendar_not_linked",
      message: "改期成功（此筆預約未綁定 Google Calendar event）",
    };
  }

  try {
    await updateCalendarBookingEvent({
      eventId: input.calendarEventId,
      date: input.newDate,
      startTime,
      endTime,
      name: input.name,
      service: input.service,
    });

    return {
      status: "success",
      message: "改期成功，Google Calendar 已同步更新",
    };
  } catch (error) {
    console.error("[bookings.reschedule][calendar-update-failed]", {
      error,
      bookingId: input.bookingId,
      bookingGroupId: input.bookingGroupId || null,
      calendarEventId: input.calendarEventId,
    });

    try {
      await upsertPendingSyncJob({
        action: "update",
        bookingGroupId: input.bookingGroupId,
        bookingId: input.bookingId,
        calendarEventId: input.calendarEventId,
        reason: "calendar_update_failed",
        lastError: getErrorMessage(error),
        date: input.newDate,
      });
    } catch (jobError) {
      console.error("[bookings.reschedule][sync-job-upsert-failed]", jobError);
    }

    return {
      status: "partial_success",
      reason: "calendar_update_failed",
      message: "改期成功，但 Google Calendar 同步失敗",
    };
  }
}

export async function resyncBooking(
  input: ResyncBookingInput
): Promise<ResyncBookingResult> {
  if (!input.bookingId) {
    return {
      status: "validation_error",
      message: "缺少 bookingId",
    };
  }

  let targetSlots: BookingSlotRecord[] = [];

  if (input.bookingGroupId) {
    targetSlots = await findBookingSlotsByGroupId(input.bookingGroupId);
  }

  if (targetSlots.length === 0 && input.calendarEventId) {
    targetSlots = await findBookingSlotsByCalendarEvent({
      calendarEventId: input.calendarEventId,
      date: input.date,
    });
  }

  if (targetSlots.length === 0) {
    targetSlots = await getBookingSlotsByIds([input.bookingId]);
  }

  if (targetSlots.length === 0) {
    return {
      status: "validation_error",
      message: "找不到可補同步的預約資料",
    };
  }

  const sortedSlots = [...targetSlots].sort((a, b) => a.time.localeCompare(b.time));
  const base = sortedSlots[0];
  const startTime = base.time;
  const lastSlot = sortedSlots[sortedSlots.length - 1].time;
  const endTime = minutesToTime(timeToMinutes(lastSlot) + 30);
  const targetSlotIds = targetSlots.map((slot) => slot.id);

  try {
    const calendarResult = await createCalendarBookingEvent({
      name: base.name,
      service: base.service,
      date: base.date,
      startTime,
      endTime,
      note: base.note,
      phone: base.phone,
      lineId: base.lineId,
    });

    if (!calendarResult.eventId) {
      throw new Error("CALENDAR_EVENT_ID_MISSING");
    }

    await markBookingSlotIdsSynced({
      slotIds: targetSlotIds,
      eventId: calendarResult.eventId,
    });

    return {
      status: "success",
      eventId: calendarResult.eventId,
      updatedSlotIds: targetSlotIds,
      message: "Google Calendar 補同步成功",
    };
  } catch (error) {
    console.error("[bookings.resync][calendar-sync-failed]", {
      error,
      bookingId: input.bookingId,
      bookingGroupId: input.bookingGroupId || null,
      calendarEventId: input.calendarEventId || null,
    });

    try {
      await markBookingSlotIdsFailed(targetSlotIds);
    } catch (updateError) {
      console.error("[bookings.resync][mark-failed-error]", updateError);
    }

    throw error;
  }
}
