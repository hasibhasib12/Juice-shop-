import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getCurrentUser } from "@/lib/auth";
import { checkActionRateLimit } from "@/lib/action-rate-limit";
import { isAllowedMutationOrigin } from "@/lib/request-security";
import { detectProductImageType, isImageUploadRequestSizeAllowed } from "@/lib/product-image";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bucket = "pos-staff-avatars";

export async function POST(request: NextRequest) {
  if (!isAllowedMutationOrigin(request.headers.get("origin"), request.nextUrl.origin, request.headers.get("sec-fetch-site"))) return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  const actor = await getCurrentUser();
  if (!actor) return NextResponse.json({ error: "Sign-in required." }, { status: 401 });
  if (actor.role !== "OWNER" && actor.role !== "MANAGER") return NextResponse.json({ error: "Manager or owner access required." }, { status: 403 });
  const rate = await checkActionRateLimit("staff-photo-upload", actor.id, 20, 900);
  if (!rate.allowed) return NextResponse.json({ error: "Too many photo uploads. Please wait before trying again." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  const contentLength = request.headers.get("content-length");
  if (!isImageUploadRequestSizeAllowed(contentLength, 3 * 1024 * 1024)) {
    return NextResponse.json({ error: "Staff photo upload request is too large. Maximum image size is 3 MB." }, { status: 413 });
  }
  let form: FormData;
  try { form = await request.formData(); } catch { return NextResponse.json({ error: "Choose a valid image file." }, { status: 400 }); }
  const file = form.get("photo");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose a staff photo." }, { status: 400 });
  if (file.size < 1 || file.size > 3 * 1024 * 1024) return NextResponse.json({ error: "Staff photos must be smaller than 3 MB." }, { status: 400 });
  const bytes = Buffer.from(await file.arrayBuffer());
  const imageType = detectProductImageType(bytes);
  if (!imageType || file.type !== imageType.mime) return NextResponse.json({ error: "Only valid JPEG, PNG and WebP image files are accepted." }, { status: 400 });

  const endpoint = process.env.AWS_ENDPOINT_URL_S3;
  const region = process.env.AWS_REGION;
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  if (!endpoint || !region || !accessKeyId || !secretAccessKey) return NextResponse.json({ error: "Staff photo storage is not configured for this preview." }, { status: 503 });
  const key = `staff/${actor.branchId}/${randomUUID()}.${imageType.extension}`;
  try {
    const client = new S3Client({ region, endpoint, forcePathStyle: true, credentials: { accessKeyId, secretAccessKey } });
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: imageType.mime, CacheControl: "public, max-age=31536000, immutable" }));
    return NextResponse.json({ photoUrl: `${endpoint.replace(/\/$/, "")}/${bucket}/${key}` }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Photo upload failed. Please try again." }, { status: 503 });
  }
}
