"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
import type { OperationsAction, OperationsReservation, OperationsRoom, OperationsSnapshot, OperationsWorkOrder, WorkStatus } from "@/lib/operations-types";

type Tab = "today" | "rooms" | "reservations" | "work" | "settings";
const tabs: [Tab, string][] = [["today", "วันนี้"], ["rooms", "ห้องพัก"], ["reservations", "การจอง"], ["work", "งานทีม"], ["settings", "ตั้งค่า"]];
const statusText: Record<string, string> = { CONFIRMED: "ยืนยันแล้ว", CHECKED_IN: "เข้าพัก", CHECKED_OUT: "ออกแล้ว", CANCELLED: "ยกเลิก", OPEN: "รอดำเนินการ", IN_PROGRESS: "กำลังทำ", DONE: "เสร็จแล้ว" };
const workTypeText = { HOUSEKEEPING: "ทำความสะอาด", REPAIR: "ซ่อมบำรุง" };
const field = (data: FormData, key: string) => String(data.get(key) ?? "").trim();
const numberField = (data: FormData, key: string) => Number(data.get(key));

async function readResponse(response: Response) {
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof data?.error === "string" ? data.error : `คำขอไม่สำเร็จ (${response.status})`);
  return data;
}

function Badge({ value }: { value: string }) { return <span className={`op-badge op-badge-${value.toLowerCase()}`}>{statusText[value] ?? value}</span>; }
function Empty({ children }: { children: React.ReactNode }) { return <p className="op-empty">{children}</p>; }
function FormButton({ busy, children }: { busy: boolean; children: React.ReactNode }) { return <button disabled={busy} type="submit">{busy ? "กำลังบันทึก…" : children}</button>; }

