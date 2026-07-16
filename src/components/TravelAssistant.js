'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import styles from './TravelAssistant.module.css';

const KAKAO_CHAT_URL = 'http://pf.kakao.com/_zvsxaG/chat';
const QUICK_PROMPTS = ['크루즈 추천 받기', '예약 및 결제 문의', '픽업 및 이동 문의'];

export default function TravelAssistant() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

  async function ask(prompt = message) {
    const text = prompt.trim();
    if (!text || loading) return;
    setMessage(text); setLoading(true); setError('');
    try {
      const response = await fetch('/api/agent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: text }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '안내를 불러오지 못했습니다.');
      setResult(data);
    } catch (requestError) {
      setError(requestError.message || '네트워크 연결을 확인해주세요.');
    } finally { setLoading(false); }
  }

  function handleSubmit(event) { event.preventDefault(); ask(); }

  return <section className={styles.assistant} aria-label="여행 안내 상담">
    {open && <div className={styles.panel} role="dialog" aria-modal="true" aria-labelledby="travel-assistant-title">
      <header className={styles.header}><div><p>LOCAL DESK / ONLINE</p><h2 id="travel-assistant-title">하롱 여행 안내</h2></div><button type="button" className={styles.close} onClick={() => setOpen(false)} aria-label="여행 안내 닫기">×</button></header>
      <div className={styles.body} aria-live="polite">
        {!result && !loading && <p className={styles.intro}>크루즈, 예약, 픽업에 대해 물어보세요. 실시간 객실과 최종 요금은 현지 상담원이 확인합니다.</p>}
        <div className={styles.prompts}>{QUICK_PROMPTS.map((prompt) => <button key={prompt} type="button" onClick={() => ask(prompt)}>{prompt}<span>→</span></button>)}</div>
        {loading && <p className={styles.status}>안내를 확인하고 있어요.</p>}
        {error && <p className={styles.error}>{error}</p>}
        {result && <article className={styles.response}>
          <p className={styles.agent}>{result.agent}</p><p className={styles.answer}>{result.answer}</p>
          {result.recommendations?.map((cruise) => <Link className={styles.cruise} href={cruise.href} key={cruise.href} onClick={() => setOpen(false)}><span>{cruise.duration}</span><strong>{cruise.name}</strong><b>{cruise.fromPriceLabel} <i>→</i></b></Link>)}
          {result.requiresHumanReview && <a className={styles.kakao} href={KAKAO_CHAT_URL} target="_blank" rel="noreferrer">카카오톡으로 확인하기 <span>↗</span></a>}
        </article>}
      </div>
      <form className={styles.form} onSubmit={handleSubmit}><label className="sr-only" htmlFor="travel-assistant-message">여행 문의</label><input ref={inputRef} id="travel-assistant-message" value={message} maxLength="1000" onChange={(event) => setMessage(event.target.value)} placeholder="예: 8월 가족 3명, 1박 2일 추천" /><button type="submit" disabled={loading || !message.trim()} aria-label="문의 보내기">→</button></form>
    </div>}
    <button type="button" className={styles.launcher} onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-controls="travel-assistant-title"><span className={styles.signal} aria-hidden="true" /><span><small>LOCAL DESK</small>여행 안내</span><b>{open ? '×' : '↗'}</b></button>
  </section>;
}
