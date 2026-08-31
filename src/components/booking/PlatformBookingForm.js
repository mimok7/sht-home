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
  if (type === 'cruise_vehicle') return { ...shared, cruiseReservationId: '', cruiseCartItemId: '', vehicleServiceType: 'private_rental', passengerCount: 2, requestNote: '', vehicles: [vehicleSeed()] };
  if (type === 'airport') return { ...shared, serviceType: 'round_trip', airportRoute: '', vehicleType: '', passengerCount: 2, luggageCount: 0, requestNote: '', pickup: { category: '', route: '', vehicleType: '', airportPriceCode: '', serviceDate: '', airportLocation: '', accommodation: '', flightNumber: '', datetime: '' }, sending: { category: '', route: '', vehicleType: '', airportPriceCode: '', serviceDate: '', airportLocation: '', accommodation: '', flightNumber: '', datetime: '' } };
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

function airportRouteParts(route) {
  return String(route || '').split(/\s+-\s+/).map((part) => part.trim()).filter(Boolean);
}

function airportRoundTripKey(route) {
  const parts = airportRouteParts(route);
  return parts.length === 2 ? [...parts].sort((left, right) => left.localeCompare(right, 'ko')).join(' ↔ ') : String(route || '');
}

function airportRouteLabel(route) {
  const parts = airportRouteParts(route);
  return parts.length === 2 ? `${parts[0]} ↔ ${parts[1]}` : route;
}

function airportRouteChoices(prices, serviceType) {
  const choices = new Map();
  for (const price of prices) {
    if (serviceType === 'round_trip') {
      if (price.service_type !== '픽업') continue;
      const value = airportRoundTripKey(price.route);
      if (!choices.has(value)) choices.set(value, { value, label: airportRouteLabel(price.route) });
    } else {
      const value = JSON.stringify([price.service_type, price.route]);
      if (!choices.has(value)) choices.set(value, { value, label: price.route });
    }
  }
  return [...choices.values()];
}

function airportSelection(prices, form) {
  if (!form.airportRoute || !form.vehicleType) return [];
  if (form.serviceType === 'round_trip') {
    const pickup = prices.find((row) => row.service_type === '픽업' && airportRoundTripKey(row.route) === form.airportRoute && row.vehicle_type === form.vehicleType);
    const sending = prices.find((row) => row.service_type === '샌딩' && airportRoundTripKey(row.route) === form.airportRoute && row.vehicle_type === form.vehicleType);
    return [pickup, sending].filter(Boolean).map((row) => ({ wayType: row.service_type === '픽업' ? 'pickup' : 'sending', category: row.service_type, route: row.route, vehicleType: row.vehicle_type, airportPriceCode: row.airport_code }));
  }
  const [category, route] = JSON.parse(form.airportRoute);
  const row = prices.find((price) => price.service_type === category && price.route === route && price.vehicle_type === form.vehicleType);
  return row ? [{ wayType: row.service_type === '픽업' ? 'pickup' : 'sending', category: row.service_type, route: row.route, vehicleType: row.vehicle_type, airportPriceCode: row.airport_code }] : [];
}

function findVehiclePrice(prices, vehicle) {
  return prices.find((row) => row.way_type === vehicle.wayType && row.route === vehicle.route && row.vehicle_type === vehicle.vehicleType) || null;
}

function isRentcarPrice(row) {
  return row?.car_category_code === '렌트카' || (row?.rental_type === '단독대여' && row?.price !== null && row?.price !== undefined);
}

