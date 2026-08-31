// 홈페이지 장바구니를 고객앱과 동일한 플랫폼 예약 구조로 저장한다.
import { normalizeBookingCartItems } from '@/lib/booking-cart-contract';
import { getHomepageBookingCartDatabase, getPlatformBearerToken, getPlatformCartOwner, getPlatformUserDatabase } from '@/lib/homepage-booking-cart-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function fail(message, status = 400, details = '') {
  return Response.json({ error: message, details }, { status });
}

function dbError(error, fallback) {
  if (!error) return null;
  const next = new Error(fallback);
  next.cause = error;
  return next;
}

function number(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function integer(value, fallback = 0) {
  return Math.max(0, Math.trunc(number(value, fallback)));
}

function isoKst(value) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return `${value}:00+09:00`;
  return value;
}

function daysBetween(start, end) {
  const startDate = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);
  const days = Math.round((endDate.getTime() - startDate.getTime()) / 86400000);
  return Number.isFinite(days) && days > 0 ? days : 1;
}

function isDateValid(row, date, from = 'valid_from', to = 'valid_to') {
  return Boolean(date) && (!row?.[from] || row[from] <= date) && (!row?.[to] || row[to] >= date);
}

function scheduleLabel(value) {
  return ({ DAY: '당일', '1N2D': '1박2일', '2N3D': '2박3일', '1박 2일': '1박2일', '2박 3일': '2박3일' })[value] || value;
}

function scheduleCode(value) {
  return ({ 당일: 'DAY', '1박2일': '1N2D', '2박3일': '2N3D' })[scheduleLabel(value)] || value;
}

function platformData(item) {
  const data = item?.metadata?.platform;
  if (!data || ![1, 2].includes(data.contractVersion)) {
    throw new Error(`${item.serviceLabel} 항목은 플랫폼 저장 정보가 부족합니다. 장바구니에서 삭제한 뒤 다시 선택해 주세요.`);
  }
  return data;
}

async function createAutomaticQuote(platform, owner) {
  const profile = await platform.from('users').select('name').eq('id', owner.id).maybeSingle();
  if (profile.error) throw dbError(profile.error, '예약자 정보를 확인하지 못했습니다.');
  const titleBase = profile.data?.name || owner.email.split('@')[0] || '고객';
  const allQuotes = await platform.from('quote').select('id').eq('user_id', owner.id);
  if (allQuotes.error) throw dbError(allQuotes.error, '견적 번호를 확인하지 못했습니다.');
  const created = await platform.from('quote').insert({ user_id: owner.id, title: `${titleBase}${(allQuotes.data || []).length + 1}`, status: 'draft' }).select('id,title,status').single();
  if (created.error) throw dbError(created.error, '새 견적을 생성하지 못했습니다.');
  return created.data;
}

async function insertParent(platform, ownerId, quoteId, values) {
  const result = await platform.from('reservation').insert({
    re_user_id: ownerId,
    re_quote_id: quoteId || null,
    re_status: 'pending',
    re_created_at: new Date().toISOString(),
    ...values,
  }).select('re_id,re_quote_id').single();
  if (result.error) throw dbError(result.error, '플랫폼 예약 기본 정보를 저장하지 못했습니다.');
  return result.data;
}

