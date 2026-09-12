'use client';

import Link from 'next/link';
import { use, useEffect, useMemo, useState } from 'react';
import CruiseMediaGallery from '@/components/CruiseMediaGallery';
import { resolvePublicMediaUrl } from '@/lib/public-media-url';
import { getPlatformCartSession, hydrateBookingCart, queueBookingCartItemAfterLogin, replaceBookingCartItem } from '@/lib/booking-cart';
import '../hotel-detail.css';
import '../hotel-cart.css';

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function formatPrice(value, currency = 'VND') {
  const amount = positiveNumber(value);
  return amount ? `${amount.toLocaleString('ko-KR')} ${currency}` : '요금 문의';
}

function proxiedImageUrl(imageUrl) {
  const resolvedUrl = resolvePublicMediaUrl(imageUrl);
  if (!resolvedUrl || !/^https?:\/\//i.test(resolvedUrl)) return resolvedUrl;
  try {
    if (!new URL(resolvedUrl).hostname.endsWith('.supabase.co')) return resolvedUrl;
  } catch {
    return resolvedUrl;
  }
  return `/api/public-image?url=${encodeURIComponent(resolvedUrl)}`;
}

function dateMatches(rate, date) {
  if (!date) return true;
  return (!rate.validFrom || rate.validFrom <= date) && (!rate.validTo || rate.validTo >= date);
}

function roomName(payload, price) {
  return payload?.room_name || payload?.room_type || price?.label || '객실명 확인 중';
}

const HOTEL_MEDIA_LABELS = {
  main: { label: '대표 이미지', eyebrow: 'HOTEL' },
  exterior: { label: '익스테리어', eyebrow: 'EXTERIOR' },
  interior: { label: '인테리어', eyebrow: 'INTERIOR' },
  menu: { label: '메뉴', eyebrow: 'DINING' },
  other: { label: '추가 이미지', eyebrow: 'GALLERY' },
};

function hotelMediaCategory(image) {
  if (image.collection === 'hotel_menu') return 'menu';
  const source = `${image.collection || ''} ${image.image_name || ''}`;
  if (/exterior|외관/i.test(source)) return 'exterior';
  if (/interior|인테리어|내부/i.test(source)) return 'interior';
  if (/menu|메뉴/i.test(source)) return 'menu';
  if (/main|hero|대표/i.test(source) || image.is_primary) return 'main';
  return image.collection === 'hotel_import' ? 'main' : 'other';
}

function buildHotelMediaGroups(imageRows, hotelName) {
  const groups = new Map();
  for (const image of imageRows || []) {
    if (image.hotel_price_code || !image.image_url) continue;
    const category = hotelMediaCategory(image);
    if (!groups.has(category)) groups.set(category, { id: category, ...HOTEL_MEDIA_LABELS[category], images: [] });
    const url = proxiedImageUrl(image.image_url);
    const images = groups.get(category).images;
    if (!images.some((current) => current.url === url)) {
      images.push({ id: image.id, url, alt: image.image_name || `${hotelName} ${HOTEL_MEDIA_LABELS[category].label}` });
    }
  }
  return ['main', 'exterior', 'interior', 'menu', 'other'].map((category) => groups.get(category)).filter(Boolean);
}

function buildRooms(detailRows, priceRows, imageRows) {
  const pricesByCode = new Map((priceRows || []).map((price) => [String(price.source_id), price]));
  const imagesByCode = new Map();
  for (const image of imageRows || []) {
    if (!image.hotel_price_code || !image.image_url) continue;
    const code = String(image.hotel_price_code);
    if (!imagesByCode.has(code)) imagesByCode.set(code, []);
    const images = imagesByCode.get(code);
    const imageUrl = proxiedImageUrl(image.image_url);
    if (!images.some((current) => current.url === imageUrl)) images.push({ id: image.id, url: imageUrl, alt: `${code} 객실 이미지` });
  }

  return (detailRows || []).map((detail) => {
    const payload = detail.payload || {};
    const price = pricesByCode.get(String(detail.source_id));
    const images = imagesByCode.get(String(detail.source_id)) || [];
    return {
      id: String(detail.source_id), name: roomName(payload, price), roomType: payload.room_type || '', category: payload.room_category || '',
      maxGuests: positiveNumber(payload.occupancy_max) || positiveNumber(price?.max_guests), breakfast: payload.include_breakfast,
      childPolicy: payload.child_policy || '', notes: payload.notes || '', validFrom: price?.valid_from || payload.start_date || '',
      validTo: price?.valid_to || payload.end_date || '', price: price?.price_amount ?? payload.base_price, currency: price?.currency || 'VND',
      priceUnit: price?.price_unit || 'per_room', images,
    };
  }).sort((left, right) => left.name.localeCompare(right.name, 'ko'));
}

function buildSourceRooms(roomRows, imageRows) {
  const imagesByCode = new Map();
  for (const image of imageRows || []) {
    if (!image.hotel_price_code || !image.image_url) continue;
    const code = String(image.hotel_price_code);
    if (!imagesByCode.has(code)) imagesByCode.set(code, []);
    const url = proxiedImageUrl(image.image_url);
    const images = imagesByCode.get(code);
    if (!images.some((current) => current.url === url)) images.push({ id: image.id, url, alt: `${code} 객실 이미지` });
  }
  return (roomRows || []).map((room) => ({
    ...room,
    images: imagesByCode.get(String(room.id)) || [],
  })).sort((left, right) => left.name.localeCompare(right.name, 'ko'));
}

function roomFacts(room) {
  return [room.roomType && `객실 유형 ${room.roomType}`, room.category && `객실 구분 ${room.category}`, room.maxGuests && `최대 ${room.maxGuests}명`, room.breakfast === true ? '조식 포함' : room.breakfast === false ? '조식 미포함' : null].filter(Boolean);
}

function editCartItemIdFromLocation() {
  if (typeof window === 'undefined') return '';
  return new URLSearchParams(window.location.search).get('editCartItem') || '';
}

export default function HotelDetail({ params }) {
  const { id } = use(params);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [hotel, setHotel] = useState(null);
  const [rooms, setRooms] = useState([]);
  const [hotelMediaGroups, setHotelMediaGroups] = useState([]);
  const [selectedRoomId, setSelectedRoomId] = useState('');
  const [detailRoomId, setDetailRoomId] = useState('');
  const [stayDate, setStayDate] = useState('');
  const [guests, setGuests] = useState(2);
  const [roomCount, setRoomCount] = useState(1);
  const [cartMessage, setCartMessage] = useState('');
  const [editingCartItemId, setEditingCartItemId] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function fetchHotel() {
      setLoading(true); setLoadError('');
      const hotelId = decodeURIComponent(id);
      let detailPayload;
      try {
        const detailResponse = await fetch(`/api/public-product-detail?service=hotel&id=${encodeURIComponent(hotelId)}`);
        if (!detailResponse.ok) throw new Error('호텔 상세 조회 실패');
        detailPayload = await detailResponse.json();
      } catch (error) {
        console.error('Failed to load hotel detail:', error?.message || error);
        if (!cancelled) { setLoadError('현재 공개된 호텔 정보를 찾을 수 없습니다.'); setLoading(false); }
        return;
      }
      if (cancelled) return;
      if (hotelId.startsWith('hotel-code-')) {
        try {
          const source = detailPayload.source;
          if (!source) throw new Error('호텔 원본 조회 실패');
          const imageRows = (source.images || []).map((image) => ({
            id: image.id,
            hotel_price_code: image.hotelPriceCode,
            collection: image.collection,
            image_name: image.imageName,
            image_url: image.url,
            sort_order: image.sortOrder,
            is_primary: image.isPrimary,
          }));
          const nextMediaGroups = buildHotelMediaGroups(imageRows, source.hotel.name);
          const galleryFirstImage = nextMediaGroups.flatMap((group) => group.images)[0]?.url || '';
          const nextRooms = buildSourceRooms(source.rooms || [], imageRows);
          let editingItem = null;
          const editCartItemId = editCartItemIdFromLocation();
          if (editCartItemId) {
            const cart = await hydrateBookingCart();
            if (cancelled) return;
            editingItem = cart.items.find((item) => item.id === editCartItemId && item.serviceType === 'hotel' && String(item.productId) === hotelId) || null;
          }
          const editingRoom = editingItem && nextRooms.find((room) => room.id === editingItem.optionId);
          setHotel({ id: hotelId, name: source.hotel.name, description: source.hotel.description, location: source.hotel.location || '지역 확인 중', rating: positiveNumber(source.hotel.rating), heroImage: galleryFirstImage });
          setHotelMediaGroups(nextMediaGroups); setRooms(nextRooms); setSelectedRoomId(editingRoom?.id || nextRooms[0]?.id || '');
          setStayDate(editingItem?.startDate || ''); setGuests(Math.max(1, Number(editingItem?.adults || 2))); setRoomCount(Math.max(1, Number(editingItem?.quantity || 1))); setEditingCartItemId(editingItem?.id || ''); setLoading(false);
          return;
        } catch (error) {
          console.error('Failed to load source hotel detail:', error?.message || error);
          if (!cancelled) { setLoadError('현재 공개된 호텔 정보를 찾을 수 없습니다.'); setLoading(false); }
          return;
        }
      }
      if (detailPayload.notFound || !detailPayload.hotel) { setLoadError('현재 공개된 호텔 정보를 찾을 수 없습니다.'); setLoading(false); return; }
      const product = detailPayload.hotel;
      const imageRows = detailPayload.images || [];
      const nextMediaGroups = buildHotelMediaGroups(imageRows, product.name_ko);
      const galleryFirstImage = nextMediaGroups.flatMap((group) => group.images)[0]?.url;
      const nextRooms = buildRooms(detailPayload.details || [], detailPayload.prices || [], imageRows);
      let editingItem = null;
      const editCartItemId = editCartItemIdFromLocation();
      if (editCartItemId) {
        const cart = await hydrateBookingCart();
        if (cancelled) return;
        editingItem = cart.items.find((item) => item.id === editCartItemId && item.serviceType === 'hotel' && String(item.productId) === String(product.id)) || null;
      }
      const editingRoom = editingItem && nextRooms.find((room) => room.id === editingItem.optionId);
      setHotel({ id: product.id, name: product.manual_override?.name_ko || product.name_ko, description: product.manual_override?.description ?? product.description, location: product.metadata?.location || '지역 확인 중', rating: positiveNumber(product.metadata?.star_rating), heroImage: proxiedImageUrl(product.manual_override?.image_url || product.image_url) || galleryFirstImage || '' });
      setHotelMediaGroups(nextMediaGroups); setRooms(nextRooms); setSelectedRoomId(editingRoom?.id || nextRooms[0]?.id || '');
      setStayDate(editingItem?.startDate || ''); setGuests(Math.max(1, Number(editingItem?.adults || 2))); setRoomCount(Math.max(1, Number(editingItem?.quantity || 1))); setEditingCartItemId(editingItem?.id || ''); setLoading(false);
    }
    fetchHotel();
    return () => { cancelled = true; };
  }, [id]);

  const availableRooms = useMemo(() => rooms.filter((room) => dateMatches(room, stayDate)), [rooms, stayDate]);
  const selectedRoom = availableRooms.find((room) => room.id === selectedRoomId) || availableRooms[0] || null;
  const detailRoom = rooms.find((room) => room.id === detailRoomId) || null;

  useEffect(() => {
    if (!detailRoom) return undefined;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event) => { if (event.key === 'Escape') setDetailRoomId(''); };
    document.body.style.overflow = 'hidden'; window.addEventListener('keydown', closeOnEscape);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener('keydown', closeOnEscape); };
  }, [detailRoom]);

  async function handleAddToCart() {
    if (!selectedRoom || !stayDate) {
      setCartMessage('객실과 투숙일을 선택해 주세요.');
      return;
    }
    const checkoutDate = new Date(`${stayDate}T00:00:00Z`);
    checkoutDate.setUTCDate(checkoutDate.getUTCDate() + 1);
    const checkout = checkoutDate.toISOString().slice(0, 10);
    const nextItem = {
      id: `hotel:${selectedRoom.id}:${stayDate}`,
      serviceType: 'hotel', productId: hotel.id, optionId: selectedRoom.id,
      name: hotel.name, optionName: selectedRoom.name, startDate: stayDate, endDate: checkout,
      adults: guests, children: 0, infants: 0, quantity: roomCount,
      unitPrice: positiveNumber(selectedRoom.price) || 0, currency: selectedRoom.currency,
      priceStatus: 'reference', sourceHref: `/hotels/${encodeURIComponent(hotel.id)}`,
      metadata: { priceUnit: selectedRoom.priceUnit, platform: { contractVersion: 1, hotelPriceCode: selectedRoom.id, checkin: stayDate, checkout, roomCount, adultCount: guests, childCount: 0, infantCount: 0, requestNote: '' } },
    };
    const session = await getPlatformCartSession();
    if (!session) {
      const next = `${window.location.pathname}${window.location.search}`;
      queueBookingCartItemAfterLogin(nextItem, editingCartItemId, next);
      window.location.replace(`/login?next=${encodeURIComponent(next)}`);
      return;
    }
    const savedItem = replaceBookingCartItem(editingCartItemId, nextItem);
    setEditingCartItemId(savedItem.id);
    setCartMessage(editingCartItemId ? '선택 내용을 수정했습니다. 장바구니의 기존 항목을 교체했습니다.' : '호텔을 장바구니에 담았습니다. 크루즈와 다른 서비스도 함께 결제 준비할 수 있습니다.');
  }

  if (loading) return <div className="hotel-detail-state"><span>STAY HALONG / HOTEL</span><h1>호텔 객실을<br />불러오는 중입니다.</h1><i aria-hidden="true" /><p>객실 정보와 등록 요금을 확인하고 있습니다.</p></div>;
  if (!hotel || loadError) return <div className="hotel-detail-state hotel-detail-state-error"><span>STAY HALONG / NOT FOUND</span><h1>호텔을 찾을 수 없습니다.</h1><p>{loadError}</p><Link href="/hotels">호텔 목록으로 돌아가기 →</Link></div>;

  const displayMediaGroups = hotelMediaGroups.length
    ? hotelMediaGroups
    : hotel.heroImage ? [{ id: 'main', label: '대표 이미지', eyebrow: 'HOTEL', images: [{ id: 'hero', url: hotel.heroImage, alt: `${hotel.name} 대표 이미지` }] }] : [];

  return <div className="hotel-detail-page">
    <div className="hotel-detail-hero" style={{ backgroundImage: hotel.heroImage ? `url(${hotel.heroImage})` : undefined }}><div /></div>
    <div className="container hotel-detail-layout">
      <main className="hotel-detail-main">
        <Link href="/hotels" className="hotel-back-link">← 호텔 목록</Link>
        <header className="hotel-detail-header"><span>HOTEL / ROOM RESERVATION</span><h1>{hotel.name}</h1><p className="hotel-detail-location">{hotel.location}{hotel.rating ? ` · ★ ${hotel.rating}` : ''}</p><p className="hotel-detail-description">{hotel.description || 'Stay Halong이 엄선한 호텔의 객실과 등록 요금을 확인해 보세요.'}</p></header>
        {displayMediaGroups.length > 0 && <section className="hotel-photo-archive"><CruiseMediaGallery cruiseName={hotel.name} heroImage={hotel.heroImage} groups={displayMediaGroups} /></section>}
        <section className="hotel-rooms-section"><div className="hotel-section-heading"><div><span>01 / ROOMS</span><h2>객실 및 등록 요금</h2></div><label>투숙일<input type="date" value={stayDate} onChange={(event) => setStayDate(event.target.value)} /></label></div><p className="hotel-price-notice">표시된 금액은 객실 기준 등록 요금입니다. 객실 가능 여부와 최종 요금은 상담을 통해 확정됩니다.</p>
          {availableRooms.length === 0 ? <p className="hotel-no-rooms">선택한 투숙일에 적용되는 등록 객실이 없습니다. 상담으로 확인해 주세요.</p> : <div className="hotel-room-list">{availableRooms.map((room, index) => {
            const roomGroup = room.images.length ? { id: `room-${room.id}`, label: room.name, eyebrow: 'ROOM', images: room.images } : null;
            return <article className={`hotel-room-row ${selectedRoom?.id === room.id ? 'selected' : ''}`} key={room.id}><div className="hotel-room-media">{roomGroup ? <CruiseMediaGallery cruiseName={hotel.name} heroImage={room.images[0].url} groups={[roomGroup]} mainGroupId={roomGroup.id} mainClassName="hotel-room-image" showArchive={false} showMainMeta={false} /> : <span className="hotel-room-image hotel-room-image-empty">ROOM / {String(index + 1).padStart(2, '0')}</span>}<button type="button" className="hotel-room-detail-button" onClick={() => { setSelectedRoomId(room.id); setDetailRoomId(room.id); }}>상세 안내 ↗</button></div><button type="button" className="hotel-room-select" onClick={() => setSelectedRoomId(room.id)}><span><strong>{room.name}</strong><small>{roomFacts(room).join(' · ') || '상세 정보는 상담 시 안내합니다.'}</small></span><span className="hotel-room-price"><small>객실 1실 기준</small><b>{formatPrice(room.price, room.currency)}</b></span></button></article>;
          })}</div>}
        </section>
      </main>
      <aside className="hotel-booking-sidebar"><div className="hotel-booking-card"><span>SELECTED ROOM</span><h2>객실 예약</h2><p>호텔과 크루즈 등 선택 상품을 한 장바구니에서 확인할 수 있습니다.</p><label>선택 객실<input value={selectedRoom?.name || '객실을 선택하세요'} readOnly /></label><label>투숙일<input type="date" value={stayDate} onChange={(event) => { setStayDate(event.target.value); setCartMessage(''); }} /></label><label>투숙 인원<select value={guests} onChange={(event) => setGuests(Number(event.target.value))}>{[1, 2, 3, 4, 5, 6].map((value) => <option value={value} key={value}>{value}명</option>)}</select></label><label>객실 수<select value={roomCount} onChange={(event) => setRoomCount(Number(event.target.value))}>{[1, 2, 3, 4, 5].map((value) => <option value={value} key={value}>{value}실</option>)}</select></label><div className="hotel-booking-price"><span>등록 요금 참고</span><strong>{formatPrice((positiveNumber(selectedRoom?.price) || 0) * roomCount, selectedRoom?.currency)}</strong><small>{selectedRoom?.priceUnit === 'per_room' ? `객실 ${roomCount}실 기준` : '가격 기준은 상담 시 확인'}</small></div><button type="button" className="hotel-booking-cta" onClick={handleAddToCart}>{editingCartItemId ? '선택 수정 저장' : '장바구니에 담기'} <span>{editingCartItemId ? '→' : '＋'}</span></button>{cartMessage && <p role="status">{cartMessage} <Link href="/booking/cart">장바구니 보기 →</Link></p>}<a className="hotel-booking-cta hotel-booking-secondary" href="http://pf.kakao.com/_zvsxaG/chat" target="_blank" rel="noreferrer">카카오톡으로 예약 문의 <span>→</span></a></div></aside>
    </div>
    {detailRoom && <div className="hotel-room-modal" role="dialog" aria-modal="true" aria-labelledby="hotel-room-modal-title" onClick={(event) => { if (event.target === event.currentTarget) setDetailRoomId(''); }}><section><header><div><span>ROOM DETAIL</span><h2 id="hotel-room-modal-title">{detailRoom.name}</h2></div><button type="button" onClick={() => setDetailRoomId('')}>닫기 ×</button></header><div className="hotel-room-modal-content"><div className="hotel-room-facts">{roomFacts(detailRoom).map((fact) => <span key={fact}>{fact}</span>)}</div>{detailRoom.notes && <div><strong>객실 안내</strong><p>{detailRoom.notes}</p></div>}{detailRoom.childPolicy && <div><strong>아동 정책</strong><p>{detailRoom.childPolicy}</p></div>}<dl><div><dt>등록 요금</dt><dd>{formatPrice(detailRoom.price, detailRoom.currency)}</dd></div><div><dt>적용 기간</dt><dd>{detailRoom.validFrom || detailRoom.validTo ? `${detailRoom.validFrom || '상시'} ~ ${detailRoom.validTo || '상시'}` : '상담 확인'}</dd></div><div><dt>가격 기준</dt><dd>{detailRoom.priceUnit === 'per_room' ? '객실 1실 기준' : '상담 확인'}</dd></div></dl></div></section></div>}
  </div>;
}
