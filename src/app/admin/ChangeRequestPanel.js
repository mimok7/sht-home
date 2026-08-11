'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const categories = { content: '문구·콘텐츠', product: '상품·요금', design: '디자인·이미지', bug: '오류·기능', other: '기타' };
const statusLabels = { open: '접수됨', in_progress: '수정 진행 중', done: '수정 완료' };
const panelDetails = {
  create: { panel: 'change-requests', number: '08 / CHANGE REQUESTS', title: '수정 신청', description: '수정 내용과 화면 캡처를 남기고 관리팀과 댓글로 논의합니다.' },
  status: { panel: 'change-request-status', number: '09 / REQUEST STATUS', title: '수정 신청 현황', description: '접수되거나 수정 진행 중인 신청을 확인하고 상태를 관리합니다.' },
  completed: { panel: 'change-request-completed', number: '10 / COMPLETED REQUESTS', title: '수정 완료 내역', description: '완료 처리된 수정 신청을 확인합니다.' },
};

export default function ChangeRequestPanel({ adminRequest, active, view = 'create' }) {
  const [items, setItems] = useState([]);
  const [notice, setNotice] = useState('');
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState('');
  const hasLoaded = useRef(false);
  const isSubmitting = useRef(false);
  const details = panelDetails[view];

  const load = useCallback(async () => {
    const result = await adminRequest('/api/admin/change-requests');
    setItems(result.requests || []);
  }, [adminRequest]);

  useEffect(() => {
    if (!active || view === 'create' || hasLoaded.current) return;
    void load().then(() => { hasLoaded.current = true; }).catch((error) => setNotice(error.message));
  }, [active, load, view]);

  const visibleItems = useMemo(() => items.filter((item) => {
    if (view === 'status') return item.status !== 'done';
    if (view === 'completed') return item.status === 'done';
    return true;
  }), [items, view]);

  async function create(event) {
    event.preventDefault();
    if (isSubmitting.current) return;
    const form = event.currentTarget;
    isSubmitting.current = true;
    setCreating(true);
    try {
      const result = await adminRequest('/api/admin/change-requests', { method: 'POST', body: new FormData(form) });
      form.reset();
      setItems((current) => [result.request, ...current]);
      setNotice('수정 신청을 등록했습니다.');
    } catch (error) { setNotice(error.message); } finally {
      isSubmitting.current = false;
      setCreating(false);
    }
  }

  async function comment(event, requestId) {
    event.preventDefault();
    const form = event.currentTarget;
    const content = new FormData(form).get('content')?.trim();
    if (!content) return;
    try {
      const result = await adminRequest('/api/admin/change-requests', { method: 'POST', body: JSON.stringify({ action: 'comment', requestId, content }) });
      form.reset();
      setItems((current) => current.map((item) => item.id === requestId ? { ...item, comments: [...(item.comments || []), result.comment] } : item));
    } catch (error) { setNotice(error.message); }
  }

  async function updateStatus(requestId, status) {
    try {
      const result = await adminRequest('/api/admin/change-requests', { method: 'POST', body: JSON.stringify({ action: 'update-status', requestId, status }) });
      setItems((current) => current.map((item) => item.id === requestId ? { ...item, status: result.request.status } : item));
      setNotice(status === 'done' ? '수정 신청을 완료 처리했습니다.' : '수정 신청 상태를 변경했습니다.');
    } catch (error) { setNotice(error.message); }
  }

  async function downloadScreenshot(requestId, path) {
    try {
      const response = await adminRequest(`/api/admin/change-requests?download=${encodeURIComponent(requestId)}&path=${encodeURIComponent(path)}`, { raw: true });
      const blob = await response.blob();
      const fileUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = fileUrl;
      link.download = path.split('/').pop() || 'screenshot';
      link.click();
      URL.revokeObjectURL(fileUrl);
    } catch (error) { setNotice(error.message); }
  }

  async function deleteRequest(requestId) {
    if (!window.confirm('이 수정 신청과 첨부 이미지, 댓글을 모두 삭제할까요?')) return;
    setDeletingId(requestId);
    try {
      await adminRequest('/api/admin/change-requests', { method: 'POST', body: JSON.stringify({ action: 'delete-request', requestId }) });
      setItems((current) => current.filter((item) => item.id !== requestId));
      setNotice('수정 신청을 삭제했습니다.');
    } catch (error) { setNotice(error.message); } finally { setDeletingId(''); }
  }

  return <section className="admin-section admin-panel" data-panel={details.panel}>
    <div className="admin-section-title"><span>{details.number}</span><h2>{details.title}</h2><p>{details.description}</p></div>
    {view === 'create' && <form className="change-request-form" onSubmit={create}>
      <label>카테고리<select name="category">{Object.entries(categories).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <label>제목<input name="title" maxLength="120" required placeholder="수정할 항목을 요약해 주세요" /></label>
      <label className="wide">수정 내용<textarea name="description" rows="6" maxLength="5000" required placeholder="수정 위치와 원하는 변경 내용을 구체적으로 적어 주세요." /></label>
      <label className="wide">캡처 화면<input name="screenshots" type="file" accept="image/jpeg,image/png,image/webp" multiple /><small>JPG · PNG · WebP, 파일당 5MB</small></label>
      <button className="admin-save" disabled={creating}>{creating ? '등록 중…' : '수정 신청 등록'}</button>
    </form>}
    {notice && <p className="admin-notice">{notice}</p>}
    {view !== 'create' && <div className="change-request-list">
      {visibleItems.length === 0 ? <p className="admin-loading">{view === 'completed' ? '완료된 수정 신청이 없습니다.' : '표시할 수정 신청이 없습니다.'}</p> : visibleItems.map((item) => <article className="change-request-item" key={item.id}>
        <header><span>{categories[item.category]}</span><small>{new Date(item.created_at).toLocaleString('ko-KR')}</small></header>
        <h3>{item.title}</h3><p>{item.description}</p>
        {item.screenshot_urls?.length > 0 && <div className="change-request-shots">{item.screenshot_urls.map((url, index) => <figure key={url}><a href={url} target="_blank" rel="noreferrer"><img src={url} alt={`${item.title} 첨부 캡처 ${index + 1}`} /></a><button type="button" onClick={() => downloadScreenshot(item.id, item.screenshot_paths?.[index])}>이미지 다운로드</button></figure>)}</div>}
        <footer><span>{item.created_by_email}</span><b className={`change-request-status ${item.status || 'open'}`}>{statusLabels[item.status] || statusLabels.open}</b></footer>
        {view === 'status' && <div className="change-request-actions"><label className="change-request-status-control">처리 상태<select value={item.status || 'open'} onChange={(event) => updateStatus(item.id, event.target.value)}><option value="open">접수됨</option><option value="in_progress">수정 진행 중</option><option value="done">수정 완료</option></select></label><button type="button" className="admin-delete" onClick={() => deleteRequest(item.id)} disabled={deletingId === item.id}>{deletingId === item.id ? '삭제 중…' : '신청 삭제'}</button></div>}
        <div className="change-request-comments">{(item.comments || []).map((reply) => <p key={reply.id}><b>{reply.author_email}</b>{reply.content}<small>{new Date(reply.created_at).toLocaleString('ko-KR')}</small></p>)}</div>
        <form className="change-request-comment" onSubmit={(event) => comment(event, item.id)}><input name="content" maxLength="2000" required placeholder="관리자 댓글" /><button>댓글 등록</button></form>
      </article>)}
    </div>}
  </section>;
}