async function saveCruise(platform, owner, quoteId, item) {
  const data = platformData(item);
  const rooms = Array.isArray(data.rooms) && data.rooms.length ? data.rooms : [{ rateCardId: item.optionId, roomCount: item.quantity, adultCount: item.adults, childCount: item.children, infantCount: item.infants }];
  const rateIds = [...new Set(rooms.map((room) => room.rateCardId).filter(Boolean))];
  const applicable = await platform.rpc('get_applicable_cruise_rate_cards', { p_schedule_type: scheduleCode(data.schedule), p_checkin_date: data.checkin || item.startDate, p_cruise_name: data.cruiseName || item.name, p_room_type: null, p_booking_date: new Date().toISOString().slice(0, 10) });
  const result = applicable.error ? await platform.from('cruise_rate_card').select('*').in('id', rateIds).eq('is_active', true) : applicable;
  if (result.error) throw dbError(result.error, '크루즈 객실 요금을 다시 확인하지 못했습니다.');
  const rateMap = new Map((result.data || []).filter((rate) => rateIds.includes(rate.id)).map((rate) => [rate.id, rate]));
  if (rateMap.size !== rateIds.length) throw new Error('현재 예약할 수 없는 크루즈 객실이 포함되어 있습니다.');

  const checkin = data.checkin || item.startDate;
  const surchargeResult = await platform.from('cruise_holiday_surcharge').select('*').eq('cruise_name', data.cruiseName || item.name).eq('valid_year', new Date(`${checkin}T00:00:00Z`).getUTCFullYear()).or(`schedule_type.eq.${scheduleCode(data.schedule)},schedule_type.is.null`);
  if (surchargeResult.error) throw dbError(surchargeResult.error, '크루즈 공휴일 추가요금을 확인하지 못했습니다.');
  const surcharges = (surchargeResult.data || []).filter((row) => row.holiday_date <= checkin && (row.holiday_date_end || row.holiday_date) >= checkin);

  let total = 0;
  let adults = 0;
  let children = 0;
  let infants = 0;
  const detailRows = rooms.map((room) => {
    const rate = rateMap.get(room.rateCardId);
    if (!isDateValid(rate, data.checkin || item.startDate)) throw new Error(`${rate.room_type} 객실은 선택일에 적용되지 않습니다.`);
    if (scheduleLabel(rate.schedule_type) !== scheduleLabel(data.schedule)) throw new Error(`${rate.room_type} 객실의 일정이 변경되었습니다.`);
    const roomCount = Math.max(1, integer(room.roomCount, 1));
    const adultCount = Math.max(1, integer(room.adultCount, 1));
    const childCount = integer(room.childCount);
    const childExtraBedCount = integer(room.childExtraBedCount);
    const infantCount = integer(room.infantCount);
    const extraBedCount = integer(room.extraBedCount);
    const singleCount = integer(room.singleCount);
    const baseTotal = roomCount * (
      number(rate.price_adult) * adultCount +
      number(rate.price_child) * childCount +
      number(rate.price_child_extra_bed) * childExtraBedCount +
      number(rate.price_infant) * Math.max(0, infantCount - 1) +
      number(rate.price_extra_bed) * extraBedCount +
      number(rate.price_single) * singleCount
    );
    const surchargeTotal = roomCount * surcharges.filter((row) => row.is_confirmed).reduce((sum, row) => {
      const note = `${row.holiday_name || ''} ${row.notes || ''}`.toLowerCase();
      if (/유아|infant|2세\s*미만|3번째|2인째/.test(note)) {
        const chargeable = /3번째/.test(note) ? Math.max(0, infantCount - 2) : /2인째/.test(note) ? Math.max(0, infantCount - 1) : infantCount;
        return sum + number(row.surcharge_per_person) * chargeable;
      }
      return sum + number(row.surcharge_per_person) * adultCount + number(row.surcharge_child, number(row.surcharge_per_person)) * (childCount + childExtraBedCount);
    }, 0);
    const roomTotal = baseTotal + surchargeTotal;
    total += roomTotal;
    adults += adultCount * roomCount;
    children += (childCount + childExtraBedCount) * roomCount;
    infants += infantCount * roomCount;
    return {
      room_price_code: rate.id,
      checkin: data.checkin || item.startDate,
      guest_count: adultCount + childCount + childExtraBedCount + infantCount + extraBedCount + singleCount,
      adult_count: adultCount,
      child_count: childCount,
      child_extra_bed_count: childExtraBedCount,
      infant_count: infantCount,
      extra_bed_count: extraBedCount,
      single_count: singleCount,
      room_count: roomCount,
      unit_price: number(rate.price_adult),
      room_total_price: roomTotal,
    };
  });
  const optionTotal = (data.tourOptions || []).reduce((sum, option) => sum + number(option.price) * Math.max(1, integer(option.quantity, 1)), 0);
  total += optionTotal;
  const promotions = [...new Map([...rateMap.values()].filter((rate) => rate.promotion_code).map((rate) => [rate.promotion_code, { code: rate.promotion_code, name: rate.promotion_name || null }])).values()];
  const priceBreakdown = { source: 'homepage_cart', contract_version: data.contractVersion, operational_details_status: 'pending', cruise_name: data.cruiseName || item.name, schedule: data.schedule, checkin_date: checkin, room_selections: detailRows, surcharges, tour_options: data.tourOptions || [], promotion_code: promotions[0]?.code || null, promotion_name: promotions[0]?.name || null, grand_total: total };
  const parent = await insertParent(platform, owner.id, quoteId, { re_type: 'cruise', total_amount: total, pax_count: adults + children + infants, re_adult_count: adults, re_child_count: children, re_infant_count: infants, reservation_date: data.checkin || item.startDate, price_breakdown: priceBreakdown });
  const accommodation = JSON.stringify(detailRows.map((row) => ({ room_price_code: row.room_price_code, room_count: row.room_count, adult_count: row.adult_count, child_count: row.child_count, infant_count: row.infant_count })));
  const rows = detailRows.map((row, index) => ({ ...row, reservation_id: parent.re_id, connecting_room: data.contractVersion === 1 && index === 0 ? Boolean(data.connectingRoom) : false, birthday_event: data.contractVersion === 1 && index === 0 ? Boolean(data.birthdayEvent) : false, birthday_name: data.contractVersion === 1 && index === 0 ? data.birthdayName || null : null, accommodation_info: index === 0 ? accommodation : null, request_note: data.contractVersion === 1 && index === 0 ? data.requestNote || null : null }));
  const detail = await platform.from('reservation_cruise').insert(rows);
  if (detail.error) throw dbError(detail.error, '크루즈 객실 상세 정보를 저장하지 못했습니다.');
  return { ...parent, promotionCodes: promotions.map((promotion) => promotion.code), totalAmount: total };
}

async function saveHotel(platform, owner, quoteId, item) {
  const data = platformData(item);
  const priceResult = await platform.from('hotel_price').select('*').eq('hotel_price_code', data.hotelPriceCode || item.optionId).maybeSingle();
  if (priceResult.error || !priceResult.data) throw dbError(priceResult.error, '호텔 객실 요금을 다시 확인하지 못했습니다.') || new Error('선택한 호텔 객실을 찾을 수 없습니다.');
  const rate = priceResult.data;
  const checkin = data.checkin || item.startDate;
  const checkout = data.checkout || item.endDate;
  if (!checkin || !checkout || !isDateValid(rate, checkin, 'start_date', 'end_date')) throw new Error('선택한 숙박일에 적용 가능한 호텔 객실이 아닙니다.');
  const nights = daysBetween(checkin, checkout);
  const roomCount = Math.max(1, integer(data.roomCount, item.quantity));
  const adults = Math.max(1, integer(data.adultCount, item.adults));
  const children = integer(data.childCount, item.children);
  const unitPrice = number(rate.base_price);
  const total = unitPrice * roomCount * nights;
  const parent = await insertParent(platform, owner.id, quoteId, { re_type: 'hotel', total_amount: total, pax_count: adults + children, re_adult_count: adults, re_child_count: children, reservation_date: checkin, price_breakdown: { source: 'homepage_cart', operational_details_status: 'pending', hotel_price_code: rate.hotel_price_code, unit_price: unitPrice, room_count: roomCount, nights, grand_total: total } });
  const detail = await platform.from('reservation_hotel').insert({ reservation_id: parent.re_id, hotel_price_code: rate.hotel_price_code, schedule: `${checkin} ~ ${checkout}`, room_count: roomCount, guest_count: adults + children, checkin_date: checkin, unit_price: unitPrice, total_price: total, request_note: data.contractVersion === 1 ? data.requestNote || null : null });
  if (detail.error) throw dbError(detail.error, '호텔 예약 상세 정보를 저장하지 못했습니다.');
  return parent;
}

