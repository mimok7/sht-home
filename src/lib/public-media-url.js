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

function r2PathFromPublicUrl(value) {
  const url = typeof value === 'string' ? value.trim() : '';
  if (!url) return '';
  try {
    const parsed = new URL(url, 'https://media.stayhalong.local');
    if (parsed.pathname !== '/api/public-image') return '';
    return parsed.searchParams.get('r2') || '';
  } catch {
    return '';
  }
}

// Catalogue media has completed its migration to R2.  Normalize every R2
// representation (relative URL, absolute URL, or bucket/path pair) to one
// relative URL so the same object cannot be rendered twice through aliases.
export function resolveR2PublicMediaUrl(imageUrl, bucket, storagePath) {
  try {
    if (isR2StorageBucket(bucket) && storagePath) return r2ImageUrl(storagePath);
    const path = r2PathFromPublicUrl(imageUrl);
    return path ? r2ImageUrl(path) : '';
  } catch {
    return '';
  }
}

export function resolvePublicMediaUrl(imageUrl, bucket, storagePath) {
  const r2Url = resolveR2PublicMediaUrl(imageUrl, bucket, storagePath);
  if (r2Url) return r2Url;
  const directUrl = typeof imageUrl === 'string' ? imageUrl.trim() : '';
  if (directUrl.startsWith(`${LEGACY_HOMEPAGE_STORAGE_ORIGIN}/storage/v1/object/public/homepage-images/`)) {
    const origin = platformOrigin();
    return origin ? `${origin}${directUrl.slice(LEGACY_HOMEPAGE_STORAGE_ORIGIN.length)}` : directUrl;
  }
  if (directUrl) return directUrl;
  return platformStorageUrl(bucket, storagePath);
}
