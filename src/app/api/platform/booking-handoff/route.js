import { NextResponse } from 'next/server';

const SCHEDULE_TYPES = new Set(['DAY', '1N2D', '2N3D']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readText(params, key, maxLength) {
  const value = params.get(key)?.trim();
  if (!value || value.length > maxLength) throw new Error(`invalid_${key}`);
  return value;
}

function readCount(params, key, minimum, maximum) {
  const value = Number(params.get(key));
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`invalid_${key}`);
  return value;
}

function customerPlatformUrl() {
  const target = new URL(process.env.PLATFORM_CUSTOMER_URL || 'https://customer.stayhalong.com');
  if (target.protocol !== 'https:' && target.hostname !== 'localhost') {
    throw new Error('invalid_platform_customer_url');
  }
  return target;
}

export function GET(request) {
  try {
    const params = request.nextUrl.searchParams;
    const rateCardId = readText(params, 'rateCardId', 36);
    const sourceProductId = readText(params, 'sourceProductId', 36);
    const sourceProductSlug = readText(params, 'sourceProductSlug', 160);
    const cruiseName = readText(params, 'cruiseName', 160);
    const roomType = readText(params, 'roomType', 160);
    const schedule = readText(params, 'schedule', 5);
    const checkin = readText(params, 'checkin', 10);

    if (!UUID_PATTERN.test(rateCardId) || !UUID_PATTERN.test(sourceProductId)) throw new Error('invalid_id');
    if (!SCHEDULE_TYPES.has(schedule)) throw new Error('invalid_schedule');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(checkin)) throw new Error('invalid_checkin');

    const adultCount = readCount(params, 'adultCount', 1, 20);
    const childCount = readCount(params, 'childCount', 0, 10);
    const infantCount = readCount(params, 'infantCount', 0, 10);
    const roomCount = readCount(params, 'roomCount', 1, 10);
    const target = new URL('/mypage/direct-booking/cruise', customerPlatformUrl());

    target.searchParams.set('source', 'homepage');
    target.searchParams.set('sourceProductId', sourceProductId);
    target.searchParams.set('sourceProductSlug', sourceProductSlug);
    target.searchParams.set('rateCardId', rateCardId);
    target.searchParams.set('cruiseName', cruiseName);
    target.searchParams.set('roomType', roomType);
    target.searchParams.set('schedule', schedule);
    target.searchParams.set('checkin', checkin);
    target.searchParams.set('adultCount', String(adultCount));
    target.searchParams.set('childCount', String(childCount));
    target.searchParams.set('infantCount', String(infantCount));
    target.searchParams.set('roomCount', String(roomCount));

    return NextResponse.redirect(target, 303);
  } catch (error) {
    console.warn('[booking-handoff] rejected request', error instanceof Error ? error.message : 'invalid_request');
    return NextResponse.json({ error: '예약 조건을 확인해 주세요.' }, { status: 400 });
  }
}