async function saveAirport(platform, owner, quoteId, item) {
  const data = platformData(item);
  const legs = Array.isArray(data.legs) ? data.legs.filter((leg) => leg.airportPriceCode) : [];
  if (!legs.length) throw new Error('공항 이동 요금 선택 정보가 없습니다.');
  const codes = [...new Set(legs.map((leg) => leg.airportPriceCode))];
  const prices = await platform.from('airport_price').select('*').in('airport_code', codes).eq('is_active', true);
  if (prices.error) throw dbError(prices.error, '공항 이동 요금을 다시 확인하지 못했습니다.');
  const priceMap = new Map((prices.data || []).map((row) => [row.airport_code, row]));
  let total = 0;
  for (const leg of legs) {
    const price = priceMap.get(leg.airportPriceCode);
    if (!price || !isDateValid(price, leg.serviceDate || String(leg.datetime || '').slice(0, 10))) throw new Error('선택일에 적용 가능한 공항 이동 요금이 없습니다.');
    if (price.service_type !== leg.category || price.route !== leg.route || price.vehicle_type !== leg.vehicleType) throw new Error('공항 이동 요금 조건이 변경되었습니다. 다시 선택해 주세요.');
    total += number(price.price);
  }
  const passengers = Math.max(1, integer(data.passengerCount, item.adults + item.children));
  const parent = await insertParent(platform, owner.id, quoteId, { re_type: 'airport', total_amount: total, pax_count: passengers, re_adult_count: integer(item.adults), re_child_count: integer(item.children), reservation_date: legs[0].serviceDate || String(legs[0].datetime || '').slice(0, 10), price_breakdown: { source: 'homepage_cart', operational_details_status: 'pending', legs: legs.map((leg) => ({ code: leg.airportPriceCode, way_type: leg.wayType, service_date: leg.serviceDate || String(leg.datetime || '').slice(0, 10), price: number(priceMap.get(leg.airportPriceCode)?.price) })), grand_total: total } });
  const detailRows = legs.map((leg) => { const price = priceMap.get(leg.airportPriceCode); const legacy = data.contractVersion === 1; return { reservation_id: parent.re_id, airport_price_code: price.airport_code, ra_airport_location: legacy ? leg.airportLocation || null : null, accommodation_info: legacy ? leg.accommodation || null : null, ra_flight_number: legacy ? leg.flightNumber || null : null, ra_datetime: legacy ? isoKst(leg.datetime) : null, ra_passenger_count: passengers, ra_luggage_count: integer(data.luggageCount), way_type: leg.wayType, ra_car_count: 1, unit_price: number(price.price), total_price: number(price.price), request_note: legacy ? data.requestNote || null : null }; });
  const detail = await platform.from('reservation_airport').insert(detailRows);
  if (detail.error) throw dbError(detail.error, '공항 이동 상세 정보를 저장하지 못했습니다.');
  return parent;
}

async function saveRentcar(platform, owner, quoteId, item, cruiseVehicle = false, linkedCruiseReservationId = '') {
  const data = platformData(item);
  let effectiveQuoteId = quoteId;
  if (cruiseVehicle) {
    const sourceReservationId = linkedCruiseReservationId || data.cruiseReservationId;
    if (!sourceReservationId) throw new Error('차량을 연결할 크루즈 예약을 찾을 수 없습니다.');
    const source = await platform.from('reservation').select('re_id,re_quote_id,re_type').eq('re_id', sourceReservationId).eq('re_user_id', owner.id).eq('re_type', 'cruise').maybeSingle();
    if (source.error) throw dbError(source.error, '연결할 크루즈 예약을 확인하지 못했습니다.');
    if (!source.data) throw new Error('차량을 연결할 크루즈 예약을 찾을 수 없습니다.');
    effectiveQuoteId = source.data.re_quote_id || quoteId;
  }
  const vehicles = Array.isArray(data.vehicles) ? data.vehicles.filter((vehicle) => vehicle.rentcarPriceCode) : [];
  if (!vehicles.length) throw new Error('차량 요금 선택 정보가 없습니다.');
  const codes = [...new Set(vehicles.map((vehicle) => vehicle.rentcarPriceCode))];
  const prices = await platform.from('rentcar_price').select('*').in('rent_code', codes).eq('is_active', true);
  if (prices.error) throw dbError(prices.error, '차량 요금을 다시 확인하지 못했습니다.');
  const priceMap = new Map((prices.data || []).map((row) => [row.rent_code, row]));
  let total = 0;
  for (const vehicle of vehicles) {
    const price = priceMap.get(vehicle.rentcarPriceCode);
    if (!price || price.way_type !== vehicle.wayType || price.route !== vehicle.route || price.vehicle_type !== vehicle.vehicleType) throw new Error('차량 요금 조건이 변경되었습니다. 다시 선택해 주세요.');
    total += number(price.price) * Math.max(1, integer(vehicle.carCount, 1));
  }
  const reservationType = cruiseVehicle ? 'car' : 'rentcar';
  const firstDate = String(vehicles[0].pickupDatetime || vehicles[0].returnDatetime || '').slice(0, 10);
  const parent = await insertParent(platform, owner.id, effectiveQuoteId, { re_type: reservationType, total_amount: total, pax_count: Math.max(1, integer(data.passengerCount, item.adults + item.children)), re_adult_count: integer(item.adults), re_child_count: integer(item.children), reservation_date: item.startDate || firstDate || null, price_breakdown: { source: 'homepage_cart', operational_details_status: 'pending', source_cruise_reservation_id: linkedCruiseReservationId || data.cruiseReservationId || null, vehicles: vehicles.map((vehicle) => ({ code: vehicle.rentcarPriceCode, count: vehicle.carCount, price: number(priceMap.get(vehicle.rentcarPriceCode)?.price) })), grand_total: total } });
  const rows = vehicles.map((vehicle) => {
    const price = priceMap.get(vehicle.rentcarPriceCode);
    const count = Math.max(1, integer(vehicle.carCount, 1));
    const legacy = data.contractVersion === 1;
    if (cruiseVehicle) return { reservation_id: parent.re_id, car_price_code: price.rent_code, rentcar_price_code: price.rent_code, way_type: vehicle.wayType, route: vehicle.route, vehicle_type: vehicle.vehicleType, rental_type: price.rental_type || null, car_count: count, passenger_count: Math.max(1, integer(data.passengerCount)), pickup_datetime: legacy ? isoKst(vehicle.pickupDatetime) : null, pickup_location: legacy ? vehicle.pickupLocation || null : null, dropoff_location: legacy ? vehicle.destination || null : null, pickup_time: legacy ? vehicle.pickupTime || null : null, return_time: legacy ? vehicle.returnTime || null : null, return_datetime: legacy ? isoKst(vehicle.returnDatetime) : null, one_way_direction: vehicle.oneWayDirection || null, unit_price: number(price.price), car_total_price: number(price.price) * count, request_note: legacy ? data.requestNote || null : null };
    return { reservation_id: parent.re_id, rentcar_price_code: price.rent_code, pickup_datetime: legacy ? isoKst(vehicle.pickupDatetime) : null, pickup_location: legacy ? vehicle.pickupLocation || null : null, destination: legacy ? vehicle.destination || null : null, via_location: legacy ? vehicle.viaLocation || null : null, via_waiting: legacy ? vehicle.viaWaiting || null : null, return_datetime: legacy && vehicle.wayType !== '편도' ? isoKst(vehicle.returnDatetime) : null, return_pickup_location: legacy && vehicle.wayType !== '편도' ? vehicle.returnPickupLocation || null : null, return_destination: legacy && vehicle.wayType !== '편도' ? vehicle.returnDestination || null : null, return_via_location: legacy && vehicle.wayType !== '편도' ? vehicle.returnViaLocation || null : null, return_via_waiting: legacy && vehicle.wayType !== '편도' ? vehicle.returnViaWaiting || null : null, luggage_count: integer(data.luggageCount), passenger_count: Math.max(1, integer(data.passengerCount)), car_count: count, unit_price: number(price.price), total_price: number(price.price) * count, request_note: legacy ? data.requestNote || null : null, way_type: vehicle.wayType };
  });
  const detail = await platform.from(cruiseVehicle ? 'reservation_cruise_car' : 'reservation_rentcar').insert(rows);
  if (detail.error) throw dbError(detail.error, cruiseVehicle ? '크루즈 차량 상세 정보를 저장하지 못했습니다.' : '렌터카 상세 정보를 저장하지 못했습니다.');
  return parent;
}

