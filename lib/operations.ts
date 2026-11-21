import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { OperationsError, requireManager, opsHash } from "@/lib/operations-auth";
import type { OperationsAction, OperationsSnapshot, OperationsStaff } from "@/lib/operations-types";

function fail(message: string, status = 400): never { throw new OperationsError(message, status); }
const value = (v: unknown, label: string, max = 200): string => {
  if (typeof v !== "string" || !v.trim() || v.trim().length > max) fail(`กรุณากรอก${label}ไม่เกิน ${max} ตัวอักษร`);
  return v.trim();
};
const optional = (v: unknown, max = 1000) => typeof v === "string" ? v.trim().slice(0, max) : "";
const email = (v: unknown) => {
  const result = value(v, "อีเมล", 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) fail("กรุณากรอกอีเมลให้ถูกต้อง");
  return result;
};
const date = (v: unknown) => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) fail("กรุณาเลือกวันที่ให้ถูกต้อง");
  const parsed = new Date(`${v}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== v) fail("กรุณาเลือกวันที่ให้ถูกต้อง");
  return parsed;
};
const positive = (v: unknown, label: string): number => {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 1000) fail(`${label}ต้องเป็นจำนวนเต็มตั้งแต่ 1 ถึง 1,000`);
  return v;
};
const isoDate = (v: Date) => v.toISOString().slice(0, 10);
const propertyToday = (timezone: string) => {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
};
const staffPublic = (s: { id: string; name: string; email: string; role: string; active: boolean }): OperationsStaff => ({
  id: s.id, name: s.name, email: s.email, role: s.role as OperationsStaff["role"], active: s.active,
});

const str = z.string();
const id = str.min(1);
const person = { guestName: str.min(1), guestContact: str, checkIn: str, checkOut: str, partySize: z.number().int().positive(), notes: str };
export const operationsActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("createRoom"), number: str, type: str, capacity: z.number().int().positive() }),
  z.object({ action: z.literal("updateRoom"), id, number: str, type: str, capacity: z.number().int().positive(), outOfService: z.boolean() }),
  z.object({ action: z.literal("createReservation"), roomId: id, ...person }),
  z.object({ action: z.literal("updateReservation"), id, roomId: id, ...person }),
  z.object({ action: z.literal("cancelReservation"), id }),
  z.object({ action: z.literal("checkIn"), id }),
  z.object({ action: z.literal("checkOut"), id }),
  z.object({ action: z.literal("createWorkOrder"), roomId: id, type: z.enum(["HOUSEKEEPING", "REPAIR"]), title: str, assigneeId: id.nullable(), blocksRoom: z.boolean() }),
  z.object({ action: z.literal("updateWorkOrder"), id, status: z.enum(["OPEN", "IN_PROGRESS", "DONE"]), assigneeId: id.nullable() }),
  z.object({ action: z.literal("updateProperty"), name: str }),
  z.object({ action: z.literal("createStaff"), name: str, email: str, password: str, role: z.enum(["MANAGER", "STAFF"]) }),
  z.object({ action: z.literal("deactivateStaff"), id }),
]);

export async function operationsSnapshot(user: { id: string; propertyId: string; name: string; email: string; role: string; active: boolean }): Promise<OperationsSnapshot> {
  const propertyId = user.propertyId;
  const [property, rooms, reservations, workOrders, staff] = await Promise.all([
    prisma.property.findUnique({ where: { id: propertyId } }),
    prisma.room.findMany({ where: { propertyId, active: true }, orderBy: { number: "asc" } }),
    prisma.reservation.findMany({ where: { propertyId }, include: { guest: true, stay: true }, orderBy: { checkInDate: "asc" } }),
    prisma.workOrder.findMany({ where: { propertyId }, orderBy: { createdAt: "desc" } }),
    prisma.opsStaff.findMany({
      where: { propertyId, ...(user.role === "MANAGER" ? {} : { active: true }) },
      orderBy: [{ active: "desc" }, { name: "asc" }],
    }),
  ]);
  if (!property) fail("ไม่สามารถโหลดข้อมูลที่พักได้", 503);
  const currentDate = propertyToday(property.timezone);
  return {
    user: staffPublic(user), property: { id: property.id, name: property.name, timezone: property.timezone }, currentDate,
    rooms: rooms.map(r => ({ id: r.id, number: r.number, type: r.type, capacity: r.capacity, clean: r.clean, outOfService: r.outOfService })),
    reservations: reservations.map(r => ({ id: r.id, roomId: r.roomId, guestName: r.guest.name, guestContact: r.guest.contact, checkIn: isoDate(r.checkInDate), checkOut: isoDate(r.checkOutDate), partySize: r.partySize, notes: r.notes, status: r.status as OperationsSnapshot["reservations"][number]["status"], checkedInAt: r.stay?.checkedInAt.toISOString() ?? null, checkedOutAt: r.stay?.checkedOutAt?.toISOString() ?? null })),
    workOrders: workOrders.map(w => ({ id: w.id, roomId: w.roomId, type: w.type as "HOUSEKEEPING" | "REPAIR", title: w.title, status: w.status as "OPEN" | "IN_PROGRESS" | "DONE", assigneeId: w.assigneeId, blocksRoom: w.blocksRoom, createdAt: w.createdAt.toISOString() })),
    staff: staff.map(staffPublic),
  };
}

async function scopedRoom(tx: Prisma.TransactionClient, propertyId: string, id: string) {
  const room = await tx.room.findFirst({ where: { id, propertyId, active: true } });
  if (!room) fail("ไม่พบห้องพัก", 404);
  return room;
}
async function scopedAssignee(tx: Prisma.TransactionClient, propertyId: string, id: string | null) {
  if (!id) return null;
  const assignee = await tx.opsStaff.findFirst({ where: { id, propertyId, active: true } });
  if (!assignee) fail("ไม่พบพนักงานที่เลือก", 404);
  return id;
}
async function lockRoom(tx: Prisma.TransactionClient, roomId: string) {
  await tx.$queryRaw`SELECT id FROM "Room" WHERE id = ${roomId} FOR UPDATE`;
}
async function assertNoOverlap(tx: Prisma.TransactionClient, roomId: string, checkInDate: Date, checkOutDate: Date, exceptId?: string) {
  const overlap = await tx.reservation.findFirst({ where: { roomId, id: exceptId ? { not: exceptId } : undefined, status: { in: ["CONFIRMED", "CHECKED_IN"] }, checkInDate: { lt: checkOutDate }, checkOutDate: { gt: checkInDate } }, select: { id: true } });
  if (overlap) fail("ห้องนี้มีการจองอยู่แล้วในช่วงวันที่เลือก", 409);
}
async function reservationFields(tx: Prisma.TransactionClient, propertyId: string, action: Extract<OperationsAction, {action: "createReservation" | "updateReservation"}>, exceptId?: string) {
  const room = await scopedRoom(tx, propertyId, value(action.roomId, "ห้องพัก"));
  const checkInDate = date(action.checkIn), checkOutDate = date(action.checkOut);
  if (checkOutDate <= checkInDate) fail("วันออกต้องอยู่หลังวันเข้า");
  const partySize = positive(action.partySize, "จำนวนผู้เข้าพัก");
  if (partySize > room.capacity) fail("จำนวนผู้เข้าพักเกินความจุของห้อง", 409);
  if (room.outOfService) fail("ห้องนี้งดใช้งาน", 409);
  await lockRoom(tx, room.id);
  const blocking = await tx.workOrder.count({ where: { propertyId, roomId: room.id, type: "REPAIR", blocksRoom: true, status: { not: "DONE" } } });
  if (blocking) fail("ห้องนี้ปิดรับจองระหว่างซ่อม", 409);
  await assertNoOverlap(tx, room.id, checkInDate, checkOutDate, exceptId);
  return { roomId: room.id, checkInDate, checkOutDate, partySize, notes: optional(action.notes), guestName: value(action.guestName, "ชื่อผู้เข้าพัก"), guestContact: optional(action.guestContact, 254) };
}

export async function applyOperationsAction(user: { id: string; propertyId: string }, action: OperationsAction) {
  // Every write for one property enters the same queue. This keeps readiness,
  // reservations, and work order transitions coherent across concurrent requests.
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${user.propertyId}))`;
    const actor = await tx.opsStaff.findFirst({
      where: { id: user.id, propertyId: user.propertyId, active: true },
      select: { id: true, propertyId: true, role: true },
    });
    if (!actor) fail("กรุณาเข้าสู่ระบบ", 401);
    return applyOperationsActionLocked(tx, actor, action);
  }, { timeout: 30000 });
}

