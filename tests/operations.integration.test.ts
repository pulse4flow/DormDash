import assert from "node:assert/strict";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import type { OperationsSnapshot } from "../lib/operations-types";

const databaseUrl = process.env.OPS_TEST_DATABASE_URL;
const appDatabaseUrl = process.env.DATABASE_URL;
const baseUrl = process.env.OPS_TEST_BASE_URL ?? "http://127.0.0.1:3100";

function assertIsolatedEnvironment() {
  assert.ok(databaseUrl, "OPS_TEST_DATABASE_URL is required; use a disposable local test database");
  const parsed = new URL(databaseUrl);
  assert.match(parsed.protocol, /^postgres(ql)?:$/);
  assert.ok(["127.0.0.1", "localhost", "::1"].includes(parsed.hostname), "Test database must be local");
  assert.match(parsed.pathname, /test/i, "Test database name must contain 'test'");
  assert.equal(appDatabaseUrl, databaseUrl, "App and test must point to the same isolated database");
  const appUrl = new URL(baseUrl);
  assert.ok(["127.0.0.1", "localhost", "::1"].includes(appUrl.hostname), "Test app must be local");
  assert.ok(process.env.ADMIN_REGISTRATION_KEY, "ADMIN_REGISTRATION_KEY is required");
}

assertIsolatedEnvironment();
const prisma = new PrismaClient();
const unique = `ops-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

type Json = Record<string, unknown>;

async function request(path: string, method = "GET", body?: Json, cookie?: string) {
  const response = await fetch(new URL(path, baseUrl), {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  const text = await response.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = text; }
  return { response, data, cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "" };
}

async function action(body: Json, cookie: string, expected = 200) {
  const result = await request("/api/operations", "POST", body, cookie);
  assert.equal(result.response.status, expected, JSON.stringify(result.data));
  return result.data;
}

async function snapshot(cookie: string) {
  const result = await request("/api/operations", "GET", undefined, cookie);
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  return result.data as OperationsSnapshot;
}

function day(offset: number) {
  const now = new Date();
  const bangkok = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Bangkok" }));
  bangkok.setDate(bangkok.getDate() + offset);
  return `${bangkok.getFullYear()}-${String(bangkok.getMonth() + 1).padStart(2, "0")}-${String(bangkok.getDate()).padStart(2, "0")}`;
}

test("operations HTTP journey, isolation, authorization, and concurrency", { timeout: 120_000 }, async (t) => {
  try {
    const anonymous = await request("/api/operations");
    assert.equal(anonymous.response.status, 401);

    const managerEmail = `${unique}-manager@example.test`;
    const password = "Test-password-12345";
    const setup = await request("/api/operations/setup", "POST", {
      registrationKey: process.env.ADMIN_REGISTRATION_KEY,
      propertyName: `${unique} property`, timezone: "Asia/Bangkok",
      name: "Test Manager", email: managerEmail, password,
    });
    let managerCookie = setup.cookie;
    if (setup.response.status === 409) {
      // A previous run already bootstrapped this disposable database.
      const property = await prisma.property.create({ data: { name: `${unique} property`, timezone: "Asia/Bangkok" } });
      await prisma.opsStaff.create({ data: {
        propertyId: property.id, name: "Test Manager", email: managerEmail,
        role: "MANAGER", passwordHash: await bcrypt.hash(password, 10),
      } });
      const login = await request("/api/operations/session", "POST", { email: managerEmail, password });
      assert.equal(login.response.status, 200, JSON.stringify(login.data));
      managerCookie = login.cookie;
    } else {
      assert.equal(setup.response.status, 201, JSON.stringify(setup.data));
    }
    assert.ok(managerCookie);

    await t.test("setup and login are guarded", async () => {
      const wrongKey = await request("/api/operations/setup", "POST", {
        registrationKey: "wrong-key", propertyName: "Unauthorized", timezone: "Asia/Bangkok",
        name: "Other", email: `wrong-${unique}@example.test`, password,
      });
      assert.equal(wrongKey.response.status, 403);
      const repeat = await request("/api/operations/setup", "POST", {
        registrationKey: process.env.ADMIN_REGISTRATION_KEY,
        propertyName: "Second setup", timezone: "Asia/Bangkok",
        name: "Other", email: `other-${unique}@example.test`, password,
      });
      assert.equal(repeat.response.status, 409);
      const denied = await request("/api/operations/session", "POST", { email: managerEmail, password: "incorrect" });
      assert.equal(denied.response.status, 401);
      const login = await request("/api/operations/session", "POST", { email: managerEmail, password });
      assert.equal(login.response.status, 200, JSON.stringify(login.data));
      assert.ok(login.cookie);
    });

    const staffEmail = `${unique}-staff@example.test`;
    await action({ action: "createStaff", name: "Front Desk", email: staffEmail, password, role: "STAFF" }, managerCookie);
    const staffLogin = await request("/api/operations/session", "POST", { email: staffEmail, password });
    assert.equal(staffLogin.response.status, 200, JSON.stringify(staffLogin.data));
    const staffCookie = staffLogin.cookie;

    await t.test("roles and property boundaries", async () => {
      await action({ action: "createRoom", number: `${unique}-A`, type: "Standard", capacity: 2 }, staffCookie, 403);
      await action({ action: "updateProperty", name: "Unauthorized rename" }, staffCookie, 403);
      await action({ action: "createRoom", number: `${unique}-scope`, type: "Standard", capacity: 2 }, managerCookie);
      const own = await snapshot(managerCookie);
      const ownRoom = own.rooms.find((room) => room.number === `${unique}-scope`);
      assert.ok(ownRoom);
      const foreignProperty = await prisma.property.create({ data: { name: `${unique} foreign`, timezone: "Asia/Bangkok" } });
      const foreignRoom = await prisma.room.create({ data: { propertyId: foreignProperty.id, number: `${unique}-foreign`, type: "Standard", capacity: 2 } });
      await prisma.opsStaff.create({ data: { propertyId: foreignProperty.id, name: "Foreign", email: `${unique}-foreign@example.test`, role: "MANAGER", passwordHash: await bcrypt.hash(password, 10) } });
      const visible = await snapshot(managerCookie);
      assert.equal(visible.property.id, own.property.id);
      assert.ok(!visible.rooms.some((room) => room.id === foreignRoom.id));
      await action({ action: "updateRoom", id: foreignRoom.id, number: "stolen", type: "Standard", capacity: 2, outOfService: false }, managerCookie, 404);
      const foreignBooking = await request("/api/operations", "POST", {
        action: "createReservation", roomId: foreignRoom.id, guestName: "Foreign Guest", guestContact: "",
        checkIn: day(20), checkOut: day(21), partySize: 1, notes: "",
      }, staffCookie);
      assert.notEqual(foreignBooking.response.status, 200);
      const foreignStaff = await prisma.opsStaff.findUniqueOrThrow({ where: { email: `${unique}-foreign@example.test` } });
      const foreignAssignment = await request("/api/operations", "POST", {
        action: "createWorkOrder", roomId: ownRoom.id,
        type: "REPAIR", title: "Foreign assignee", assigneeId: foreignStaff.id, blocksRoom: false,
      }, staffCookie);
      assert.notEqual(foreignAssignment.response.status, 200);
      const foreignReservation = await prisma.reservation.create({ data: {
        propertyId: foreignProperty.id, roomId: foreignRoom.id,
        guestId: (await prisma.guest.create({ data: { propertyId: foreignProperty.id, name: "Foreign Guest" } })).id,
        checkInDate: new Date(`${day(22)}T00:00:00.000Z`), checkOutDate: new Date(`${day(23)}T00:00:00.000Z`),
      } });
      const foreignCancel = await request("/api/operations", "POST", { action: "cancelReservation", id: foreignReservation.id }, staffCookie);
      assert.notEqual(foreignCancel.response.status, 200);
      assert.equal((await prisma.reservation.findUniqueOrThrow({ where: { id: foreignReservation.id } })).status, "CONFIRMED");
    });

    await t.test("request origin and JSON are checked", async () => {
      const sameOrigin = await fetch(new URL("/api/operations", baseUrl), {
        method: "POST", headers: { origin: new URL(baseUrl).origin, cookie: managerCookie, "content-type": "application/json" },
        body: JSON.stringify({ action: "updateProperty", name: `${unique} property` }),
      });
      assert.equal(sameOrigin.status, 200);
      const badOrigin = await fetch(new URL("/api/operations", baseUrl), {
        method: "POST", headers: { origin: "https://invalid.example", cookie: managerCookie, "content-type": "application/json" },
        body: JSON.stringify({ action: "updateProperty", name: "Bad origin" }),
      });
      assert.equal(badOrigin.status, 403);
      const badJson = await fetch(new URL("/api/operations", baseUrl), {
        method: "POST", headers: { cookie: managerCookie, "content-type": "application/json" }, body: "{",
      });
      assert.equal(badJson.status, 400);
    });

    await action({ action: "createRoom", number: `${unique}-101`, type: "Standard", capacity: 2 }, managerCookie);
    const state = await snapshot(managerCookie);
    const room = state.rooms.find((item) => item.number === `${unique}-101`);
    assert.ok(room);

    const reservation = (start: string, end: string, guestName: string) => ({
      action: "createReservation", roomId: room.id, guestName, guestContact: "0123456789",
      checkIn: start, checkOut: end, partySize: 2, notes: "integration test",
    });

    await t.test("date validation, overlap, and concurrent booking", async () => {
      await action(reservation(day(2), day(2), "Invalid Dates"), staffCookie, 400);
      await action(reservation(day(5), day(3), "Reverse Dates"), staffCookie, 400);
      const results = await Promise.all([
        request("/api/operations", "POST", reservation(day(10), day(12), "Concurrent A"), staffCookie),
        request("/api/operations", "POST", reservation(day(11), day(13), "Concurrent B"), staffCookie),
      ]);
      assert.deepEqual(results.map(({ response }) => response.status).sort(), [200, 409], results.map((r) => JSON.stringify(r.data)).join("; "));
      await action(reservation(day(13), day(14), "Adjacent Booking"), staffCookie);
      await action(reservation(day(30), day(32), "To cancel"), staffCookie);
      const toCancel = (await snapshot(staffCookie)).reservations.find((item) => item.guestName === "To cancel");
      assert.ok(toCancel);
      await action({ action: "cancelReservation", id: toCancel.id }, staffCookie);
      await action(reservation(day(30), day(32), "Replacement after cancellation"), staffCookie);
      const future = (await snapshot(staffCookie)).reservations.find((item) => item.guestName === "Adjacent Booking");
      assert.ok(future);
      await action({ action: "checkIn", id: future.id }, staffCookie, 409);
      await action(reservation(day(-3), day(-2), "Expired Booking"), staffCookie);
      const expired = (await snapshot(staffCookie)).reservations.find((item) => item.guestName === "Expired Booking");
      assert.ok(expired);
      await action({ action: "checkIn", id: expired.id }, staffCookie, 409);
    });

    await t.test("check-in, check-out, housekeeping, and blocking repair", async () => {
      await action(reservation(day(0), day(1), "Current Guest"), staffCookie);
      let current = await snapshot(managerCookie);
      const stay = current.reservations.find((item) => item.guestName === "Current Guest");
      assert.ok(stay);
      await action({ action: "checkIn", id: stay.id }, staffCookie);
      current = await snapshot(managerCookie);
      assert.equal(current.reservations.find((item) => item.id === stay.id)?.status, "CHECKED_IN");
      await action({ action: "checkOut", id: stay.id }, staffCookie);
      current = await snapshot(managerCookie);
      assert.equal(current.reservations.find((item) => item.id === stay.id)?.status, "CHECKED_OUT");
      assert.equal(current.rooms.find((item) => item.id === room.id)?.clean, false);
      const housekeeping = current.workOrders.find((item) => item.roomId === room.id && item.type === "HOUSEKEEPING" && item.status !== "DONE");
      assert.ok(housekeeping);
      const housekeepingCount = current.workOrders.filter((item) => item.roomId === room.id && item.type === "HOUSEKEEPING").length;
      await action({ action: "checkOut", id: stay.id }, staffCookie, 409);
      assert.equal((await snapshot(managerCookie)).workOrders.filter((item) => item.roomId === room.id && item.type === "HOUSEKEEPING").length, housekeepingCount);
      await action({ action: "updateWorkOrder", id: housekeeping.id, status: "DONE", assigneeId: null }, staffCookie);
      current = await snapshot(managerCookie);
      assert.equal(current.rooms.find((item) => item.id === room.id)?.clean, true);
      await action({ action: "createWorkOrder", roomId: room.id, type: "REPAIR", title: "Blocked fixture", assigneeId: null, blocksRoom: true }, staffCookie);
      current = await snapshot(managerCookie);
      const repair = current.workOrders.find((item) => item.roomId === room.id && item.type === "REPAIR" && item.status !== "DONE");
      assert.ok(repair);
      assert.equal(current.rooms.find((item) => item.id === room.id)?.outOfService, false);
      await action(reservation(day(20), day(21), "Blocked by repair"), staffCookie, 409);
      await action({ action: "updateRoom", id: room.id, number: room.number, type: room.type, capacity: room.capacity, outOfService: true }, managerCookie);
      await action({ action: "updateWorkOrder", id: repair.id, status: "DONE", assigneeId: null }, staffCookie);
      current = await snapshot(managerCookie);
      assert.equal(current.rooms.find((item) => item.id === room.id)?.outOfService, true);
    });
  } finally {
    await prisma.$disconnect();
  }
});
