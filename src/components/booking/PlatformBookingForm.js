// 고객앱 예약 조건을 홈페이지 디자인으로 입력해 홈페이지 DB 장바구니에 저장한다.
'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import BookingCartLink from '@/components/BookingCartLink';
import { getPlatformCartSession, hydrateBookingCart, queueBookingCartItemAfterLogin, replaceBookingCartItem, syncBookingCart } from '@/lib/booking-cart';
import { loadPlatformBookingOptions, uniqueValues, validOn } from '@/lib/platform-booking-options';
import { platformSupabase } from '@/lib/platform-supabase';

const SERVICES = {
  cruise: { label: '크루즈 예약', example: '크루즈 객실' },
  cruise_vehicle: { label: '크루즈 차량예약', example: '크루즈 차량' },
  airport: { label: '공항 서비스 예약', example: '공항 이동' },
  hotel: { label: '호텔 예약', example: '호텔 객실' },
  rentcar: { label: '렌터카 예약', example: '렌터카' },
  tour: { label: '투어 예약', example: '투어' },
  package: { label: '패키지 예약', example: '올인원 패키지' },
  ticket: { label: '티켓 예약', example: '티켓' },
};

const SCHEDULES = ['1박2일', '2박3일', '당일'];
const WAY_TYPES = ['편도', '당일왕복', '다른날왕복', '시내당일렌트'];
const TOUR_NAMES = ['닌빈 한국어 가이드 투어', '하노이 역사투어', '하노이 오후 투어', '하노이 원데이 당일투어'];

function scheduleLabel(value) {
  return ({ DAY: '당일', '1N2D': '1박2일', '2N3D': '2박3일', '1박 2일': '1박2일', '2박 3일': '2박3일' })[value] || value;
}

function scheduleCode(value) {
  return ({ 당일: 'DAY', '1박2일': '1N2D', '2박3일': '2N3D' })[value] || value;
}

function n(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function money(value, currency = 'VND') {
  return value > 0 ? `${Number(value).toLocaleString('ko-KR')} ${currency}` : '요금 선택 필요';
}

function roomSeed() {
  return { key: crypto.randomUUID(), rateCardId: '', roomCount: 1, adultCount: 2, childCount: 0, childExtraBedCount: 0, infantCount: 0, extraBedCount: 0, singleCount: 0 };
}

function vehicleSeed() {
  return { key: crypto.randomUUID(), wayType: '편도', route: '', vehicleType: '', rentcarPriceCode: '', carCount: 1, pickupDatetime: '', pickupLocation: '', destination: '', viaLocation: '', viaWaiting: '', returnDatetime: '', returnPickupLocation: '', returnDestination: '', returnViaLocation: '', returnViaWaiting: '', oneWayDirection: 'pickup' };
}

function initialForm(type) {
  const shared = { requestNote: '', adults: 2, children: 0, infants: 0 };
  if (type === 'cruise') return { ...shared, checkin: '', schedule: '1박2일', cruiseName: '', rooms: [roomSeed()], connectingRoom: false, birthdayEvent: false, birthdayName: '', tourOptions: [] };
  if (type === 'cruise_vehicle') return { ...shared, cruiseReservationId: '', vehicleServiceType: 'private_rental', passengerCount: 2, requestNote: '', vehicles: [vehicleSeed()] };
  if (type === 'airport') return { ...shared, serviceType: 'both', passengerCount: 2, luggageCount: 0, requestNote: '', pickup: { category: '', route: '', vehicleType: '', airportPriceCode: '', airportLocation: '', accommodation: '', flightNumber: '', datetime: '' }, sending: { category: '', route: '', vehicleType: '', airportPriceCode: '', airportLocation: '', accommodation: '', flightNumber: '', datetime: '' } };
  if (type === 'hotel') return { ...shared, checkin: '', checkout: '', hotelName: '', hotelPriceCode: '', roomCount: 1 };
  if (type === 'rentcar') return { ...shared, passengerCount: 2, luggageCount: 0, vehicles: [vehicleSeed()] };
  if (type === 'tour') return { ...shared, tourId: '', usageDate: '', guestCount: 2, paymentMethod: '', pickupLocation: '', dropoffLocation: '', lunchOption: '금잔디 식당(한식-추천)', courseOption: '호아루(추천)', nightTourOption: '선택안함', addons: [] };
  if (type === 'package') return { ...shared, packageId: '', departureDate: '', totalChildren: 0, totalInfants: 0, childExtraBed: 0, childNoExtraBed: 0, infantFree: 0, infantTour: 0, infantExtraBed: 0, infantSeat: 0, itemDetails: {} };
  return { ...shared, ticketType: '', ticketName: '', usageDate: '', adultCount: 2, childCount: 0, priceChannel: 'card', shuttleRequired: false, shuttleCount: 0, pickupLocation: '', dropoffLocation: '', lobsterCount: 0, fishCount: 0, programSelection: '', ticketDetails: '' };
}

function Field({ label, children, full = false }) {
  return <div className={`booking-field${full ? ' full' : ''}`}><label>{label}</label>{children}</div>;
}

function NumberInput({ value, onChange, min = 0, max = 40 }) {
  return <input type="number" min={min} max={max} value={value} onChange={(event) => onChange(event.target.value)} />;
}

function Select(props) {
  const { value, onChange, options, placeholder = '선택해 주세요', label = (option) => option, disabled = false } = props;
  const optionValue = Object.prototype.hasOwnProperty.call(props, 'valueOf') ? props.valueOf : (option) => option;
  return <select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}><option value="">{placeholder}</option>{options.map((option) => <option value={optionValue(option)} key={optionValue(option)}>{label(option)}</option>)}</select>;
}

function Choice({ active, onClick, children }) {
  return <button type="button" className={`booking-choice${active ? ' selected' : ''}`} aria-pressed={active} onClick={onClick}>{children}</button>;
}

function validRateRows(rows, date, from = 'valid_from', to = 'valid_to') {
  return (rows || []).filter((row) => !date || validOn(row, date, from, to));
}

function findVehiclePrice(prices, vehicle) {
  return prices.find((row) => row.way_type === vehicle.wayType && row.route === vehicle.route && row.vehicle_type === vehicle.vehicleType) || null;
}

async function loadCruiseReservations(quoteId = '') {
  const auth = await platformSupabase.auth.getUser();
  if (!auth.data.user) return [];
  let query = platformSupabase.from('reservation').select('re_id,re_quote_id,reservation_date,price_breakdown,re_created_at').eq('re_user_id', auth.data.user.id).eq('re_type', 'cruise').order('re_created_at', { ascending: false });
  if (quoteId) query = query.eq('re_quote_id', quoteId);
  const reservations = await query;
  if (reservations.error || !reservations.data?.length) return [];
  const ids = reservations.data.map((row) => row.re_id);
  const details = await platformSupabase.from('reservation_cruise').select('reservation_id,room_price_code,checkin').in('reservation_id', ids);
  const rateIds = [...new Set((details.data || []).map((row) => row.room_price_code).filter(Boolean))];
  const rates = rateIds.length ? await platformSupabase.from('cruise_rate_card').select('id,cruise_name,room_type,schedule_type').in('id', rateIds) : { data: [] };
  const rateMap = new Map((rates.data || []).map((row) => [row.id, row]));
  return reservations.data.map((reservation) => {
    const detail = (details.data || []).find((row) => row.reservation_id === reservation.re_id);
    const rate = rateMap.get(detail?.room_price_code);
    return { ...reservation, checkin: detail?.checkin || reservation.reservation_date, cruiseName: rate?.cruise_name || '크루즈', roomType: rate?.room_type || '', schedule: scheduleLabel(rate?.schedule_type || '') };
  });
}

