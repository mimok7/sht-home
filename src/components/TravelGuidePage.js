'use client';

import { useState } from 'react';
import Link from 'next/link';
import styles from './TravelGuidePage.module.css';

const QUICK_PROMPTS = ['가족 여행에 맞는 크루즈를 추천해줘', '예약과 결제 절차가 궁금해', '하노이 픽업이 가능한가요?'];
const KAKAO_CHAT_URL = 'http://pf.kakao.com/_zvsxaG/chat';

export default function TravelGuidePage() {
  const [message, setMessage] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  async function ask(question = message) {
    const text = question.trim(); if (!text || loading) return;
    setMessage(text); setLoading(true); setError('');
    try {
      const response = await fetch('/api/agent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: text }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || '안내를 불러오지 못했습니다.'); setResult(data);
    } catch (requestError) { setError(requestError.message || '네트워크 연결을 확인해주세요.'); } finally { setLoading(false); }
  }
  return <main className={styles.page}>
    <section className={styles.hero}><div><p>LOCAL DESK / TRAVEL GUIDE</p><h1>하롱 여행,<br /><span>바로 물어보세요.</span></h1><strong>CRUISE · RESERVATION · TRANSFER</strong></div><aside><b>01</b><p>상품 추천부터 이동 일정까지, 현재 등록된 여행 정보를 바탕으로 안내합니다.</p></aside></section>
    <section className={styles.content} aria-label="하롱 여행 안내 대화"><div className={styles.notes}><p>HOW IT WORKS</p><ol><li><b>01</b>여행 조건을 남겨주세요.</li><li><b>02</b>현재 상품 기준으로 안내합니다.</li><li><b>03</b>최종 예약은 현지 데스크가 확인합니다.</li></ol><a href={KAKAO_CHAT_URL} target="_blank" rel="noreferrer">바로 카카오 상담 <span>↗</span></a></div><div className={styles.chat}><header><p>STAY HALONG / GUIDE DESK</p><h2>무엇이 궁금한가요?</h2></header><div className={styles.conversation} aria-live="polite">{!result && <p className={styles.welcome}>이용일, 인원, 여행 스타일을 알려주시면 더 정확히 추천해드릴게요.</p>}<div className={styles.prompts}>{QUICK_PROMPTS.map((prompt) => <button type="button" key={prompt} onClick={() => ask(prompt)}>{prompt}<span>→</span></button>)}</div>{loading && <p className={styles.status}>여행 정보를 확인하고 있어요.</p>}{error && <p className={styles.error}>{error}</p>}{result && <article className={styles.answer}><p>{result.agent}</p><strong>{result.answer}</strong>{result.recommendations?.map((cruise) => <Link key={cruise.href} href={cruise.href}><small>{cruise.duration}</small><b>{cruise.name}</b><span>{cruise.fromPriceLabel} →</span></Link>)}{result.requiresHumanReview && <a href={KAKAO_CHAT_URL} target="_blank" rel="noreferrer">현지 상담원에게 최종 확인 <span>↗</span></a>}</article>}</div><form onSubmit={(event) => { event.preventDefault(); ask(); }}><label className="sr-only" htmlFor="guide-question">여행 문의</label><input id="guide-question" value={message} onChange={(event) => setMessage(event.target.value)} maxLength="1000" placeholder="예: 8월, 성인 2명, 1박 2일 크루즈 추천" /><button type="submit" disabled={loading || !message.trim()}>안내 받기 <span>→</span></button></form></div></section>
  </main>;
}
