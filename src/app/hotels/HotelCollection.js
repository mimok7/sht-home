'use client';

import { useMemo, useState } from 'react';

function hotelArea(location) {
  if (/하노이/.test(location)) return 'hanoi';
  if (/하롱|바이짜이|스코어베이/.test(location)) return 'halong';
  return 'other';
}

function formatPrice(value, currency) {
  return value ? `${value.toLocaleString('ko-KR')} ${currency}` : '요금 문의';
}

export default function HotelCollection({ hotels }) {
  const [area, setArea] = useState('all');
  const [rating, setRating] = useState('all');
  const [sort, setSort] = useState('price-asc');
  const filteredHotels = useMemo(() => hotels
    .filter((hotel) => area === 'all' || hotelArea(hotel.location) === area)
    .filter((hotel) => rating === 'all' || Number(hotel.rating) === Number(rating))
    .sort((left, right) => {
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
        <label className="hotel-sort"><span className="sr-only">정렬 순서</span><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="price-asc">등록요금 낮은 순</option><option value="price-desc">등록요금 높은 순</option><option value="name">이름순</option></select></label>
      </section>

      {filteredHotels.length === 0 ? (
        <div className="hotel-collection-empty"><strong>선택한 조건에 맞는 호텔이 없습니다.</strong><p>필터를 변경해 다른 호텔을 확인해 주세요.</p></div>
      ) : (
        <section className="hotel-list" aria-label="호텔 목록">
          {filteredHotels.map((hotel, index) => (
            <article className="hotel-card" key={hotel.id}>
              {hotel.imageUrl ? (
                <div className="hotel-card-image" role="img" aria-label={`${hotel.name} 대표 이미지`} style={{ backgroundImage: `url(${hotel.imageUrl})` }}><span>HOTEL / {String(index + 1).padStart(2, '0')}</span></div>
              ) : (
                <div className="hotel-card-image hotel-card-image-empty" role="img" aria-label={`${hotel.name} 이미지 준비 중`}><span>HOTEL / IMAGE ARCHIVE</span><strong>PHOTO<br />PENDING</strong></div>
              )}
              <div className="hotel-card-copy">
                <div className="hotel-card-location">{hotel.location}</div>
                <h2>{hotel.name}</h2>
                <p>{hotel.description || '스테이하롱 현지 데스크가 일정에 맞춰 추천하는 호텔입니다.'}</p>
                <dl>
                  <div><dt>RATING</dt><dd>{hotel.rating ? `${hotel.rating} STAR` : '등급 확인 중'}</dd></div>
                  <div><dt>FROM</dt><dd>{formatPrice(hotel.minPrice, hotel.currency)}</dd></div>
                </dl>
                <a className="hotel-inquiry-link" href="http://pf.kakao.com/_zvsxaG/chat" target="_blank" rel="noreferrer">객실·예약 문의 <span>→</span></a>
              </div>
            </article>
          ))}
        </section>
      )}
    </>
  );
}