async function saveTour(platform, owner, quoteId, item) {
  const data = platformData(item);
  const guests = Math.max(1, integer(data.guestCount, item.adults + item.children));
  const priceResult = await platform.from('tour_pricing').select('*').eq('pricing_id', data.tourPricingId).eq('tour_id', data.tourId).eq('is_active', true).maybeSingle();
  if (priceResult.error || !priceResult.data) throw dbError(priceResult.error, '투어 요금을 다시 확인하지 못했습니다.') || new Error('선택한 투어 요금을 찾을 수 없습니다.');
  const rate = priceResult.data;
  if (guests < integer(rate.min_guests) || (rate.max_guests && guests > integer(rate.max_guests))) throw new Error('선택 인원에 적용되는 투어 요금이 변경되었습니다.');
  let unitPrice = number(rate.price_per_person);
  if (data.paymentMethod) {
    const payment = await platform.from('tour_payment_pricing').select('price').eq('tour_id', data.tourId).eq('payment_method', data.paymentMethod).eq('is_active', true).maybeSingle();
    if (payment.error) throw dbError(payment.error, '투어 결제 방식별 요금을 확인하지 못했습니다.');
    if (payment.data?.price != null) unitPrice = number(payment.data.price);
  }
  const addonTotal = (data.addons || []).reduce((sum, addon) => sum + number(addon.price) * Math.max(1, integer(addon.quantity, 1)), 0);
  const total = unitPrice * guests + addonTotal;
  const requestNote = data.contractVersion === 1 ? [data.requestNote, data.lunchOption && `식사: ${data.lunchOption}`, data.courseOption && `코스: ${data.courseOption}`, data.nightTourOption && `야간투어: ${data.nightTourOption}`].filter(Boolean).join('\n') : null;
  const parent = await insertParent(platform, owner.id, quoteId, { re_type: 'tour', total_amount: total, pax_count: guests, re_adult_count: integer(item.adults), re_child_count: integer(item.children), reservation_date: data.usageDate || item.startDate, price_breakdown: { source: 'homepage_cart', operational_details_status: 'pending', tour_id: data.tourId, pricing_id: rate.pricing_id, payment_method: data.paymentMethod || null, lunch_option: data.lunchOption || null, course_option: data.courseOption || null, night_tour_option: data.nightTourOption || null, unit_price: unitPrice, addons: data.addons || [], grand_total: total } });
  const detail = await platform.from('reservation_tour').insert({ reservation_id: parent.re_id, tour_price_code: rate.pricing_id, tour_capacity: guests, pickup_location: data.contractVersion === 1 ? data.pickupLocation || null : null, dropoff_location: data.contractVersion === 1 ? data.dropoffLocation || null : null, usage_date: data.usageDate || item.startDate, unit_price: unitPrice, total_price: total, request_note: requestNote || null, adult_count: integer(item.adults), child_count: integer(item.children), infant_count: integer(item.infants) });
  if (detail.error) throw dbError(detail.error, '투어 상세 정보를 저장하지 못했습니다.');
  return parent;
}

