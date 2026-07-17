// 플랫폼 원본 카탈로그의 v2 변환 상태 조회와 수동 재변환을 처리한다.
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isAuthorized(request) {
  const expected = process.env.PLATFORM_SYNC_SECRET;
  const received = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
  if (!expected || !received) return false;
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  return expectedBuffer.length === receivedBuffer.length && crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

function getDatabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.HOMEPAGE_SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
}

async function getStatus(database) {
  const { data, error } = await database.rpc('platform_catalog_v2_status');
  if (error) throw error;
  return data;
}

export async function GET(request) {
  if (!isAuthorized(request)) return Response.json({ error: '인증되지 않은 변환 상태 요청입니다.' }, { status: 401 });
  const database = getDatabase();
  if (!database) return Response.json({ error: '홈페이지 동기화 서비스 키가 설정되지 않았습니다.' }, { status: 503 });
  try {
    return Response.json({ ok: true, status: await getStatus(database) });
  } catch (error) {
    console.error('[platform-transform] status failed', error.message);
    return Response.json({ error: '변환 현황을 조회하지 못했습니다.' }, { status: 500 });
  }
}

export async function POST(request) {
  if (!isAuthorized(request)) return Response.json({ error: '인증되지 않은 변환 요청입니다.' }, { status: 401 });
  const database = getDatabase();
  if (!database) return Response.json({ error: '홈페이지 동기화 서비스 키가 설정되지 않았습니다.' }, { status: 503 });
  try {
    const { data: transformed, error } = await database.rpc('refresh_platform_catalog_full_v2');
    if (error) throw error;
    return Response.json({ ok: true, transformed, status: await getStatus(database) });
  } catch (error) {
    console.error('[platform-transform] refresh failed', error.message);
    return Response.json({ error: '홈페이지 상품 전체 변환에 실패했습니다.' }, { status: 500 });
  }
}