export default function PlatformBookingForm({ type }) {
  const service = SERVICES[type];
  const [form, setForm] = useState(() => initialForm(type));
  const [options, setOptions] = useState({});
  const [cruiseReservations, setCruiseReservations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [editingCartItemId, setEditingCartItemId] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!service) return;
      setLoading(true);
      setError('');
      try {
        const [loaded, cruises] = await Promise.all([loadPlatformBookingOptions(type), type === 'cruise_vehicle' ? loadCruiseReservations(new URLSearchParams(window.location.search).get('quoteId') || '') : Promise.resolve([])]);
        if (cancelled) return;
        setOptions(loaded);
        setCruiseReservations(cruises);
        const query = new URLSearchParams(window.location.search);
        if (type === 'cruise' && query.get('rateCardId')) {
          setForm((current) => ({
            ...current,
            checkin: query.get('checkin') || current.checkin,
            schedule: scheduleLabel(query.get('schedule') || current.schedule),
            cruiseName: query.get('cruiseName') || current.cruiseName,
            rooms: [{ ...roomSeed(), rateCardId: query.get('rateCardId') || '', roomCount: n(query.get('roomCount'), 1), adultCount: n(query.get('adultCount'), 2), childCount: n(query.get('childCount')), infantCount: n(query.get('infantCount')) }],
          }));
        }
        if (type === 'package') {
          const packages = (loaded.packages || []).filter((pkg) => !/ambassador|엠바사더/i.test(`${pkg.name} ${pkg.package_code}`));
          const selected = packages.find((pkg) => String(pkg.name).includes('그랜드 파이어니스')) || packages[0];
          if (selected) setForm((current) => ({ ...current, packageId: current.packageId || selected.id }));
        }
        const editCartItemId = query.get('editCartItem');
        if (editCartItemId) {
          const cart = await hydrateBookingCart();
          const item = cart.items.find((entry) => entry.id === editCartItemId && entry.serviceType === type);
          if (item?.metadata?.platform) {
            setForm((current) => ({ ...current, ...item.metadata.platform }));
            setEditingCartItemId(item.id);
          }
        }
      } catch (loadError) {
        if (!cancelled) setError(loadError.message || '플랫폼 예약 항목을 불러오지 못했습니다.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [service, type]);

  useEffect(() => {
    let cancelled = false;
    async function refreshCruiseRates() {
      if (type !== 'cruise' || !form.checkin || !form.schedule) return;
      const [result, surcharges] = await Promise.all([
        platformSupabase.rpc('get_applicable_cruise_rate_cards', { p_schedule_type: scheduleCode(form.schedule), p_checkin_date: form.checkin, p_cruise_name: null, p_room_type: null, p_booking_date: new Date().toISOString().slice(0, 10) }),
        platformSupabase.from('cruise_holiday_surcharge').select('*').eq('valid_year', new Date(`${form.checkin}T00:00:00Z`).getUTCFullYear()).or(`schedule_type.eq.${scheduleCode(form.schedule)},schedule_type.is.null`),
      ]);
      if (!cancelled) setOptions((current) => ({ ...current, ...(!result.error && result.data ? { rates: result.data } : {}), ...(!surcharges.error ? { surcharges: surcharges.data || [] } : {}) }));
    }
    void refreshCruiseRates();
    return () => { cancelled = true; };
  }, [form.checkin, form.schedule, type]);

  const set = (field, value) => { setForm((current) => ({ ...current, [field]: value })); setError(''); setMessage(''); };
  const setLeg = (leg, field, value) => setForm((current) => ({ ...current, [leg]: { ...current[leg], [field]: value, ...(field === 'category' ? { route: '', vehicleType: '', airportPriceCode: '' } : {}), ...(field === 'route' ? { vehicleType: '', airportPriceCode: '' } : {}) } }));
  const setRoom = (key, field, value) => setForm((current) => ({ ...current, rooms: current.rooms.map((room) => room.key === key ? { ...room, [field]: value } : room) }));
  const setVehicle = (key, field, value) => setForm((current) => ({ ...current, vehicles: current.vehicles.map((vehicle) => vehicle.key === key ? { ...vehicle, [field]: value, ...(field === 'wayType' ? { route: '', vehicleType: '', rentcarPriceCode: '' } : {}), ...(field === 'route' ? { vehicleType: '', rentcarPriceCode: '' } : {}) } : vehicle) }));
  const setPackageItem = (itemId, field, value) => setForm((current) => ({ ...current, itemDetails: { ...current.itemDetails, [itemId]: { ...(current.itemDetails?.[itemId] || {}), [field]: value } } }));

  const derived = useMemo(() => {
    if (type === 'cruise') {
      const rates = form.checkin ? validRateRows(options.rates, form.checkin).filter((rate) => scheduleLabel(rate.schedule_type) === form.schedule && (!rate.valid_year || Number(rate.valid_year) === new Date(`${form.checkin}T00:00:00Z`).getUTCFullYear())) : [];
      const cruises = uniqueValues(rates, 'cruise_name');
      const rooms = rates.filter((rate) => rate.cruise_name === form.cruiseName);
      const selected = form.rooms.map((room) => ({ room, rate: rooms.find((rate) => rate.id === room.rateCardId) })).filter((entry) => entry.rate);
      const surchargeRows = (options.surcharges || []).filter((row) => row.cruise_name === form.cruiseName && row.holiday_date <= form.checkin && (row.holiday_date_end || row.holiday_date) >= form.checkin && row.is_confirmed);
      const total = selected.reduce((sum, { room, rate }) => {
        const base = n(rate.price_adult) * n(room.adultCount) + n(rate.price_child) * n(room.childCount) + n(rate.price_child_extra_bed) * n(room.childExtraBedCount) + n(rate.price_infant) * Math.max(0, n(room.infantCount) - 1) + n(rate.price_extra_bed) * n(room.extraBedCount) + n(rate.price_single) * n(room.singleCount);
        const surcharge = surchargeRows.reduce((charge, row) => charge + n(row.surcharge_per_person) * n(room.adultCount) + n(row.surcharge_child, n(row.surcharge_per_person)) * (n(room.childCount) + n(room.childExtraBedCount)), 0);
        return sum + n(room.roomCount, 1) * (base + surcharge);
      }, 0);
      return { rates, cruises, rooms, selected, total, name: form.cruiseName || service.example, optionName: `${form.schedule} · 객실 ${form.rooms.length}개`, startDate: form.checkin, endDate: '', adults: form.rooms.reduce((sum, room) => sum + n(room.adultCount) * n(room.roomCount, 1), 0), children: form.rooms.reduce((sum, room) => sum + (n(room.childCount) + n(room.childExtraBedCount)) * n(room.roomCount, 1), 0), infants: form.rooms.reduce((sum, room) => sum + n(room.infantCount) * n(room.roomCount, 1), 0), quantity: form.rooms.reduce((sum, room) => sum + n(room.roomCount, 1), 0) };
    }
    if (type === 'hotel') {
      const hotels = (options.hotels || []).length ? options.hotels : uniqueValues(options.prices, 'hotel_name').map((hotel_name) => ({ hotel_name }));
      const rooms = validRateRows(options.prices, form.checkin, 'start_date', 'end_date').filter((row) => row.hotel_name === form.hotelName);
      const selected = rooms.find((room) => room.hotel_price_code === form.hotelPriceCode);
      const nights = form.checkin && form.checkout ? Math.max(1, Math.round((new Date(form.checkout) - new Date(form.checkin)) / 86400000)) : 1;
      return { hotels, rooms, selected, total: n(selected?.base_price) * n(form.roomCount, 1) * nights, name: form.hotelName || service.example, optionName: selected?.room_name || '', startDate: form.checkin, endDate: form.checkout, adults: n(form.adults), children: n(form.children), infants: n(form.infants), quantity: n(form.roomCount, 1) };
    }
    if (type === 'airport') {
      const legs = form.serviceType === 'both' ? [form.pickup, form.sending] : form.serviceType === 'pickup' ? [form.pickup] : [form.sending];
      const selected = legs.map((leg) => (options.prices || []).find((row) => row.airport_code === leg.airportPriceCode)).filter(Boolean);
      return { total: selected.reduce((sum, row) => sum + n(row.price), 0), name: '공항 이동', optionName: form.serviceType === 'both' ? '픽업 + 샌딩' : form.serviceType === 'pickup' ? '공항 픽업' : '공항 샌딩', startDate: String(legs[0]?.datetime || '').slice(0, 10), endDate: String(legs[1]?.datetime || '').slice(0, 10), adults: n(form.adults), children: n(form.children), infants: 0, quantity: legs.length };
    }
    if (type === 'rentcar' || type === 'cruise_vehicle') {
      const selected = form.vehicles.map((vehicle) => findVehiclePrice(options.prices || [], vehicle)).filter(Boolean);
      const cruise = cruiseReservations.find((row) => row.re_id === form.cruiseReservationId);
      return { total: selected.reduce((sum, row, index) => sum + n(row.price) * n(form.vehicles[index]?.carCount, 1), 0), name: type === 'cruise_vehicle' ? `${cruise?.cruiseName || '크루즈'} 차량` : '렌터카', optionName: form.vehicles.map((vehicle) => vehicle.vehicleType).filter(Boolean).join(' · '), startDate: String(form.vehicles[0]?.pickupDatetime || '').slice(0, 10), endDate: String(form.vehicles[0]?.returnDatetime || '').slice(0, 10), adults: n(form.adults), children: n(form.children), infants: 0, quantity: form.vehicles.reduce((sum, vehicle) => sum + n(vehicle.carCount, 1), 0) };
    }
    if (type === 'tour') {
      const tour = (options.tours || []).find((row) => row.tour_id === form.tourId);
      const guests = n(form.guestCount, 1);
      const price = (options.prices || []).find((row) => row.tour_id === form.tourId && guests >= n(row.min_guests) && (!row.max_guests || guests <= n(row.max_guests)));
      const payment = (options.payments || []).find((row) => row.tour_id === form.tourId && row.payment_method === form.paymentMethod);
      const addons = (form.addons || []).map((selected) => ({ ...selected, row: (options.addons || []).find((row) => row.option_id === selected.optionId) })).filter((entry) => entry.row);
      const unit = payment ? n(payment.price) : n(price?.price_per_person);
      return { tour, price, payment, addons, total: unit * guests + addons.reduce((sum, entry) => sum + n(entry.row.price) * n(entry.quantity, 1), 0), name: tour?.tour_name || service.example, optionName: form.paymentMethod || price?.vehicle_type || '', startDate: form.usageDate, endDate: '', adults: n(form.adults), children: n(form.children), infants: n(form.infants), quantity: guests };
    }
    if (type === 'package') {
      const packages = (options.packages || []).filter((pkg) => !/ambassador|엠바사더/i.test(`${pkg.name} ${pkg.package_code}`));
      const pkg = packages.find((row) => row.id === form.packageId);
      const config = pkg?.price_config?.[String(form.adults)];
      const adultPrice = typeof config === 'object' ? n(config?.per_person) : n(config, n(pkg?.base_price));
      const total = n(form.adults) * adultPrice + n(form.childExtraBed) * n(pkg?.price_child_extra_bed, 6900000) + n(form.childNoExtraBed) * n(pkg?.price_child_no_extra_bed, 5850000) + n(form.infantTour) * n(pkg?.price_infant_tour, 900000) + n(form.infantExtraBed) * n(pkg?.price_infant_extra_bed, 4200000) + n(form.infantSeat) * n(pkg?.price_infant_seat, 800000);
      return { packages, pkg, total, name: pkg?.name || service.example, optionName: '크루즈 · 공항 · 투어 포함', startDate: form.departureDate, endDate: '', adults: n(form.adults), children: n(form.totalChildren), infants: n(form.totalInfants), quantity: 1 };
    }
    const ticketTypes = [{ value: 'dragon', label: '드래곤 펄 레스토랑' }, { value: 'other', label: '요코온센 공용온천 티켓' }];
    const sourceTours = (options.tours || []).filter((tour) => form.ticketType === 'dragon' ? tour.is_cruise_addon === true : tour.is_cruise_addon === false && String(tour.tour_code || '').startsWith('YOKO_ONSEN'));
    const ticketNames = sourceTours.length ? sourceTours.map((tour) => tour.tour_name) : uniqueValues((options.prices || []).filter((row) => row.ticket_type === form.ticketType), 'ticket_name');
    const lines = (options.prices || []).filter((row) => row.ticket_type === form.ticketType && validOn(row, form.usageDate));
    const adults = n(form.adultCount); const children = form.ticketType === 'dragon' ? n(form.childCount) : 0;
    const shuttleCount = form.ticketType === 'dragon' && form.shuttleRequired ? adults + children : 0;
    const pricedLines = lines.map((row) => ({ row, quantity: /child|아동/i.test(row.price_item) ? children : /shuttle|셔틀/i.test(row.price_item) ? shuttleCount : adults }));
    const price = (row) => n(row.stay_card_price_vnd);
    return { ticketTypes, ticketNames, lines, pricedLines, total: pricedLines.reduce((sum, entry) => sum + price(entry.row) * entry.quantity, 0), name: form.ticketName || service.example, optionName: form.ticketType, startDate: form.usageDate, endDate: '', adults, children, infants: 0, quantity: adults + children };
  }, [cruiseReservations, form, options, service, type]);

  function buildPlatformData() {
    if (type === 'cruise') {
      if (!form.checkin || !form.cruiseName || form.rooms.some((room) => !room.rateCardId)) throw new Error('일정, 크루즈와 모든 객실을 선택해 주세요.');
      return { contractVersion: 1, ...form, tourOptions: (form.tourOptions || []).map((selected) => { const row = (options.tourOptions || []).find((option) => option.option_id === selected.optionId); return { optionId: selected.optionId, name: row?.option_name, price: n(row?.option_price), quantity: n(selected.quantity, 1) }; }) };
    }
    if (type === 'hotel') {
      if (!form.checkin || !form.checkout || form.checkout <= form.checkin || !form.hotelPriceCode) throw new Error('체크인·체크아웃 날짜와 객실을 선택해 주세요.');
      return { contractVersion: 1, hotelPriceCode: form.hotelPriceCode, checkin: form.checkin, checkout: form.checkout, roomCount: n(form.roomCount, 1), adultCount: n(form.adults), childCount: n(form.children), infantCount: n(form.infants), requestNote: form.requestNote };
    }
    if (type === 'airport') {
      const requested = form.serviceType === 'both' ? [['pickup', form.pickup], ['sending', form.sending]] : [[form.serviceType, form[form.serviceType]]];
      if (requested.some(([, leg]) => !leg.airportPriceCode || !leg.airportLocation || !leg.accommodation || !leg.datetime)) throw new Error('각 공항 이동의 요금, 공항, 장소와 일시를 모두 입력해 주세요.');
      return { contractVersion: 1, passengerCount: n(form.passengerCount, 1), luggageCount: n(form.luggageCount), requestNote: form.requestNote, legs: requested.map(([wayType, leg]) => ({ ...leg, wayType })) };
    }
    if (type === 'rentcar' || type === 'cruise_vehicle') {
      if (type === 'cruise_vehicle' && !form.cruiseReservationId) throw new Error('차량을 추가할 크루즈 예약을 선택해 주세요.');
      if (form.vehicles.some((vehicle) => !vehicle.rentcarPriceCode || !vehicle.pickupLocation || !vehicle.destination || (!vehicle.pickupDatetime && vehicle.oneWayDirection !== 'dropoff'))) throw new Error('모든 차량의 요금, 장소와 일시를 입력해 주세요.');
      return { contractVersion: 1, cruiseReservationId: form.cruiseReservationId || null, passengerCount: n(form.passengerCount, 1), luggageCount: n(form.luggageCount), requestNote: form.requestNote, vehicles: form.vehicles };
    }
    if (type === 'tour') {
      if (!form.tourId || !form.usageDate || !derived.price || !form.pickupLocation || !form.dropoffLocation) throw new Error('투어, 이용일, 인원 요금과 픽업·하차 장소를 입력해 주세요.');
      return { contractVersion: 1, ...form, tourPricingId: derived.price.pricing_id, addons: derived.addons.map((entry) => ({ optionId: entry.row.option_id, name: entry.row.option_name, price: n(entry.row.price), quantity: n(entry.quantity, 1) })) };
    }
    if (type === 'package') {
      if (!form.packageId || !form.departureDate) throw new Error('패키지와 여행 출발일을 선택해 주세요.');
      if (n(form.childExtraBed) + n(form.childNoExtraBed) !== n(form.totalChildren)) throw new Error('아동 인원과 엑스트라베드 옵션 인원 합계가 같아야 합니다.');
      if (n(form.infantFree) + n(form.infantTour) !== n(form.totalInfants)) throw new Error('유아 인원과 필수 유아 옵션 인원 합계가 같아야 합니다.');
      const airportItem = (derived.pkg?.items || []).find((item) => item.service_type === 'airport');
      const airport = airportItem ? form.itemDetails?.[airportItem.id] || {} : null;
      if (airport && (!airport.pickupAirportName || !airport.pickupDateTime || !airport.accommodation || !airport.sandingAirportName || !airport.sandingDateTime || !airport.sandingPickupLocation)) throw new Error('패키지 공항 픽업·샌딩의 공항, 일시와 숙소를 모두 입력해 주세요.');
      const shuttleItem = (derived.pkg?.items || []).find((item) => item.service_type === 'car_sht');
      const shuttle = shuttleItem ? form.itemDetails?.[shuttleItem.id] || {} : {};
      return { contractVersion: 1, ...form, adultCount: n(form.adults), shtPickupVehicle: shuttle.shtPickupVehicle || null, shtPickupSeat: shuttle.shtPickupSeat || null, shtDropoffVehicle: shuttle.shtDropoffVehicle || null, shtDropoffSeat: shuttle.shtDropoffSeat || null };
    }
    if (!form.ticketType || !form.ticketName || !form.usageDate || !derived.lines.length || n(form.adultCount) + n(form.childCount) < 1) throw new Error('티켓 종류, 상품, 이용일과 인원을 선택해 주세요.');
    if (form.ticketType === 'other' && !form.programSelection) throw new Error('요코온센 프로그램을 선택해 주세요.');
    if (n(form.lobsterCount) + n(form.fishCount) > n(form.adultCount) + n(form.childCount)) throw new Error('메뉴 선택 인원은 총 참가 인원을 초과할 수 없습니다.');
    return { contractVersion: 1, ...form, priceChannel: 'card', shuttleCount: form.ticketType === 'dragon' && form.shuttleRequired ? n(form.adultCount) + n(form.childCount) : 0, lines: derived.pricedLines.filter((entry) => entry.quantity > 0).map((entry) => ({ ticketPriceCode: entry.row.ticket_price_code, quantity: entry.quantity })) };
  }

  async function addToCart(event) {
    event.preventDefault();
    setSaving(true); setError(''); setMessage('');
    try {
      const platform = buildPlatformData();
      const nextItem = { id: editingCartItemId || `${type}:${crypto.randomUUID()}`, serviceType: type, productId: type === 'package' ? form.packageId : type, optionId: type === 'cruise' ? form.rooms[0]?.rateCardId : type === 'hotel' ? form.hotelPriceCode : '', name: derived.name, optionName: derived.optionName, startDate: derived.startDate, endDate: derived.endDate, adults: derived.adults, children: derived.children, infants: derived.infants, quantity: Math.max(1, derived.quantity), unitPrice: derived.total / Math.max(1, derived.quantity), currency: type === 'cruise' && derived.selected?.[0]?.rate?.currency === 'USD' ? 'USD' : type === 'ticket' && form.priceChannel === 'krw' ? 'KRW' : 'VND', priceStatus: 'reference', sourceHref: `/booking/service/${type}`, metadata: { platform, summary: summaryRows() } };
      const session = await getPlatformCartSession();
      if (!session) {
        const next = `${window.location.pathname}${window.location.search}`;
        queueBookingCartItemAfterLogin(nextItem, editingCartItemId, next);
        window.location.replace(`/login?next=${encodeURIComponent(next)}`);
        return;
      }
      const saved = replaceBookingCartItem(editingCartItemId, nextItem);
      const synced = await syncBookingCart();
      if (!synced.synced) throw new Error('선택 내용은 임시 보관했지만 홈페이지 DB 장바구니에 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.');
      setEditingCartItemId(saved.id);
      setMessage(editingCartItemId ? '홈페이지 DB 장바구니의 선택 내용을 수정했습니다.' : '홈페이지 DB 장바구니에 저장했습니다. 최종 저장 전까지 플랫폼 예약은 생성되지 않습니다.');
    } catch (saveError) {
      setError(saveError.message || '장바구니에 저장하지 못했습니다.');
    } finally { setSaving(false); }
  }

  function summaryRows() {
    return [['서비스', service.label], ['상품', derived.name], ['옵션', derived.optionName || '선택 중'], ['이용일', derived.startDate || '미정'], ['인원', `성인 ${derived.adults} · 아동 ${derived.children} · 유아 ${derived.infants}`], ['참고 금액', money(derived.total, type === 'cruise' && derived.selected?.[0]?.rate?.currency === 'USD' ? 'USD' : type === 'ticket' && form.priceChannel === 'krw' ? 'KRW' : 'VND')]];
  }

  function airportLeg(legName, label) {
    const leg = form[legName];
    const prices = validRateRows(options.prices, String(leg.datetime || '').slice(0, 10));
    const categories = uniqueValues(prices, 'service_type');
    const routes = uniqueValues(prices.filter((row) => row.service_type === leg.category), 'route');
    const vehicles = uniqueValues(prices.filter((row) => row.service_type === leg.category && row.route === leg.route), 'vehicle_type');
    const selected = prices.find((row) => row.service_type === leg.category && row.route === leg.route && row.vehicle_type === leg.vehicleType);
    const airports = uniqueValues(options.airports, 'airport_name');
    return <div className="booking-field-set"><span className="booking-field-set-label">{label}</span><div className="booking-fields">
      <Field label="서비스 분류"><Select value={leg.category} onChange={(value) => setLeg(legName, 'category', value)} options={categories} /></Field>
      <Field label="이동 경로"><Select value={leg.route} onChange={(value) => setLeg(legName, 'route', value)} options={routes} disabled={!leg.category} /></Field>
      <Field label="차량 유형"><Select value={leg.vehicleType} onChange={(value) => { setLeg(legName, 'vehicleType', value); const row = prices.find((price) => price.service_type === leg.category && price.route === leg.route && price.vehicle_type === value); if (row) setLeg(legName, 'airportPriceCode', row.airport_code); }} options={vehicles} disabled={!leg.route} /></Field>
      <Field label="공항"><Select value={leg.airportLocation} onChange={(value) => setLeg(legName, 'airportLocation', value)} options={airports} /></Field>
      <Field label={legName === 'pickup' ? '도착 일시' : '출발 일시'}><input type="datetime-local" value={leg.datetime} onChange={(event) => setLeg(legName, 'datetime', event.target.value)} /></Field>
      <Field label={legName === 'pickup' ? '항공편명' : '항공편명 선택'}><input value={leg.flightNumber} onChange={(event) => setLeg(legName, 'flightNumber', event.target.value)} /></Field>
      <Field label={legName === 'pickup' ? '목적지 또는 숙소' : '출발 숙소'} full><input value={leg.accommodation} onChange={(event) => setLeg(legName, 'accommodation', event.target.value)} /></Field>
      {selected && <p className="booking-inline-note booking-field full">현재 등록 요금 {money(n(selected.price))}</p>}
    </div></div>;
  }

  function vehicleFields(cruiseVehicle) {
    const sourceCruise = cruiseReservations.find((row) => row.re_id === form.cruiseReservationId);
    const prices = (options.prices || []).filter((row) => {
      if (!cruiseVehicle) return row.car_category_code === '렌트카';
      if (!String(row.route || '').includes('하롱베이')) return false;
      if (form.vehicleServiceType === 'cruise_shuttle') return String(row.vehicle_type || '').includes('셔틀') && row.cruise === sourceCruise?.cruiseName;
      return row.rental_type === '단독대여' && ['공통', sourceCruise?.cruiseName].includes(row.cruise);
    });
    return <>
      {cruiseVehicle && <Field label="차량을 추가할 크루즈 예약" full><Select value={form.cruiseReservationId} onChange={(value) => set('cruiseReservationId', value)} options={cruiseReservations} valueOf={(row) => row.re_id} label={(row) => `${row.checkin || '일정 미정'} · ${row.cruiseName} ${row.roomType}`} placeholder={cruiseReservations.length ? '크루즈 예약을 선택해 주세요' : '차량을 추가할 크루즈 예약이 없습니다'} /></Field>}
      {cruiseVehicle && <div className="booking-step"><span>차량 서비스 유형</span><div className="booking-choice-grid"><Choice active={form.vehicleServiceType === 'private_rental'} onClick={() => setForm((current) => ({ ...current, vehicleServiceType: 'private_rental', vehicles: [vehicleSeed()] }))}>단독 차량</Choice><Choice active={form.vehicleServiceType === 'cruise_shuttle'} onClick={() => setForm((current) => ({ ...current, vehicleServiceType: 'cruise_shuttle', vehicles: [vehicleSeed()] }))}>크루즈사 셔틀</Choice></div></div>}
      {form.vehicles.map((vehicle, index) => {
        const ways = WAY_TYPES.filter((way) => prices.some((row) => row.way_type === way));
        const routes = uniqueValues(prices.filter((row) => row.way_type === vehicle.wayType), 'route');
        const vehicles = uniqueValues(prices.filter((row) => row.way_type === vehicle.wayType && row.route === vehicle.route), 'vehicle_type');
        const selected = findVehiclePrice(prices, vehicle);
        return <div className="booking-repeat-card" key={vehicle.key}><div className="booking-repeat-head"><strong>차량 {index + 1}</strong>{form.vehicles.length > 1 && <button type="button" onClick={() => set('vehicles', form.vehicles.filter((row) => row.key !== vehicle.key))}>삭제</button>}</div><div className="booking-fields">
          <Field label="이용 방식"><Select value={vehicle.wayType} onChange={(value) => setVehicle(vehicle.key, 'wayType', value)} options={ways} /></Field>
          <Field label="경로"><Select value={vehicle.route} onChange={(value) => setVehicle(vehicle.key, 'route', value)} options={routes} disabled={!vehicle.wayType} /></Field>
          <Field label="차량 유형"><Select value={vehicle.vehicleType} onChange={(value) => { setVehicle(vehicle.key, 'vehicleType', value); const row = prices.find((price) => price.way_type === vehicle.wayType && price.route === vehicle.route && price.vehicle_type === value); if (row) setVehicle(vehicle.key, 'rentcarPriceCode', row.rent_code); }} options={vehicles} disabled={!vehicle.route} /></Field>
          <Field label="차량 수"><NumberInput value={vehicle.carCount} min={1} max={6} onChange={(value) => setVehicle(vehicle.key, 'carCount', value)} /></Field>
          {vehicle.wayType === '편도' && cruiseVehicle && <Field label="편도 방향"><Select value={vehicle.oneWayDirection} onChange={(value) => setVehicle(vehicle.key, 'oneWayDirection', value)} options={[{ value: 'pickup', label: '선착장으로 픽업' }, { value: 'dropoff', label: '선착장에서 드롭' }]} valueOf={(row) => row.value} label={(row) => row.label} /></Field>}
          <Field label="픽업 일시"><input type="datetime-local" value={vehicle.pickupDatetime} onChange={(event) => setVehicle(vehicle.key, 'pickupDatetime', event.target.value)} /></Field>
          <Field label="픽업 장소"><input value={vehicle.pickupLocation} onChange={(event) => setVehicle(vehicle.key, 'pickupLocation', event.target.value)} /></Field>
          <Field label="목적지"><input value={vehicle.destination} onChange={(event) => setVehicle(vehicle.key, 'destination', event.target.value)} /></Field>
          <Field label="경유지"><input value={vehicle.viaLocation} onChange={(event) => setVehicle(vehicle.key, 'viaLocation', event.target.value)} /></Field>
          <Field label="경유 대기"><input value={vehicle.viaWaiting} onChange={(event) => setVehicle(vehicle.key, 'viaWaiting', event.target.value)} /></Field>
          {vehicle.wayType !== '편도' && <><Field label="귀환 일시"><input type="datetime-local" value={vehicle.returnDatetime} onChange={(event) => setVehicle(vehicle.key, 'returnDatetime', event.target.value)} /></Field><Field label="귀환 출발지"><input value={vehicle.returnPickupLocation} onChange={(event) => setVehicle(vehicle.key, 'returnPickupLocation', event.target.value)} /></Field><Field label="귀환 목적지"><input value={vehicle.returnDestination} onChange={(event) => setVehicle(vehicle.key, 'returnDestination', event.target.value)} /></Field></>}
          {selected && <p className="booking-inline-note booking-field full">{selected.vehicle_examples || selected.description || selected.vehicle_type} · {money(n(selected.price))}</p>}
        </div></div>;
      })}
      <button type="button" className="booking-add-row" onClick={() => set('vehicles', [...form.vehicles, vehicleSeed()])}>차량 추가 ＋</button>
      <div className="booking-fields booking-field-set"><Field label="탑승 인원"><NumberInput value={form.passengerCount} min={1} onChange={(value) => set('passengerCount', value)} /></Field><Field label="수하물 수"><NumberInput value={form.luggageCount} onChange={(value) => set('luggageCount', value)} /></Field></div>
    </>;
  }

  function packageItemFields() {
    const items = [...(derived.pkg?.items || [])].sort((a, b) => n(a.item_order) - n(b.item_order));
    if (!items.length) return null;
    const airportNames = uniqueValues(options.airports, 'airport_name');
    return <div className="booking-field-set"><span className="booking-field-set-label">패키지 서비스별 일정과 장소</span>{items.map((item, index) => {
      const details = form.itemDetails?.[item.id] || {};
      return <div className="booking-repeat-card" key={item.id}><div className="booking-repeat-head"><strong>{index + 1}. {item.description || item.service_type}</strong><span>{item.service_type}</span></div><div className="booking-fields">
        {item.service_type === 'airport' ? <>
          <Field label="픽업 공항"><Select value={details.pickupAirportName || ''} onChange={(value) => setPackageItem(item.id, 'pickupAirportName', value)} options={airportNames} /></Field>
          <Field label="픽업 일시"><input type="datetime-local" value={details.pickupDateTime || ''} onChange={(event) => setPackageItem(item.id, 'pickupDateTime', event.target.value)} /></Field>
          <Field label="도착 항공편"><input value={details.flightNumber || ''} onChange={(event) => setPackageItem(item.id, 'flightNumber', event.target.value)} /></Field>
          <Field label="픽업 후 하차 숙소"><input value={details.accommodation || ''} onChange={(event) => setPackageItem(item.id, 'accommodation', event.target.value)} /></Field>
          <Field label="샌딩 공항"><Select value={details.sandingAirportName || ''} onChange={(value) => setPackageItem(item.id, 'sandingAirportName', value)} options={airportNames} /></Field>
          <Field label="샌딩 일시"><input type="datetime-local" value={details.sandingDateTime || ''} onChange={(event) => setPackageItem(item.id, 'sandingDateTime', event.target.value)} /></Field>
          <Field label="샌딩 승차 숙소" full><input value={details.sandingPickupLocation || ''} onChange={(event) => setPackageItem(item.id, 'sandingPickupLocation', event.target.value)} /></Field>
        </> : item.service_type === 'car_sht' ? <>
          <Field label="승선 차량"><input value={details.shtPickupVehicle || ''} onChange={(event) => setPackageItem(item.id, 'shtPickupVehicle', event.target.value)} placeholder="예: Vehicle 1" /></Field>
          <Field label="승선 좌석"><input value={details.shtPickupSeat || ''} onChange={(event) => setPackageItem(item.id, 'shtPickupSeat', event.target.value)} placeholder="예: A1,A2" /></Field>
          <Field label="승선 픽업 장소"><input value={details.pickupLocation || ''} onChange={(event) => setPackageItem(item.id, 'pickupLocation', event.target.value)} /></Field>
          <Field label="하선 차량"><input value={details.shtDropoffVehicle || ''} onChange={(event) => setPackageItem(item.id, 'shtDropoffVehicle', event.target.value)} placeholder="예: Vehicle 1" /></Field>
          <Field label="하선 좌석"><input value={details.shtDropoffSeat || ''} onChange={(event) => setPackageItem(item.id, 'shtDropoffSeat', event.target.value)} placeholder="예: B1,B2" /></Field>
          <Field label="하선 하차 장소"><input value={details.dropoffLocation || ''} onChange={(event) => setPackageItem(item.id, 'dropoffLocation', event.target.value)} /></Field>
        </> : <>
          <Field label="픽업·숙소 장소"><input value={details.accommodation || ''} onChange={(event) => setPackageItem(item.id, 'accommodation', event.target.value)} /></Field>
          <Field label="하차·다음 장소"><input value={details.roomType || ''} onChange={(event) => setPackageItem(item.id, 'roomType', event.target.value)} /></Field>
          {(item.service_type === 'cruise' || item.service_type === 'hotel') && <Field label="객실 수"><NumberInput value={details.roomCount || 1} min={1} max={10} onChange={(value) => setPackageItem(item.id, 'roomCount', value)} /></Field>}
        </>}
      </div></div>;
    })}</div>;
  }

  function fields() {
    if (type === 'cruise') return <>
      <div className="booking-step"><span>01 / 일정</span><div className="booking-choice-grid">{SCHEDULES.map((schedule) => <Choice key={schedule} active={form.schedule === schedule} onClick={() => setForm((current) => ({ ...current, schedule, cruiseName: '', rooms: [roomSeed()] }))}>{schedule}</Choice>)}</div></div>
      <div className="booking-fields"><Field label="출항일"><input type="date" value={form.checkin} onChange={(event) => setForm((current) => ({ ...current, checkin: event.target.value, cruiseName: '', rooms: [roomSeed()] }))} /></Field><Field label="크루즈"><Select value={form.cruiseName} onChange={(value) => setForm((current) => ({ ...current, cruiseName: value, rooms: [roomSeed()] }))} options={derived.cruises} disabled={!form.checkin} /></Field></div>
      <div className="booking-field-set"><span className="booking-field-set-label">02 / 객실 구성</span>{form.rooms.map((room, index) => { const selected = derived.rooms.find((rate) => rate.id === room.rateCardId); return <div className="booking-repeat-card" key={room.key}><div className="booking-repeat-head"><strong>객실 {index + 1}</strong>{form.rooms.length > 1 && <button type="button" onClick={() => set('rooms', form.rooms.filter((row) => row.key !== room.key))}>삭제</button>}</div><div className="booking-fields"><Field label="객실 타입" full><Select value={room.rateCardId} onChange={(value) => setRoom(room.key, 'rateCardId', value)} options={derived.rooms} valueOf={(rate) => rate.id} label={(rate) => `${rate.room_type}${rate.room_type_en ? ` / ${rate.room_type_en}` : ''} · ${money(n(rate.price_adult), rate.currency)}`} /></Field><Field label="객실 수"><NumberInput value={room.roomCount} min={1} max={8} onChange={(value) => setRoom(room.key, 'roomCount', value)} /></Field><Field label="성인"><NumberInput value={room.adultCount} min={1} onChange={(value) => setRoom(room.key, 'adultCount', value)} /></Field><Field label="아동"><NumberInput value={room.childCount} onChange={(value) => setRoom(room.key, 'childCount', value)} /></Field><Field label="아동 엑스트라베드"><NumberInput value={room.childExtraBedCount} onChange={(value) => setRoom(room.key, 'childExtraBedCount', value)} /></Field><Field label="유아"><NumberInput value={room.infantCount} onChange={(value) => setRoom(room.key, 'infantCount', value)} /></Field>{selected?.extra_bed_available && <Field label="성인 엑스트라베드"><NumberInput value={room.extraBedCount} onChange={(value) => setRoom(room.key, 'extraBedCount', value)} /></Field>}{selected?.single_available && <Field label="싱글 이용"><NumberInput value={room.singleCount} onChange={(value) => setRoom(room.key, 'singleCount', value)} /></Field>}</div></div>; })}<button type="button" className="booking-add-row" onClick={() => set('rooms', [...form.rooms, roomSeed()])}>객실 추가 ＋</button></div>
      <div className="booking-field-set"><label className="booking-check"><input type="checkbox" checked={form.connectingRoom} onChange={(event) => set('connectingRoom', event.target.checked)} />커넥팅룸 신청</label><label className="booking-check"><input type="checkbox" checked={form.birthdayEvent} onChange={(event) => set('birthdayEvent', event.target.checked)} />생일 이벤트 신청</label>{form.birthdayEvent && <Field label="생일 당사자 영문성함"><input value={form.birthdayName} onChange={(event) => set('birthdayName', event.target.value)} /></Field>}</div>
      {form.schedule === '당일' && form.cruiseName && <div className="booking-field-set"><span className="booking-field-set-label">당일투어 선택 옵션</span>{(options.tourOptions || []).filter((option) => option.cruise_name === form.cruiseName && scheduleLabel(option.schedule_type) === form.schedule).map((option) => { const selected = form.tourOptions.find((entry) => entry.optionId === option.option_id); return <label className="booking-option-line" key={option.option_id}><input type="checkbox" checked={Boolean(selected)} onChange={(event) => set('tourOptions', event.target.checked ? [...form.tourOptions, { optionId: option.option_id, quantity: 1 }] : form.tourOptions.filter((entry) => entry.optionId !== option.option_id))} /><span>{option.option_name}</span><b>{money(n(option.option_price))}</b></label>; })}</div>}
    </>;
    if (type === 'hotel') return <><div className="booking-fields"><Field label="체크인"><input type="date" value={form.checkin} onChange={(event) => setForm((current) => ({ ...current, checkin: event.target.value, hotelName: '', hotelPriceCode: '' }))} /></Field><Field label="체크아웃"><input type="date" min={form.checkin} value={form.checkout} onChange={(event) => set('checkout', event.target.value)} /></Field><Field label="호텔" full><Select value={form.hotelName} onChange={(value) => setForm((current) => ({ ...current, hotelName: value, hotelPriceCode: '' }))} options={derived.hotels} valueOf={(hotel) => hotel.hotel_name} label={(hotel) => `${hotel.hotel_name}${hotel.location ? ` · ${hotel.location}` : ''}`} /></Field><Field label="객실" full><Select value={form.hotelPriceCode} onChange={(value) => set('hotelPriceCode', value)} options={derived.rooms} valueOf={(room) => room.hotel_price_code} label={(room) => `${room.room_name} · ${room.include_breakfast ? '조식 포함' : '조식 별도'} · ${money(n(room.base_price))}`} /></Field><Field label="객실 수"><NumberInput value={form.roomCount} min={1} max={10} onChange={(value) => set('roomCount', value)} /></Field><Field label="성인"><NumberInput value={form.adults} min={1} onChange={(value) => set('adults', value)} /></Field><Field label="아동"><NumberInput value={form.children} onChange={(value) => set('children', value)} /></Field><Field label="유아"><NumberInput value={form.infants} onChange={(value) => set('infants', value)} /></Field></div></>;
    if (type === 'airport') return <><div className="booking-step"><span>01 / 이동 형태</span><div className="booking-choice-grid"><Choice active={form.serviceType === 'both'} onClick={() => set('serviceType', 'both')}>픽업 + 샌딩</Choice><Choice active={form.serviceType === 'pickup'} onClick={() => set('serviceType', 'pickup')}>공항 픽업</Choice><Choice active={form.serviceType === 'sending'} onClick={() => set('serviceType', 'sending')}>공항 샌딩</Choice></div></div>{(form.serviceType === 'pickup' || form.serviceType === 'both') && airportLeg('pickup', '02 / 픽업 정보')}{(form.serviceType === 'sending' || form.serviceType === 'both') && airportLeg('sending', form.serviceType === 'both' ? '03 / 샌딩 정보' : '02 / 샌딩 정보')}<div className="booking-fields booking-field-set"><Field label="탑승 인원"><NumberInput value={form.passengerCount} min={1} onChange={(value) => set('passengerCount', value)} /></Field><Field label="수하물 수"><NumberInput value={form.luggageCount} onChange={(value) => set('luggageCount', value)} /></Field><Field label="성인"><NumberInput value={form.adults} min={1} onChange={(value) => set('adults', value)} /></Field><Field label="아동"><NumberInput value={form.children} onChange={(value) => set('children', value)} /></Field></div></>;
    if (type === 'rentcar') return vehicleFields(false);
    if (type === 'cruise_vehicle') return vehicleFields(true);
    if (type === 'tour') {
      const tours = (options.tours || []).filter((tour) => TOUR_NAMES.includes(tour.tour_name));
      const payments = uniqueValues((options.payments || []).filter((row) => row.tour_id === form.tourId), 'payment_method');
      const addons = (options.addons || []).filter((row) => row.tour_id === form.tourId && row.is_available !== false);
      const isNinhBinh = derived.tour?.tour_name === '닌빈 한국어 가이드 투어';
      return <><div className="booking-fields"><Field label="투어" full><Select value={form.tourId} onChange={(value) => setForm((current) => ({ ...current, tourId: value, paymentMethod: '', addons: [] }))} options={tours} valueOf={(tour) => tour.tour_id} label={(tour) => `${tour.tour_name} · ${tour.duration || ''}`} /></Field><Field label="이용일"><input type="date" value={form.usageDate} onChange={(event) => set('usageDate', event.target.value)} /></Field><Field label="참가 인원"><NumberInput value={form.guestCount} min={1} onChange={(value) => set('guestCount', value)} /></Field>{payments.length > 0 && <Field label="결제 방식"><Select value={form.paymentMethod} onChange={(value) => set('paymentMethod', value)} options={payments} /></Field>}<Field label="픽업 장소"><input value={form.pickupLocation} onChange={(event) => set('pickupLocation', event.target.value)} /></Field><Field label="하차 장소"><input value={form.dropoffLocation} onChange={(event) => set('dropoffLocation', event.target.value)} /></Field><Field label="성인"><NumberInput value={form.adults} min={1} onChange={(value) => set('adults', value)} /></Field><Field label="아동"><NumberInput value={form.children} onChange={(value) => set('children', value)} /></Field></div>{isNinhBinh && <div className="booking-field-set"><span className="booking-field-set-label">닌빈 투어 선택</span><div className="booking-fields"><Field label="식사"><Select value={form.lunchOption} onChange={(value) => set('lunchOption', value)} options={['금잔디 식당(한식-추천)', '현지식', '식사 미신청']} /></Field><Field label="코스"><Select value={form.courseOption} onChange={(value) => set('courseOption', value)} options={['호아루(추천)', '항무아(입장료 현장결제)']} /></Field><Field label="야간 투어"><Select value={form.nightTourOption} onChange={(value) => set('nightTourOption', value)} options={['선택안함', '선택 (추가비용)']} /></Field></div></div>}{addons.length > 0 && <div className="booking-field-set"><span className="booking-field-set-label">추가 옵션</span>{addons.map((addon) => { const selected = form.addons.find((entry) => entry.optionId === addon.option_id); return <label className="booking-option-line" key={addon.option_id}><input type="checkbox" checked={Boolean(selected)} onChange={(event) => set('addons', event.target.checked ? [...form.addons, { optionId: addon.option_id, quantity: 1 }] : form.addons.filter((entry) => entry.optionId !== addon.option_id))} /><span>{addon.option_name}</span><b>{money(n(addon.price), addon.price_currency)}</b></label>; })}</div>}</>;
    }
    if (type === 'package') return <><div className="booking-fields"><Field label="패키지" full><Select value={form.packageId} onChange={(value) => set('packageId', value)} options={derived.packages} valueOf={(pkg) => pkg.id} label={(pkg) => pkg.name} /></Field><Field label="여행 출발일"><input type="date" value={form.departureDate} onChange={(event) => set('departureDate', event.target.value)} /></Field><Field label="성인(12세 이상)"><NumberInput value={form.adults} min={1} max={20} onChange={(value) => set('adults', value)} /></Field><Field label="총 아동"><NumberInput value={form.totalChildren} onChange={(value) => set('totalChildren', value)} /></Field><Field label="총 유아"><NumberInput value={form.totalInfants} onChange={(value) => set('totalInfants', value)} /></Field></div><div className="booking-field-set"><span className="booking-field-set-label">아동 옵션</span><div className="booking-fields"><Field label="엑스트라베드 사용"><NumberInput value={form.childExtraBed} max={form.totalChildren} onChange={(value) => set('childExtraBed', value)} /></Field><Field label="엑스트라베드 미사용"><NumberInput value={form.childNoExtraBed} max={form.totalChildren} onChange={(value) => set('childNoExtraBed', value)} /></Field></div></div><div className="booking-field-set"><span className="booking-field-set-label">유아 옵션</span><div className="booking-fields"><Field label="신장 미만 무료"><NumberInput value={form.infantFree} max={form.totalInfants} onChange={(value) => set('infantFree', value)} /></Field><Field label="신장 이상 투어"><NumberInput value={form.infantTour} max={form.totalInfants} onChange={(value) => set('infantTour', value)} /></Field><Field label="엑스트라베드 추가"><NumberInput value={form.infantExtraBed} max={form.totalInfants} onChange={(value) => set('infantExtraBed', value)} /></Field><Field label="리무진 좌석 추가"><NumberInput value={form.infantSeat} max={form.totalInfants} onChange={(value) => set('infantSeat', value)} /></Field></div></div></>;
    return <><div className="booking-fields"><Field label="티켓 종류"><Select value={form.ticketType} onChange={(value) => setForm((current) => ({ ...current, ticketType: value, ticketName: '', programSelection: '', shuttleRequired: false }))} options={derived.ticketTypes} valueOf={(row) => row.value} label={(row) => row.label} /></Field><Field label={form.ticketType === 'dragon' ? '드래곤펄 투어' : '요코온센 상품'}><Select value={form.ticketName} onChange={(value) => set('ticketName', value)} options={derived.ticketNames} disabled={!form.ticketType} /></Field><Field label="이용일"><input type="date" value={form.usageDate} onChange={(event) => set('usageDate', event.target.value)} /></Field><Field label={form.ticketType === 'other' ? '수량' : '성인'}><NumberInput value={form.adultCount} min={0} onChange={(value) => set('adultCount', value)} /></Field>{form.ticketType === 'dragon' && <Field label="아동"><NumberInput value={form.childCount} onChange={(value) => set('childCount', value)} /></Field>}{form.ticketType === 'other' && <Field label="프로그램 선택"><Select value={form.programSelection} onChange={(value) => set('programSelection', value)} options={['모닝', '에프터눈', '나이트']} /></Field>}<Field label="티켓 상세"><input value={form.ticketDetails} onChange={(event) => set('ticketDetails', event.target.value)} /></Field></div>{form.ticketType === 'dragon' && <><div className="booking-field-set"><span className="booking-field-set-label">드래곤펄 메인 메뉴</span><div className="booking-fields"><Field label="랍스터"><NumberInput value={form.lobsterCount} onChange={(value) => set('lobsterCount', value)} /></Field><Field label="생선요리"><NumberInput value={form.fishCount} onChange={(value) => set('fishCount', value)} /></Field></div></div><label className="booking-check"><input type="checkbox" checked={form.shuttleRequired} onChange={(event) => set('shuttleRequired', event.target.checked)} />하롱 국제 선착장 셔틀 차량 신청</label></>}</>;
  }

  if (!service) return <div className="booking-page"><div className="booking-shell"><div className="booking-empty"><h1>서비스를 찾을 수 없습니다.</h1><Link href="/booking">예약 홈으로 →</Link></div></div></div>;
  return <div className="booking-page"><div className="booking-shell"><Link href="/booking" className="booking-back">← 전체 서비스</Link><div className="booking-title-row"><div><span className="booking-section-kicker">HAPPY TRAVEL SERVICE</span><h1>{service.label}</h1></div><BookingCartLink className="beta-badge" header={false}>장바구니</BookingCartLink></div>{loading ? <div className="booking-empty"><h2>여행 서비스를 불러오는 중입니다.</h2></div> : <form className="service-flow" onSubmit={addToCart}><section className="booking-panel"><div className="booking-panel-head"><span>01 / RESERVATION DETAILS</span><h2>여행 조건 선택</h2></div><div className="booking-panel-body">{fields()}{type === 'package' && packageItemFields()}<div className="booking-field full booking-request-note"><label>요청사항</label><textarea value={form.requestNote} onChange={(event) => set('requestNote', event.target.value)} placeholder="필요한 요청사항을 입력해 주세요." /></div></div></section><aside className="service-selection-summary"><div><span>02 / SELECTION SUMMARY</span><h2>선택 내용</h2></div><dl>{summaryRows().map(([label, value]) => <div key={label}><dt>{label}</dt><dd className={label.includes('금액') ? 'booking-summary-price' : ''}>{value}</dd></div>)}</dl></aside>{error && <p className="booking-error" role="alert">{error}</p>}{message && <p className="booking-warning" role="status">{message}</p>}<div className="booking-controls"><button type="submit" disabled={saving}>{saving ? '홈페이지 DB 저장 중…' : editingCartItemId ? '장바구니 수정 저장 →' : '장바구니에 저장 →'}</button><BookingCartLink className="secondary" showCount={false} header={false}>장바구니 보기 →</BookingCartLink></div></form>}</div></div>;
}
