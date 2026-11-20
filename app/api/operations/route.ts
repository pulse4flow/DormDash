import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { applyOperationsAction, operationsSnapshot } from "@/lib/operations";
import { checkOpsOrigin, opsApiError, requireOpsStaff } from "@/lib/operations-auth";
import type { OperationsAction } from "@/lib/operations-types";
import { operationsActionSchema } from "@/lib/operations";
import { z } from "zod";

export const dynamic = "force-dynamic";
export async function GET() {
  try { return NextResponse.json(await operationsSnapshot(await requireOpsStaff())); }
  catch (error) { return opsApiError(error); }
}
export async function POST(request: Request) {
  try {
    checkOpsOrigin(request);
    const user = await requireOpsStaff();
    const action = operationsActionSchema.parse(await request.json()) as OperationsAction;
    await applyOperationsAction(user, action);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return NextResponse.json({ error: "หมายเลขห้องหรืออีเมลนี้ถูกใช้แล้ว" }, { status: 409 });
    if (error instanceof z.ZodError) return NextResponse.json({ error: "กรุณาตรวจสอบข้อมูลที่กรอก" }, { status: 400 });
    if (error instanceof SyntaxError) return NextResponse.json({ error: "ข้อมูลคำขอไม่ถูกต้อง" }, { status: 400 });
    return opsApiError(error);
  }
}