async function saveTicket(platform, owner, quoteId, item) {
  const data = platformData(item);
  const priceCodes = [...new Set((data.lines || []).map((line) => line.ticketPriceCode).filter(Boolean))];
  const prices = priceCodes.length ? await platform.from('ticket_price').select('*').in('ticket_price_code', priceCodes).eq('is_active', true) : { data: [], error: null };
  if (prices.error) throw dbError(prices.error, '티켓 요금을 다시 확인하지 못했습니다.');
  const priceMap = new Map((prices.data || []).map((row) => [row.ticket_price_code, row]));
  let total = 0;
  const lines = (data.lines || []).map((line) => {
    const rate = priceMap.get(line.ticketPriceCode);
    if (!rate || !isDateValid(rate, data.usageDate || item.startDate)) throw new Error('선택일에 적용 가능한 티켓 요금이 없습니다.');
    const quantity = integer(line.quantity);
    const unitPrice = number(rate.stay_card_price_vnd);
    total += unitPrice * quantity;
    return { ...line, quantity, unitPrice, rate };
  });
  const adults = integer(data.adultCount, item.adults);
  const children = data.ticketType === 'dragon' ? integer(data.childCount, item.children) : 0;
  const ticketQuantity = adults + children;
  const shuttleCount = data.ticketType === 'dragon' && data.shuttleRequired ? ticketQuantity : 0;
  const menuSelections = [integer(data.lobsterCount) > 0 ? `랍스터:${integer(data.lobsterCount)}` : '', integer(data.fishCount) > 0 ? `생선요리:${integer(data.fishCount)}` : ''].filter(Boolean);
  const menuNotes = [integer(data.lobsterCount) > 0 ? `랍스터 ${integer(data.lobsterCount)}명` : '', integer(data.fishCount) > 0 ? `생선요리 ${integer(data.fishCount)}명` : ''].filter(Boolean);
  const requestNote = data.ticketType === 'dragon'
    ? [`[셔틀] ${data.shuttleRequired ? '신청함' : '신청 안함'}`, `[인원] 성인 ${adults}명, 아동 ${children}명`, data.contractVersion === 1 && menuNotes.length ? `[메인메뉴] ${menuNotes.join(', ')}` : '', data.contractVersion === 1 ? data.requestNote : ''].filter(Boolean).join('\n')
    : [`[프로그램] ${data.programSelection || '미선택'}`, `[수량] ${ticketQuantity}매`, data.contractVersion === 1 && data.ticketDetails ? `[상세내용] ${data.ticketDetails}` : '', data.contractVersion === 1 && data.requestNote ? `[요청사항] ${data.requestNote}` : ''].filter(Boolean).join('\n');
  const representativeLine = lines.find((line) => line.quantity > 0) || lines[0];
  const parent = await insertParent(platform, owner.id, quoteId, { re_type: 'ticket', total_amount: total, pax_count: ticketQuantity, re_adult_count: adults, re_child_count: children, reservation_date: data.usageDate || item.startDate, price_breakdown: { source: 'homepage_cart', operational_details_status: 'pending', ticket_type: data.ticketType, price_channel: 'card', request_note: requestNote || null, lines: lines.map((line) => ({ code: line.ticketPriceCode, item: line.rate.price_item, quantity: line.quantity, unit_price: line.unitPrice })), grand_total: total } });
  const detail = await platform.from('reservation_ticket').insert({ reservation_id: parent.re_id, ticket_type: data.ticketType, ticket_name: data.ticketType === 'dragon' ? data.ticketName || representativeLine?.rate?.ticket_name || item.name : null, program_selection: data.ticketType === 'dragon' ? (data.contractVersion === 1 ? menuSelections.join(', ') || null : null) : data.programSelection || null, ticket_quantity: ticketQuantity, usage_date: data.usageDate || item.startDate, shuttle_required: data.ticketType === 'dragon' && Boolean(data.shuttleRequired), pickup_location: null, dropoff_location: null, ticket_details: data.contractVersion === 1 && data.ticketType === 'other' ? data.ticketDetails || null : null, special_requests: data.contractVersion === 1 ? data.requestNote || null : null, request_note: requestNote || null, unit_price: ticketQuantity > 0 ? Math.round(total / ticketQuantity) : 0, total_price: total, ticket_price_code: representativeLine?.ticketPriceCode || null, ticket_price_item: representativeLine?.rate?.price_item || null, price_channel: 'card', adult_count: adults, child_count: children, shuttle_count: shuttleCount });
  if (detail.error) throw dbError(detail.error, '티켓 상세 정보를 저장하지 못했습니다.');
  return parent;
}

function packageAdultPrice(pkg, adults) {
  const config = pkg.price_config?.[String(adults)];
  if (config && typeof config === 'object') return number(config.per_person);
  if (config != null) return number(config);
  const keys = Object.keys(pkg.price_config || {}).map(Number).filter(Number.isFinite).sort((a, b) => b - a);
  if (keys[0] && adults > keys[0]) {
    const top = pkg.price_config[String(keys[0])];
    return typeof top === 'object' ? number(top.per_person) : number(top);
  }
  return number(pkg.base_price);
}