async function applyOperationsActionLocked(tx: Prisma.TransactionClient, user: { id: string; propertyId: string; role: string }, action: OperationsAction) {
  if (!action || typeof action !== "object" || typeof action.action !== "string") fail("คำขอไม่ถูกต้อง");
  const propertyId = user.propertyId;
  switch (action.action) {
    case "createRoom": {
      requireManager(user.role);
      await tx.room.create({ data: { propertyId, number: value(action.number, "หมายเลขห้อง", 40), type: value(action.type, "ประเภทห้อง", 80), capacity: positive(action.capacity, "ความจุห้อง") } });
      return;
    }
    case "updateRoom": {
      requireManager(user.role);
      {
        const room = await scopedRoom(tx, propertyId, value(action.id, "ห้องพัก"));
        const capacity = positive(action.capacity, "ความจุห้อง");
        const oversized = await tx.reservation.findFirst({ where: { propertyId, roomId: room.id, status: { in: ["CONFIRMED", "CHECKED_IN"] }, partySize: { gt: capacity } }, select: { id: true } });
        if (oversized) fail("ลดความจุไม่ได้ เพราะมีการจองที่ยังใช้งานอยู่และมีผู้เข้าพักเกินความจุใหม่", 409);
        await tx.room.update({ where: { id: room.id }, data: { number: value(action.number, "หมายเลขห้อง", 40), type: value(action.type, "ประเภทห้อง", 80), capacity, outOfService: action.outOfService } });
      } return;
    }
    case "createReservation": {
      {
        const f = await reservationFields(tx, propertyId, action);
        const guest = await tx.guest.create({ data: { propertyId, name: f.guestName, contact: f.guestContact } });
        await tx.reservation.create({ data: { propertyId, roomId: f.roomId, guestId: guest.id, checkInDate: f.checkInDate, checkOutDate: f.checkOutDate, partySize: f.partySize, notes: f.notes } });
      } return;
    }
    case "updateReservation": {
      {
        const reservation = await tx.reservation.findFirst({ where: { id: value(action.id, "การจอง"), propertyId } });
        if (!reservation) fail("ไม่พบการจอง", 404);
        if (reservation.status !== "CONFIRMED") fail("แก้ไขได้เฉพาะการจองที่ยืนยันแล้วและยังไม่เช็กอิน", 409);
        const f = await reservationFields(tx, propertyId, action, reservation.id);
        await tx.guest.update({ where: { id: reservation.guestId }, data: { name: f.guestName, contact: f.guestContact } });
        await tx.reservation.update({ where: { id: reservation.id }, data: { roomId: f.roomId, checkInDate: f.checkInDate, checkOutDate: f.checkOutDate, partySize: f.partySize, notes: f.notes } });
      } return;
    }
    case "cancelReservation": {
      const result = await tx.reservation.updateMany({ where: { id: value(action.id, "การจอง"), propertyId, status: "CONFIRMED" }, data: { status: "CANCELLED" } });
      if (!result.count) fail("ยกเลิกได้เฉพาะการจองที่ยืนยันแล้วและยังไม่เช็กอิน", 409);
      return;
    }
    case "checkIn": {
      {
        const reservation = await tx.reservation.findFirst({ where: { id: value(action.id, "การจอง"), propertyId } });
        if (!reservation) fail("ไม่พบการจอง", 404);
        const property = await tx.property.findUniqueOrThrow({ where: { id: propertyId } });
        const today = propertyToday(property.timezone);
        if (today < isoDate(reservation.checkInDate) || today >= isoDate(reservation.checkOutDate)) fail("เช็กอินได้เฉพาะในช่วงวันเข้าพักของการจอง", 409);
        await lockRoom(tx, reservation.roomId);
        const room = await scopedRoom(tx, propertyId, reservation.roomId);
        if (reservation.status !== "CONFIRMED" || !room.clean || room.outOfService) fail("ห้องยังไม่พร้อมให้เช็กอิน", 409);
        const blocking = await tx.workOrder.count({ where: { roomId: room.id, propertyId, status: { not: "DONE" }, blocksRoom: true } });
        if (blocking) fail("ห้องนี้ยังมีงานที่ต้องทำก่อนเช็กอิน", 409);
        const occupied = await tx.stay.count({ where: { roomId: room.id, propertyId, checkedOutAt: null } });
        if (occupied) fail("ห้องนี้มีผู้เข้าพักอยู่", 409);
        const changed = await tx.reservation.updateMany({ where: { id: reservation.id, status: "CONFIRMED" }, data: { status: "CHECKED_IN" } });
        if (!changed.count) fail("การจองมีการเปลี่ยนแปลง กรุณารีเฟรชแล้วลองอีกครั้ง", 409);
        await tx.stay.create({ data: { propertyId, reservationId: reservation.id, roomId: room.id } });
      } return;
    }
    case "checkOut": {
      {
        const reservation = await tx.reservation.findFirst({ where: { id: value(action.id, "การจอง"), propertyId } });
        if (!reservation) fail("ไม่พบการจอง", 404);
        await lockRoom(tx, reservation.roomId);
        if (reservation.status !== "CHECKED_IN") fail("การจองนี้ยังไม่ได้เช็กอินหรือเช็กเอาต์แล้ว", 409);
        const stay = await tx.stay.findUnique({ where: { reservationId: reservation.id } });
        if (!stay || stay.checkedOutAt) fail("ไม่พบการเข้าพักที่ยังดำเนินอยู่", 409);
        await tx.stay.update({ where: { id: stay.id }, data: { checkedOutAt: new Date() } });
        await tx.reservation.update({ where: { id: reservation.id }, data: { status: "CHECKED_OUT" } });
        await tx.room.update({ where: { id: reservation.roomId }, data: { clean: false } });
        await tx.workOrder.create({ data: { propertyId, roomId: reservation.roomId, type: "HOUSEKEEPING", status: "OPEN", title: "เตรียมห้องหลังเช็กเอาต์", blocksRoom: true } });
      } return;
    }
    case "createWorkOrder": {
      {
        const room = await scopedRoom(tx, propertyId, value(action.roomId, "ห้องพัก"));
        if (action.type !== "HOUSEKEEPING" && action.type !== "REPAIR") fail("ประเภทงานไม่ถูกต้อง");
        const assigneeId = await scopedAssignee(tx, propertyId, action.assigneeId);
        await tx.workOrder.create({ data: { propertyId, roomId: room.id, type: action.type, title: value(action.title, "รายละเอียดงาน"), assigneeId, blocksRoom: action.blocksRoom === true } });
        if (action.type === "HOUSEKEEPING") await tx.room.update({ where: { id: room.id }, data: { clean: false } });
      } return;
    }
    case "updateWorkOrder": {
      {
        const work = await tx.workOrder.findFirst({ where: { id: value(action.id, "รายการงาน"), propertyId } });
        if (!work) fail("ไม่พบรายการงาน", 404);
        if (!["OPEN", "IN_PROGRESS", "DONE"].includes(action.status)) fail("สถานะงานไม่ถูกต้อง");
        if (work.status === "DONE" && action.status !== "DONE") fail("งานที่เสร็จแล้วไม่สามารถเปิดใหม่ได้", 409);
        const assigneeId = await scopedAssignee(tx, propertyId, action.assigneeId);
        await tx.workOrder.update({ where: { id: work.id }, data: { status: action.status, assigneeId, completedAt: action.status === "DONE" ? new Date() : null } });
        if (work.type === "HOUSEKEEPING" && action.status === "DONE") {
          const other = await tx.workOrder.count({ where: { roomId: work.roomId, propertyId, type: "HOUSEKEEPING", status: { not: "DONE" } } });
          if (!other) await tx.room.update({ where: { id: work.roomId }, data: { clean: true } });
        }
      } return;
    }
    case "updateProperty": {
      requireManager(user.role);
      await tx.property.update({ where: { id: propertyId }, data: { name: value(action.name, "ชื่อที่พัก", 120) } }); return;
    }
    case "createStaff": {
      requireManager(user.role);
      if (action.role !== "MANAGER" && action.role !== "STAFF") fail("สิทธิ์พนักงานไม่ถูกต้อง");
      const password = action.password;
      if (typeof password !== "string" || password.length < 10 || new TextEncoder().encode(password).length > 72) fail("รหัสผ่านต้องมีอย่างน้อย 10 ตัวอักษร และมีขนาดไม่เกิน 72 ไบต์");
      await tx.opsStaff.create({ data: { propertyId, name: value(action.name, "ชื่อพนักงาน"), email: email(action.email), passwordHash: await opsHash(password), role: action.role } }); return;
    }
    case "deactivateStaff": {
      requireManager(user.role);
      const staff = await tx.opsStaff.findFirst({
        where: { id: action.id, propertyId },
        select: { id: true, role: true, active: true },
      });
      if (!staff) fail("ไม่พบพนักงานที่เลือก", 404);
      if (staff.role !== "STAFF") fail("ปิดใช้งานได้เฉพาะบัญชีพนักงาน", 409);
      if (!staff.active) return;

      await tx.opsStaff.update({ where: { id: staff.id }, data: { active: false } });
      await tx.workOrder.updateMany({
        where: { propertyId, assigneeId: staff.id, status: { in: ["OPEN", "IN_PROGRESS"] } },
        data: { assigneeId: null },
      });
      return;
    }
    default: fail("คำขอไม่ถูกต้อง");
  }
}