function todayInSeoul() {
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function selectedCruiseChoice(choices, form) {
  if (form.cruiseCartItemId) return choices.find((choice) => choice.cartItemId === form.cruiseCartItemId) || null;
  if (form.cruiseReservationId) return choices.find((choice) => choice.reservationId === form.cruiseReservationId) || null;
  return null;
}

function applySingleShuttleDefaults(form, choices, prices) {
  const cruise = selectedCruiseChoice(choices, form);
  const shuttlePrices = (prices || []).filter((row) => cruise?.cruiseName && String(row.vehicle_type || '').includes('셔틀') && row.cruise === cruise.cruiseName);
  if (!shuttlePrices.length) return form;
  return {
    ...form,
    vehicles: form.vehicles.map((vehicle) => {
      const ways = WAY_TYPES.filter((way) => shuttlePrices.some((row) => row.way_type === way));
      const wayType = ways.length === 1 ? ways[0] : vehicle.wayType;
      const routes = uniqueValues(shuttlePrices.filter((row) => row.way_type === wayType), 'route');
      const route = routes.length === 1 ? routes[0] : vehicle.route;
      const vehicleTypes = uniqueValues(shuttlePrices.filter((row) => row.way_type === wayType && row.route === route), 'vehicle_type');
      const vehicleType = vehicleTypes.length === 1 ? vehicleTypes[0] : vehicle.vehicleType;
      const price = shuttlePrices.find((row) => row.way_type === wayType && row.route === route && row.vehicle_type === vehicleType);
      return { ...vehicle, wayType, route, vehicleType, rentcarPriceCode: price?.rent_code || vehicle.rentcarPriceCode };
    }),
  };
}

async function loadCruiseReservations() {
  const auth = await platformSupabase.auth.getUser();
  if (!auth.data.user) return [];
  const today = todayInSeoul();
  let query = platformSupabase.from('reservation').select('re_id,re_quote_id,reservation_date,re_adult_count,re_child_count,re_infant_count,pax_count,price_breakdown,re_created_at').eq('re_user_id', auth.data.user.id).eq('re_type', 'cruise').gte('reservation_date', today).order('re_created_at', { ascending: false });
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
    return { value: `reservation:${reservation.re_id}`, reservationId: reservation.re_id, cartItemId: '', checkin: String(detail?.checkin || reservation.reservation_date || '').slice(0, 10), cruiseName: rate?.cruise_name || '크루즈', roomType: rate?.room_type || '', schedule: scheduleLabel(rate?.schedule_type || ''), adults: n(reservation.re_adult_count), children: n(reservation.re_child_count), infants: n(reservation.re_infant_count), passengerCount: Math.max(1, n(reservation.pax_count)) };
  }).filter((reservation) => reservation.checkin >= today);
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
        const query = new URLSearchParams(window.location.search);
        const [loaded, savedCruises, cart] = await Promise.all([
          loadPlatformBookingOptions(type),
          type === 'cruise_vehicle' ? loadCruiseReservations() : Promise.resolve([]),
          type === 'cruise_vehicle' ? hydrateBookingCart() : Promise.resolve({ items: [] }),
        ]);
        if (cancelled) return;
        setOptions(loaded);
        if (type === 'cruise_vehicle') {
          const today = todayInSeoul();
          const cartCruises = (cart.items || []).filter((item) => item.serviceType === 'cruise' && item.startDate >= today).sort((left, right) => Date.parse(right.addedAt) - Date.parse(left.addedAt)).map((item) => ({
            value: `cart:${item.id}`, reservationId: '', cartItemId: item.id, checkin: item.startDate, cruiseName: item.name, roomType: item.optionName, schedule: item.metadata?.platform?.schedule || '', adults: n(item.adults), children: n(item.children), infants: n(item.infants), passengerCount: Math.max(1, n(item.adults) + n(item.children) + n(item.infants)),
          }));
          const cruises = [...cartCruises, ...savedCruises];
          setCruiseReservations(cruises);
          const requestedCartItemId = query.get('cruiseCartItemId');
          const requestedServiceType = query.get('vehicleServiceType');
          const defaultCruise = cartCruises.find((item) => item.cartItemId === requestedCartItemId) || cartCruises[0] || cruises[0];
          if (defaultCruise) setForm((current) => {
            if (current.cruiseReservationId || current.cruiseCartItemId) return current;
            const next = { ...current, cruiseReservationId: defaultCruise.reservationId, cruiseCartItemId: defaultCruise.cartItemId, adults: defaultCruise.adults, children: defaultCruise.children, infants: defaultCruise.infants, passengerCount: defaultCruise.passengerCount, vehicleServiceType: requestedServiceType === 'cruise_shuttle' ? 'cruise_shuttle' : 'private_rental' };
            return next.vehicleServiceType === 'cruise_shuttle' ? applySingleShuttleDefaults(next, cruises, loaded.prices) : next;
          });
        }
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
  const setRoom = (key, field, value) => setForm((current) => ({ ...current, rooms: current.rooms.map((room) => room.key === key ? { ...room, [field]: value } : room) }));
  const setVehicle = (key, field, value) => setForm((current) => ({ ...current, vehicles: current.vehicles.map((vehicle) => vehicle.key === key ? { ...vehicle, [field]: value, ...(field === 'wayType' ? { route: '', vehicleType: '', rentcarPriceCode: '' } : {}), ...(field === 'route' ? { vehicleType: '', rentcarPriceCode: '' } : {}) } : vehicle) }));
  const chooseCruiseVehicleSource = (value) => {
    const choice = cruiseReservations.find((row) => row.value === value);
    if (!choice) return;
    setForm((current) => {
      const next = { ...current, cruiseReservationId: choice.reservationId, cruiseCartItemId: choice.cartItemId, adults: choice.adults, children: choice.children, infants: choice.infants, passengerCount: choice.passengerCount, vehicles: [vehicleSeed()] };
      return next.vehicleServiceType === 'cruise_shuttle' ? applySingleShuttleDefaults(next, cruiseReservations, options.prices) : next;
    });
  };

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
      const prices = validRateRows(options.prices, todayInSeoul());
      const legs = airportSelection(prices, form);
      const selected = legs.map((leg) => prices.find((row) => row.airport_code === leg.airportPriceCode)).filter(Boolean);
      return { prices, legs, total: selected.reduce((sum, row) => sum + n(row.price), 0), name: '공항 이동', optionName: `${form.serviceType === 'round_trip' ? '왕복' : '편도'}${form.vehicleType ? ` · ${form.vehicleType}` : ''}`, routeLabel: form.serviceType === 'round_trip' ? form.airportRoute : (form.airportRoute ? JSON.parse(form.airportRoute)[1] : ''), startDate: '', endDate: '', adults: 0, children: 0, infants: 0, quantity: legs.length || (form.serviceType === 'round_trip' ? 2 : 1) };
    }
    if (type === 'rentcar' || type === 'cruise_vehicle') {
      const selected = form.vehicles.map((vehicle) => findVehiclePrice(options.prices || [], vehicle)).filter(Boolean);
      const cruise = selectedCruiseChoice(cruiseReservations, form);
      return { total: selected.reduce((sum, row, index) => sum + n(row.price) * n(form.vehicles[index]?.carCount, 1), 0), name: type === 'cruise_vehicle' ? `${cruise?.cruiseName || '크루즈'} 차량` : '렌터카', optionName: form.vehicles.map((vehicle) => vehicle.vehicleType).filter(Boolean).join(' · '), startDate: type === 'cruise_vehicle' ? cruise?.checkin || '' : '', endDate: '', adults: n(form.adults), children: n(form.children), infants: 0, quantity: form.vehicles.reduce((sum, vehicle) => sum + n(vehicle.carCount, 1), 0) };
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
      return { contractVersion: 2, checkin: form.checkin, schedule: form.schedule, cruiseName: form.cruiseName, rooms: form.rooms, tourOptions: (form.tourOptions || []).map((selected) => { const row = (options.tourOptions || []).find((option) => option.option_id === selected.optionId); return { optionId: selected.optionId, name: row?.option_name, price: n(row?.option_price), quantity: n(selected.quantity, 1) }; }) };
    }
    if (type === 'hotel') {
      if (!form.checkin || !form.checkout || form.checkout <= form.checkin || !form.hotelPriceCode) throw new Error('체크인·체크아웃 날짜와 객실을 선택해 주세요.');
      return { contractVersion: 2, hotelPriceCode: form.hotelPriceCode, checkin: form.checkin, checkout: form.checkout, roomCount: n(form.roomCount, 1), adultCount: n(form.adults), childCount: n(form.children), infantCount: n(form.infants) };
    }
    if (type === 'airport') {
      const expectedLegs = form.serviceType === 'round_trip' ? 2 : 1;
      if (derived.legs.length !== expectedLegs) throw new Error('이동 형태, 이동 경로와 차량 유형을 선택해 주세요.');
      return { contractVersion: 2, passengerCount: n(form.passengerCount, 1), luggageCount: n(form.luggageCount), legs: derived.legs.map((leg) => ({ ...leg, serviceDate: null })) };
    }
    if (type === 'rentcar' || type === 'cruise_vehicle') {
      if (type === 'cruise_vehicle' && !form.cruiseReservationId && !form.cruiseCartItemId) throw new Error('차량을 추가할 크루즈 예약을 선택해 주세요.');
      if (form.vehicles.some((vehicle) => !vehicle.rentcarPriceCode)) throw new Error('모든 차량의 요금 조건을 선택해 주세요.');
      return { contractVersion: 2, cruiseReservationId: form.cruiseReservationId || null, cruiseCartItemId: form.cruiseCartItemId || null, passengerCount: n(form.passengerCount, 1), luggageCount: n(form.luggageCount), vehicles: form.vehicles.map((vehicle) => ({ key: vehicle.key, wayType: vehicle.wayType, route: vehicle.route, vehicleType: vehicle.vehicleType, rentcarPriceCode: vehicle.rentcarPriceCode, carCount: n(vehicle.carCount, 1), oneWayDirection: vehicle.oneWayDirection })) };
    }
    if (type === 'tour') {
      if (!form.tourId || !form.usageDate || !derived.price) throw new Error('투어, 이용일과 인원 요금을 선택해 주세요.');
      return { contractVersion: 2, tourId: form.tourId, usageDate: form.usageDate, guestCount: n(form.guestCount, 1), paymentMethod: form.paymentMethod, adultCount: n(form.adults), childCount: n(form.children), infantCount: n(form.infants), lunchOption: form.lunchOption, courseOption: form.courseOption, nightTourOption: form.nightTourOption, tourPricingId: derived.price.pricing_id, addons: derived.addons.map((entry) => ({ optionId: entry.row.option_id, name: entry.row.option_name, price: n(entry.row.price), quantity: n(entry.quantity, 1) })) };
    }
    if (type === 'package') {
      if (!form.packageId || !form.departureDate) throw new Error('패키지와 여행 출발일을 선택해 주세요.');
      if (n(form.childExtraBed) + n(form.childNoExtraBed) !== n(form.totalChildren)) throw new Error('아동 인원과 엑스트라베드 옵션 인원 합계가 같아야 합니다.');
      if (n(form.infantFree) + n(form.infantTour) !== n(form.totalInfants)) throw new Error('유아 인원과 필수 유아 옵션 인원 합계가 같아야 합니다.');
      return { contractVersion: 2, packageId: form.packageId, departureDate: form.departureDate, adultCount: n(form.adults), totalChildren: n(form.totalChildren), totalInfants: n(form.totalInfants), childExtraBed: n(form.childExtraBed), childNoExtraBed: n(form.childNoExtraBed), infantFree: n(form.infantFree), infantTour: n(form.infantTour), infantExtraBed: n(form.infantExtraBed), infantSeat: n(form.infantSeat) };
    }
    if (!form.ticketType || !form.ticketName || !form.usageDate || !derived.lines.length || n(form.adultCount) + n(form.childCount) < 1) throw new Error('티켓 종류, 상품, 이용일과 인원을 선택해 주세요.');
    if (form.ticketType === 'other' && !form.programSelection) throw new Error('요코온센 프로그램을 선택해 주세요.');
    if (n(form.lobsterCount) + n(form.fishCount) > n(form.adultCount) + n(form.childCount)) throw new Error('메뉴 선택 인원은 총 참가 인원을 초과할 수 없습니다.');
    return { contractVersion: 2, ticketType: form.ticketType, ticketName: form.ticketName, usageDate: form.usageDate, adultCount: n(form.adultCount), childCount: n(form.childCount), programSelection: form.programSelection, shuttleRequired: Boolean(form.shuttleRequired), priceChannel: 'card', shuttleCount: form.ticketType === 'dragon' && form.shuttleRequired ? n(form.adultCount) + n(form.childCount) : 0, lines: derived.pricedLines.filter((entry) => entry.quantity > 0).map((entry) => ({ ticketPriceCode: entry.row.ticket_price_code, quantity: entry.quantity })) };
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
    if (type === 'airport') return [['서비스', service.label], ['이동 형태', derived.optionName || '선택 중'], ['이동 경로', derived.routeLabel || '선택 중'], ['차량 유형', form.vehicleType || '선택 중'], ['참고 금액', money(derived.total)]];
    return [['서비스', service.label], ['상품', derived.name], ['옵션', derived.optionName || '선택 중'], ['이용일', derived.startDate || '미정'], ['인원', `성인 ${derived.adults} · 아동 ${derived.children} · 유아 ${derived.infants}`], ['참고 금액', money(derived.total, type === 'cruise' && derived.selected?.[0]?.rate?.currency === 'USD' ? 'USD' : type === 'ticket' && form.priceChannel === 'krw' ? 'KRW' : 'VND')]];
  }

  function airportFields() {
    const prices = validRateRows(options.prices, todayInSeoul());
    const routes = airportRouteChoices(prices, form.serviceType);
    const vehicleTypes = uniqueValues(prices.filter((row) => form.serviceType === 'round_trip' ? airportRoundTripKey(row.route) === form.airportRoute : JSON.stringify([row.service_type, row.route]) === form.airportRoute), 'vehicle_type');
    return <><div className="booking-step"><span>01 / 이동 형태</span><div className="booking-choice-grid"><Choice active={form.serviceType === 'round_trip'} onClick={() => setForm((current) => ({ ...current, serviceType: 'round_trip', airportRoute: '', vehicleType: '' }))}>왕복</Choice><Choice active={form.serviceType === 'one_way'} onClick={() => setForm((current) => ({ ...current, serviceType: 'one_way', airportRoute: '', vehicleType: '' }))}>편도</Choice></div></div><div className="booking-fields booking-field-set"><Field label="이동 경로"><Select value={form.airportRoute} onChange={(value) => setForm((current) => ({ ...current, airportRoute: value, vehicleType: '' }))} options={routes} valueOf={(route) => route.value} label={(route) => route.label} /></Field><Field label="차량 유형"><Select value={form.vehicleType} onChange={(value) => set('vehicleType', value)} options={vehicleTypes} disabled={!form.airportRoute} /></Field></div></>;
  }

  function vehicleFields(cruiseVehicle) {
    const sourceCruise = selectedCruiseChoice(cruiseReservations, form);
    const prices = (options.prices || []).filter((row) => {
      if (!cruiseVehicle) return isRentcarPrice(row);
      if (!String(row.route || '').includes('하롱베이')) return false;
      if (form.vehicleServiceType === 'cruise_shuttle') return String(row.vehicle_type || '').includes('셔틀') && row.cruise === sourceCruise?.cruiseName;
      return row.rental_type === '단독대여' && ['공통', sourceCruise?.cruiseName].includes(row.cruise);
    });
    return <>
      {cruiseVehicle && <Field label="차량을 추가할 크루즈 예약" full><Select value={form.cruiseCartItemId ? `cart:${form.cruiseCartItemId}` : form.cruiseReservationId ? `reservation:${form.cruiseReservationId}` : ''} onChange={chooseCruiseVehicleSource} options={cruiseReservations} valueOf={(row) => row.value} label={(row) => row.cruiseName} placeholder={cruiseReservations.length ? '크루즈 예약을 선택해 주세요' : '차량을 추가할 크루즈 예약이 없습니다'} /></Field>}
      {cruiseVehicle && <div className="booking-step"><span>차량 서비스 유형</span><div className="booking-choice-grid"><Choice active={form.vehicleServiceType === 'private_rental'} onClick={() => setForm((current) => ({ ...current, vehicleServiceType: 'private_rental', vehicles: [vehicleSeed()] }))}>단독 차량</Choice><Choice active={form.vehicleServiceType === 'cruise_shuttle'} onClick={() => setForm((current) => applySingleShuttleDefaults({ ...current, vehicleServiceType: 'cruise_shuttle', vehicles: [vehicleSeed()] }, cruiseReservations, options.prices))}>크루즈사 셔틀</Choice></div></div>}
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
          {selected && <p className="booking-inline-note booking-field full">{selected.vehicle_examples || selected.description || selected.vehicle_type} · {money(n(selected.price))}</p>}
        </div></div>;
      })}
      <button type="button" className="booking-add-row" onClick={() => set('vehicles', [...form.vehicles, vehicleSeed()])}>차량 추가 ＋</button>
      <div className="booking-fields booking-field-set"><Field label="탑승 인원"><NumberInput value={form.passengerCount} min={1} onChange={(value) => set('passengerCount', value)} /></Field><Field label="수하물 수"><NumberInput value={form.luggageCount} onChange={(value) => set('luggageCount', value)} /></Field></div>
    </>;
  }

  function fields() {
    if (type === 'cruise') return <>
      <div className="booking-step"><span>01 / 일정</span><div className="booking-choice-grid">{SCHEDULES.map((schedule) => <Choice key={schedule} active={form.schedule === schedule} onClick={() => setForm((current) => ({ ...current, schedule, cruiseName: '', rooms: [roomSeed()] }))}>{schedule}</Choice>)}</div></div>
      <div className="booking-fields"><Field label="출항일"><input type="date" value={form.checkin} onChange={(event) => setForm((current) => ({ ...current, checkin: event.target.value, cruiseName: '', rooms: [roomSeed()] }))} /></Field><Field label="크루즈"><Select value={form.cruiseName} onChange={(value) => setForm((current) => ({ ...current, cruiseName: value, rooms: [roomSeed()] }))} options={derived.cruises} disabled={!form.checkin} /></Field></div>
      <div className="booking-field-set"><span className="booking-field-set-label">02 / 객실 구성</span>{form.rooms.map((room, index) => { const selected = derived.rooms.find((rate) => rate.id === room.rateCardId); return <div className="booking-repeat-card" key={room.key}><div className="booking-repeat-head"><strong>객실 {index + 1}</strong>{form.rooms.length > 1 && <button type="button" onClick={() => set('rooms', form.rooms.filter((row) => row.key !== room.key))}>삭제</button>}</div><div className="booking-fields"><Field label="객실 타입" full><Select value={room.rateCardId} onChange={(value) => setRoom(room.key, 'rateCardId', value)} options={derived.rooms} valueOf={(rate) => rate.id} label={(rate) => `${rate.room_type}${rate.room_type_en ? ` / ${rate.room_type_en}` : ''} · ${money(n(rate.price_adult), rate.currency)}`} /></Field><Field label="객실 수"><NumberInput value={room.roomCount} min={1} max={8} onChange={(value) => setRoom(room.key, 'roomCount', value)} /></Field><Field label="성인"><NumberInput value={room.adultCount} min={1} onChange={(value) => setRoom(room.key, 'adultCount', value)} /></Field><Field label="아동"><NumberInput value={room.childCount} onChange={(value) => setRoom(room.key, 'childCount', value)} /></Field><Field label="아동 엑스트라베드"><NumberInput value={room.childExtraBedCount} onChange={(value) => setRoom(room.key, 'childExtraBedCount', value)} /></Field><Field label="유아"><NumberInput value={room.infantCount} onChange={(value) => setRoom(room.key, 'infantCount', value)} /></Field>{selected?.extra_bed_available && <Field label="성인 엑스트라베드"><NumberInput value={room.extraBedCount} onChange={(value) => setRoom(room.key, 'extraBedCount', value)} /></Field>}{selected?.single_available && <Field label="싱글 이용"><NumberInput value={room.singleCount} onChange={(value) => setRoom(room.key, 'singleCount', value)} /></Field>}</div></div>; })}<button type="button" className="booking-add-row" onClick={() => set('rooms', [...form.rooms, roomSeed()])}>객실 추가 ＋</button></div>
      {form.schedule === '당일' && form.cruiseName && <div className="booking-field-set"><span className="booking-field-set-label">당일투어 선택 옵션</span>{(options.tourOptions || []).filter((option) => option.cruise_name === form.cruiseName && scheduleLabel(option.schedule_type) === form.schedule).map((option) => { const selected = form.tourOptions.find((entry) => entry.optionId === option.option_id); return <label className="booking-option-line" key={option.option_id}><input type="checkbox" checked={Boolean(selected)} onChange={(event) => set('tourOptions', event.target.checked ? [...form.tourOptions, { optionId: option.option_id, quantity: 1 }] : form.tourOptions.filter((entry) => entry.optionId !== option.option_id))} /><span>{option.option_name}</span><b>{money(n(option.option_price))}</b></label>; })}</div>}
    </>;
    if (type === 'hotel') return <><div className="booking-fields"><Field label="체크인"><input type="date" value={form.checkin} onChange={(event) => setForm((current) => ({ ...current, checkin: event.target.value, hotelName: '', hotelPriceCode: '' }))} /></Field><Field label="체크아웃"><input type="date" min={form.checkin} value={form.checkout} onChange={(event) => set('checkout', event.target.value)} /></Field><Field label="호텔" full><Select value={form.hotelName} onChange={(value) => setForm((current) => ({ ...current, hotelName: value, hotelPriceCode: '' }))} options={derived.hotels} valueOf={(hotel) => hotel.hotel_name} label={(hotel) => `${hotel.hotel_name}${hotel.location ? ` · ${hotel.location}` : ''}`} /></Field><Field label="객실" full><Select value={form.hotelPriceCode} onChange={(value) => set('hotelPriceCode', value)} options={derived.rooms} valueOf={(room) => room.hotel_price_code} label={(room) => `${room.room_name} · ${room.include_breakfast ? '조식 포함' : '조식 별도'} · ${money(n(room.base_price))}`} /></Field><Field label="객실 수"><NumberInput value={form.roomCount} min={1} max={10} onChange={(value) => set('roomCount', value)} /></Field><Field label="성인"><NumberInput value={form.adults} min={1} onChange={(value) => set('adults', value)} /></Field><Field label="아동"><NumberInput value={form.children} onChange={(value) => set('children', value)} /></Field><Field label="유아"><NumberInput value={form.infants} onChange={(value) => set('infants', value)} /></Field></div></>;
    if (type === 'airport') return airportFields();
    if (type === 'rentcar') return vehicleFields(false);
    if (type === 'cruise_vehicle') return vehicleFields(true);
    if (type === 'tour') {
      const tours = (options.tours || []).filter((tour) => TOUR_NAMES.includes(tour.tour_name));
      const payments = uniqueValues((options.payments || []).filter((row) => row.tour_id === form.tourId), 'payment_method');
      const addons = (options.addons || []).filter((row) => row.tour_id === form.tourId && row.is_available !== false);
      const isNinhBinh = derived.tour?.tour_name === '닌빈 한국어 가이드 투어';
      return <><div className="booking-fields"><Field label="투어" full><Select value={form.tourId} onChange={(value) => setForm((current) => ({ ...current, tourId: value, paymentMethod: '', addons: [] }))} options={tours} valueOf={(tour) => tour.tour_id} label={(tour) => `${tour.tour_name} · ${tour.duration || ''}`} /></Field><Field label="이용일"><input type="date" value={form.usageDate} onChange={(event) => set('usageDate', event.target.value)} /></Field><Field label="참가 인원"><NumberInput value={form.guestCount} min={1} onChange={(value) => set('guestCount', value)} /></Field>{payments.length > 0 && <Field label="결제 방식"><Select value={form.paymentMethod} onChange={(value) => set('paymentMethod', value)} options={payments} /></Field>}<Field label="성인"><NumberInput value={form.adults} min={1} onChange={(value) => set('adults', value)} /></Field><Field label="아동"><NumberInput value={form.children} onChange={(value) => set('children', value)} /></Field></div>{isNinhBinh && <div className="booking-field-set"><span className="booking-field-set-label">닌빈 투어 선택</span><div className="booking-fields"><Field label="식사"><Select value={form.lunchOption} onChange={(value) => set('lunchOption', value)} options={['금잔디 식당(한식-추천)', '현지식', '식사 미신청']} /></Field><Field label="코스"><Select value={form.courseOption} onChange={(value) => set('courseOption', value)} options={['호아루(추천)', '항무아(입장료 현장결제)']} /></Field><Field label="야간 투어"><Select value={form.nightTourOption} onChange={(value) => set('nightTourOption', value)} options={['선택안함', '선택 (추가비용)']} /></Field></div></div>}{addons.length > 0 && <div className="booking-field-set"><span className="booking-field-set-label">추가 옵션</span>{addons.map((addon) => { const selected = form.addons.find((entry) => entry.optionId === addon.option_id); return <label className="booking-option-line" key={addon.option_id}><input type="checkbox" checked={Boolean(selected)} onChange={(event) => set('addons', event.target.checked ? [...form.addons, { optionId: addon.option_id, quantity: 1 }] : form.addons.filter((entry) => entry.optionId !== addon.option_id))} /><span>{addon.option_name}</span><b>{money(n(addon.price), addon.price_currency)}</b></label>; })}</div>}</>;
    }
    if (type === 'package') return <><div className="booking-fields"><Field label="패키지" full><Select value={form.packageId} onChange={(value) => set('packageId', value)} options={derived.packages} valueOf={(pkg) => pkg.id} label={(pkg) => pkg.name} /></Field><Field label="여행 출발일"><input type="date" value={form.departureDate} onChange={(event) => set('departureDate', event.target.value)} /></Field><Field label="성인(12세 이상)"><NumberInput value={form.adults} min={1} max={20} onChange={(value) => set('adults', value)} /></Field><Field label="총 아동"><NumberInput value={form.totalChildren} onChange={(value) => set('totalChildren', value)} /></Field><Field label="총 유아"><NumberInput value={form.totalInfants} onChange={(value) => set('totalInfants', value)} /></Field></div><div className="booking-field-set"><span className="booking-field-set-label">아동 옵션</span><div className="booking-fields"><Field label="엑스트라베드 사용"><NumberInput value={form.childExtraBed} max={form.totalChildren} onChange={(value) => set('childExtraBed', value)} /></Field><Field label="엑스트라베드 미사용"><NumberInput value={form.childNoExtraBed} max={form.totalChildren} onChange={(value) => set('childNoExtraBed', value)} /></Field></div></div><div className="booking-field-set"><span className="booking-field-set-label">유아 옵션</span><div className="booking-fields"><Field label="신장 미만 무료"><NumberInput value={form.infantFree} max={form.totalInfants} onChange={(value) => set('infantFree', value)} /></Field><Field label="신장 이상 투어"><NumberInput value={form.infantTour} max={form.totalInfants} onChange={(value) => set('infantTour', value)} /></Field><Field label="엑스트라베드 추가"><NumberInput value={form.infantExtraBed} max={form.totalInfants} onChange={(value) => set('infantExtraBed', value)} /></Field><Field label="리무진 좌석 추가"><NumberInput value={form.infantSeat} max={form.totalInfants} onChange={(value) => set('infantSeat', value)} /></Field></div></div></>;
    return <><div className="booking-fields"><Field label="티켓 종류"><Select value={form.ticketType} onChange={(value) => setForm((current) => ({ ...current, ticketType: value, ticketName: '', programSelection: '', shuttleRequired: false }))} options={derived.ticketTypes} valueOf={(row) => row.value} label={(row) => row.label} /></Field><Field label={form.ticketType === 'dragon' ? '드래곤펄 투어' : '요코온센 상품'}><Select value={form.ticketName} onChange={(value) => set('ticketName', value)} options={derived.ticketNames} disabled={!form.ticketType} /></Field><Field label="이용일"><input type="date" value={form.usageDate} onChange={(event) => set('usageDate', event.target.value)} /></Field><Field label={form.ticketType === 'other' ? '수량' : '성인'}><NumberInput value={form.adultCount} min={0} onChange={(value) => set('adultCount', value)} /></Field>{form.ticketType === 'dragon' && <Field label="아동"><NumberInput value={form.childCount} onChange={(value) => set('childCount', value)} /></Field>}{form.ticketType === 'other' && <Field label="프로그램 선택"><Select value={form.programSelection} onChange={(value) => set('programSelection', value)} options={['모닝', '에프터눈', '나이트']} /></Field>}</div>{form.ticketType === 'dragon' && <label className="booking-check"><input type="checkbox" checked={form.shuttleRequired} onChange={(event) => set('shuttleRequired', event.target.checked)} />하롱 국제 선착장 셔틀 차량 신청</label>}</>;
  }

  if (!service) return <div className="booking-page"><div className="booking-shell"><div className="booking-empty"><h1>서비스를 찾을 수 없습니다.</h1><Link href="/booking">예약 홈으로 →</Link></div></div></div>;
  return <div className="booking-page"><div className="booking-shell"><Link href="/booking" className="booking-back">← 전체 서비스</Link><div className="booking-title-row"><div><span className="booking-section-kicker">HAPPY TRAVEL SERVICE</span><h1>{service.label}</h1></div><BookingCartLink className="beta-badge" header={false}>장바구니</BookingCartLink></div>{loading ? <div className="booking-empty"><h2>여행 서비스를 불러오는 중입니다.</h2></div> : <form className="service-flow" onSubmit={addToCart}><section className="booking-panel"><div className="booking-panel-head"><span>01 / PRICE SELECTION</span></div><div className="booking-panel-body">{fields()}</div></section><aside className="service-selection-summary"><div><span>02 / SELECTION SUMMARY</span><h2>선택 내용</h2></div><dl>{summaryRows().map(([label, value]) => <div key={label}><dt>{label}</dt><dd className={label.includes('금액') ? 'booking-summary-price' : ''}>{value}</dd></div>)}</dl></aside>{error && <p className="booking-error" role="alert">{error}</p>}{message && <p className="booking-warning" role="status">{message}</p>}<div className="booking-controls"><button type="submit" disabled={saving}>{saving ? '홈페이지 DB 저장 중…' : editingCartItemId ? '장바구니 수정 저장 →' : '장바구니에 저장 →'}</button><BookingCartLink className="secondary" showCount={false} header={false}>장바구니 보기 →</BookingCartLink></div></form>}</div></div>;
}
