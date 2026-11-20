import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const COOKIE = "dormdash_operations";
const secret = () => {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 32) throw new Error("AUTH_UNAVAILABLE");
  return new TextEncoder().encode(value);
};

export class OperationsError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export async function opsHash(password: string) { return bcrypt.hash(password, 12); }
export async function opsVerify(password: string, hash: string) { return bcrypt.compare(password, hash); }

export async function opsSessionToken(staffId: string) {
  return new SignJWT({ scope: "operations" }).setProtectedHeader({ alg: "HS256" })
    .setSubject(staffId).setIssuedAt().setExpirationTime("8h").sign(secret());
}

export function opsSessionCookie(token: string) {
  return { name: COOKIE, value: token, options: { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge: 28800 } };
}

export function clearOpsSessionCookie() {
  return { name: COOKIE, value: "", options: { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge: 0 } };
}

export async function requireOpsStaff() {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) throw new OperationsError("กรุณาเข้าสู่ระบบ", 401);
  let id: string;
  try {
    const verified = await jwtVerify(token, secret());
    if (verified.payload.scope !== "operations" || !verified.payload.sub) throw new Error("Invalid session");
    id = verified.payload.sub;
  } catch { throw new OperationsError("กรุณาเข้าสู่ระบบ", 401); }
  const staff = await prisma.opsStaff.findUnique({ where: { id } });
  if (!staff?.active) throw new OperationsError("กรุณาเข้าสู่ระบบ", 401);
  return staff;
}

export function requireManager(role: string) {
  if (role !== "MANAGER") throw new OperationsError("รายการนี้ต้องใช้สิทธิ์ผู้จัดการ", 403);
}

export function checkOpsOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  let parsed: URL;
  try { parsed = new URL(origin); } catch { throw new OperationsError("คำขอมาจากที่อยู่เว็บที่ไม่ถูกต้อง", 403); }
  const host = request.headers.get("host") ?? new URL(request.url).host;
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.host.toLowerCase() !== host.toLowerCase()) throw new OperationsError("คำขอมาจากที่อยู่เว็บที่ไม่ถูกต้อง", 403);
}

export function opsApiError(error: unknown) {
  if (error instanceof OperationsError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof Error && error.message === "AUTH_UNAVAILABLE") return NextResponse.json({ error: "ระบบเข้าสู่ระบบไม่พร้อมใช้งาน" }, { status: 503 });
  console.error(error);
  return NextResponse.json({ error: "ระบบไม่พร้อมใช้งานชั่วคราว กรุณาลองอีกครั้ง" }, { status: 503 });
}
