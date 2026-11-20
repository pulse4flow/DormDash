import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkOpsOrigin, opsApiError, opsHash, opsSessionCookie, opsSessionToken, OperationsError } from "@/lib/operations-auth";

export async function POST(request: Request) {
  try {
    checkOpsOrigin(request);
    const input = await request.json() as Record<string, unknown> | null;
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new OperationsError("กรุณาตรวจสอบข้อมูลที่พักและบัญชีผู้จัดการ");
    if (!process.env.ADMIN_REGISTRATION_KEY || typeof input.registrationKey !== "string" || input.registrationKey !== process.env.ADMIN_REGISTRATION_KEY) throw new OperationsError("รหัสสำหรับตั้งค่าระบบไม่ถูกต้อง", 403);
    if ([input.name, input.propertyName, input.email, input.password, input.timezone].some(v => typeof v !== "string")) throw new OperationsError("กรุณาตรวจสอบข้อมูลที่พักและบัญชีผู้จัดการ");
    const name = (input.name as string).trim(), propertyName = (input.propertyName as string).trim(), email = (input.email as string).trim().toLowerCase(), password = input.password as string, timezone = (input.timezone as string).trim();
    if (!name || name.length > 200 || !propertyName || propertyName.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 10 || new TextEncoder().encode(password).length > 72) throw new OperationsError("กรุณาตรวจสอบข้อมูลที่พักและบัญชีผู้จัดการ");
    try { new Intl.DateTimeFormat("en-US", { timeZone: timezone }); } catch { throw new OperationsError("เขตเวลาไม่ถูกต้อง"); }
    const passwordHash = await opsHash(password);
    const user = await prisma.$transaction(async tx => {
      // The advisory transaction lock serializes all first-property setup requests.
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(70320831)`;
      if (await tx.property.count()) throw new OperationsError("ระบบตั้งค่าที่พักแล้ว กรุณาเข้าสู่ระบบ", 409);
      const property = await tx.property.create({ data: { name: propertyName, timezone } });
      return tx.opsStaff.create({ data: { propertyId: property.id, name, email, passwordHash, role: "MANAGER" } });
    });
    const response = NextResponse.json({ ok: true }, { status: 201 });
    response.cookies.set(opsSessionCookie(await opsSessionToken(user.id)));
    return response;
  } catch (error) { return error instanceof SyntaxError ? NextResponse.json({ error: "ข้อมูลคำขอไม่ถูกต้อง" }, { status: 400 }) : opsApiError(error); }
}
