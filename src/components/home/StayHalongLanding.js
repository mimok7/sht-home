'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import styles from '@/app/page.module.css';
import landingStyles from './StayHalongLanding.module.css';

const BOOKING_URL = 'https://customer.stayhalong.com/mypage/direct-booking';
const KAKAO_QUOTE_URL = 'http://pf.kakao.com/_zvsxaG/chat';

export default function StayHalongLanding() {
  const [bookingNoticeOpen, setBookingNoticeOpen] = useState(false);

  useEffect(() => {
    if (!bookingNoticeOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setBookingNoticeOpen(false);
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [bookingNoticeOpen]);

  function openBookingNotice(event) {
    event.preventDefault();
    setBookingNoticeOpen(true);
  }

  return <div className={styles.home}>
    <section className={styles.hero}>
      <div className={styles.heroCopy}>
        <p className={styles.kicker}>CURATED IN HA LONG · 2026</p>
        <h1>하롱베이,<br /><span>머무는 여행<br />되다.</span></h1>
        <p className={styles.description}>배 한 척이 여행의 분위기를 바꿉니다. 현지에서 직접 보고 고른 크루즈로 복잡한 선택은 줄이고, 좋은 순간은 더 오래 남겨보세요.</p>
        <div className={styles.actions}>
          <a href={KAKAO_QUOTE_URL} className={styles.yellowButton} target="_blank" rel="noreferrer">견적 상담 <span>↗</span></a>
          <a href={BOOKING_URL} className={styles.yellowButton} onClick={openBookingNotice}>예약하기 <span>↗</span></a>
          <a href="https://customer.stayhalong.com/mypage" className={styles.yellowButton} target="_blank" rel="noreferrer">예약 확인 <span>↗</span></a>
        </div>
        <div className={landingStyles.contactActions}>
          <a href="http://pf.kakao.com/_zvsxaG/chat" className={styles.yellowButton} target="_blank" rel="noreferrer">카톡 상담 <span>↗</span></a>
          <a href="https://cafe.naver.com/f-e/cafes/31003053/menus/792?viewType=I" className={styles.yellowButton} target="_blank" rel="noreferrer">내 크루즈 찾기 <span>↗</span></a>
          <a href="https://www.youtube.com/@Realhalong" className={styles.yellowButton} target="_blank" rel="noreferrer">유튜브 <span>↗</span></a>
        </div>
        <div className={styles.meta}><span><b>KR</b> 현지 한국어 상담</span><span><b>1:1</b> 맞춤 여행 제안</span></div>
      </div>
      <div className={styles.heroImage} style={{ backgroundColor: 'var(--deep)' }}>
        <Image src="/images/cruises/2.png" alt="석양이 비치는 하롱베이와 크루즈" fill priority sizes="(max-width:800px) 100vw, 57vw" style={{ objectFit: 'contain', objectPosition: 'center top' }} />
        <div className={styles.coordinates}>20°54′N　107°11′E</div>
        <div className={styles.localDesk}><i /><div><small>LOCAL DESK</small><strong>하롱 현지에서 바로 답해요</strong></div></div>
      </div>
    </section>
    <div className={styles.ticker}>STAY SLOW <i>✦</i> SAIL FAR <i>✦</i> FEEL HALONG <i>✦</i> STAY SLOW</div>
    <section className={styles.why}>
      <small>01 / WHY STAY HALONG</small>
      <div className={styles.whyTitle}><p>좋은 여행은</p><h2>더 많이 보는 것<br />보다<br /><span>잘 고르는 것.</span></h2></div>
      <div className={styles.whyBody}><p>사진만 보고 상품을 나열하지 않습니다. 선택의 컨디션, 객실의 실제 전망, 동선과 서비스까지 현지에서 확인하고 추천합니다.</p><ol><li><b>01</b>현지에서 직접 확인한 선박</li><li><b>02</b>숨은 비용 없는 명확한 안내</li><li><b>03</b>예약 이후까지 한국어 케어</li></ol></div>
    </section>
    <section className={styles.route}>
      <div className={styles.routeImage}><Image src="/images/cruises/111.png" alt="크루즈 내부 프리미엄 다이닝 공간" fill sizes="(max-width:800px) 100vw, 48vw" /><strong>ON<br />BOARD</strong></div>
      <div className={styles.routeCopy}><small>03 / YOUR ROUTE</small><h2>처음이라도,<br />선택은 어렵지<br />않게.</h2><ol><li><b>01</b><span><strong>취향을 알려주세요</strong><small>일정, 동행, 원하는 분위기만 간단히.</small></span></li><li><b>02</b><span><strong>현지 큐레이터가 골라요</strong><small>조건에 맞는 선택지만 명확하게.</small></span></li><li><b>03</b><span><strong>예약부터 승선까지</strong><small>한국어로 편안하게 함께합니다.</small></span></li></ol><a href={BOOKING_URL} className={styles.darkButton} onClick={openBookingNotice}>예약하기　↗</a></div>
    </section>
    <section className={styles.final}><small>YOUR BAY. YOUR PACE.</small><h2>이제, 하롱베이에<br /><span>머물러 보세요.</span></h2><a href={BOOKING_URL} onClick={openBookingNotice}>예약 시작하기　↗</a></section>
    {bookingNoticeOpen && <div className={landingStyles.bookingNoticeOverlay} role="dialog" aria-modal="true" aria-labelledby="booking-notice-title" onClick={(event) => { if (event.target === event.currentTarget) setBookingNoticeOpen(false); }}>
      <section className={landingStyles.bookingNoticePanel}>
        <header>
          <div><span>PRODUCT RESERVATION</span><h2 id="booking-notice-title">상품 예약 안내</h2></div>
          <button type="button" onClick={() => setBookingNoticeOpen(false)} aria-label="예약 안내 닫기">닫기 ×</button>
        </header>
        <div className={landingStyles.bookingNoticeBody}>
          <p><strong>이곳은 견적 상담이 아닌, 상품 예약 창입니다.</strong></p>
          <p>신청서를 작성하셔도 금액이 표시되지는 않습니다.</p>
          <p>견적 상담은 아래 카카오톡 채널로 연락해 주세요.</p>
          <a href={KAKAO_QUOTE_URL} target="_blank" rel="noreferrer" className={landingStyles.quoteLink}>견적상담 바로가기 ↗</a>
        </div>
        <footer>
          <button type="button" className={landingStyles.closeButton} onClick={() => setBookingNoticeOpen(false)}>닫기</button>
          <a href={BOOKING_URL} target="_blank" rel="noreferrer" className={landingStyles.bookingButton}>상품 예약 창 열기 ↗</a>
        </footer>
      </section>
    </div>}
  </div>;
}
