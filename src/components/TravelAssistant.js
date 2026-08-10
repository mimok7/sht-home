'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import styles from './TravelAssistant.module.css';

export default function TravelAssistant() {
  const pathname = usePathname();

  if (pathname.startsWith('/travel-guide')) return null;

  const disabled = pathname === '/temp-home';

  return <section className={styles.assistant} aria-label="여행 안내 바로가기">
    {disabled ? <button type="button" className={styles.launcher} disabled aria-label="LOCAL DESK 여행 안내는 현재 이용할 수 없습니다"><span className={styles.signal} aria-hidden="true" /><span><small>LOCAL DESK</small>여행 안내</span><b>↗</b></button> : <Link href="/travel-guide" className={styles.launcher}><span className={styles.signal} aria-hidden="true" /><span><small>LOCAL DESK</small>여행 안내</span><b>↗</b></Link>}
  </section>;
}
