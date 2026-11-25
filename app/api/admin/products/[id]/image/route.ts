import { randomUUID } from "node:crypto";
import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { detectProductImageType } from "@/lib/product-image";
import { checkActionRateLimit } from "@/lib/action-rate-limit";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const BUCKET = "pos-product-images";
function storageClient() {
  const endpoint = process.env.AWS_ENDPOINT_URL_S3;
  const region = process.env.AWS_REGION;
  if (!endpoint || !region || !process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) throw new Error("Product image storage is not configured for this environment.");
  return { client: new S3Client({ endpoint, region, forcePathStyle: true }), endpoint };
}
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const actor = await getCurrentUser();
  if (!actor) return NextResponse.json({ error: "Sign-in required." }, { status: 401 });
  if (actor.role !== "OWNER" && actor.role !== "MANAGER") return NextResponse.json({ error: "Manager or owner access required." }, { status: 403 });
  const rate = await checkActionRateLimit("product-image-upload", actor.id, 20, 900);
  if (!rate.allowed) return NextResponse.json({ error: "Too many image uploads. Please wait before trying again." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  const { id } = await context.params;
  const product = await prisma.product.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!product) return NextResponse.json({ error: "Product not found." }, { status: 404 });
  let form: FormData;
  try { form = await request.formData(); } catch { return NextResponse.json({ error: "Choose an image file." }, { status: 400 }); }
  const file = form.get("image");
  if (!(file instanceof File) || file.size < 1 || file.size > 5 * 1024 * 1024) return NextResponse.json({ error: "Choose an image between 1 byte and 5 MB." }, { status: 400 });
  const bytes = Buffer.from(await file.arrayBuffer());
  const imageType = detectProductImageType(bytes);
  if (!imageType || file.type !== imageType.mime) return NextResponse.json({ error: "Only valid JPEG, PNG and WebP image files are accepted." }, { status: 400 });
  const key = "products/" + id + "/" + randomUUID() + "." + imageType.extension;
  let client: S3Client;
  let endpoint: string;
  try { ({ client, endpoint } = storageClient()); } catch { return NextResponse.json({ error: "Product image storage is not configured." }, { status: 503 }); }
  try {
    await client.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: bytes, ContentType: imageType.mime, CacheControl: "public, max-age=31536000, immutable" }));
    const imageUrl = endpoint.replace(/\/+$/, "") + "/" + BUCKET + "/" + key;
    await prisma.$transaction(async (tx) => {
      await tx.product.update({ where: { id }, data: { imageUrl } });
      await tx.auditEvent.create({ data: { userId: actor.id, action: "PRODUCT_IMAGE_UPLOADED", entityType: "Product", entityId: id, details: { key, contentType: imageType.mime, sizeBytes: bytes.length } } });
    });
    return NextResponse.json({ imageUrl }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    try { await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key })); } catch { /* keep the original failure response */ }
    return NextResponse.json({ error: "Product image could not be saved." }, { status: 503 });
  }
}
