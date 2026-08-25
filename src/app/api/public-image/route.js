export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function isPublicSupabaseImage(url) {
  return url.protocol === 'https:'
    && url.hostname.endsWith('.supabase.co')
    && url.pathname.startsWith('/storage/v1/object/public/');
}

export async function GET(request) {
  const sourceUrl = new URL(request.url).searchParams.get('url');
  if (!sourceUrl) return new Response('이미지 주소가 필요합니다.', { status: 400 });

  let remoteUrl;
  try {
    remoteUrl = new URL(sourceUrl);
  } catch {
    return new Response('올바르지 않은 이미지 주소입니다.', { status: 400 });
  }
  if (!isPublicSupabaseImage(remoteUrl)) return new Response('허용되지 않은 이미지 주소입니다.', { status: 400 });

  try {
    const remote = await fetch(remoteUrl, { next: { revalidate: 3600 } });
    if (!remote.ok || !remote.body) return new Response('이미지를 불러오지 못했습니다.', { status: remote.status || 502 });
    const contentType = remote.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) return new Response('이미지 형식이 아닙니다.', { status: 415 });

    return new Response(remote.body, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800',
      },
    });
  } catch (error) {
    console.error('Public image proxy failed:', error);
    return new Response('이미지 연결에 실패했습니다.', { status: 502 });
  }
}