function offsetDate(date, days) {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

function splitShtSeatsByBucket(value) {
  const seats = String(value || '').split(/[,;\s]+/).map((seat) => seat.trim().toUpperCase()).filter(Boolean);
  if (seats.includes('ALL')) return [{ bucket: 'ALL', seats: ['ALL'] }];
  const grouped = new Map();
  for (const seat of seats) {
    const bucket = seat.startsWith('A') ? 'A' : seat.startsWith('B') || seat.startsWith('C') ? 'B' : null;
    if (!bucket) continue;
    grouped.set(bucket, [...(grouped.get(bucket) || []), seat]);
  }
  return [...grouped.entries()].map(([bucket, bucketSeats]) => ({ bucket, seats: bucketSeats }));
}

function packageShtPriceCode(bucket) {
  if (bucket === 'ALL') return 'SHT_LIMO_SOLO_HN_HL_2WAY_DIFF';
  if (bucket === 'A') return 'SHT_LIMO_A_HN_HL_2WAY_DIFF';
  return 'SHT_LIMO_B_HN_HL_2WAY_DIFF';
}

async function packageShtRow(platform, { reservationId, vehicleNumber, seatNumber, category, usageDate, pickupLocation, dropoffLocation, requestNote }) {
  const groups = splitShtSeatsByBucket(seatNumber);
  if (!groups.length) return null;
  const codes = groups.map((group) => packageShtPriceCode(group.bucket));
  const prices = await platform.from('rentcar_price').select('rent_code,price').in('rent_code', codes);
  if (prices.error) throw dbError(prices.error, '패키지 스하 셔틀 요금을 확인하지 못했습니다.');
  const priceMap = new Map((prices.data || []).map((row) => [row.rent_code, number(row.price)]));
  const breakdown = groups.map((group) => {
    const priceCode = packageShtPriceCode(group.bucket);
    const unitPrice = priceMap.get(priceCode) || 0;
    const quantity = group.bucket === 'ALL' ? 10 : group.seats.length;
    return { bucket: group.bucket, seats: group.seats, price_code: priceCode, unit_price: unitPrice, quantity, total_price: group.bucket === 'ALL' ? unitPrice : unitPrice * group.seats.length };
  });
  const totalPassengers = breakdown.reduce((sum, entry) => sum + entry.quantity, 0);
  const totalPrice = breakdown.reduce((sum, entry) => sum + entry.total_price, 0);
  const allSeats = groups.flatMap((group) => group.seats);
  return { reservation_id: reservationId, vehicle_number: vehicleNumber || '', seat_number: allSeats.join(','), sht_category: category, usage_date: usageDate, pickup_location: pickupLocation || '', dropoff_location: dropoffLocation || '', passenger_count: totalPassengers, car_count: 1, car_price_code: breakdown[0].price_code, unit_price: totalPrice > 0 && totalPassengers > 0 ? Math.round(totalPrice / totalPassengers) : breakdown[0].unit_price || null, car_total_price: totalPrice, request_note: requestNote || null, created_at: new Date().toISOString(), seat_pricing_breakdown: breakdown };
}

async function savePackage(platform, owner, item) {
  const data = platformData(item);
  const pkgResult = await platform.from('package_master').select('*,items:package_items(*)').eq('id', data.packageId).eq('is_active', true).maybeSingle();
  if (pkgResult.error || !pkgResult.data) throw dbError(pkgResult.error, '패키지를 다시 확인하지 못했습니다.') || new Error('선택한 패키지를 찾을 수 없습니다.');
  const pkg = pkgResult.data;
  const adults = Math.max(1, integer(data.adultCount, item.adults));
  const childExtraBed = integer(data.childExtraBed);
  const childNoExtraBed = integer(data.childNoExtraBed);
  const infantFree = integer(data.infantFree);
  const infantTour = integer(data.infantTour);
  const infantExtraBed = integer(data.infantExtraBed);
  const infantSeat = integer(data.infantSeat);
  const children = childExtraBed + childNoExtraBed;
  const infants = infantFree + infantTour;
  const adultPrice = packageAdultPrice(pkg, adults);
  const total = adults * adultPrice + childExtraBed * number(pkg.price_child_extra_bed, 6900000) + childNoExtraBed * number(pkg.price_child_no_extra_bed, 5850000) + infantTour * number(pkg.price_infant_tour, 900000) + infantExtraBed * number(pkg.price_infant_extra_bed, 4200000) + infantSeat * number(pkg.price_infant_seat, 800000);
  const parent = await insertParent(platform, owner.id, null, { re_type: 'package', package_id: pkg.id, total_amount: total, pax_count: adults + children + infants, re_adult_count: adults, re_child_count: children, re_infant_count: infants, reservation_date: data.departureDate || item.startDate, price_breakdown: { source: 'homepage_cart', operational_details_status: 'pending', adult: { count: adults, unit_price: adultPrice, total: adults * adultPrice }, child_extra_bed: { count: childExtraBed, unit_price: number(pkg.price_child_extra_bed), total: childExtraBed * number(pkg.price_child_extra_bed) }, child_no_extra_bed: { count: childNoExtraBed, unit_price: number(pkg.price_child_no_extra_bed), total: childNoExtraBed * number(pkg.price_child_no_extra_bed) }, infant_tour: { count: infantTour, unit_price: number(pkg.price_infant_tour), total: infantTour * number(pkg.price_infant_tour) }, infant_extra_bed: { count: infantExtraBed, unit_price: number(pkg.price_infant_extra_bed), total: infantExtraBed * number(pkg.price_infant_extra_bed) }, infant_seat: { count: infantSeat, unit_price: number(pkg.price_infant_seat), total: infantSeat * number(pkg.price_infant_seat) }, grand_total: total }, manager_note: `여행시작일: ${data.departureDate || item.startDate}\n성인: ${adults}, 아동(EB): ${childExtraBed}, 아동(No EB): ${childNoExtraBed}, 유아(무료): ${infantFree}, 유아(투어): ${infantTour}, 유아(EB): ${infantExtraBed}, 유아(좌석): ${infantSeat}` });
  const vehicle = (count, type) => count <= 2 ? '승용차' : count <= 4 ? 'SUV (Xpander급)' : count <= 7 ? (type === 'airport' && count === 5 ? '카니발, 이노바' : '9인승 리무진') : '11인승 리무진';
  const guests = adults + children + infants;
  const packageDetail = await platform.from('reservation_package').insert({ reservation_id: parent.re_id, package_id: pkg.id, adult_count: adults, child_extra_bed: childExtraBed, child_no_extra_bed: childNoExtraBed, infant_free: infantFree, infant_tour: infantTour, infant_extra_bed: infantExtraBed, infant_seat: infantSeat, adult_price: adultPrice, child_extra_bed_price: number(pkg.price_child_extra_bed, 6900000), child_no_extra_bed_price: number(pkg.price_child_no_extra_bed, 5850000), infant_tour_price: number(pkg.price_infant_tour, 900000), infant_extra_bed_price: number(pkg.price_infant_extra_bed, 4200000), infant_seat_price: number(pkg.price_infant_seat, 800000), airport_vehicle: vehicle(guests, 'airport'), ninh_binh_vehicle: vehicle(guests, 'tour'), hanoi_vehicle: vehicle(guests, 'tour'), cruise_vehicle: '스하 셔틀 리무진', sht_pickup_vehicle: null, sht_pickup_seat: null, sht_dropoff_vehicle: null, sht_dropoff_seat: null, total_price: total, additional_requests: data.contractVersion === 1 ? data.requestNote || null : null, created_at: new Date().toISOString() });
  if (packageDetail.error) throw dbError(packageDetail.error, '패키지 상세 정보를 저장하지 못했습니다.');

  const baseDate = data.departureDate || item.startDate;
  for (const packageItem of pkg.items || []) {
    const details = data.itemDetails?.[packageItem.id] || {};
    const description = String(packageItem.description || '').toLowerCase();
    let usageDate = baseDate;
    if (packageItem.service_type === 'tour') usageDate = offsetDate(baseDate, description.includes('하노이') || description.includes('hanoi') ? 3 : 1);
    if (packageItem.service_type === 'cruise') usageDate = offsetDate(baseDate, 2);
    const commonNote = `[차량수배: ${vehicle(guests, packageItem.service_type === 'airport' ? 'airport' : 'tour')}]`;

    if (packageItem.service_type === 'cruise') {
      let rateCode = packageItem.default_data?.room_price_code || '';
      if (!rateCode) {
        const rate = await platform.from('cruise_rate_card').select('id').ilike('cruise_name', '%그랜드 파이어니스%').ilike('room_type', '%베란다 스위트%').eq('is_active', true).limit(1).maybeSingle();
        if (rate.error) throw dbError(rate.error, '패키지 크루즈 객실을 확인하지 못했습니다.');
        rateCode = rate.data?.id || '';
      }
      if (!rateCode) throw new Error('패키지 크루즈 객실 요금 코드가 없습니다.');
      const detail = await platform.from('reservation_cruise').insert({ reservation_id: parent.re_id, room_price_code: rateCode, checkin: usageDate, guest_count: guests, adult_count: adults, child_count: children, infant_count: infants, child_extra_bed_count: childExtraBed, room_count: Math.max(1, integer(details.roomCount, 1)), accommodation_info: '그랜드 파이어니스 베란다 스위트', request_note: `[객실: 그랜드 파이어니스 베란다 스위트]\n${commonNote}` });
      if (detail.error) throw dbError(detail.error, '패키지 크루즈 상세 정보를 저장하지 못했습니다.');
    }

    if (packageItem.service_type === 'airport') {
      const airportName = '하노이 노이바이 국제공항';
      const legs = [
        { way_type: 'pickup', airport: details.pickupAirportName || airportName },
        { way_type: 'sending', airport: details.sandingAirportName || airportName },
      ];
      const detail = await platform.from('reservation_airport').insert(legs.map((leg) => ({ reservation_id: parent.re_id, airport_price_code: 'package1', request_note: commonNote, ra_datetime: null, ra_flight_number: null, ra_passenger_count: guests, ra_luggage_count: guests, ra_airport_location: leg.airport, accommodation_info: null, way_type: leg.way_type, ra_car_count: 1, unit_price: 0, total_price: 0 })));
      if (detail.error) throw dbError(detail.error, '패키지 공항 이동 상세 정보를 저장하지 못했습니다.');
    }

    if (packageItem.service_type === 'tour') {
      const tourName = description.includes('하노이') || description.includes('hanoi') ? '하노이 오후 투어' : '닌빈투어';
      let tour = await platform.from('tour').select('tour_id').eq('tour_name', tourName).eq('is_active', true).limit(1).maybeSingle();
      if (!tour.data && tourName === '닌빈투어') tour = await platform.from('tour').select('tour_id').ilike('tour_name', '%닌빈%').eq('is_active', true).limit(1).maybeSingle();
      if (tour.error) throw dbError(tour.error, '패키지 투어를 확인하지 못했습니다.');
      let pricingId = null;
      if (tour.data?.tour_id) {
        const pricing = await platform.from('tour_pricing').select('pricing_id').eq('tour_id', tour.data.tour_id).eq('is_active', true).lte('min_guests', guests).gte('max_guests', guests).order('min_guests').limit(1).maybeSingle();
        if (pricing.error) throw dbError(pricing.error, '패키지 투어 요금을 확인하지 못했습니다.');
        pricingId = pricing.data?.pricing_id || null;
      }
      const detail = await platform.from('reservation_tour').insert({ reservation_id: parent.re_id, tour_price_code: pricingId, tour_capacity: guests, pickup_location: null, dropoff_location: null, usage_date: usageDate, adult_count: adults, child_count: children, infant_count: infants, request_note: commonNote });
      if (detail.error) throw dbError(detail.error, '패키지 투어 상세 정보를 저장하지 못했습니다.');
    }

    if (packageItem.service_type === 'hotel') {
      const detail = await platform.from('reservation_hotel').insert({ reservation_id: parent.re_id, hotel_price_code: packageItem.default_data?.hotel_price_code || null, checkin_date: usageDate, room_count: Math.max(1, integer(details.roomCount, 1)), guest_count: guests, adult_count: adults, child_count: children, infant_count: infants, accommodation_info: null, request_note: commonNote });
      if (detail.error) throw dbError(detail.error, '패키지 호텔 상세 정보를 저장하지 못했습니다.');
    }

    if (packageItem.service_type === 'rentcar') {
      const detail = await platform.from('reservation_rentcar').insert({ reservation_id: parent.re_id, rentcar_price_code: packageItem.default_data?.rentcar_price_code || packageItem.default_data?.rent_code || null, pickup_datetime: null, pickup_location: null, destination: null, car_count: 1, passenger_count: guests, request_note: commonNote });
      if (detail.error) throw dbError(detail.error, '패키지 렌터카 상세 정보를 저장하지 못했습니다.');
    }

    if (packageItem.service_type === 'car_sht') {
      const rows = [];
      const pickupRow = await packageShtRow(platform, { reservationId: parent.re_id, vehicleNumber: details.shtPickupVehicle, seatNumber: details.shtPickupSeat, category: 'pickup', usageDate: offsetDate(baseDate, 2), pickupLocation: details.pickupLocation, dropoffLocation: '선착장', requestNote: commonNote });
      const dropoffRow = await packageShtRow(platform, { reservationId: parent.re_id, vehicleNumber: details.shtDropoffVehicle, seatNumber: details.shtDropoffSeat, category: 'dropoff', usageDate: offsetDate(baseDate, 3), pickupLocation: '선착장', dropoffLocation: details.dropoffLocation, requestNote: commonNote });
      if (pickupRow) rows.push(pickupRow);
      if (dropoffRow) rows.push(dropoffRow);
      if (!rows.length) rows.push({ reservation_id: parent.re_id, usage_date: offsetDate(baseDate, 2), car_count: 1, passenger_count: guests, request_note: commonNote });
      const detail = await platform.from('reservation_car_sht').insert(rows);
      if (detail.error) throw dbError(detail.error, '패키지 스하 차량 상세 정보를 저장하지 못했습니다.');
    }
  }
  return parent;
}

async function saveItem(platform, owner, quoteId, item, linkedCruiseReservationId = '') {
  if (item.serviceType === 'cruise') return saveCruise(platform, owner, quoteId, item);
  if (item.serviceType === 'cruise_vehicle') return saveRentcar(platform, owner, quoteId, item, true, linkedCruiseReservationId);
  if (item.serviceType === 'airport') return saveAirport(platform, owner, quoteId, item);
  if (item.serviceType === 'hotel') return saveHotel(platform, owner, quoteId, item);
  if (item.serviceType === 'rentcar') return saveRentcar(platform, owner, quoteId, item, false);
  if (item.serviceType === 'tour') return saveTour(platform, owner, quoteId, item);
  if (item.serviceType === 'package') return savePackage(platform, owner, item);
  if (item.serviceType === 'ticket') return saveTicket(platform, owner, quoteId, item);
  throw new Error('지원하지 않는 서비스가 포함되어 있습니다.');
}

async function rollback(platform, reservationIds) {
  if (!reservationIds.length) return;
  const result = await platform.from('reservation').delete().in('re_id', reservationIds);
  if (result.error) console.error('[booking-submit] rollback failed', result.error.message);
}

async function claimCruisePromotions(request, reservation, item) {
  const codes = reservation.promotionCodes || [];
  if (!codes.length) return;
  const token = getPlatformBearerToken(request);
  const customerAppUrl = (process.env.PLATFORM_CUSTOMER_APP_URL || 'https://customer.stayhalong.com').replace(/\/$/, '');
  for (const promotionCode of codes) {
    try {
      const response = await fetch(`${customerAppUrl}/api/cruise-promotion/claim`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ promotionCode, reservationId: reservation.re_id, quoteId: reservation.re_quote_id || null, metadata: { source: 'homepage_booking_cart', checkin: item.startDate, cruise_name: item.name, total_price: reservation.totalAmount } }), cache: 'no-store' });
      const claim = await response.json().catch(() => null);
      if (claim?.reason === 'quota_exhausted') throw new Error('선택한 크루즈 프로모션이 마감되었습니다. 장바구니에서 객실 요금을 다시 선택해 주세요.');
      if (!response.ok || !claim?.claimed) console.warn('[booking-submit] promotion claim skipped', promotionCode, claim?.reason || response.status);
    } catch (error) {
      if (String(error?.message || '').includes('프로모션이 마감')) throw error;
      console.warn('[booking-submit] promotion claim failed', promotionCode, error?.message || error);
    }
  }
}

