import Image from 'next/image';
import Link from 'next/link';
import styles from '@/app/page.module.css';
import landingStyles from './StayHalongLanding.module.css';

export default function ShthomeLanding() {
  return <div className={styles.home}>
    <section className={styles.hero}>
      <div className={styles.heroCopy}>
        <p className={styles.kicker}>STAY HALONG / OFFICIAL HOME</p>
        <h1>하롱베이,<br /><span>머무는 여행<br />되다.</span></h1>
        <p className={styles.description}>현지에서 직접 보고 고른 크루즈와 여행 정보를 한곳에서 만나보세요. 취향에 맞는 하롱베이의 시간을 차분하게 골라드립니다.</p>
        <div className={styles.actions}>
          <Link href="/cruises" className={styles.yellowButton}>크루즈 둘러보기 <span>→</span></Link>
          <Link href="/travel-guide" className={styles.yellowButton}>여행 안내 <span>→</span></Link>
        </div>
        <div className={landingStyles.contactActions}>
          <Link href="/hotels" className={styles.yellowButton}>호텔 찾아보기 <span>→</span></Link>
          <Link href="/faq" className={styles.yellowButton}>고객센터 <span>→</span></Link>
          <Link href="/notice" className={styles.yellowButton}>여행 소식 <span>→</span></Link>
        </div>
        <div className={styles.meta}><span><b>CURATED</b> 현지 확인 컬렉션</span><span><b>KR</b> 한국어 여행 안내</span></div>
      </div>
      <div className={styles.heroImage} style={{ backgroundColor: 'var(--deep)' }}>
        <Image src="/images/cruises/2.png" alt="석양이 비치는 하롱베이와 크루즈" fill priority sizes="(max-width:800px) 100vw, 57vw" style={{ objectFit: 'contain', objectPosition: 'center top' }} />
        <div className={styles.coordinates}>20°54′N　107°11′E</div>
        <div className={styles.localDesk}><i /><div><small>OFFICIAL HOME</small><strong>하롱 여행을 한눈에 살펴보세요</strong></div></div>
      </div>
    </section>
    <div className={styles.ticker}>STAY SLOW <i>✦</i> SAIL FAR <i>✦</i> FEEL HALONG <i>✦</i> STAY SLOW</div>
    <section className={styles.why}>
      <small>01 / WHY STAY HALONG</small>
      <div className={styles.whyTitle}><p>좋은 여행은</p><h2>더 많이 보는 것<br />보다<br /><span>잘 고르는 것.</span></h2></div>
      <div className={styles.whyBody}><p>사진만 보고 상품을 나열하지 않습니다. 선택의 컨디션, 객실의 실제 전망, 동선과 서비스까지 현지에서 확인하고 추천합니다.</p><ol><li><b>01</b>현지에서 직접 확인한 선박</li><li><b>02</b>숨은 비용 없는 명확한 안내</li><li><b>03</b>여행 전후 한국어 케어</li></ol></div>
    </section>
    <section className={styles.route}>
      <div className={styles.routeImage}><Image src="/images/cruises/111.png" alt="크루즈 내부 프리미엄 다이닝 공간" fill sizes="(max-width:800px) 100vw, 48vw" /><strong>ON<br />BOARD</strong></div>
      <div className={styles.routeCopy}><small>02 / EXPLORE HALONG</small><h2>처음이라도,<br />하롱은 어렵지<br />않게.</h2><ol><li><b>01</b><span><strong>크루즈를 비교하세요</strong><small>여정과 객실, 분위기를 한눈에 확인합니다.</small></span></li><li><b>02</b><span><strong>여행 정보를 살펴보세요</strong><small>현지 이동과 일정 준비를 도와드립니다.</small></span></li><li><b>03</b><span><strong>필요할 때 문의하세요</strong><small>한국어로 편안하게 안내합니다.</small></span></li></ol><Link href="/cruises" className={styles.darkButton}>크루즈 컬렉션 보기　→</Link></div>
    </section>
    <section className={styles.final}><small>YOUR BAY. YOUR PACE.</small><h2>이제, 하롱베이를<br /><span>살펴보세요.</span></h2><Link href="/travel-guide">하롱 여행 안내 보기　→</Link></section>
  </div>;
}
