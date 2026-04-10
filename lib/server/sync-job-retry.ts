import "server-only";

import {
  getSyncJobById,
  markSyncJobResolved,
  markSyncJobRetryFailed,
  type SyncJobAction,
  type SyncJobRecord,
} from "@/lib/server/sync-job-repo";
import {
  type BookingSlotRecord,
  findBookingSlotsByCalendarEvent,
  findBookingSlotsByGroupId,
  getBookingSlotsByIds,
  markBookingSlotIdsSynced,
} from "@/lib/server/booking-repo";
import {
  createCalendarBookingEvent,
  deleteCalendarBookingEvent,
  updateCalendarBookingEvent,
} from "@/lib/server/calendar-client";

export type RetrySyncJobResult =
  | {
      status: "success";
      message: string;
    }
  | {
      status: "validation_error";
      code: "validation_error" | "job_not_pending" | "unsupported_action";
      message: string;
    }
  | {
      status: "not_found";
      code: "job_not_found";
      message: string;
    }
  | {
      status: "error";
      code: "retry_failed";
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

function toErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

async function loadTargetSlots(job: SyncJobRecord): Promise<BookingSlotRecord[]> {
  let targetSlots: BookingSlotRecord[] = [];

  if (job.bookingGroupId) {
    targetSlots = await findBookingSlotsByGroupId(job.bookingGroupId);
  }

  if (targetSlots.length === 0 && job.calendarEventId) {
    targetSlots = await findBookingSlotsByCalendarEvent({
      calendarEventId: job.calendarEventId,
      date: (job.date as string) || undefined,
    });
  }

  if (targetSlots.length === 0 && job.bookingId) {
    targetSlots = await getBookingSlotsByIds([job.bookingId]);
  }

  return targetSlots;
}

async function executeSyncJobAction(job: SyncJobRecord) {
  if (job.action === "delete") {
    if (!job.calendarEventId) {
      throw new Error("calendarEventId 缺失，無法重試 delete");
    }
    await deleteCalendarBookingEvent({
      eventId: job.calendarEventId,
    });
    return;
  }

  const targetSlots = await loadTargetSlots(job);

  if (targetSlots.length === 0) {
    throw new Error(`找不到可重試 ${job.action} 的預約資料`);
  }

  const sortedSlots = [...targetSlots].sort((a, b) => a.time.localeCompare(b.time));
  const baseSlot = sortedSlots[0];
  const lastSlot = sortedSlots[sortedSlots.length - 1];
  const startTime = baseSlot.time;
  const endTime = minutesToTime(timeToMinutes(lastSlot.time) + 30);

  if (job.action === "update") {
    if (!job.calendarEventId) {
      throw new Error("calendarEventId 缺失，無法重試 update");
    }

    await updateCalendarBookingEvent({
      eventId: job.calendarEventId,
      date: baseSlot.date,
      startTime,
      endTime,
      name: baseSlot.name,
      service: baseSlot.service,
    });
    return;
  }

  if (job.action === "create") {
    const calendarResult = await createCalendarBookingEvent({
      name: baseSlot.name,
      service: baseSlot.service,
      date: baseSlot.date,
      startTime,
      endTime,
      note: baseSlot.note,
      phone: baseSlot.phone,
      lineId: baseSlot.lineId,
    });

    if (!calendarResult.eventId) {
      throw new Error("CALENDAR_EVENT_ID_MISSING");
    }

    await markBookingSlotIdsSynced({
      slotIds: targetSlots.map((slot) => slot.id),
      eventId: calendarResult.eventId,
    });
    return;
  }

  throw new Error(`unsupported_action:${job.action}`);
}

export async function retrySyncJobById(params: {
  jobId: string;
  actor: string;
  allowedActions?: SyncJobAction[];
}): Promise<RetrySyncJobResult> {
  const { jobId, actor, allowedActions } = params;

  if (!jobId) {
    return {
      status: "validation_error",
      code: "validation_error",
      message: "缺少 jobId",
    };
  }

  const job = await getSyncJobById(jobId);
  if (!job) {
    return {
      status: "not_found",
      code: "job_not_found",
      message: "找不到 sync job",
    };
  }

  if (job.status !== "pending") {
    return {
      status: "validation_error",
      code: "job_not_pending",
      message: "此 sync job 不是 pending 狀態，無法重試",
    };
  }

  if (allowedActions && !allowedActions.includes(job.action)) {
    return {
      status: "validation_error",
      code: "unsupported_action",
      message: `目前僅支援 ${allowedActions.join(" / ")} 重試`,
    };
  }

  try {
    await executeSyncJobAction(job);
    await markSyncJobResolved({
      jobId,
      actor,
    });

    return {
      status: "success",
      message: "重試成功，已標記為 resolved",
    };
  } catch (error) {
    await markSyncJobRetryFailed({
      jobId,
      errorMessage: toErrorMessage(error),
      actor,
    });

    return {
      status: "error",
      code: "retry_failed",
      message: "重試失敗",
    };
  }
}
