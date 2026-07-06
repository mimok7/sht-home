import Image from 'next/image';
import Link from 'next/link';
import styles from './page.module.css';

export default function Home() {
  return (
    <div className={styles.container}>
      {/* Hero Section */}
      <section className={styles.hero}>
        <div className={styles.heroBackground}>
          <Image 
            src="/halong-hero.png" 
            alt="하롱베이의 절경" 
            fill
            priority
            style={{ objectFit: 'cover', objectPosition: 'center' }}
          />
          <div className={styles.heroOverlay}></div>
        </div>
        
        <div className={`container ${styles.heroContent} animate-fade-in`}>
          <h1 className={styles.heroTitle}>
            완벽한 하롱베이의 순간,<br />
            <span>STAY HALONG</span>
          </h1>
          <p className={styles.heroSubtitle}>
            최고급 크루즈부터 프라이빗 투어까지,<br/>
            당신의 여행을 가장 아름답게 디자인합니다.
          </p>
          <div className={styles.heroButtons}>
            <Link href="/cruises" className="btn-primary">크루즈 예약하기</Link>
            <Link href="/tours" className="btn-outline" style={{ color: 'white', borderColor: 'white' }}>당일 투어 보기</Link>
          </div>
        </div>
      </section>

      {/* Services Section */}
      <section className={styles.services}>
        <div className="container">
          <div className={styles.sectionHeader}>
            <h2>우리의 서비스</h2>
            <p>스테이하롱이 제공하는 특별한 경험</p>
          </div>
          
          <div className={styles.serviceGrid}>
            <div className={styles.serviceCard}>
              <div className={styles.serviceIcon}>🚢</div>
              <h3>럭셔리 크루즈 예약</h3>
              <p>1박 2일, 2박 3일 럭셔리 크루즈로 하롱베이의 숨겨진 비경을 탐험하세요.</p>
              <Link href="/cruises" className={styles.serviceLink}>자세히 보기 &rarr;</Link>
            </div>
            <div className={styles.serviceCard}>
              <div className={styles.serviceIcon}>🚌</div>
              <h3>일일 투어 패키지</h3>
              <p>시간이 부족한 분들을 위한 알찬 하롱베이 당일 투어 프로그램을 제공합니다.</p>
              <Link href="/tours" className={styles.serviceLink}>자세히 보기 &rarr;</Link>
            </div>
            <div className={styles.serviceCard}>
              <div className={styles.serviceIcon}>🚘</div>
              <h3>프라이빗 차량 렌트</h3>
              <p>하노이-하롱베이 왕복 편안하고 안전한 프라이빗 차량 서비스를 이용하세요.</p>
              <Link href="/transport" className={styles.serviceLink}>자세히 보기 &rarr;</Link>
            </div>
          </div>
        </div>
      </section>

      {/* Best Products Placeholder Section */}
      <section className={styles.products}>
        <div className="container">
          <div className={styles.sectionHeader}>
            <h2>인기 투어 상품</h2>
            <p>고객님들이 가장 많이 선택하신 베스트 상품</p>
          </div>
          
          <div className={styles.productGrid}>
            {['Catherine Cruise', 'Athena Premium Cruise', 'Lialah Granzer Cruise'].map((item) => (
              <div key={item} className={styles.productCard}>
                <div className={styles.productImagePlaceholder}></div>
                <div className={styles.productInfo}>
                  <span className={styles.productBadge}>BEST</span>
                  <h3>[프리미엄] {item}</h3>
                  <div className={styles.productPrice}>₩ 350,000 ~</div>
                  <Link href={`/product/${encodeURIComponent(item)}`} className="btn-primary" style={{ width: '100%', display: 'block', textAlign: 'center', marginTop: '1rem' }}>예약하기</Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
