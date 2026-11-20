import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkOpsOrigin, clearOpsSessionCookie, opsApiError, opsSessionCookie, opsSessionToken, opsVerify, OperationsError } from "@/lib/operations-auth";

export async function POST(request: Request) {
  try {
    checkOpsOrigin(request);
    const input = await request.json() as Record<string, unknown> | null;
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new OperationsError("กรุณากรอกอีเมลและรหัสผ่าน");
    if (typeof input.email !== "string" || typeof input.password !== "string") throw new OperationsError("กรุณากรอกอีเมลและรหัสผ่าน");
    const user = await prisma.opsStaff.findUnique({ where: { email: input.email.trim().toLowerCase() } });
    if (!user?.active || !(await opsVerify(input.password, user.passwordHash))) throw new OperationsError("อีเมลหรือรหัสผ่านไม่ถูกต้อง", 401);
    const response = NextResponse.json({ ok: true });
    response.cookies.set(opsSessionCookie(await opsSessionToken(user.id)));
    return response;
  } catch (error) { return error instanceof SyntaxError ? NextResponse.json({ error: "ข้อมูลคำขอไม่ถูกต้อง" }, { status: 400 }) : opsApiError(error); }
}
export async function DELETE(request: Request) {
  try {
    checkOpsOrigin(request);
    const response = NextResponse.json({ ok: true });
    response.cookies.set(clearOpsSessionCookie());
    return response;
  } catch (error) { return opsApiError(error); }
}
