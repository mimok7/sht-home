'use client';

import CatalogImage from '@/components/CatalogImage';
import Link from 'next/link';
import { useMemo, useState } from 'react';

function CruiseRepresentativeImage({ cruise, eager = false, highPriority = false }) {
  return <div className="product-image-box">
    {cruise.imageUrl && <CatalogImage
      className="product-representative-image"
      src={cruise.imageUrl}
      alt={`${cruise.name} 대표 이미지`}
      fill
      sizes="(max-width: 720px) calc(100vw - 48px), (max-width: 1200px) calc(50vw - 36px), 566px"
      quality={75}
      loading={eager ? 'eager' : 'lazy'}
      fetchPriority={highPriority ? 'high' : 'auto'}
    />}
    <span className="duration-tag">{cruise.duration || '일정 확인'}</span>
  </div>;
}

export default function CruiseCollection({ cruises }) {
  const [schedule, setSchedule] = useState('all');
  const [rating, setRating] = useState('all');
  const [sort, setSort] = useState('price-desc');
  const filteredCruises = useMemo(() => cruises
    .filter((cruise) => schedule === 'all' || cruise.scheduleTypes.includes(schedule))
    .filter((cruise) => rating === 'all' || Math.floor(Number(cruise.rating)) === Number(rating))
    .sort((left, right) => {
      const leftPrice = left.minPrice ?? (sort === 'price-desc' ? -1 : Number.MAX_SAFE_INTEGER);
      const rightPrice = right.minPrice ?? (sort === 'price-desc' ? -1 : Number.MAX_SAFE_INTEGER);
      return sort === 'price-desc' ? rightPrice - leftPrice : leftPrice - rightPrice;
    }), [cruises, rating, schedule, sort]);

  return (
    <>
      <div className="filter-bar">
        <div className="filter-group">
          <select className="filter-select" value={schedule} onChange={(event) => setSchedule(event.target.value)} aria-label="일정 필터">
            <option value="all">일정 전체</option><option value="DAY">당일 크루즈</option><option value="1N2D">1박 2일</option><option value="2N3D">2박 3일</option>
          </select>
          <select className="filter-select" value={rating} onChange={(event) => setRating(event.target.value)} aria-label="등급 필터">
            <option value="all">등급 전체</option><option value="6">6성급 프리미엄</option><option value="5">5성급 럭셔리</option>
          </select>
        </div>
        <div className="sort-group">
          <select className="filter-select" value={sort} onChange={(event) => setSort(event.target.value)} aria-label="정렬 순서">
            <option value="price-desc">등록요금 높은 순</option><option value="price-asc">등록요금 낮은 순</option>
          </select>
        </div>
      </div>
      {filteredCruises.length === 0 ? (
        <div className="collection-empty"><strong>선택한 조건에 맞는 크루즈가 없습니다.</strong><p>필터를 변경해 다른 상품을 확인해 주세요.</p></div>
      ) : (
        <div className="product-list">
          {filteredCruises.map((cruise, index) => (
            <article key={cruise.id} className="product-list-card">
              <CruiseRepresentativeImage cruise={cruise} eager={index < 2} highPriority={index === 0} />
              <div className="product-details">
                <h2><Link href={`/product/${encodeURIComponent(cruise.slug)}`} prefetch={false}>{cruise.name}</Link></h2>
                <p>{cruise.description || cruise.nameEn || 'Stay Halong이 엄선한 하롱베이 크루즈입니다.'}</p>
                <div className="product-meta"><div className="rating">{cruise.rating ? `★ ${cruise.rating}` : '등급 확인 필요'}</div><div className="price">{cruise.minPrice ? <><span>{cruise.minPrice.toLocaleString()} {cruise.currency}</span> 등록요금부터 · 단위 확인 필요</> : <span>요금 확인 필요</span>}</div></div>
                <Link href={`/product/${encodeURIComponent(cruise.slug)}`} className="product-detail-link" prefetch={false}>상품 상세 및 예약 보기 <span>→</span></Link>
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
