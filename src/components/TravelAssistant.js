'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import styles from './TravelAssistant.module.css';

export default function TravelAssistant() {
  const pathname = usePathname();

  if (pathname.startsWith('/travel-guide')) return null;

  return <section className={styles.assistant} aria-label="여행 안내 바로가기">
    <Link href="/travel-guide" className={styles.launcher}>
      <span className={styles.signal} aria-hidden="true" />
      <span><small>LOCAL DESK</small>여행 안내</span>
      <b>↗</b>
    </Link>
  </section>;
}