export async function POST(request) {
  const owner = await getPlatformCartOwner(request);
  const homepage = getHomepageBookingCartDatabase();
  const platform = getPlatformUserDatabase(request);
  if (!owner || !platform) return fail('플랫폼 로그인이 필요합니다.', 401);
  if (!homepage) return fail('홈페이지 장바구니 저장소가 설정되지 않았습니다.', 503);

  const cartResult = await homepage.from('homepage_booking_carts').select('id,items,status,updated_at').eq('platform_user_id', owner.id).maybeSingle();
  if (cartResult.error) return fail('홈페이지 장바구니를 불러오지 못했습니다.', 500);
  const items = normalizeBookingCartItems(cartResult.data?.items);
  if (!items.length) return fail('저장할 장바구니 항목이 없습니다.');

  const createdIds = [];
  const createdByCartItemId = new Map();
  try {
    items.forEach(platformData);
    // 견적 선택 UI 없이, 이번 장바구니의 일반 서비스만 새 견적에 묶는다.
    // 패키지는 고객앱 데이터 계약대로 독립 예약으로 저장한다.
    const quote = items.some((item) => item.serviceType !== 'package') ? await createAutomaticQuote(platform, owner) : null;
    for (const item of items) {
      const linkedCruiseReservationId = item.serviceType === 'cruise_vehicle' ? createdByCartItemId.get(item.metadata?.platform?.cruiseCartItemId) || '' : '';
      const reservation = await saveItem(platform, owner, quote?.id || null, item, linkedCruiseReservationId);
      createdIds.push(reservation.re_id);
      createdByCartItemId.set(item.id, reservation.re_id);
      if (item.serviceType === 'cruise') await claimCruisePromotions(request, reservation, item);
    }
    const clearedAt = new Date().toISOString();
    const cleared = await homepage.from('homepage_booking_carts').update({ items: [], item_count: 0, status: 'active', updated_at: clearedAt }).eq('id', cartResult.data.id).eq('updated_at', cartResult.data.updated_at).select('id').maybeSingle();
    if (cleared.error || !cleared.data) throw dbError(cleared.error, '플랫폼 예약은 저장했지만 홈페이지 장바구니를 비우지 못했습니다.') || new Error('장바구니가 다른 화면에서 변경되었습니다. 다시 확인해 주세요.');
    return Response.json({ quoteId: quote?.id || null, reservationIds: createdIds, itemCount: createdIds.length, clearedAt });
  } catch (error) {
    await rollback(platform, createdIds);
    console.error('[booking-submit] failed', error?.cause?.message || error?.message || error);
    return fail(error?.message || '장바구니 예약을 저장하지 못했습니다.', 400, error?.cause?.message || '');
  }
}
