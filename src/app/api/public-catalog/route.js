import { unstable_cache } from 'next/cache';
import { loadPublicCatalog } from '@/lib/public-catalog-source';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const getCachedPublicCatalog = unstable_cache(
  loadPublicCatalog,
  ['public-catalog-v2'],
  { revalidate: 30, tags: ['public-catalog'] },
);

export async function GET(request) {
  const searchParams = new URL(request.url).searchParams;
  const service = searchParams.get('service');
  const key = searchParams.get('key')?.trim() || '';
  if (!['cruise', 'hotel'].includes(service) || !key || key.length > 200) {
    return Response.json({ error: '요청한 상품 정보를 확인할 수 없습니다.' }, { status: 400 });
  }

  try {
    const catalog = await getCachedPublicCatalog(service, key);
    return Response.json(catalog, {
      headers: { 'Cache-Control': 'public, max-age=30, s-maxage=30, stale-while-revalidate=300' },
    });
  } catch (error) {
    console.error('[public-catalog] source lookup failed', error?.message || error);
    return Response.json({ error: '상품 정보를 불러오지 못했습니다.' }, { status: 500 });
  }
}
