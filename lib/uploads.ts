export const IMAGE_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export const ATTACHMENT_CONTENT_TYPES = [
  ...IMAGE_CONTENT_TYPES,
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/zip",
] as const;

export const UPLOAD_LIMITS = {
  image: 5 * 1024 * 1024,
  attachment: 25 * 1024 * 1024,
} as const;

export type UploadKind = keyof typeof UPLOAD_LIMITS;

export function isUploadKind(value: unknown): value is UploadKind {
  return value === "image" || value === "attachment";
}

export function allowedContentTypes(kind: UploadKind): readonly string[] {
  return kind === "image" ? IMAGE_CONTENT_TYPES : ATTACHMENT_CONTENT_TYPES;
}

export function isAllowedContentType(kind: UploadKind, contentType: string) {
  return allowedContentTypes(kind).includes(contentType as never);
}
