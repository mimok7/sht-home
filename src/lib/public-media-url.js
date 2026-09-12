import { isR2StorageBucket, r2ImageUrl } from '@/lib/r2-storage';

const LEGACY_HOMEPAGE_STORAGE_ORIGIN = 'https://tthwqfhdojncqtwfssqe.supabase.co';

function platformOrigin() {
  return String(process.env.NEXT_PUBLIC_PLATFORM_SUPABASE_URL || '').replace(/\/$/, '');
}

export function platformStorageUrl(bucket, storagePath) {
  if (isR2StorageBucket(bucket)) return r2ImageUrl(storagePath);
  const origin = platformOrigin();
  if (!origin || !bucket || !storagePath) return '';
  const encodedPath = String(storagePath).split('/').map(encodeURIComponent).join('/');
  return `${origin}/storage/v1/object/public/${encodeURIComponent(bucket)}/${encodedPath}`;
}

export function resolvePublicMediaUrl(imageUrl, bucket, storagePath) {
  const directUrl = typeof imageUrl === 'string' ? imageUrl.trim() : '';
  if (directUrl.startsWith(`${LEGACY_HOMEPAGE_STORAGE_ORIGIN}/storage/v1/object/public/homepage-images/`)) {
    const origin = platformOrigin();
    return origin ? `${origin}${directUrl.slice(LEGACY_HOMEPAGE_STORAGE_ORIGIN.length)}` : directUrl;
  }
  if (directUrl) return directUrl;
  return platformStorageUrl(bucket, storagePath);
}
