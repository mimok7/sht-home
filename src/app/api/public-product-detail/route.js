import { getCachedPublicProductDetail } from '@/lib/public-product-detail-source';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  const params = new URL(request.url).searchParams;
  const service = params.get('service');
  const id = params.get('id')?.trim() || '';
  const includeMedia = params.get('includeMedia') === '1';
  if (!['cruise', 'hotel'].includes(service) || !id || id.length > 200) {
    return Response.json({ error: '상품 정보를 확인할 수 없습니다.' }, { status: 400 });
  }

  try {
    const detail = await getCachedPublicProductDetail(service, id, includeMedia);
    return Response.json(detail, {
      headers: { 'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=3600' },
    });
  } catch (error) {
    console.error('[public-product-detail] lookup failed', error?.message || error);
    return Response.json({ error: error?.publicMessage || '상품 정보를 불러오지 못했습니다.' }, { status: 500 });
  }
}
