import Link from 'next/link';
import styles from './SupportPage.module.css';

export const kakaoChatUrl = 'http://pf.kakao.com/_zvsxaG/chat';

export default function SupportPage({ eyebrow, title, intro, children }) {
  return <div className={styles.page}>
    <header className={styles.hero}><div className={styles.heroInner}><p className={styles.eyebrow}>{eyebrow}</p><h1>{title}</h1><p className={styles.intro}>{intro}</p></div></header>
    <div className={styles.body}><main className={styles.content}>{children}</main><aside className={styles.aside}><p className={styles.asideLabel}>LOCAL DESK</p><strong>궁금한 점이 있나요?</strong><p>하롱 현지에서 한국어로 답해드려요.</p><a className={styles.kakaoButton} href={kakaoChatUrl} target="_blank" rel="noreferrer">카톡 상담 <span>↗</span></a></aside></div>
    <div className={styles.back}><Link href="/">← 홈으로 돌아가기</Link></div>
  </div>;
}

export function Section({ number, children }) { return <section className={styles.section}><p className={styles.sectionNumber}>{number}</p><div className={styles.sectionText}>{children}</div></section>; }
