import {
  FieldValue,
  type QueryDocumentSnapshot,
  type Query,
} from "firebase-admin/firestore";
import { adminDb } from "@/lib/server/firebase-admin";

type BaseBookingData = {
  name: string;
  lineId: string;
  phone: string;
  note?: string;
  service: string;
  lessons: number;
  date: string;
};

type RescheduleBookingData = {
  name: string;
  lineId: string;
  phone: string;
  note?: string;
  service: string;
  lessons?: number;
  status: string;
  calendarEventId?: string;
  calendarSyncStatus?: string;
  contactStatus?: string;
  bookingGroupId?: string;
  date: string;
};

export type BookingSlotRecord = {
  id: string;
  name: string;
  lineId: string;
  phone: string;
  note?: string;
  service: string;
  lessons?: number;
  date: string;
  time: string;
  status?: string;
  bookingGroupId?: string;
  calendarEventId?: string;
  calendarSyncStatus?: string;
  contactStatus?: string;
};

function slotDocRef(date: string, slot: string) {
  return adminDb.collection("bookings").doc(`${date}_${slot}`);
}

function mapBookingSlotDoc(docSnap: QueryDocumentSnapshot): BookingSlotRecord {
  return {
    id: docSnap.id,
    ...(docSnap.data() as Omit<BookingSlotRecord, "id">),
  };
}

export async function findBookingSlotIdsByGroupId(bookingGroupId: string) {
  const snapshot = await adminDb.collection("bookings").where("bookingGroupId", "==", bookingGroupId).get();
  return snapshot.docs.map((docSnap) => docSnap.id);
}

export async function findBookingSlotsByGroupId(bookingGroupId: string) {
  const snapshot = await adminDb.collection("bookings").where("bookingGroupId", "==", bookingGroupId).get();
  return snapshot.docs.map(mapBookingSlotDoc);
}

export async function findBookingSlotIdsByCalendarEvent(params: {
  calendarEventId: string;
  date?: string;
}) {
  const { calendarEventId, date } = params;

  let q: Query = adminDb
    .collection("bookings")
    .where("calendarEventId", "==", calendarEventId);

  if (date) {
    q = q.where("date", "==", date);
  }

  const snapshot = await q.get();
  return snapshot.docs.map((docSnap) => docSnap.id);
}

export async function findBookingSlotsByCalendarEvent(params: {
  calendarEventId: string;
  date?: string;
}) {
  const { calendarEventId, date } = params;

  let q: Query = adminDb.collection("bookings").where("calendarEventId", "==", calendarEventId);

  if (date) {
    q = q.where("date", "==", date);
  }

  const snapshot = await q.get();
  return snapshot.docs.map(mapBookingSlotDoc);
}

export async function getBookingSlotsByIds(slotIds: string[]) {
  const uniqueIds = Array.from(new Set(slotIds.filter(Boolean)));
  const snapshots = await Promise.all(
    uniqueIds.map((id) => adminDb.collection("bookings").doc(id).get())
  );

  return snapshots
    .filter((snap) => snap.exists)
    .map((snap) => ({
      id: snap.id,
      ...(snap.data() as Omit<BookingSlotRecord, "id">),
    }));
}

export async function deleteBookingSlotsByIds(slotIds: string[]) {
  for (const id of slotIds) {
    await adminDb.collection("bookings").doc(id).delete();
  }
}

export async function rewriteBookingSlotsInTransaction(params: {
  targetSlotIds: string[];
  newDate: string;
  newSlots: string[];
  bookingData: RescheduleBookingData;
}) {
  const { targetSlotIds, newDate, newSlots, bookingData } = params;
  const targetSlotIdSet = new Set(targetSlotIds);
  const newRefs = newSlots.map((slot) => slotDocRef(newDate, slot));

  await adminDb.runTransaction(async (transaction) => {
    for (const ref of newRefs) {
      const snap = await transaction.get(ref);
      if (snap.exists() && !targetSlotIdSet.has(ref.id)) {
        throw new Error("SLOT_ALREADY_BOOKED");
      }
    }

    targetSlotIds.forEach((id) => {
      transaction.delete(adminDb.collection("bookings").doc(id));
    });

    for (const slot of newSlots) {
      const ref = slotDocRef(newDate, slot);
      transaction.set(ref, {
        name: bookingData.name,
        lineId: bookingData.lineId,
        phone: bookingData.phone,
        note: bookingData.note || "",
        service: bookingData.service,
        lessons: bookingData.lessons || 1,
        date: newDate,
        time: slot,
        status: bookingData.status,
        calendarEventId: bookingData.calendarEventId || "",
        calendarSyncStatus: bookingData.calendarSyncStatus || "pending",
        contactStatus: bookingData.contactStatus || "未聯絡",
        createdAt: new Date(),
        ...(bookingData.bookingGroupId
          ? { bookingGroupId: bookingData.bookingGroupId }
          : {}),
      });
    }
  });
}

export async function createBookingSlotsInTransaction(params: {
  booking: BaseBookingData;
  occupiedSlots: string[];
  bookingGroupId: string;
}) {
  const { booking, occupiedSlots, bookingGroupId } = params;
  const slotRefs = occupiedSlots.map((slot) => slotDocRef(booking.date, slot));

  await adminDb.runTransaction(async (transaction) => {
    for (const ref of slotRefs) {
      const snap = await transaction.get(ref);
      if (snap.exists()) {
        throw new Error("SLOT_ALREADY_BOOKED");
      }
    }

    for (const slot of occupiedSlots) {
      const ref = slotDocRef(booking.date, slot);
      transaction.set(ref, {
        name: booking.name,
        lineId: booking.lineId,
        phone: booking.phone,
        note: booking.note || "",
        service: booking.service,
        lessons: booking.lessons,
        date: booking.date,
        time: slot,
        bookingGroupId,
        status: "pending",
        calendarEventId: "",
        calendarSyncStatus: "pending",
        createdAt: FieldValue.serverTimestamp(),
        contactStatus: "未聯絡",
      });
    }
  });
}

export async function markBookingSlotsSynced(params: {
  date: string;
  occupiedSlots: string[];
  eventId: string;
}) {
  const { date, occupiedSlots, eventId } = params;

  const slotIds = occupiedSlots.map((slot) => `${date}_${slot}`);
  await markBookingSlotIdsSynced({
    slotIds,
    eventId,
  });
}

export async function markBookingSlotsFailed(params: {
  date: string;
  occupiedSlots: string[];
}) {
  const { date, occupiedSlots } = params;

  const slotIds = occupiedSlots.map((slot) => `${date}_${slot}`);
  await markBookingSlotIdsFailed(slotIds);
}

export async function markBookingSlotIdsSynced(params: {
  slotIds: string[];
  eventId: string;
}) {
  const { slotIds, eventId } = params;
  const uniqueIds = Array.from(new Set(slotIds.filter(Boolean)));

  for (const id of uniqueIds) {
    await adminDb.collection("bookings").doc(id).update({
      calendarEventId: eventId,
      calendarSyncStatus: "synced",
    });
  }
}

export async function markBookingSlotIdsFailed(slotIds: string[]) {
  const uniqueIds = Array.from(new Set(slotIds.filter(Boolean)));

  for (const id of uniqueIds) {
    await adminDb.collection("bookings").doc(id).update({
      calendarSyncStatus: "failed",
    });
  }
}
