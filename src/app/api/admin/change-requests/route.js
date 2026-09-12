import { randomUUID } from 'node:crypto';
import { getHomepageDatabase, getHomepageOperator } from '@/lib/homepage-admin';
import { createR2DownloadUrl, deleteR2Objects, getR2Object, isPrivateR2ImagePath, putR2Object } from '@/lib/r2-storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const BUCKET = 'admin-change-request-images';
const R2_PREFIX = 'admin-change-requests';
const PRIVATE_CACHE_CONTROL = 'private, no-store';
const categories = new Set(['content', 'product', 'design', 'bug', 'other']);

async function operatorAndDatabase(request) {
  const operator = await getHomepageOperator(request);
  const database = getHomepageDatabase();
  if (!operator) throw new Error('운영자 로그인이 필요합니다.');
  if (!database) throw new Error('홈페이지 관리자 서비스 키가 설정되지 않았습니다.');
  return { operator, database };
}
function fail(error) { return Response.json({ error: error.message || '수정 신청을 처리하지 못했습니다.' }, { status: /로그인|서비스 키/.test(error.message || '') ? 401 : 400 }); }
async function list(database) {
  const [requests, comments] = await Promise.all([
    database.from('admin_change_requests').select('*').order('created_at', { ascending: false }),
    database.from('admin_change_request_comments').select('*').order('created_at'),
  ]);
  if (requests.error || comments.error) throw requests.error || comments.error;
  return Promise.all((requests.data || []).map(async (request) => {
    const paths = request.screenshot_paths || [];
    const signed = await Promise.all(paths.map(async (path) => {
      if (isPrivateR2ImagePath(path)) return createR2DownloadUrl(path, 300);
      const { data } = await database.storage.from(BUCKET).createSignedUrl(path, 300);
      return data?.signedUrl || null;
    }));
    return { ...request, screenshot_urls: signed.filter(Boolean), comments: (comments.data || []).filter((comment) => comment.request_id === request.id) };
  }));
}
export async function GET(request) { try {
  const { database } = await operatorAndDatabase(request);
  const { searchParams } = new URL(request.url);
  const requestId = searchParams.get('download');
  const path = searchParams.get('path');
  if (!requestId || !path) return Response.json({ requests: await list(database) });
  const { data: changeRequest, error: requestError } = await database.from('admin_change_requests').select('screenshot_paths').eq('id', requestId).single();
  if (requestError) throw requestError;
  if (!(changeRequest.screenshot_paths || []).includes(path)) throw new Error('첨부 이미지 정보를 찾을 수 없습니다.');
  let file;
  if (isPrivateR2ImagePath(path)) {
    const object = await getR2Object(path);
    if (!object.Body || typeof object.Body.transformToByteArray !== 'function') throw new Error('첨부 이미지를 불러오지 못했습니다.');
    file = new Blob([await object.Body.transformToByteArray()], { type: object.ContentType || 'application/octet-stream' });
  } else {
    const result = await database.storage.from(BUCKET).download(path);
    if (result.error) throw result.error;
    file = result.data;
  }
  const extension = path.split('.').pop()?.replace(/[^a-z0-9]/gi, '') || 'jpg';
  return new Response(Buffer.from(await file.arrayBuffer()), { headers: { 'Content-Type': file.type || 'application/octet-stream', 'Content-Disposition': `attachment; filename="change-request-${requestId}.${extension}"` } });
} catch (error) { return fail(error); } }
export async function POST(request) { try {
  const { operator, database } = await operatorAndDatabase(request);
  if ((request.headers.get('content-type') || '').includes('application/json')) {
    const body = await request.json();
    if (body.action === 'update-status') {
      const status = String(body.status || '');
      if (!body.requestId || !['open', 'in_progress', 'done'].includes(status)) throw new Error('변경할 상태를 선택해 주세요.');
      const { data, error } = await database.from('admin_change_requests').update({ status }).eq('id', body.requestId).select().single();
      if (error) throw error;
      return Response.json({ request: data });
    }
    if (body.action === 'delete-request') {
      if (!body.requestId) throw new Error('삭제할 수정 신청을 선택해 주세요.');
      const { data: existing, error: existingError } = await database.from('admin_change_requests').select('screenshot_paths').eq('id', body.requestId).single();
      if (existingError) throw existingError;
      const paths = existing.screenshot_paths || [];
      const legacyPaths = paths.filter((path) => !isPrivateR2ImagePath(path));
      const r2Paths = paths.filter(isPrivateR2ImagePath);
      if (legacyPaths.length) {
        const { error: storageError } = await database.storage.from(BUCKET).remove(legacyPaths);
        if (storageError) throw storageError;
      }
      if (r2Paths.length) await deleteR2Objects(r2Paths);
      const { error: commentsError } = await database.from('admin_change_request_comments').delete().eq('request_id', body.requestId);
      if (commentsError) throw commentsError;
      const { error: deleteError } = await database.from('admin_change_requests').delete().eq('id', body.requestId);
      if (deleteError) throw deleteError;
      return Response.json({ requestId: body.requestId });
    }
    const content = String(body.content || '').trim();
    if (body.action !== 'comment' || !body.requestId || !content) throw new Error('댓글 내용을 입력해 주세요.');
    const { data, error } = await database.from('admin_change_request_comments').insert({ request_id: body.requestId, author_id: operator.id, author_email: operator.email || '관리자', content }).select().single();
    if (error) throw error; return Response.json({ comment: data });
  }
  const form = await request.formData(); const category = String(form.get('category') || ''); const title = String(form.get('title') || '').trim(); const description = String(form.get('description') || '').trim();
  if (!categories.has(category) || !title || !description) throw new Error('카테고리, 제목, 수정 내용을 입력해 주세요.');
  const files = form.getAll('screenshots').filter((file) => file && file.size > 0);
  if (files.length > 5 || files.some((file) => file.size > 5 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type))) throw new Error('이미지는 최대 5장, 파일당 5MB의 JPG·PNG·WebP만 첨부할 수 있습니다.');
  const id = randomUUID(); const paths = [];
  for (const file of files) { const extension = file.type.split('/')[1]; const path = `${R2_PREFIX}/${id}/${randomUUID()}.${extension}`; await putR2Object(path, Buffer.from(await file.arrayBuffer()), file.type, PRIVATE_CACHE_CONTROL); paths.push(path); }
  const { data, error } = await database.from('admin_change_requests').insert({ id, category, title, description, screenshot_paths: paths, created_by: operator.id, created_by_email: operator.email || '관리자' }).select().single();
  if (error) throw error;
  const signed = await Promise.all(paths.map((path) => createR2DownloadUrl(path, 300)));
  return Response.json({ request: { ...data, screenshot_urls: signed.filter(Boolean), comments: [] } });
} catch (error) { return fail(error); } }
