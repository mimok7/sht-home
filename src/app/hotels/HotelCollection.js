'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import CruiseMediaGallery from '@/components/CruiseMediaGallery';
import './HotelCollection.css';

function hotelArea(location) {
  if (/하노이/.test(location)) return 'hanoi';
  if (/하롱|바이짜이|스코어베이/.test(location)) return 'halong';
  return 'other';
}

function formatPrice(value, currency) {
  return value ? `${value.toLocaleString('ko-KR')} ${currency}` : '요금 문의';
}

function RotatingHotelImage({ hotel, index }) {
  const [imageIndex, setImageIndex] = useState(0);
  const images = hotel.mainImages?.length ? hotel.mainImages : hotel.imageUrl ? [{ id: 'hero', url: hotel.imageUrl, alt: `${hotel.name} 대표 이미지` }] : [];

  useEffect(() => {
    if (images.length < 2) return undefined;
    const timer = window.setInterval(() => setImageIndex((current) => (current + 1) % images.length), 20000);
    return () => window.clearInterval(timer);
  }, [images.length]);

  if (!images.length) return <div className="hotel-card-image hotel-card-image-empty" role="img" aria-label={`${hotel.name} 이미지 준비 중`}><span>HOTEL / IMAGE ARCHIVE</span><strong>PHOTO<br />PENDING</strong></div>;

  return <CruiseMediaGallery cruiseName={hotel.name} duration={`HOTEL / ${String(index + 1).padStart(2, '0')}`} heroImage={hotel.imageUrl} displayImage={images[imageIndex]?.url} groups={[{ id: 'main', label: '대표 이미지', eyebrow: 'HOTEL', images }]} showArchive={false} mainClassName="hotel-card-image" />;
}

export default function HotelCollection({ hotels }) {
  const [area, setArea] = useState('all');
  const [rating, setRating] = useState('all');
  const [sort, setSort] = useState('recommended');
  const filteredHotels = useMemo(() => hotels
    .filter((hotel) => area === 'all' || hotelArea(hotel.location) === area)
    .filter((hotel) => rating === 'all' || Number(hotel.rating) === Number(rating))
    .sort((left, right) => {
      if (sort === 'recommended') {
        const leftRanked = Number.isFinite(left.priorityPosition);
        const rightRanked = Number.isFinite(right.priorityPosition);
        if (leftRanked !== rightRanked) return leftRanked ? -1 : 1;
        if (leftRanked && left.priorityPosition !== right.priorityPosition) return left.priorityPosition - right.priorityPosition;
        return left.name.localeCompare(right.name, 'ko');
      }
      if (sort === 'name') return left.name.localeCompare(right.name, 'ko');
      const leftPrice = left.minPrice ?? Number.MAX_SAFE_INTEGER;
      const rightPrice = right.minPrice ?? Number.MAX_SAFE_INTEGER;
      return sort === 'price-desc' ? rightPrice - leftPrice : leftPrice - rightPrice;
    }), [area, hotels, rating, sort]);

  return (
    <>
      <section className="hotel-filter-bar" aria-label="호텔 목록 필터">
        <div className="hotel-filter-group">
          <label><span className="sr-only">지역 필터</span><select value={area} onChange={(event) => setArea(event.target.value)}><option value="all">지역 전체</option><option value="halong">하롱베이</option><option value="hanoi">하노이</option></select></label>
          <label><span className="sr-only">등급 필터</span><select value={rating} onChange={(event) => setRating(event.target.value)}><option value="all">등급 전체</option><option value="5">5성급</option></select></label>
        </div>
        <label className="hotel-sort"><span className="sr-only">정렬 순서</span><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="recommended">추천순</option><option value="price-asc">등록요금 낮은 순</option><option value="price-desc">등록요금 높은 순</option><option value="name">이름순</option></select></label>
      </section>

      {filteredHotels.length === 0 ? (
        <div className="hotel-collection-empty"><strong>선택한 조건에 맞는 호텔이 없습니다.</strong><p>필터를 변경해 다른 호텔을 확인해 주세요.</p></div>
      ) : (
        <section className="hotel-list" aria-label="호텔 목록">
          {filteredHotels.map((hotel, index) => (
            <article className="hotel-card" key={hotel.id}>
              <RotatingHotelImage hotel={hotel} index={index} />
              <div className="hotel-card-copy">
                <div className="hotel-card-location">{hotel.location}</div>
                <h2>{hotel.name}</h2>
                <p>{hotel.description || '스테이하롱 현지 데스크가 일정에 맞춰 추천하는 호텔입니다.'}</p>
                <dl>
                  <div><dt>RATING</dt><dd>{hotel.rating ? `${hotel.rating} STAR` : '등급 확인 중'}</dd></div>
                  <div><dt>FROM</dt><dd>{formatPrice(hotel.minPrice, hotel.currency)}</dd></div>
                </dl>
                <Link className="hotel-inquiry-link" href={`/hotels/${encodeURIComponent(hotel.id)}`}>객실 상세 및 예약 보기 <span>→</span></Link>
              </div>
            </article>
          ))}
        </section>
      )}
    </>
  );
}
