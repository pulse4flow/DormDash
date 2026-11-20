import { head } from "@vercel/blob";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { apiError } from "@/lib/http";
import {
  isAllowedContentType,
  UPLOAD_LIMITS,
} from "@/lib/uploads";
import { prisma } from "@/lib/prisma";

const inputSchema = z.object({
  url: z.string().url(),
  fileName: z.string().min(1).max(180),
  mimeType: z.string().min(1),
  size: z.number().int().positive(),
});

export async function POST(request: Request) {
  try {
    await requireAdmin();
    const input = inputSchema.parse(await request.json());

    if (
      !isAllowedContentType("attachment", input.mimeType) ||
      input.size > UPLOAD_LIMITS.attachment
    ) {
      return NextResponse.json(
        { error: "Unsupported file type or size." },
        { status: 400 },
      );
    }

    const blob = await head(input.url);
    if (
      !blob.pathname.startsWith("uploads/") ||
      blob.size !== input.size ||
      blob.contentType !== input.mimeType
    ) {
      return NextResponse.json(
        { error: "Uploaded file verification failed." },
        { status: 400 },
      );
    }

    const attachment = await prisma.attachment.create({
      data: {
        fileName: input.fileName,
        mimeType: blob.contentType,
        size: blob.size,
        url: blob.url,
      },
    });

    return NextResponse.json(attachment, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
