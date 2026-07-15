import Image from 'next/image';
import Link from 'next/link';
import styles from './page.module.css';

export default function Home() {
  return (
    <div className={styles.home}>
      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.kicker}>CURATED IN HA LONG · 2026</p>
          <h1>하롱베이,<br /><span>머무는 여행</span>이 되다.</h1>
          <p className={styles.description}>배 한 척이 여행의 분위기를 바꿉니다. 현지에서 직접 보고 고른 크루즈로 복잡한 선택은 줄이고, 좋은 순간은 더 오래 남겨보세요.</p>
          <div className={styles.actions}>
            <a href="https://cafe.naver.com/f-e/cafes/31003053/menus/792?viewType=I" className={styles.yellowButton} target="_blank" rel="noreferrer">내 크루즈 찾기 <span>↗</span></a>
            <a href="https://customer.stayhalong.com/" className={styles.yellowButton} target="_blank" rel="noreferrer">예약하기 <span>↗</span></a>
          </div>
          <div className={styles.contactActions}>
            <a href="http://pf.kakao.com/_zvsxaG/chat" className={styles.yellowButton} target="_blank" rel="noreferrer">카톡 상담 <span>↗</span></a>
            <a href="https://www.youtube.com/@Realhalong" className={styles.yellowButton} target="_blank" rel="noreferrer">유튜브 <span>↗</span></a>
          </div>
          <div className={styles.meta}><span><b>23</b> CURATED CRUISES</span><span><b>KR</b> 현지 한국어 상담</span></div>
        </div>

        <div className={styles.heroImage} style={{ backgroundColor: 'var(--deep)' }}>
          <Image
            src="/images/cruises/2.png"
            alt="석양이 비치는 하롱베이와 크루즈"
            fill
            priority
            sizes="(max-width:800px) 100vw, 57vw"
            style={{ objectFit: 'contain', objectPosition: 'center top' }}
          />
          <div className={styles.coordinates}>20°54′N　107°11′E</div>
          <div className={styles.localDesk}><i /><div><small>LOCAL DESK</small><strong>하롱 현지에서 바로 답해요</strong></div></div>
        </div>

      </section>

      <div className={styles.ticker}>STAY SLOW <i>✦</i> SAIL FAR <i>✦</i> FEEL HALONG <i>✦</i> STAY SLOW</div>

      <section className={styles.why}>
        <small>01 / WHY STAY HALONG</small>
        <div className={styles.whyTitle}><p>좋은 여행은</p><h2>더 많이 보는 것보다<br /><span>잘 고르는 것.</span></h2></div>
        <div className={styles.whyBody}>
          <p>사진만 보고 상품을 나열하지 않습니다. 선택의 컨디션, 객실의 실제 전망, 동선과 서비스까지 현지에서 확인하고 추천합니다.</p>
          <ol><li><b>01</b>현지에서 직접 확인한 선박</li><li><b>02</b>숨은 비용 없는 명확한 안내</li><li><b>03</b>예약 이후까지 한국어 케어</li></ol>
        </div>
      </section>

      <section className={styles.route}>
        <div className={styles.routeImage}>
          <Image src="/images/cruises/111.png" alt="크루즈 내부 프리미엄 다이닝 공간" fill sizes="(max-width:800px) 100vw, 48vw" />
          <strong>ON<br />BOARD</strong>
        </div>
        <div className={styles.routeCopy}>
          <small>03 / YOUR ROUTE</small><h2>처음이라도,<br />선택은 어렵지 않게.</h2>
          <ol><li><b>01</b><span><strong>취향을 알려주세요</strong><small>일정, 동행, 원하는 분위기만 간단히.</small></span></li><li><b>02</b><span><strong>현지 큐레이터가 골라요</strong><small>조건에 맞는 선택지만 명확하게.</small></span></li><li><b>03</b><span><strong>예약부터 승선까지</strong><small>한국어로 편안하게 함께합니다.</small></span></li></ol>
          <Link href="/cruises" className={styles.darkButton}>여정 시작하기　→</Link>
        </div>
      </section>

      <section className={styles.final}><small>YOUR BAY. YOUR PACE.</small><h2>이제, 하롱베이에<br /><span>머물러 보세요.</span></h2><Link href="/cruises">크루즈 컬렉션 보기　↗</Link></section>
    </div>
  );
}
