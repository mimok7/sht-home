import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const R2_BUCKET_PREFIX = 'r2:';
// The bucket itself is private. Public catalogue media is delivered only by
// the public-image route; reservation and operator attachments use separate
// prefixes and are exposed only with a short-lived, authenticated URL.
const PUBLIC_IMAGE_PATH = /^(?:cruises|cabins|hotels|catalog)\/[a-zA-Z0-9_./-]+$/;
const PRIVATE_IMAGE_PATH = /^(?:documents|admin-change-requests)\/[a-zA-Z0-9_./-]+$/;
const IMAGE_PATH = /^(?:(?:cruises|cabins|hotels|catalog)|(?:documents|admin-change-requests))\/[a-zA-Z0-9_./-]+$/;
let client;

function configuration() {
  const endpoint = String(process.env.R2_ENDPOINT || '').replace(/\/$/, '');
  const bucket = String(process.env.R2_BUCKET || '').trim();
  const accessKeyId = String(process.env.R2_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = String(process.env.R2_SECRET_ACCESS_KEY || '').trim();
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  return { endpoint, bucket, accessKeyId, secretAccessKey };
}

function assertImagePath(path) {
  const value = String(path || '');
  if (!IMAGE_PATH.test(value) || value.includes('..') || value.includes('\\')) throw new Error('유효하지 않은 이미지 경로입니다.');
  return value;
}

function r2Client() {
  const config = configuration();
  if (!config) throw new Error('R2 이미지 저장소 설정이 없습니다.');
  if (!client) {
    client = new S3Client({
      region: 'auto',
      endpoint: config.endpoint,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
  }
  return { client, config };
}

export function r2StorageBucket() {
  const config = configuration();
  return config ? `${R2_BUCKET_PREFIX}${config.bucket}` : '';
}

export function isR2StorageBucket(bucket) {
  return typeof bucket === 'string' && bucket.startsWith(R2_BUCKET_PREFIX);
}

export function r2ImageUrl(path, origin = '') {
  const safePath = assertImagePath(path);
  const relativeUrl = `/api/public-image?r2=${encodeURIComponent(safePath)}`;
  return origin ? `${String(origin).replace(/\/$/, '')}${relativeUrl}` : relativeUrl;
}

export function isPublicR2ImagePath(path) {
  const value = String(path || '');
  return PUBLIC_IMAGE_PATH.test(value) && !value.includes('..') && !value.includes('\\');
}

export function isPrivateR2ImagePath(path) {
  const value = String(path || '');
  return PRIVATE_IMAGE_PATH.test(value) && !value.includes('..') && !value.includes('\\');
}

export async function createR2UploadUrl(path, contentType, cacheControl = 'public, max-age=31536000, immutable') {
  const safePath = assertImagePath(path);
  const { client: storage, config } = r2Client();
  return getSignedUrl(storage, new PutObjectCommand({
    Bucket: config.bucket,
    Key: safePath,
    ContentType: contentType,
    CacheControl: cacheControl,
  }), { expiresIn: 300 });
}

export async function createR2DownloadUrl(path, expiresIn = 300) {
  const safePath = assertImagePath(path);
  const { client: storage, config } = r2Client();
  return getSignedUrl(storage, new GetObjectCommand({
    Bucket: config.bucket,
    Key: safePath,
  }), { expiresIn: Math.max(60, Math.min(Number(expiresIn) || 300, 900)) });
}

export async function putR2Object(path, body, contentType, cacheControl = 'public, max-age=31536000, immutable') {
  const safePath = assertImagePath(path);
  const { client: storage, config } = r2Client();
  await storage.send(new PutObjectCommand({
    Bucket: config.bucket,
    Key: safePath,
    Body: body,
    ContentType: contentType,
    CacheControl: cacheControl,
  }));
}

export async function assertR2Object(path) {
  const safePath = assertImagePath(path);
  const { client: storage, config } = r2Client();
  await storage.send(new HeadObjectCommand({ Bucket: config.bucket, Key: safePath }));
}

export async function getR2Object(path) {
  const safePath = assertImagePath(path);
  const { client: storage, config } = r2Client();
  return storage.send(new GetObjectCommand({ Bucket: config.bucket, Key: safePath }));
}

export async function deleteR2Objects(paths) {
  const keys = [...new Set((paths || []).map(assertImagePath))];
  if (!keys.length) return;
  const { client: storage, config } = r2Client();
  const result = await storage.send(new DeleteObjectsCommand({
    Bucket: config.bucket,
    Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
  }));
  if (result.Errors?.length) throw new Error('R2 이미지 삭제에 실패했습니다.');
}
