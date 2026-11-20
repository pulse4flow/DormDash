import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { apiError } from "@/lib/http";
import {
  allowedContentTypes,
  isUploadKind,
  UPLOAD_LIMITS,
} from "@/lib/uploads";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as HandleUploadBody;
    const response = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        await requireAdmin();

        let kind: unknown;
        try {
          kind = JSON.parse(clientPayload ?? "{}").kind;
        } catch {
          throw new Error("Invalid upload request.");
        }

        if (!isUploadKind(kind) || !pathname.startsWith("uploads/")) {
          throw new Error("Invalid upload request.");
        }

        return {
          allowedContentTypes: [...allowedContentTypes(kind)],
          maximumSizeInBytes: UPLOAD_LIMITS[kind],
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ kind }),
        };
      },
    });

    return NextResponse.json(response);
  } catch (error) {
    return apiError(error);
  }
}
