/**
 * r2.ts — singleton R2 client + typed helpers.
 *
 * Server-only module. Never import this from client components.
 * The S3Client is module-scoped so it's created once per Lambda/Edge cold
 * start and reused across requests (avoids socket leaks).
 */

import {
  S3Client,
  HeadObjectCommand,
  PutObjectCommand,
  type HeadObjectCommandOutput,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// ---------------------------------------------------------------------------
// Credential validation at module load time.
// If any of the three required env vars are absent we throw immediately rather
// than producing a confusing "invalid credentials" error at request time.
// We only check, never log the values.
// ---------------------------------------------------------------------------

const accountId = process.env.R2_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

if (!accountId || !accessKeyId || !secretAccessKey) {
  throw new Error(
    "R2 env vars missing (R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY)"
  );
}

// ---------------------------------------------------------------------------
// Singleton S3Client
// ---------------------------------------------------------------------------

export const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId, secretAccessKey },
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type R2BucketKind = "glb" | "media";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the R2 bucket name from the kind discriminant.
 * Values come from env vars set by deploy-ops; they default to the canonical
 * names in .env.example ("forge-glb" / "forge-media").
 */
function resolveBucketName(kind: R2BucketKind): string {
  const name =
    kind === "glb"
      ? process.env.R2_BUCKET_GLB
      : process.env.R2_BUCKET_MEDIA;

  if (!name) {
    throw new Error(
      `R2 bucket env var missing for kind "${kind}" (R2_BUCKET_GLB / R2_BUCKET_MEDIA)`
    );
  }
  return name;
}

/**
 * Resolve the public base URL for a bucket kind.
 * Returns the URL with any trailing slash stripped so callers can safely
 * append "/<key>" without producing double slashes.
 */
function resolvePublicBaseUrl(kind: R2BucketKind): string {
  const base =
    kind === "glb"
      ? process.env.R2_PUBLIC_URL_GLB
      : process.env.R2_PUBLIC_URL_MEDIA;

  if (!base) {
    throw new Error(
      `R2 public URL env var missing for kind "${kind}" (R2_PUBLIC_URL_GLB / R2_PUBLIC_URL_MEDIA)`
    );
  }
  // Strip trailing slash once, then callers always prepend "/".
  return base.replace(/\/$/, "");
}

// ---------------------------------------------------------------------------
// Exported helpers
// ---------------------------------------------------------------------------

/**
 * Generate a presigned PUT URL that the client uses to upload a file directly
 * to R2 (bypassing Vercel's serverless body limit).
 *
 * ContentLength is included in the signed payload so R2 will reject any
 * upload that doesn't match the declared size — prevents bloated uploads.
 */
export async function getPresignedPutUrl(args: {
  bucket: R2BucketKind;
  objectKey: string;
  contentType: string;
  contentLength: number;
  expiresInSeconds?: number;
}): Promise<string> {
  const { bucket, objectKey, contentType, contentLength, expiresInSeconds = 600 } = args;

  const command = new PutObjectCommand({
    Bucket: resolveBucketName(bucket),
    Key: objectKey,
    ContentType: contentType,
    ContentLength: contentLength,
  });

  return getSignedUrl(r2, command, { expiresIn: expiresInSeconds });
}

// ---------------------------------------------------------------------------

type HeadSuccess = { exists: true; contentLength: number; contentType: string };
type HeadMiss = { exists: false };

/**
 * HEAD an object to verify it was actually uploaded after the client PUT.
 *
 * - Returns `{ exists: true, ... }` on success.
 * - Returns `{ exists: false }` for 404 / NoSuchKey — object genuinely absent.
 * - Rethrows everything else (credentials, network, 5xx) so the route can
 *   surface a 500 rather than silently treating it as "not found".
 */
export async function headObject(args: {
  bucket: R2BucketKind;
  objectKey: string;
}): Promise<HeadSuccess | HeadMiss> {
  const command = new HeadObjectCommand({
    Bucket: resolveBucketName(args.bucket),
    Key: args.objectKey,
  });

  let response: HeadObjectCommandOutput;
  try {
    response = await r2.send(command);
  } catch (err: unknown) {
    // AWS SDK surfaces not-found as an error whose $metadata.httpStatusCode
    // is 404, or whose name is "NotFound" / "NoSuchKey".
    if (isNotFoundError(err)) {
      return { exists: false };
    }
    // Real failure — let it propagate.
    throw err;
  }

  return {
    exists: true,
    contentLength: response.ContentLength ?? 0,
    contentType: response.ContentType ?? "application/octet-stream",
  };
}

/**
 * Narrow an unknown thrown value to the two error shapes R2/S3 uses for
 * "object does not exist": HTTP 404 status, or the error names "NotFound" /
 * "NoSuchKey".
 */
function isNotFoundError(err: unknown): boolean {
  if (err == null || typeof err !== "object") return false;
  const e = err as Record<string, unknown>;
  if (e["name"] === "NotFound" || e["name"] === "NoSuchKey") return true;
  // Check $metadata for HTTP 404 (some SDK middleware surfaces it this way).
  const meta = e["$metadata"];
  if (meta != null && typeof meta === "object") {
    const status = (meta as Record<string, unknown>)["httpStatusCode"];
    if (status === 404) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------

/**
 * Build the public URL for an already-uploaded object.
 *
 * Uses the per-bucket public URL env vars set by deploy-ops.
 * Trailing slashes in the base URL are stripped; the key is appended with a
 * single "/" separator.
 */
export function publicUrlFor(bucket: R2BucketKind, objectKey: string): string {
  const base = resolvePublicBaseUrl(bucket);
  // Ensure objectKey doesn't start with "/" to avoid double-slash.
  const key = objectKey.startsWith("/") ? objectKey.slice(1) : objectKey;
  return `${base}/${key}`;
}

// ---------------------------------------------------------------------------
// Object-key helpers
// ---------------------------------------------------------------------------

/**
 * Canonical key for a world's GLB file.
 * Example: worlds/user_abc/world_xyz/world.glb
 */
export function buildGlbKey(userId: string, worldId: string): string {
  return `worlds/${userId}/${worldId}/world.glb`;
}

/**
 * Canonical key for a world's thumbnail.
 * Example: worlds/user_abc/world_xyz/thumbnail.webp
 *
 * `ext` must be one of: jpg, png, webp.
 * Enforcement of allowed content types and extension derivation happens at the
 * route layer — do not call this with an arbitrary extension.
 */
export function buildThumbnailKey(userId: string, worldId: string, ext: string): string {
  return `worlds/${userId}/${worldId}/thumbnail.${ext}`;
}

/**
 * Canonical key for a media asset (thumbnail, image, video) attached to a
 * world.
 * Example: worlds/user_abc/world_xyz/media/thumb_001.webp
 *
 * `ext` should be one of: jpg, png, webp, mp4.
 * Enforcement of allowed extensions happens at the route layer via zod.
 */
export function buildMediaKey(
  userId: string,
  worldId: string,
  mediaId: string,
  ext: string
): string {
  return `worlds/${userId}/${worldId}/media/${mediaId}.${ext}`;
}
