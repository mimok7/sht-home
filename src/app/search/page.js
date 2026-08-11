import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import styles from './search.module.css';

export const metadata = { title: '검색 | STAY HALONG' };
export const dynamic = 'force-dynamic';

const sitePages = [
  { title: '임시 첫화면', description: '하롱베이 현지 프리미엄 여행, 크루즈 컬렉션과 한국어 상담을 안내합니다.', href: '/temp-home', type: '페이지' },
  { title: '크루즈', description: '하롱베이 크루즈 상품과 일정, 객실, 요금을 찾아보세요.', href: '/cruises', type: '페이지' },
  { title: '여행 가이드', description: '하롱베이 여행 준비와 현지 정보를 안내합니다.', href: '/travel-guide', type: '페이지' },
  { title: '자주 묻는 질문', description: '예약, 결제, 픽업과 이동, 취소 및 변경 안내를 확인하세요.', href: '/faq', type: '페이지' },
  { title: '공지사항', description: '현지 상담 운영시간과 성수기 크루즈 예약 안내입니다.', href: '/notice', type: '페이지' },
];

function matches(query, ...values) {
  return values.filter(Boolean).join(' ').toLocaleLowerCase('ko-KR').includes(query);
}

async function getCruiseResults(query) {
  const { data, error } = await supabase
    .from('public_cruise_recommendation_v2')
    .select('cruise_id,slug,cruise_name,cruise_name_en,description,category,tags');
  if (error) return [];
  const unique = new Map();
  for (const cruise of data || []) {
    if (unique.has(cruise.cruise_id) || !matches(query, cruise.cruise_name, cruise.cruise_name_en, cruise.description, cruise.category, ...(cruise.tags || []))) continue;
    unique.set(cruise.cruise_id, { title: cruise.cruise_name, description: cruise.description || `${cruise.category || '하롱베이'} 크루즈`, href: cruise.slug ? `/product/${encodeURIComponent(cruise.slug)}` : '/cruises', type: '크루즈' });
  }
  return [...unique.values()];
}

export default async function SearchPage({ searchParams }) {
  const params = await searchParams;
  const query = String(params?.q || '').trim().toLocaleLowerCase('ko-KR');
  const pageResults = query ? sitePages.filter((page) => matches(query, page.title, page.description)) : [];
  const cruiseResults = query ? await getCruiseResults(query) : [];
  const results = [...cruiseResults, ...pageResults];

  return <main className={styles.page}>
    <div className="container">
      <p className={styles.eyebrow}>SITE SEARCH</p>
      <h1>통합 검색</h1>
      <form className={styles.form} action="/search" role="search"><label className="sr-only" htmlFor="search-page-input">검색어</label><input id="search-page-input" name="q" type="search" defaultValue={params?.q || ''} placeholder="크루즈, 여행 정보, 예약 안내를 검색하세요" autoFocus /><button type="submit">검색</button></form>
      {query ? <p className={styles.summary}><b>“{params.q}”</b> 검색 결과 {results.length}건</p> : <p className={styles.summary}>찾고 싶은 크루즈나 여행 정보를 입력해 주세요.</p>}
      {query && <div className={styles.results}>{results.length ? results.map((result, index) => <Link href={result.href} className={styles.result} key={`${result.type}-${result.href}`}><span>{String(index + 1).padStart(2, '0')} / {result.type}</span><div><h2>{result.title}</h2><p>{result.description}</p></div><b>→</b></Link>) : <p className={styles.empty}>일치하는 결과가 없습니다. 다른 검색어로 다시 시도해 주세요.</p>}</div>}
    </div>
  </main>;
}