export function OperationsApp() {
  const [snapshot, setSnapshot] = useState<OperationsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [authMode, setAuthMode] = useState<"login" | "setup">("login");
  const [tab, setTab] = useState<Tab>("today");
  const [selectedDate, setSelectedDate] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingRoom, setEditingRoom] = useState<OperationsRoom | null>(null);
  const [editingReservation, setEditingReservation] = useState<OperationsReservation | null>(null);
  const [staffToDeactivate, setStaffToDeactivate] = useState<string | null>(null);

  function resetWorkspace() {
    setTab("today"); setSelectedDate("");
    setEditingRoom(null); setEditingReservation(null);
    setStaffToDeactivate(null);
  }

  const load = useCallback(async () => {
    const response = await fetch("/api/operations", { cache: "no-store" });
    if (response.status === 401) {
      setSnapshot(null); setTab("today"); setSelectedDate("");
      setEditingRoom(null); setEditingReservation(null); setStaffToDeactivate(null); return;
    }
    const fresh = await readResponse(response) as OperationsSnapshot;
    setSnapshot(fresh);
    setLastRefreshed(new Date());
  }, []);
  useEffect(() => { load().catch((cause) => setError(cause.message)).finally(() => setLoading(false)); }, [load]);

  async function submitAction(action: OperationsAction, success = "บันทึกแล้ว") {
    if (busy) return false;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/operations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action) });
      if (response.status === 401) { await load(); throw new Error("เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง"); }
      await readResponse(response);
      await load();
      setNotice(success); return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "เกิดข้อผิดพลาด"); return false; }
    finally { setBusy(false); }
  }
  async function submitSession(event: FormEvent<HTMLFormElement>, setup: boolean) {
    event.preventDefault(); if (busy) return;
    const form = event.currentTarget; const data = new FormData(form);
    const payload = setup ? { registrationKey: String(data.get("registrationKey") ?? ""), propertyName: field(data, "propertyName"), timezone: field(data, "timezone"), name: field(data, "name"), email: field(data, "email"), password: String(data.get("password") ?? "") } : { email: field(data, "email"), password: String(data.get("password") ?? "") };
    setBusy(true); setError("");
    try {
      await readResponse(await fetch(setup ? "/api/operations/setup" : "/api/operations/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }));
      resetWorkspace(); await load(); form.reset();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "เข้าสู่ระบบไม่สำเร็จ"); }
    finally { setBusy(false); }
  }
  async function logout() {
    if (busy) return; setBusy(true); setError("");
    try { await readResponse(await fetch("/api/operations/session", { method: "DELETE" })); setSnapshot(null); resetWorkspace(); setNotice(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "ออกจากระบบไม่สำเร็จ"); }
    finally { setBusy(false); }
  }

  const activeReservations = useMemo(() => snapshot?.reservations.filter((r) => r.status !== "CANCELLED") ?? [], [snapshot]);
  const occupancy = (roomId: string) => activeReservations.find((r) => r.roomId === roomId && r.status === "CHECKED_IN");
  const roomState = (room: OperationsRoom) => {
    if (room.outOfService) return "งดใช้งาน";
    if (occupancy(room.id)) return "มีผู้เข้าพัก";
    if (snapshot?.workOrders.some((w) => w.roomId === room.id && w.type === "REPAIR" && w.blocksRoom && w.status !== "DONE")) return "ติดงานซ่อม";
    if (!room.clean) return "รอทำความสะอาด";
    return "พร้อมใช้งาน";
  };
  const canCheckIn = (reservation: OperationsReservation) => {
    const room = snapshot?.rooms.find((item) => item.id === reservation.roomId);
    return !!room && reservation.checkIn <= (snapshot?.currentDate ?? "") && (snapshot?.currentDate ?? "") < reservation.checkOut && roomState(room) === "พร้อมใช้งาน";
  };
  const manager = snapshot?.user.role === "MANAGER";
  const roomName = (id: string) => snapshot?.rooms.find((r) => r.id === id)?.number ?? "—";
  const activeStaff = snapshot?.staff.filter((staff) => staff.active) ?? [];
  const staffName = (id: string | null) => id
    ? snapshot?.staff.find((staff) => staff.id === id)?.name ?? "บัญชีที่ปิดใช้งาน"
    : "ยังไม่มอบหมาย";
  const date = selectedDate || snapshot?.currentDate || "";
  const isToday = date === snapshot?.currentDate;
  const arrivals = activeReservations.filter((r) => r.checkIn === date && r.status === "CONFIRMED");
  const departures = activeReservations
    .filter((r) => r.status === "CHECKED_IN" && (r.checkOut === date || (isToday && r.checkOut < date)))
    .sort((a, b) => a.checkOut.localeCompare(b.checkOut));
  const openWorks = snapshot?.workOrders.filter((w) => w.status !== "DONE") ?? [];

  async function reservationSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    const common = { roomId: field(data, "roomId"), guestName: field(data, "guestName"), guestContact: field(data, "guestContact"), checkIn: field(data, "checkIn"), checkOut: field(data, "checkOut"), partySize: numberField(data, "partySize"), notes: field(data, "notes") };
    if (common.checkOut <= common.checkIn) { setError("วันออกต้องอยู่หลังวันเข้า"); return; }
    const ok = await submitAction(editingReservation ? { action: "updateReservation", id: editingReservation.id, ...common } : { action: "createReservation", ...common }, editingReservation ? "แก้ไขการจองแล้ว" : "เพิ่มการจองแล้ว");
    if (ok) { form.reset(); setEditingReservation(null); }
  }
  async function roomSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    const common = { number: field(data, "number"), type: field(data, "type"), capacity: numberField(data, "capacity") };
    const ok = await submitAction(editingRoom ? { action: "updateRoom", id: editingRoom.id, ...common, outOfService: data.get("outOfService") === "on" } : { action: "createRoom", ...common });
    if (ok) { form.reset(); setEditingRoom(null); }
  }
  async function workSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    const ok = await submitAction({ action: "createWorkOrder", roomId: field(data, "roomId"), type: field(data, "type") as "HOUSEKEEPING" | "REPAIR", title: field(data, "title"), assigneeId: field(data, "assigneeId") || null, blocksRoom: data.get("blocksRoom") === "on" });
    if (ok) form.reset();
  }
  async function basicSubmit(event: FormEvent<HTMLFormElement>, make: (data: FormData) => OperationsAction) {
    event.preventDefault(); const form = event.currentTarget;
    if (await submitAction(make(new FormData(form)))) form.reset();
  }
  function cancelReservation(id: string) { if (window.confirm("ยืนยันยกเลิกการจองนี้หรือไม่?")) void submitAction({ action: "cancelReservation", id }, "ยกเลิกการจองแล้ว"); }
  async function deactivateStaff(id: string) {
    if (await submitAction({ action: "deactivateStaff", id }, "ปิดบัญชีพนักงานแล้ว")) {
      setStaffToDeactivate(null);
    }
  }
  function updateWork(order: OperationsWorkOrder, patch: { status?: WorkStatus; assigneeId?: string | null }) { void submitAction({ action: "updateWorkOrder", id: order.id, status: patch.status ?? order.status, assigneeId: patch.assigneeId === undefined ? order.assigneeId : patch.assigneeId }); }

  return <div className="op-app">
    <header className="op-header"><div className="op-header-inner"><Link href="/" className="op-brand">DormDash <span>Operations</span></Link><div className="op-header-actions"><ThemeToggle />{snapshot && <><span className="op-user">{snapshot.user.name} · {manager ? "ผู้จัดการ" : "พนักงาน"}</span><button type="button" className="op-quiet" onClick={logout} disabled={busy}>ออกจากระบบ</button></>}</div></div></header>
    <main className="op-main">
      {error && <div role="alert" className="op-feedback op-feedback-error">{error}</div>}{notice && <div role="status" className="op-feedback op-feedback-success">{notice}</div>}
      {loading ? <div className="op-panel"><p role="status">กำลังโหลดข้อมูล…</p></div> : !snapshot ? <section className="op-auth op-panel"><p className="op-eyebrow">จัดการที่พัก</p><h1>{authMode === "login" ? "เข้าสู่ระบบ" : "เริ่มตั้งค่าที่พัก"}</h1><p className="op-muted">จัดการห้อง การจอง และงานประจำวันในที่เดียว</p><div className="op-tabs" role="tablist" aria-label="วิธีเข้าสู่ระบบ"><button type="button" role="tab" aria-selected={authMode === "login"} className={authMode === "login" ? "active" : ""} onClick={() => { setAuthMode("login"); setError(""); }}>เข้าสู่ระบบ</button><button type="button" role="tab" aria-selected={authMode === "setup"} className={authMode === "setup" ? "active" : ""} onClick={() => { setAuthMode("setup"); setError(""); }}>ตั้งค่าครั้งแรก</button></div><form key={authMode} className="op-form" onSubmit={(event) => submitSession(event, authMode === "setup")}>
        {authMode === "setup" && <><label>รหัสสำหรับตั้งค่าระบบ<input name="registrationKey" type="password" required autoComplete="off" /></label><label>ชื่อที่พัก<input name="propertyName" required maxLength={120} /></label><label>เขตเวลา<input name="timezone" defaultValue="Asia/Bangkok" required /></label><label>ชื่อผู้จัดการ<input name="name" required maxLength={100} /></label></>}
        <label>อีเมล<input name="email" type="email" required autoComplete="email" /></label><label>รหัสผ่าน<input name="password" type="password" required minLength={authMode === "setup" ? 10 : undefined} maxLength={authMode === "setup" ? 72 : undefined} autoComplete={authMode === "login" ? "current-password" : "new-password"} /></label><FormButton busy={busy}>{authMode === "login" ? "เข้าสู่ระบบ" : "สร้างที่พัก"}</FormButton></form></section> : <>
        <div className="op-hero"><div><p className="op-eyebrow">พื้นที่ทำงาน · {snapshot.property.timezone}</p><h1>{snapshot.property.name}</h1><p>ข้อมูลห้องพัก การจอง และงานทีมล่าสุด</p></div><div className="op-refresh"><span>อัปเดตล่าสุด {lastRefreshed ? lastRefreshed.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }) : "—"}</span><button type="button" className="op-refresh-button" disabled={busy} onClick={() => { setError(""); load().catch((cause) => setError(cause.message)); }}>รีเฟรช</button></div></div>
        <nav className="op-nav" aria-label="เมนูปฏิบัติการ">{tabs.filter(([key]) => key !== "settings" || manager).map(([key, label]) => <button type="button" key={key} aria-current={tab === key ? "page" : undefined} className={tab === key ? "active" : ""} onClick={() => { setTab(key); setStaffToDeactivate(null); setError(""); setNotice(""); }}>{label}</button>)}</nav>
        {tab === "today" && <div className="op-stack">
          <div className="op-section-heading">
            <div><p className="op-eyebrow">ภาพรวมรายวัน</p><h2>วันนี้</h2></div>
            <label className="op-date-filter">เลือกวันที่
              <input aria-label="เลือกวันที่" type="date" value={date} onChange={(event) => {
                const nextDate = event.target.value;
                setSelectedDate(nextDate === snapshot.currentDate ? "" : nextDate);
              }} />
            </label>
          </div>
          <div className="op-stat-grid">
            <div><strong>{arrivals.length}</strong><span>รอเช็กอิน</span></div>
            <div><strong>{departures.length}</strong><span>รอเช็กเอาต์</span></div>
            <div><strong>{snapshot.rooms.filter((r) => roomState(r) === "พร้อมใช้งาน").length}</strong><span>ห้องพร้อมตอนนี้</span></div>
            <div><strong>{openWorks.length}</strong><span>งานค้างตอนนี้</span></div>
          </div>
          <div className="op-two-cols">
            <section className="op-panel">
              <h3>ผู้มาถึงวันที่เลือก</h3>
              {arrivals.length ? arrivals.map((r) => <div className="op-row" key={r.id}>
                <div><strong>ห้อง {roomName(r.roomId)} · {r.guestName}</strong><small>เข้า {r.checkIn} · ออก {r.checkOut}</small></div>
                <button disabled={busy || !canCheckIn(r)} title="เช็กอินได้ในช่วงวันเข้าพักเมื่อห้องพร้อม"
                  onClick={() => void submitAction({ action: "checkIn", id: r.id }, "เช็กอินแล้ว")}>เช็กอิน</button>
              </div>) : <Empty>ไม่มีรายการรอเช็กอิน</Empty>}
            </section>
            <section className="op-panel">
              <h3>{isToday ? "รอเช็กเอาต์วันนี้และรายการค้าง" : "ผู้มีกำหนดออกวันที่เลือก"}</h3>
              {departures.length ? departures.map((r) => <div className="op-row" key={r.id}>
                <div>
                  <strong>ห้อง {roomName(r.roomId)} · {r.guestName}</strong>
                  <small>กำหนดออก {r.checkOut}</small>
                </div>
                <div className="op-row-actions">
                  {r.checkOut < snapshot.currentDate && <span className="op-badge op-badge-open">เลยกำหนดเช็กเอาต์</span>}
                  <button disabled={busy} onClick={() => void submitAction({ action: "checkOut", id: r.id }, "เช็กเอาต์แล้ว")}>เช็กเอาต์</button>
                </div>
              </div>) : <Empty>ไม่มีรายการรอเช็กเอาต์</Empty>}
            </section>
          </div>
          <section className="op-panel">
            <h3>งานที่ยังไม่เสร็จ</h3>
            {openWorks.length ? openWorks.slice(0, 8).map((w) => <div className="op-row" key={w.id}>
              <div><strong>ห้อง {roomName(w.roomId)} · {w.title}</strong><small>{workTypeText[w.type]} · {staffName(w.assigneeId)}</small></div>
              <Badge value={w.status} />
            </div>) : <Empty>ไม่มีงานค้าง</Empty>}
          </section>
        </div>}
        {tab === "rooms" && <div className="op-stack"><div className="op-section-heading"><div><p className="op-eyebrow">ห้องและความพร้อม</p><h2>ห้องพัก</h2></div><span className="op-muted">ทั้งหมด {snapshot.rooms.length} ห้อง</span></div><div className="op-room-grid">{snapshot.rooms.map((room) => <article className="op-panel op-room" key={room.id}><div className="op-room-head"><strong>ห้อง {room.number}</strong><span className="op-state">{roomState(room)}</span></div><p>{room.type} · พักได้ {room.capacity} คน</p><small>{room.clean ? "สะอาด" : "รอทำความสะอาด"}{room.outOfService ? " · งดใช้งาน" : ""}</small>{manager && <button type="button" className="op-quiet" onClick={() => setEditingRoom(room)}>แก้ไขห้อง</button>}</article>)}{!snapshot.rooms.length && <Empty>ยังไม่มีห้องพัก</Empty>}</div>{manager && <section className="op-panel"><h3>{editingRoom ? `แก้ไขห้อง ${editingRoom.number}` : "เพิ่มห้องพัก"}</h3><form key={editingRoom?.id ?? "new-room"} className="op-form op-form-grid" onSubmit={roomSubmit}><label>หมายเลขห้อง<input name="number" required maxLength={30} defaultValue={editingRoom?.number} /></label><label>ประเภทห้อง<input name="type" required maxLength={80} defaultValue={editingRoom?.type} /></label><label>จำนวนผู้เข้าพักสูงสุด<input name="capacity" type="number" min="1" max="100" required defaultValue={editingRoom?.capacity ?? 2} /></label>{editingRoom && <label className="op-check"><input name="outOfService" type="checkbox" defaultChecked={editingRoom.outOfService} /> งดใช้งานห้องนี้</label>}<div className="op-form-actions"><FormButton busy={busy}>{editingRoom ? "บันทึกการแก้ไข" : "เพิ่มห้อง"}</FormButton>{editingRoom && <button type="button" className="op-quiet" onClick={() => setEditingRoom(null)}>ยกเลิก</button>}</div></form></section>}</div>}
        {tab === "reservations" && <div className="op-stack"><div className="op-section-heading"><div><p className="op-eyebrow">รายการเข้าพัก</p><h2>การจอง</h2></div></div><section className="op-panel"><h3>{editingReservation ? "แก้ไขการจอง" : "เพิ่มการจอง"}</h3><form key={editingReservation?.id ?? "new-reservation"} className="op-form op-form-grid" onSubmit={reservationSubmit}><label>ห้อง<select name="roomId" required defaultValue={editingReservation?.roomId ?? ""}><option value="" disabled>เลือกห้อง</option>{snapshot.rooms.map((r) => <option key={r.id} value={r.id}>ห้อง {r.number} · {r.type} ({r.capacity} คน)</option>)}</select></label><label>ชื่อผู้เข้าพัก<input name="guestName" required maxLength={120} defaultValue={editingReservation?.guestName} /></label><label>ช่องทางติดต่อ (ไม่บังคับ)<input name="guestContact" maxLength={200} defaultValue={editingReservation?.guestContact} /></label><label>จำนวนผู้เข้าพัก<input name="partySize" type="number" min="1" max="100" required defaultValue={editingReservation?.partySize ?? 1} /></label><label>วันเข้า<input name="checkIn" type="date" required defaultValue={editingReservation?.checkIn} /></label><label>วันออก<input name="checkOut" type="date" required defaultValue={editingReservation?.checkOut} /></label><label className="op-wide">หมายเหตุ<textarea name="notes" rows={2} maxLength={1000} defaultValue={editingReservation?.notes} /></label><div className="op-form-actions"><FormButton busy={busy}>{editingReservation ? "บันทึกการแก้ไข" : "เพิ่มการจอง"}</FormButton>{editingReservation && <button type="button" className="op-quiet" onClick={() => setEditingReservation(null)}>ยกเลิก</button>}</div></form></section><section className="op-panel"><h3>การจองทั้งหมด</h3>{snapshot.reservations.length ? snapshot.reservations.map((r) => <div className="op-row op-reservation" key={r.id}><div><strong>ห้อง {roomName(r.roomId)} · {r.guestName}</strong><small>{r.checkIn} → {r.checkOut} · {r.partySize} คน · {r.guestContact}</small>{r.notes && <small>{r.notes}</small>}</div><div className="op-row-actions"><Badge value={r.status} />{r.status === "CONFIRMED" && <><button disabled={busy} className="op-quiet" onClick={() => setEditingReservation(r)}>แก้ไข</button><button disabled={busy || !canCheckIn(r)} title="เช็กอินได้ในช่วงวันเข้าพักเมื่อห้องพร้อม" onClick={() => void submitAction({ action: "checkIn", id: r.id }, "เช็กอินแล้ว")}>เช็กอิน</button><button disabled={busy} className="op-danger" onClick={() => cancelReservation(r.id)}>ยกเลิก</button></>}{r.status === "CHECKED_IN" && <button disabled={busy} onClick={() => void submitAction({ action: "checkOut", id: r.id }, "เช็กเอาต์แล้ว")}>เช็กเอาต์</button>}</div></div>) : <Empty>ยังไม่มีการจอง</Empty>}</section></div>}
        {tab === "work" && <div className="op-stack"><div className="op-section-heading"><div><p className="op-eyebrow">งานแม่บ้านและซ่อมบำรุง</p><h2>งานทีม</h2></div></div><section className="op-panel"><h3>สร้างงาน</h3><form className="op-form op-form-grid" onSubmit={workSubmit}><label>ห้อง<select name="roomId" required defaultValue=""><option value="" disabled>เลือกห้อง</option>{snapshot.rooms.map((r) => <option key={r.id} value={r.id}>ห้อง {r.number}</option>)}</select></label><label>ประเภท<select name="type" defaultValue="HOUSEKEEPING"><option value="HOUSEKEEPING">ทำความสะอาด</option><option value="REPAIR">ซ่อมบำรุง</option></select></label><label className="op-wide">รายละเอียดงาน<input name="title" required maxLength={160} /></label><label>ผู้รับผิดชอบ<select name="assigneeId" defaultValue=""><option value="">ยังไม่มอบหมาย</option>{activeStaff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label><label className="op-check"><input name="blocksRoom" type="checkbox" /> งานนี้ทำให้ห้องไม่พร้อมใช้งาน</label><div className="op-form-actions"><FormButton busy={busy}>สร้างงาน</FormButton></div></form></section><section className="op-panel"><h3>รายการงาน</h3>{snapshot.workOrders.length ? snapshot.workOrders.map((w) => <div className="op-row op-work" key={w.id}><div><strong>ห้อง {roomName(w.roomId)} · {w.title}</strong><small>{workTypeText[w.type]}{w.blocksRoom ? " · ปิดกั้นห้อง" : ""} · {new Date(w.createdAt).toLocaleDateString("th-TH")}</small></div><div className="op-row-actions"><Badge value={w.status} /><label className="op-inline-label">ผู้รับผิดชอบ<select aria-label={`ผู้รับผิดชอบงาน ${w.title}`} value={w.assigneeId ?? ""} disabled={busy} onChange={(e) => updateWork(w, { assigneeId: e.target.value || null })}><option value="">ยังไม่มอบหมาย</option>{w.assigneeId && !activeStaff.some((staff) => staff.id === w.assigneeId) && <option value={w.assigneeId} disabled>{staffName(w.assigneeId)} (ปิดใช้งาน)</option>}{activeStaff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>{w.status === "OPEN" && <button disabled={busy} onClick={() => updateWork(w, { status: "IN_PROGRESS" })}>เริ่มงาน</button>}{w.status === "IN_PROGRESS" && <button disabled={busy} onClick={() => updateWork(w, { status: "DONE" })}>เสร็จแล้ว</button>}</div></div>) : <Empty>ยังไม่มีงาน</Empty>}</section></div>}
        {tab === "settings" && manager && <div className="op-stack"><div className="op-section-heading"><div><p className="op-eyebrow">สำหรับผู้จัดการ</p><h2>ตั้งค่า</h2></div></div><div className="op-two-cols"><section className="op-panel"><h3>ข้อมูลที่พัก</h3><form className="op-form" onSubmit={(e) => basicSubmit(e, (d) => ({ action: "updateProperty", name: field(d, "name") }))}><label>ชื่อที่พัก<input name="name" required maxLength={120} defaultValue={snapshot.property.name} /></label><p className="op-muted">เขตเวลา: {snapshot.property.timezone}</p><FormButton busy={busy}>บันทึกชื่อ</FormButton></form></section><section className="op-panel"><h3>เพิ่มพนักงาน</h3><form className="op-form" onSubmit={(e) => basicSubmit(e, (d) => ({ action: "createStaff", name: field(d, "name"), email: field(d, "email"), password: String(d.get("password") ?? ""), role: field(d, "role") as "MANAGER" | "STAFF" }))}><label>ชื่อ<input name="name" required maxLength={100} /></label><label>อีเมล<input name="email" type="email" required /></label><label>รหัสผ่าน<input name="password" type="password" required minLength={10} maxLength={72} autoComplete="new-password" /></label><label>สิทธิ์<select name="role" defaultValue="STAFF"><option value="STAFF">พนักงาน</option><option value="MANAGER">ผู้จัดการ</option></select></label><FormButton busy={busy}>เพิ่มพนักงาน</FormButton></form></section></div><section className="op-panel">
          <h3>ทีมงาน</h3>
          {snapshot.staff.map((staff) => <div className="op-row" key={staff.id}>
            <div>
              <strong>{staff.name}</strong><small>{staff.email}</small>
              {staff.active && staffToDeactivate === staff.id && <small>
                บัญชีนี้จะเข้าใช้งานไม่ได้ และงานค้างจะกลับเป็นงานที่ยังไม่มอบหมาย
              </small>}
            </div>
            <div className="op-row-actions">
              <Badge value={staff.role === "MANAGER" ? "ผู้จัดการ" : "พนักงาน"} />
              {!staff.active && <span className="op-badge op-badge-open">ปิดใช้งานแล้ว</span>}
              {staff.active && staff.role === "STAFF" && (staffToDeactivate === staff.id ? <>
                <button type="button" className="op-danger" aria-label={`ยืนยันปิดบัญชี ${staff.name}`}
                  disabled={busy} onClick={() => void deactivateStaff(staff.id)}>ยืนยันปิดบัญชี</button>
                <button type="button" className="op-quiet" disabled={busy}
                  onClick={() => setStaffToDeactivate(null)}>ยกเลิก</button>
              </> : <button type="button" className="op-danger" aria-label={`ปิดบัญชี ${staff.name}`}
                disabled={busy} onClick={() => setStaffToDeactivate(staff.id)}>ปิดบัญชี</button>)}
            </div>
          </div>)}
        </section></div>}
      </>}
      
    </main>
  </div>;
}
