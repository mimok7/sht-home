'use client';

import { use, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { platformStorageUrl, resolvePublicMediaUrl } from '@/lib/public-media-url';
import { getPlatformCartSession, hydrateBookingCart, queueBookingCartItemAfterLogin, replaceBookingCartItem, syncBookingCart } from '@/lib/booking-cart';
import { loadPlatformBookingOptions, uniqueValues } from '@/lib/platform-booking-options';
import CruiseMediaGallery from '@/components/CruiseMediaGallery';
import './product.css';

// Keep this list aligned with the public recommendation view. Cabin imagery is
// loaded separately from the public gallery tables below.
const PRODUCT_COLUMNS = 'cruise_id,slug,cruise_name,cruise_name_en,description,star_rating,hero_image,itinerary_id,schedule_type,nights,cabin_id,cabin_name,cabin_name_en,room_area_text,bed_type,max_adults,max_guests,has_balcony,is_vip,has_butler,is_recommended,connecting_available,extra_bed_available,facilities,special_amenities,rate_plan_id,valid_from,valid_to,price_basis,currency,price_adult,price_child,price_infant,price_single,price_extra_bed,single_available,tags';
const SCHEDULE_LABELS = { DAY: '당일', '1N2D': '1박 2일', '2N3D': '2박 3일' };
const SCHEDULE_ORDER = ['DAY', '1N2D', '2N3D'];
const HOAN_KIEM_OUTSIDE_PICKUP_SURCHARGE = 500000;
const CRUISE_SHUTTLE_PRICE_PER_PERSON = 1000000;
const CRUISE_FALLBACK_IMAGES = ['/yacht_1.png', '/yacht_2.png', '/yacht_3.png', '/halong-hero.png'];
const MEDIA_CATEGORY_LABELS = {
  main: { label: '대표 이미지', eyebrow: 'CRUISE' },
  exterior: { label: '익스테리어', eyebrow: 'EXTERIOR' },
  interior: { label: '인테리어', eyebrow: 'INTERIOR' },
  menu: { label: '메뉴', eyebrow: 'MENU' },
  other: { label: '전체 갤러리', eyebrow: 'GALLERY' },
};

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function usableImageUrl(imageUrl) {
  return resolvePublicMediaUrl(imageUrl);
}

function cruiseFallbackImage(value) {
  const hash = [...String(value || '')].reduce((total, character) => total + character.codePointAt(0), 0);
  return CRUISE_FALLBACK_IMAGES[hash % CRUISE_FALLBACK_IMAGES.length];
}

function formatVnd(value, currency = 'VND') {
  const price = positiveNumber(value);
  return price ? `${price.toLocaleString('ko-KR')} ${currency}` : '상담 확인';
}

function rateMatchesDate(rate, date) {
  if (!date) return true;
  return (!rate.valid_from || rate.valid_from <= date) && (!rate.valid_to || rate.valid_to >= date);
}

function chooseRate(cabin, scheduleType, date) {
  const scheduled = cabin?.rates.filter((rate) => rate.schedule_type === scheduleType) || [];
  const dated = scheduled.filter((rate) => rateMatchesDate(rate, date));
  const candidates = date ? dated : scheduled;
  // Prefer a rate that can be revalidated against the platform before using a
  // display-only legacy rate. The latter must never reach the cart.
  const bookableCandidates = candidates.filter((rate) => rate.platform_rate_card_id);
  return [...(bookableCandidates.length ? bookableCandidates : candidates)].sort((left, right) => {
    const leftPrice = positiveNumber(left.price_adult) ?? Number.MAX_SAFE_INTEGER;
    const rightPrice = positiveNumber(right.price_adult) ?? Number.MAX_SAFE_INTEGER;
    return leftPrice - rightPrice;
  })[0] || null;
}

function buildCabins(rows) {
  const cabins = new Map();
  for (const row of rows) {
    if (!row.cabin_id) continue;
    if (!cabins.has(row.cabin_id)) {
      cabins.set(row.cabin_id, {
        id: row.cabin_id,
        name: row.cabin_name,
        nameEn: row.cabin_name_en,
        imageUrl: row.cabin_image,
        roomArea: row.room_area_text,
        bedType: row.bed_type,
        maxAdults: row.max_adults,
        maxGuests: row.max_guests,
        hasBalcony: row.has_balcony,
        isVip: row.is_vip,
        hasButler: row.has_butler,
        isRecommended: row.is_recommended,
        connectingAvailable: row.connecting_available,
        extraBedAvailable: row.extra_bed_available,
        facilities: row.facilities,
        specialAmenities: row.special_amenities,
        rates: [],
      });
    }
    cabins.get(row.cabin_id).rates.push(row);
  }
  return [...cabins.values()].sort((left, right) => Number(right.isRecommended) - Number(left.isRecommended) || left.name.localeCompare(right.name, 'ko'));
}

function buildCatalogCabins(rows) {
  return (rows || []).map((row) => ({
    id: row.id,
    legacyName: row.legacy_room_name,
    name: row.name_ko || row.legacy_room_name || '객실',
    nameEn: row.name_en,
    imageUrl: row.image_url,
    roomArea: row.room_area_text,
    bedType: row.bed_type,
    maxAdults: row.max_adults,
    maxGuests: row.max_guests,
    hasBalcony: row.has_balcony,
    isVip: row.is_vip,
    hasButler: row.has_butler,
    isRecommended: row.is_recommended,
    connectingAvailable: row.connecting_available,
    extraBedAvailable: row.extra_bed_available,
    facilities: row.facilities,
    specialAmenities: row.special_amenities,
    isActive: row.is_active !== false,
    rates: [],
  })).sort((left, right) => Number(right.isRecommended) - Number(left.isRecommended) || left.name.localeCompare(right.name, 'ko'));
}

function buildSourceCabins(rows) {
  return (rows || []).map((row) => ({
    id: `source-detail-${row.id}`,
    legacyName: row.name,
    name: row.name || row.nameEn || '객실',
    nameEn: row.nameEn,
    imageUrl: row.imageUrl,
    roomArea: row.roomArea,
    bedType: row.bedType,
    maxAdults: row.maxAdults,
    maxGuests: row.maxGuests,
    hasBalcony: row.hasBalcony,
    isVip: row.isVip,
    hasButler: row.hasButler,
    isRecommended: row.isRecommended,
    connectingAvailable: row.connectingAvailable,
    extraBedAvailable: row.extraBedAvailable,
    facilities: row.facilities,
    specialAmenities: row.specialAmenities,
    description: row.description,
    inclusions: row.inclusions,
    exclusions: row.exclusions,
    warnings: row.warnings,
    isActive: true,
    rates: [],
  }));
}

function normalizedCabinName(value) {
  return String(value || '')
    .replace(/\([^)]*\)/g, '')
    .replace(/[^a-zA-Z0-9가-힣]/g, '')
    .toLowerCase()
    .replace(/^the(?=[a-z])/, '')
    .replace(/(?:room|룸)$/i, '');
}

function cabinAliases(cabin) {
  return [cabin?.legacyName, cabin?.legacy_room_name, cabin?.name, cabin?.nameEn, cabin?.name_ko, cabin?.name_en]
    .map(normalizedCabinName)
    .filter(Boolean);
}

function mergeCatalogCabins(catalogRows, recommendationRows) {
  const recommendationCabins = buildCabins(recommendationRows || []);
  const recommendationById = new Map(recommendationCabins.map((cabin) => [cabin.id, cabin]));
  return buildCatalogCabins((catalogRows || []).filter((row) => row.is_active)).map((cabin) => {
    const aliases = cabinAliases(cabin);
    const matches = recommendationCabins.filter((candidate) => cabinAliases(candidate).some((alias) => aliases.includes(alias)));
    const recommendation = recommendationById.get(cabin.id) || (matches.length === 1 ? matches[0] : null);
    return {
      ...cabin,
      imageUrl: cabin.imageUrl || recommendation?.imageUrl,
      rates: recommendation?.rates || [],
    };
  });
}

function sourceRateForCabin(rate) {
  return {
    platform_rate_card_id: rate.platformRateCardId || rate.id,
    schedule_type: rate.scheduleType,
    valid_from: rate.validFrom,
    valid_to: rate.validTo,
    currency: rate.currency || 'VND',
    price_adult: rate.priceAdult,
    price_child: rate.priceChild,
    price_infant: rate.priceInfant,
    price_single: rate.priceSingle,
    price_extra_bed: rate.priceExtraBed,
    single_available: rate.singleAvailable,
    extra_bed_available: rate.extraBedAvailable,
  };
}

function matchingCabinForSourceRate(cabins, rate) {
  const rawNames = [rate.roomName, rate.roomNameEn].filter(Boolean);
  const aliases = rawNames.map(normalizedCabinName).filter(Boolean);
  const exact = cabins.filter((cabin) => cabinAliases(cabin).some((alias) => aliases.includes(alias)));
  if (exact.length) return bestCabinDetails(exact);

  const partial = cabins.filter((cabin) => cabinAliases(cabin).some((alias) => aliases.some((rateAlias) => alias.includes(rateAlias) || rateAlias.includes(alias))));
  return partial.length ? bestCabinDetails(partial) : null;
}

function cabinDetailScore(cabin) {
  return Number(Boolean(cabin.imageUrl)) * 16
    + Number(Boolean(cabin.roomArea)) * 8
    + Number(Boolean(cabin.bedType)) * 8
    + Number(Boolean(cabin.facilities)) * 4
    + Number(Boolean(cabin.specialAmenities)) * 4
    + Number(Boolean(cabin.maxGuests)) * 2
    + Number(Boolean(cabin.maxAdults));
}

function bestCabinDetails(cabins) {
  return [...cabins].sort((left, right) =>
    cabinDetailScore(right) - cabinDetailScore(left)
    || Number(right.isActive) - Number(left.isActive)
    || String(left.name).localeCompare(String(right.name), 'ko')
  )[0] || null;
}

function sourceCabinForRate(rate) {
  const sourceKey = `${rate.roomName || ''}\u0000${rate.roomNameEn || ''}`;
  return {
    id: `source-cabin-${encodeURIComponent(sourceKey || rate.id)}`,
    sourceKey,
    legacyName: rate.roomName,
    name: rate.roomName || rate.roomNameEn || '객실',
    nameEn: rate.roomNameEn,
    imageUrl: null,
    roomArea: null,
    bedType: null,
    maxAdults: null,
    maxGuests: null,
    hasBalcony: false,
    isVip: false,
    hasButler: false,
    isRecommended: false,
    connectingAvailable: false,
    extraBedAvailable: false,
    facilities: null,
    specialAmenities: null,
    rates: [],
  };
}

function mergeSourceRates(cabins, sourceRates, catalogRows) {
  const nextCabins = cabins.map((cabin) => ({ ...cabin, rates: [...(cabin.rates || [])] }));
  const fallbackCabins = buildCatalogCabins(catalogRows || []);
  const knownRates = new Set(nextCabins.flatMap((cabin) => cabin.rates.map((rate) => String(rate.platform_rate_card_id || rate.rate_plan_id || ''))).filter(Boolean));

  for (const sourceRate of sourceRates || []) {
    const rateId = String(sourceRate.platformRateCardId || sourceRate.id || '');
    if (!rateId || knownRates.has(rateId)) continue;
    let cabin = matchingCabinForSourceRate(nextCabins, sourceRate);
    if (!cabin) {
      const fallbackCabin = matchingCabinForSourceRate(fallbackCabins, sourceRate);
      if (fallbackCabin) {
        cabin = { ...fallbackCabin, rates: [] };
        nextCabins.push(cabin);
      } else {
        const sourceKey = `${sourceRate.roomName || ''}\u0000${sourceRate.roomNameEn || ''}`;
        cabin = nextCabins.find((candidate) => candidate.sourceKey === sourceKey);
        if (!cabin) {
          cabin = sourceCabinForRate(sourceRate);
          nextCabins.push(cabin);
        }
      }
    }
    if (!cabin) continue;
    cabin.rates.push(sourceRateForCabin(sourceRate));
    knownRates.add(rateId);
  }
  return nextCabins;
}

function sourceRateCabinKey(rate) {
  return `${String(rate.roomName || '').trim().toLowerCase()}::${String(rate.roomNameEn || '').trim().toLowerCase()}`;
}

function buildRateCardCabins(sourceRates, catalogRows, sourceCabinRows = []) {
  const catalogCabins = [
    ...buildSourceCabins(sourceCabinRows),
    ...buildCatalogCabins(catalogRows || []),
  ];
  const cabinsByProduct = new Map();

  for (const sourceRate of sourceRates || []) {
    const rateId = String(sourceRate.platformRateCardId || sourceRate.id || '');
    if (!rateId || !sourceRate.scheduleType) continue;
    const matchedCabin = matchingCabinForSourceRate(catalogCabins, sourceRate);
    const key = matchedCabin ? `catalog:${matchedCabin.id}` : `source:${sourceRateCabinKey(sourceRate)}`;
    if (!cabinsByProduct.has(key)) {
      cabinsByProduct.set(key, matchedCabin
        ? { ...matchedCabin, rates: [] }
        : sourceCabinForRate(sourceRate));
    }
    cabinsByProduct.get(key).rates.push(sourceRateForCabin(sourceRate));
  }

  return [...cabinsByProduct.values()].sort((left, right) =>
    Number(right.isRecommended) - Number(left.isRecommended) || left.name.localeCompare(right.name, 'ko')
  );
}

function createCabinIdMap(allCabinRows, activeCabins) {
  const activeById = new Map(activeCabins.map((cabin) => [cabin.id, cabin.id]));
  for (const row of allCabinRows || []) {
    if (activeById.has(row.id)) continue;
    const aliases = cabinAliases(row);
    const matches = activeCabins.filter((cabin) => cabinAliases(cabin).some((alias) => aliases.includes(alias)));
    if (matches.length === 1) activeById.set(row.id, matches[0].id);
  }
  return activeById;
}

function mapSourceCruiseImages(images, cabins) {
  return (images || []).flatMap((image) => {
    const aliases = [image.roomName, image.roomNameEn].map(normalizedCabinName).filter(Boolean);
    const matches = aliases.length
      ? cabins.filter((cabin) => cabinAliases(cabin).some((alias) => aliases.includes(alias)))
      : [];
    const targetCabins = matches.length ? matches : [null];
    return targetCabins.map((cabin) => ({
      id: `source-${image.id}${cabin ? `-${cabin.id}` : ''}`,
      cabin_id: cabin?.id || null,
      collection: image.collection,
      image_name: image.imageName,
      url: image.url,
      sort_order: image.sortOrder,
      is_primary: image.isPrimary,
    }));
  });
}

function mapSourceCabinImages(sourceCabins, cabins) {
  return (sourceCabins || []).flatMap((sourceCabin) => {
    const aliases = cabinAliases({
      legacyName: sourceCabin.name,
      name: sourceCabin.name,
      nameEn: sourceCabin.nameEn,
    });
    const matches = cabins.filter((cabin) =>
      cabinAliases(cabin).some((alias) => aliases.includes(alias))
    );
    return matches.flatMap((cabin) => (sourceCabin.images || []).map((url, index) => ({
      id: `source-cabin-${sourceCabin.id}-${cabin.id}-${index}`,
      cabin_id: cabin.id,
      collection: 'cabin_gallery',
      image_name: `${sourceCabin.name}-${String(index + 1).padStart(3, '0')}`,
      url,
      sort_order: index,
      is_primary: index === 0,
    })));
  });
}

function sortMediaImages(left, right) {
  return Number(right.isPrimary) - Number(left.isPrimary)
    || Number(left.sortOrder) - Number(right.sortOrder)
    || String(left.name).localeCompare(String(right.name), undefined, { numeric: true });
}

function publicStorageUrl(bucket, path) {
  return platformStorageUrl(bucket, path);
}

function buildMediaGroups(importRows, cabinImageRows, cabins, cabinIdMap = new Map()) {
  const groups = new Map();
  const cabinById = new Map(cabins.map((cabin) => [cabin.id, cabin]));

  function mappedCabin(cabinId) {
    return cabinById.get(cabinIdMap.get(cabinId) || cabinId);
  }

  function addImage(group, image) {
    if (!image.url) return;
    if (!groups.has(group.id)) groups.set(group.id, { ...group, images: [] });
    const images = groups.get(group.id).images;
    if (!images.some((current) => current.url === image.url)) images.push(image);
  }

  for (const row of importRows || []) {
    const pathFilename = row.storage_path?.split('/').pop() || '';
    const filename = pathFilename || row.image_name || '';
    const cabin = row.cabin_id ? mappedCabin(row.cabin_id) : null;
    if (cabin) {
      const label = cabin.nameEn || cabin.name || '객실';
      addImage(
        { id: `cabin-${cabin.id}`, label, eyebrow: 'CABIN' },
        {
          id: row.id,
          url: row.url || publicStorageUrl(row.storage_bucket, row.storage_path),
          alt: row.image_name || `${label} 객실 이미지`,
          name: filename,
          sortOrder: row.sort_order,
          isPrimary: row.is_primary,
        }
      );
      continue;
    }
    const category = String(pathFilename).match(/^(main|exterior|interior|menu)-/i)?.[1]?.toLowerCase()
      || String(row.image_name || '').match(/^(main|exterior|interior|menu)-/i)?.[1]?.toLowerCase()
      || 'other';
    const label = MEDIA_CATEGORY_LABELS[category];
    addImage(
      { id: category, ...label },
      {
        id: row.id,
        url: row.url || publicStorageUrl(row.storage_bucket, row.storage_path),
        alt: `${label.label} ${filename}`,
        name: filename,
        sortOrder: row.sort_order,
        isPrimary: row.is_primary,
      }
    );
  }

  for (const row of cabinImageRows || []) {
    const cabin = mappedCabin(row.cabin_id);
    if (!cabin) continue;
    const label = cabin.nameEn || cabin.name || '객실';
    addImage(
      { id: `cabin-${cabin.id}`, label, eyebrow: 'CABIN' },
      {
        id: row.id,
        url: publicStorageUrl(row.storage_bucket, row.storage_path),
        alt: row.alt_text || `${label} 객실 이미지`,
        name: row.storage_path,
        sortOrder: row.sort_order,
        isPrimary: row.is_primary,
      }
    );
  }

  const groupOrder = new Map([
    ['main', 0],
    ['exterior', 1],
    ['interior', 2],
    ['menu', 3],
    ...cabins.map((cabin, index) => [`cabin-${cabin.id}`, index + 4]),
  ]);

  const orderedGroups = [...groups.values()]
    .map((group) => ({ ...group, images: group.images.sort(sortMediaImages) }))
    .sort((left, right) => (groupOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (groupOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER));

  // Once curated cruise/facility/cabin groups exist, do not surface old
  // unclassified imports as one large mixed gallery. They remain available in
  // storage for recovery, while the product page shows only the correct group.
  const hasStructuredGroups = orderedGroups.some((group) =>
    ['exterior', 'interior', 'menu'].includes(group.id) || group.id.startsWith('cabin-')
  );
  return hasStructuredGroups
    ? orderedGroups.filter((group) => group.id !== 'other')
    : orderedGroups;
}

function parseFacilities(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.filter(Boolean);
  } catch {
    // Legacy free text was preserved in v2; split it conservatively for display.
  }
  return String(value).split(/\\n|\n|,|·/).map((item) => item.trim()).filter(Boolean);
}

function cabinFeatures(cabin) {
  return [
    cabin.roomArea ? `면적 ${cabin.roomArea}` : null,
    cabin.bedType ? `침대 ${cabin.bedType}` : null,
    cabin.maxGuests ? `최대 ${cabin.maxGuests}명` : null,
    cabin.hasBalcony ? '발코니' : null,
    cabin.isVip ? 'VIP' : null,
    cabin.hasButler ? '버틀러' : null,
    cabin.connectingAvailable ? '커넥팅 가능' : null,
    cabin.extraBedAvailable ? '엑스트라베드 가능' : null,
  ].filter(Boolean);
}

function editCartItemIdFromLocation() {
  if (typeof window === 'undefined') return '';
  return new URLSearchParams(window.location.search).get('editCartItem') || '';
}

function initialCabinId(cabins, scheduleType) {
  const hasSchedule = (cabin) => cabin.rates.some((rate) => rate.schedule_type === scheduleType);
  const hasPlatformRate = (cabin) => cabin.rates.some((rate) => rate.schedule_type === scheduleType && rate.platform_rate_card_id);
  return cabins.find(hasPlatformRate)?.id || cabins.find(hasSchedule)?.id || null;
}

function vehicleWayLabel(value) {
  return String(value || '').includes('왕복') ? '왕복' : value;
}

function cruisePassengerCount(item) {
  return Math.max(1, Number(item?.adults || 0) + Number(item?.children || 0) + Number(item?.infants || 0));
}

function vehicleTypeOrder(value) {
  const label = String(value || '');
  if (/승용차/.test(label)) return 10;
  if (/suv/i.test(label)) return 20;
  if (/카니발|이노바/i.test(label)) return 30;
  if (/9\s*인승/.test(label)) return 40;
  if (/11\s*인승/.test(label)) return 50;
  if (/16\s*인승/.test(label)) return 60;
  if (/25\s*인승/.test(label)) return 70;
  return 100;
}

function orderedVehicleTypes(values) {
  return [...values].sort((left, right) => vehicleTypeOrder(left) - vehicleTypeOrder(right) || left.localeCompare(right, 'ko'));
}

export default function ProductDetail({ params }) {
  const { id } = use(params);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [cruise, setCruise] = useState(null);
  const [cabins, setCabins] = useState([]);
  const [mediaGroups, setMediaGroups] = useState([]);
  const [selectedCabinId, setSelectedCabinId] = useState(null);
  const [detailCabinId, setDetailCabinId] = useState(null);
  const [selectedSchedule, setSelectedSchedule] = useState('');
  const [date, setDate] = useState('');
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [infants, setInfants] = useState(0);
  const [cartMessage, setCartMessage] = useState('');
  const [editingCartItemId, setEditingCartItemId] = useState('');
  const [reservationModalOpen, setReservationModalOpen] = useState(false);
  const [vehicleChoiceModalOpen, setVehicleChoiceModalOpen] = useState(false);
  const [savedCruiseCartItemId, setSavedCruiseCartItemId] = useState('');
  const [savedCruiseSelection, setSavedCruiseSelection] = useState(null);
  const [vehicleMode, setVehicleMode] = useState('');
  const [vehiclePrices, setVehiclePrices] = useState([]);
  const [vehicleOptionsLoading, setVehicleOptionsLoading] = useState(false);
  const [vehicleOptionsError, setVehicleOptionsError] = useState('');
  const [vehicleSaving, setVehicleSaving] = useState(false);
  const [vehicleForm, setVehicleForm] = useState({ mode: '', wayType: '', route: '', vehicleType: '', rentcarPriceCode: '', carCount: 1, passengerCount: 1, hoanKiemOutsidePickup: false });

  useEffect(() => {
    let cancelled = false;

    async function fetchProduct() {
      setLoading(true);
      setLoadError('');
      setMediaGroups([]);
      const decodedId = decodeURIComponent(id);
      let result = await supabase
        .from('public_cruise_recommendation_v2')
        .select(PRODUCT_COLUMNS)
        .eq('slug', decodedId);

      if (!result.error && !result.data?.length) {
        result = await supabase
          .from('public_cruise_recommendation_v2')
          .select(PRODUCT_COLUMNS)
          .eq('cruise_name', decodedId);
      }

      if (cancelled) return;
      const rows = result.error ? [] : result.data || [];
      let first;
      let schedules;
      let nextCabins;

      if (rows.length) {
        first = rows[0];
        schedules = [...new Set(rows.map((row) => row.schedule_type).filter(Boolean))]
          .sort((left, right) => SCHEDULE_ORDER.indexOf(left) - SCHEDULE_ORDER.indexOf(right));
      } else {
        let catalogResult = await supabase
          .from('cruises_v2')
          .select('id,slug,legacy_name,name_ko,name_en,description,star_rating,hero_image')
          .eq('slug', decodedId)
          .eq('is_active', true)
          .maybeSingle();
        if (!catalogResult.error && !catalogResult.data) {
          catalogResult = await supabase
            .from('cruises_v2')
            .select('id,slug,legacy_name,name_ko,name_en,description,star_rating,hero_image')
            .eq('name_ko', decodedId)
            .eq('is_active', true)
            .maybeSingle();
        }
        if (cancelled) return;
        if (catalogResult.error || !catalogResult.data) {
          setLoadError(result.error
            ? '상품 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'
            : '현재 공개된 상품을 찾을 수 없습니다.');
          setLoading(false);
          return;
        }
        const catalog = catalogResult.data;
        const itineraryResult = await supabase
          .from('cruise_itineraries_v2')
          .select('schedule_type')
          .eq('cruise_id', catalog.id)
          .eq('is_active', true);
        if (cancelled) return;
        if (itineraryResult.error) {
          setLoadError('상품의 일정 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
          setLoading(false);
          return;
        }
        first = {
          cruise_id: catalog.id,
          slug: catalog.slug,
          cruise_name: catalog.name_ko || catalog.legacy_name,
          cruise_name_en: catalog.name_en,
          description: catalog.description,
          star_rating: catalog.star_rating,
          hero_image: catalog.hero_image,
          tags: [],
        };
        schedules = [...new Set((itineraryResult.data || []).map((row) => row.schedule_type).filter(Boolean))]
          .sort((left, right) => SCHEDULE_ORDER.indexOf(left) - SCHEDULE_ORDER.indexOf(right));
      }

      const allCabinsResult = await supabase
        .from('cabins_v2')
        .select('id,legacy_room_name,name_ko,name_en,image_url,room_area_text,bed_type,max_adults,max_guests,has_balcony,is_vip,has_butler,is_recommended,connecting_available,extra_bed_available,facilities,special_amenities,is_active')
        .eq('cruise_id', first.cruise_id);
      if (cancelled) return;
      if (allCabinsResult.error) {
        setLoadError('상품의 객실 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
        setLoading(false);
        return;
      }
      const allCabinRows = allCabinsResult.data || [];
      nextCabins = mergeCatalogCabins(allCabinRows, rows);
      let sourcePayload = null;
      try {
        const sourceResponse = await fetch(`/api/public-catalog?service=cruise&key=${encodeURIComponent(first.cruise_name)}`);
        if (sourceResponse.ok) sourcePayload = await sourceResponse.json();
      } catch (error) {
        console.warn('Failed to load source cruise catalog:', error?.message || error);
      }
      if (cancelled) return;
      if (sourcePayload?.rates?.length) nextCabins = buildRateCardCabins(sourcePayload.rates, allCabinRows, sourcePayload.cabins);
      const cabinIdMap = createCabinIdMap(allCabinRows, nextCabins);
      const allCabinIds = allCabinRows.map((cabin) => cabin.id);
      const [importsResult, cabinImagesResult] = await Promise.all([
        supabase
          .from('cruise_cafe_import_images_v2')
          .select('id,cabin_id,image_name,storage_bucket,storage_path,sort_order,is_primary,created_at')
          .eq('cruise_id', first.cruise_id)
          .order('created_at')
          .order('sort_order'),
        allCabinIds.length
          ? supabase
            .from('cabin_images_v2')
            .select('id,cabin_id,storage_bucket,storage_path,alt_text,sort_order,is_primary,created_at')
            .in('cabin_id', allCabinIds)
            .order('sort_order')
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (cancelled) return;
      if (importsResult.error || cabinImagesResult.error) {
        console.error('Failed to load public cruise gallery:', importsResult.error?.message || cabinImagesResult.error?.message);
      }
      const sourceImports = [
        ...mapSourceCruiseImages(sourcePayload?.images, nextCabins),
        ...mapSourceCabinImages(sourcePayload?.cabins, nextCabins),
      ];
      if (cancelled) return;
      const nextMediaGroups = buildMediaGroups([...(importsResult.data || []), ...sourceImports], cabinImagesResult.data || [], nextCabins, cabinIdMap);
      const storedHeroImage = nextMediaGroups.find((group) => group.id === 'main')?.images[0]?.url
        || nextMediaGroups.flatMap((group) => group.images)[0]?.url
        || '';
      let editingItem = null;
      const editCartItemId = editCartItemIdFromLocation();
      if (editCartItemId) {
        const cart = await hydrateBookingCart();
        if (cancelled) return;
        editingItem = cart.items.find((item) => item.id === editCartItemId && item.serviceType === 'cruise' && String(item.productId) === String(first.cruise_id)) || null;
      }
      const editingSchedule = schedules.includes(editingItem?.metadata?.schedule) ? editingItem.metadata.schedule : (schedules[0] || '');
      const editingCabin = editingItem && nextCabins.find((cabin) => cabin.rates.some((rate) => rate.schedule_type === editingSchedule && String(rate.platform_rate_card_id) === String(editingItem.optionId)));
      setCruise({
        id: first.cruise_id,
        slug: first.slug,
        name: first.cruise_name,
        nameEn: first.cruise_name_en,
        description: first.description,
        rating: first.star_rating,
        heroImage: storedHeroImage || usableImageUrl(first.hero_image) || cruiseFallbackImage(first.cruise_id),
        tags: first.tags || [],
        schedules,
      });
      setCabins(nextCabins);
      setMediaGroups(nextMediaGroups);
      setSelectedSchedule(editingSchedule);
      setSelectedCabinId(editingCabin?.id || initialCabinId(nextCabins, editingSchedule) || nextCabins[0]?.id || null);
      setDate(editingItem?.startDate || '');
      setAdults(Math.max(1, Number(editingItem?.adults || 2)));
      setChildren(Number(editingItem?.children || 0));
      setInfants(Number(editingItem?.infants || 0));
      setEditingCartItemId(editingItem?.id || '');
      setLoading(false);
    }

    fetchProduct();
    return () => { cancelled = true; };
  }, [id]);

  const availableCabins = useMemo(
    () => selectedSchedule
      ? cabins.filter((cabin) => cabin.rates.some((rate) => rate.schedule_type === selectedSchedule))
      : cabins,
    [cabins, selectedSchedule]
  );
  const selectedCabin = availableCabins.find((cabin) => cabin.id === selectedCabinId) || availableCabins[0] || null;
  const selectedRate = useMemo(
    () => chooseRate(selectedCabin, selectedSchedule, date),
    [selectedCabin, selectedSchedule, date]
  );
  const detailCabin = cabins.find((cabin) => cabin.id === detailCabinId) || null;
  const detailRate = chooseRate(detailCabin, selectedSchedule, date);
  const detailFacilities = parseFacilities(detailCabin?.facilities);
  const archiveGroups = mediaGroups.filter((group) => !group.id.startsWith('cabin-'));
  const cabinMediaById = new Map(
    mediaGroups
      .filter((group) => group.id.startsWith('cabin-'))
      .map((group) => [group.id.slice('cabin-'.length), group])
  );

  useEffect(() => {
    if (!detailCabin) return undefined;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setDetailCabinId(null);
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [detailCabin]);

  useEffect(() => {
    if (!reservationModalOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setReservationModalOpen(false);
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [reservationModalOpen]);

  useEffect(() => {
    if (!vehicleChoiceModalOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setVehicleChoiceModalOpen(false);
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [vehicleChoiceModalOpen]);

  function handleScheduleChange(event) {
    const scheduleType = event.target.value;
    setSelectedSchedule(scheduleType);
    setSelectedCabinId(initialCabinId(cabins, scheduleType));
  }

  function selectCabinForReservation(cabinId) {
    setSelectedCabinId(cabinId);
    if (window.matchMedia('(max-width: 600px)').matches) setReservationModalOpen(true);
  }

  async function handleAddToCart() {
    if (!selectedCabin || !date) {
      setCartMessage('객실과 이용일을 선택해 주세요.');
      return;
    }
    if (!selectedRate) {
      setCartMessage('선택한 이용일에 적용되는 요금을 찾지 못했습니다. 다른 날짜를 선택해 주세요.');
      return;
    }
    if (!selectedRate.platform_rate_card_id) {
      setCartMessage('이 객실은 현재 장바구니에 담을 수 없습니다. 카카오톡 상담으로 문의해 주세요.');
      return;
    }
    const adultPrice = positiveNumber(selectedRate.price_adult) || 0;
    const childPrice = positiveNumber(selectedRate.price_child) || 0;
    const infantPrice = positiveNumber(selectedRate.price_infant) || 0;
    const nextItem = {
      id: `cruise:${selectedRate.platform_rate_card_id}:${date}`,
      serviceType: 'cruise', productId: cruise.id, optionId: selectedRate.platform_rate_card_id,
      name: cruise.name, optionName: `${selectedCabin.name} · ${SCHEDULE_LABELS[selectedSchedule] || selectedSchedule}`,
      startDate: date, adults, children, infants, quantity: 1,
      unitPrice: adultPrice * adults + childPrice * children + infantPrice * infants,
      currency: selectedRate.currency, priceStatus: 'reference', sourceHref: `/product/${encodeURIComponent(cruise.slug)}`,
      metadata: {
        schedule: selectedSchedule,
        roomCount: 1,
        platform: {
          contractVersion: 1,
          checkin: date,
          schedule: SCHEDULE_LABELS[selectedSchedule] || selectedSchedule,
          cruiseName: cruise.name,
          rooms: [{ rateCardId: selectedRate.platform_rate_card_id, roomCount: 1, adultCount: adults, childCount: children, childExtraBedCount: 0, infantCount: infants, extraBedCount: 0, singleCount: 0 }],
          connectingRoom: false,
          birthdayEvent: false,
          birthdayName: '',
          tourOptions: [],
          requestNote: '',
        },
      },
    };
    const session = await getPlatformCartSession();
    if (!session) {
      const next = `${window.location.pathname}${window.location.search}`;
      queueBookingCartItemAfterLogin(nextItem, editingCartItemId, next);
      window.location.replace(`/login?next=${encodeURIComponent(next)}`);
      return;
    }
    const savedItem = replaceBookingCartItem(editingCartItemId, nextItem);
    let synced;
    try {
      synced = await syncBookingCart();
    } catch {
      setCartMessage('선택 내용은 임시 보관했지만 장바구니에 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.');
      return;
    }
    if (!synced.synced) {
      setCartMessage('선택 내용은 임시 보관했지만 장바구니에 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.');
      return;
    }
    setEditingCartItemId(savedItem.id);
    setReservationModalOpen(false);
    setSavedCruiseCartItemId(savedItem.id);
    setSavedCruiseSelection(savedItem);
    setVehicleMode('');
    setVehicleChoiceModalOpen(true);
    void loadVehiclePrices();
  }

  async function loadVehiclePrices() {
    setVehicleOptionsLoading(true);
    setVehicleOptionsError('');
    try {
      const loaded = await loadPlatformBookingOptions('cruise_vehicle');
      setVehiclePrices(loaded.prices || []);
    } catch {
      setVehicleOptionsError('차량 요금 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setVehicleOptionsLoading(false);
    }
  }

  const eligibleVehiclePrices = useMemo(() => {
    if (!savedCruiseSelection) return [];
    return vehiclePrices.filter((row) => {
      if (!String(row.route || '').includes('하롱베이')) return false;
      if (vehicleMode === 'cruise_shuttle') return String(row.vehicle_type || '').includes('셔틀') && row.cruise === savedCruiseSelection.name;
      return row.rental_type === '단독대여' && ['공통', savedCruiseSelection.name].includes(row.cruise) && !/스테이\s*하롱\s*셔틀\s*리무진/i.test(String(row.vehicle_type || ''));
    });
  }, [savedCruiseSelection, vehicleMode, vehiclePrices]);

  const vehicleWayTypes = useMemo(() => uniqueValues(eligibleVehiclePrices, 'way_type'), [eligibleVehiclePrices]);
  const vehicleRoutes = useMemo(() => uniqueValues(eligibleVehiclePrices.filter((row) => row.way_type === vehicleForm.wayType), 'route'), [eligibleVehiclePrices, vehicleForm.wayType]);
  const vehicleTypes = useMemo(() => orderedVehicleTypes(uniqueValues(eligibleVehiclePrices.filter((row) => row.way_type === vehicleForm.wayType && row.route === vehicleForm.route), 'vehicle_type')), [eligibleVehiclePrices, vehicleForm.route, vehicleForm.wayType]);
  const selectedVehiclePrice = useMemo(() => eligibleVehiclePrices.find((row) => row.rent_code === vehicleForm.rentcarPriceCode) || null, [eligibleVehiclePrices, vehicleForm.rentcarPriceCode]);

  function vehicleDefaults(mode, prices = eligibleVehiclePrices) {
    const roundTrip = prices.find((row) => String(row.way_type || '').includes('왕복'))?.way_type || prices[0]?.way_type || '';
    const routes = uniqueValues(prices.filter((row) => row.way_type === roundTrip), 'route');
    const route = mode === 'cruise_shuttle' ? routes[0] || '' : routes.length === 1 ? routes[0] : '';
    const vehicleTypes = orderedVehicleTypes(uniqueValues(prices.filter((row) => row.way_type === roundTrip && row.route === route), 'vehicle_type'));
    const vehicleType = mode === 'cruise_shuttle' ? vehicleTypes[0] || '' : vehicleTypes.length === 1 ? vehicleTypes[0] : '';
    const selected = prices.find((row) => row.way_type === roundTrip && row.route === route && row.vehicle_type === vehicleType);
    return { mode, wayType: roundTrip, route, vehicleType, rentcarPriceCode: selected?.rent_code || '', carCount: 1, passengerCount: cruisePassengerCount(savedCruiseSelection), hoanKiemOutsidePickup: false };
  }

  function selectVehicleMode(mode) {
    if (mode === 'none') {
      window.location.assign('/booking/cart');
      return;
    }
    const prices = vehiclePrices.filter((row) => {
      if (!String(row.route || '').includes('하롱베이')) return false;
      if (mode === 'cruise_shuttle') return String(row.vehicle_type || '').includes('셔틀') && row.cruise === savedCruiseSelection?.name;
      return row.rental_type === '단독대여' && ['공통', savedCruiseSelection?.name].includes(row.cruise) && !/스테이\s*하롱\s*셔틀\s*리무진/i.test(String(row.vehicle_type || ''));
    });
    setVehicleMode(mode);
    setVehicleForm(vehicleDefaults(mode, prices));
  }

  function updateVehicleForm(field, value) {
    setVehicleForm((current) => {
      if (field === 'wayType') {
        if (current.mode !== 'cruise_shuttle') return { ...current, wayType: value, route: '', vehicleType: '', rentcarPriceCode: '' };
        const routes = uniqueValues(eligibleVehiclePrices.filter((row) => row.way_type === value), 'route');
        const route = routes[0] || '';
        const vehicleTypes = uniqueValues(eligibleVehiclePrices.filter((row) => row.way_type === value && row.route === route), 'vehicle_type');
        const vehicleType = vehicleTypes[0] || '';
        const price = eligibleVehiclePrices.find((row) => row.way_type === value && row.route === route && row.vehicle_type === vehicleType);
        return { ...current, wayType: value, route, vehicleType, rentcarPriceCode: price?.rent_code || '' };
      }
      if (field === 'route') return { ...current, route: value, vehicleType: '', rentcarPriceCode: '' };
      if (field === 'vehicleType') {
        const price = eligibleVehiclePrices.find((row) => row.way_type === current.wayType && row.route === current.route && row.vehicle_type === value);
        return { ...current, vehicleType: value, rentcarPriceCode: price?.rent_code || '' };
      }
      return { ...current, [field]: value };
    });
  }

  async function addVehicleToCart() {
    if (!savedCruiseSelection || !selectedVehiclePrice) {
      setVehicleOptionsError('편도·왕복, 경로와 차량 유형을 선택해 주세요.');
      return;
    }
    setVehicleSaving(true);
    setVehicleOptionsError('');
    const carCount = Math.max(1, Number(vehicleForm.carCount || 1));
    const passengerCount = vehicleMode === 'cruise_shuttle' ? Math.max(1, Number(vehicleForm.passengerCount || 1)) : cruisePassengerCount(savedCruiseSelection);
    const hoanKiemSurcharge = vehicleMode === 'cruise_shuttle' && vehicleForm.hoanKiemOutsidePickup ? HOAN_KIEM_OUTSIDE_PICKUP_SURCHARGE : 0;
    const shuttleTotal = passengerCount * CRUISE_SHUTTLE_PRICE_PER_PERSON + hoanKiemSurcharge;
    const vehicleTotal = vehicleMode === 'cruise_shuttle' ? shuttleTotal : Number(selectedVehiclePrice.price || 0) * carCount;
    const cartQuantity = vehicleMode === 'cruise_shuttle' ? passengerCount : carCount;
    const vehicleItem = {
      id: `cruise_vehicle:${savedCruiseCartItemId}:${selectedVehiclePrice.rent_code}:${vehicleMode}`,
      serviceType: 'cruise_vehicle', productId: 'cruise_vehicle', optionId: selectedVehiclePrice.rent_code,
      name: `${savedCruiseSelection.name} 차량`, optionName: `${vehicleMode === 'cruise_shuttle' ? `크루즈 셔틀 · 1인 1,000,000 VND` : `단독차량 · ${selectedVehiclePrice.vehicle_type}`}${hoanKiemSurcharge ? ' · 호안키엠 외 승차(+500,000 VND)' : ''}`,
      startDate: savedCruiseSelection.startDate, adults: savedCruiseSelection.adults, children: savedCruiseSelection.children, infants: savedCruiseSelection.infants,
      quantity: cartQuantity, unitPrice: vehicleTotal / cartQuantity, currency: 'VND', priceStatus: 'reference', sourceHref: `/product/${encodeURIComponent(cruise.slug)}`,
      metadata: { platform: { contractVersion: 2, cruiseReservationId: null, cruiseCartItemId: savedCruiseCartItemId, passengerCount, luggageCount: 0, vehicleServiceType: vehicleMode, vehicles: [{ key: crypto.randomUUID(), wayType: vehicleForm.wayType, route: vehicleForm.route, vehicleType: vehicleForm.vehicleType, rentcarPriceCode: selectedVehiclePrice.rent_code, carCount, oneWayDirection: 'pickup', hoanKiemOutsidePickup: Boolean(vehicleForm.hoanKiemOutsidePickup) }] } },
    };
    try {
      replaceBookingCartItem('', vehicleItem);
      const synced = await syncBookingCart();
      if (!synced.synced) throw new Error();
      setVehicleChoiceModalOpen(false);
      window.location.assign('/booking/cart');
    } catch {
      setVehicleOptionsError('차량 선택을 장바구니에 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.');
      setVehicleSaving(false);
    }
  }

  function renderReservationStartForm(fieldPrefix) {
    const fieldId = (name) => `${fieldPrefix}-${name}`;
    if (!cruise.schedules.length) {
      return <>
        <span className="reservation-step">01 / CONSULTATION</span>
        <h3>예약 상담</h3>
        <p className="reservation-intro">이 상품은 현재 일정과 요금을 준비하고 있습니다. 상담으로 원하시는 날짜와 객실을 확인해 주세요.</p>
        <a className="kakao-link" href="http://pf.kakao.com/_zvsxaG/chat" target="_blank" rel="noreferrer">카카오톡으로 바로 상담 ↗</a>
      </>;
    }
    return <>
      <span className="reservation-step">01 / SELECT &amp; CONTINUE</span>
      <h3>예약 시작</h3>
      <p className="reservation-intro">선택한 객실과 일정으로 여행 예약을 준비합니다.</p>
      <form className="reservation-form" action="/booking/cruise" method="get">
        <input type="hidden" name="sourceProductId" value={cruise.id} />
        <input type="hidden" name="sourceProductSlug" value={cruise.slug} />
        <input type="hidden" name="rateCardId" value={selectedRate?.platform_rate_card_id || ''} />
        <input type="hidden" name="cruiseName" value={cruise.name} />
        <input type="hidden" name="roomType" value={selectedCabin?.name || ''} />
        <input type="hidden" name="schedule" value={selectedSchedule} />
        <input type="hidden" name="adultCount" value={adults} />
        <input type="hidden" name="childCount" value={children} />
        <input type="hidden" name="infantCount" value={infants} />
        <input type="hidden" name="roomCount" value="1" />
        <div className="form-group"><label>선택한 객실</label><input type="text" value={selectedCabin?.name || '객실을 선택하세요'} readOnly /></div>
        <div className="form-group"><label htmlFor={fieldId('schedule')}>일정</label><select id={fieldId('schedule')} value={selectedSchedule} onChange={handleScheduleChange}>{cruise.schedules.map((type) => <option key={type} value={type}>{SCHEDULE_LABELS[type]}</option>)}</select></div>
        <div className="guest-grid">
          <div className="form-group"><label htmlFor={fieldId('adults')}>성인</label><select id={fieldId('adults')} value={adults} onChange={(event) => setAdults(Number(event.target.value))}>{[1, 2, 3, 4, 5, 6].map((number) => <option key={number}>{number}</option>)}</select></div>
          <div className="form-group"><label htmlFor={fieldId('children')}>아동</label><select id={fieldId('children')} value={children} onChange={(event) => setChildren(Number(event.target.value))}>{[0, 1, 2, 3, 4].map((number) => <option key={number}>{number}</option>)}</select></div>
          <div className="form-group"><label htmlFor={fieldId('infants')}>유아</label><select id={fieldId('infants')} value={infants} onChange={(event) => setInfants(Number(event.target.value))}>{[0, 1, 2, 3].map((number) => <option key={number}>{number}</option>)}</select></div>
        </div>
        <div className="form-group"><label htmlFor={fieldId('date')}>이용일</label><input type="date" id={fieldId('date')} name="checkin" value={date} onChange={(event) => setDate(event.target.value)} required /></div>
        {date && !selectedRate && <p className="date-warning">선택일에 적용되는 등록 요금이 없습니다. 예약 담당자에게 문의해 주세요.</p>}
        <div className="total-price-box"><strong className="total-amount">{formatVnd(selectedRate?.price_adult, selectedRate?.currency)}</strong></div>
        <button type="button" className="btn-primary w-100" onClick={handleAddToCart}>{editingCartItemId ? '선택 수정 저장　→' : '장바구니에 담기　＋'}</button>
        {cartMessage && <p className="handoff-note" role="status">{cartMessage} <a href="/booking/cart">장바구니 보기 →</a></p>}
        <a className="kakao-link" href="http://pf.kakao.com/_zvsxaG/chat" target="_blank" rel="noreferrer">카카오톡으로 바로 상담 ↗</a>
      </form>
    </>;
  }

  if (loading) {
    return (
      <div className="product-state product-state-loading">
        <span>STAY HALONG / PREPARING YOUR JOURNEY</span>
        <h1>좋은 여행을<br />불러오는 중입니다.</h1>
        <i aria-hidden="true" />
        <p>v2 크루즈와 객실 정보를 확인하고 있습니다.</p>
      </div>
    );
  }

  if (!cruise || loadError) {
    return (
      <div className="product-state product-state-error">
        <span>STAY HALONG / NOT FOUND</span>
        <h2>상품을 찾을 수 없습니다.</h2>
        <p>{loadError}</p>
      </div>
    );
  }

  const duration = cruise.schedules.map((type) => SCHEDULE_LABELS[type]).filter(Boolean).join(' · ') || '일정 상담';
  const detailGalleryGroups = archiveGroups.filter((group) => group.id !== 'main');

  return (
    <div className="product-page">
      <div className="container product-content-wrapper">
        <main className="product-main">
          <header className="product-header">
            <span className="duration-badge">{duration}</span>
            <h1>{cruise.name}</h1>
            {cruise.nameEn && <p className="product-subtitle">{cruise.nameEn}</p>}
            <p className="product-desc">{cruise.description || 'Stay Halong이 엄선한 하롱베이 크루즈입니다.'}</p>
            <div className="product-facts">
              {cruise.rating && <span>★ {cruise.rating}</span>}
              {cruise.tags.map((tag) => <span key={tag}>#{tag}</span>)}
            </div>
          </header>

          {detailGalleryGroups.some((group) => group.images.length) && (
            <section className="product-section product-photo-archive">
              <CruiseMediaGallery
                cruiseName={cruise.name}
                duration={duration}
                groups={detailGalleryGroups}
                showMain={false}
              />
            </section>
          )}

          <section className="product-section">
            <div className="section-heading-row">
              <h2>객실 및 등록 요금</h2>
              {cruise.schedules.length > 0 && <label className="schedule-picker">
                <span>일정</span>
                <select value={selectedSchedule} onChange={handleScheduleChange}>
                  {cruise.schedules.map((type) => <option key={type} value={type}>{SCHEDULE_LABELS[type]}</option>)}
                </select>
              </label>}
            </div>
            <p className="price-notice">{cruise.schedules.length
              ? '등록 요금은 비교용 참고값이며 이용일에 따라 달라질 수 있습니다. 최종 금액은 예약 단계에서 다시 확인합니다.'
              : '현재 일정과 요금을 준비하고 있습니다. 원하는 날짜와 객실은 상담으로 확인해 주세요.'}</p>
            <div className="cabins-list">
              {availableCabins.length === 0 && <p className="price-notice">등록된 객실 정보가 없습니다. 상담으로 이용 가능한 객실을 확인해 주세요.</p>}
              {availableCabins.map((cabin, index) => {
                const rate = chooseRate(cabin, selectedSchedule, date);
                const cabinMedia = cabinMediaById.get(cabin.id);
                return (
                  <div
                    key={cabin.id}
                    className={`cabin-card ${selectedCabin?.id === cabin.id ? 'active' : ''}`}
                  >
                    <div className="cabin-media-actions">
                      {cabinMedia ? (
                        <CruiseMediaGallery
                          cruiseName={cruise.name}
                heroImage={usableImageUrl(cabin.imageUrl) || `/cabin_${(index % 5) + 1}.png`}
                          groups={[cabinMedia]}
                          mainGroupId={cabinMedia.id}
                          mainClassName="cabin-image cabin-gallery-trigger"
                          showArchive={false}
                          showMainMeta={false}
                        />
                      ) : (
                        <span className="cabin-image" style={{ backgroundImage: `url(${cabin.imageUrl || `/cabin_${(index % 5) + 1}.png`})` }} />
                      )}
                      <button type="button" className="cabin-detail-button" onClick={() => { setSelectedCabinId(cabin.id); setDetailCabinId(cabin.id); }}>상세 안내 <span>↗</span></button>
                    </div>
                    <button type="button" className="cabin-select-button" onClick={() => selectCabinForReservation(cabin.id)}>
                      <span className="cabin-info">
                        <strong>{cabin.name}</strong>
                        <small>{[cabin.roomArea && `면적 ${cabin.roomArea}`, cabin.bedType && `침대 ${cabin.bedType}`, cabin.maxGuests && `최대 ${cabin.maxGuests}명`].filter(Boolean).join(' · ')}</small>
                      </span>
                      <span className="cabin-price">
                        <small>등록요금 참고</small>
                        <strong>{formatVnd(rate?.price_adult, rate?.currency)}</strong>
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>
          </section>

        </main>

        <aside className="product-sidebar">
          <div className="reservation-card sticky">
            {renderReservationStartForm('sidebar')}
          </div>
        </aside>
      </div>

      {reservationModalOpen && (
        <div className="product-reservation-modal" role="dialog" aria-modal="true" aria-labelledby="mobile-reservation-title" onClick={(event) => { if (event.target === event.currentTarget) setReservationModalOpen(false); }}>
          <section className="product-reservation-modal-panel">
            <header><div><span>CRUISE RESERVATION</span><strong id="mobile-reservation-title">{selectedCabin?.name || '객실 선택'}</strong></div><button type="button" onClick={() => setReservationModalOpen(false)} aria-label="예약 시작 닫기">닫기 ×</button></header>
            <div className="reservation-card">{renderReservationStartForm('mobile')}</div>
          </section>
        </div>
      )}

      {vehicleChoiceModalOpen && (
        <div className="cruise-vehicle-choice-modal" role="dialog" aria-modal="true" aria-labelledby="cruise-vehicle-choice-title" onClick={(event) => { if (event.target === event.currentTarget) setVehicleChoiceModalOpen(false); }}>
          <section className="cruise-vehicle-choice-panel">
            <header><div><span>NEXT / CRUISE VEHICLE</span><h2 id="cruise-vehicle-choice-title">크루즈 차량을 선택하세요</h2></div><button type="button" onClick={() => setVehicleChoiceModalOpen(false)} aria-label="크루즈 차량 선택 닫기">닫기 ×</button></header>
            <div className="cruise-vehicle-choice-content">
              {!vehicleMode && <><p>크루즈 예약은 장바구니에 저장되었습니다. 필요한 이동 서비스를 선택하거나, 차량 없이 장바구니로 이동할 수 있습니다.</p><div className="cruise-vehicle-choice-actions"><button type="button" onClick={() => selectVehicleMode('cruise_shuttle')} disabled={vehicleOptionsLoading}><span>01 / SHUTTLE</span><strong>크루즈 셔틀</strong><small>편도·왕복과 탑승 인원만 선택합니다.</small><b>{vehicleOptionsLoading ? '불러오는 중…' : '선택 →'}</b></button><button type="button" onClick={() => selectVehicleMode('private_rental')} disabled={vehicleOptionsLoading}><span>02 / PRIVATE CAR</span><strong>단독차량</strong><small>편도·왕복, 경로와 차량을 선택합니다.</small><b>{vehicleOptionsLoading ? '불러오는 중…' : '선택 →'}</b></button><button type="button" onClick={() => selectVehicleMode('none')}><span>03 / NO VEHICLE</span><strong>선택안함</strong><small>차량 없이 장바구니로 이동합니다.</small><b>장바구니 →</b></button></div></>}
              {vehicleMode && <div className="cruise-vehicle-config"><button type="button" className="cruise-vehicle-back" onClick={() => setVehicleMode('')}>← 차량 종류 다시 선택</button><p><strong>{vehicleMode === 'cruise_shuttle' ? '크루즈 셔틀' : '단독차량'}</strong> 조건을 선택한 뒤 장바구니에 바로 저장합니다.</p>{vehicleOptionsLoading && <p className="cruise-vehicle-status">차량 요금을 불러오는 중입니다.</p>}{vehicleOptionsError && <p className="cruise-vehicle-status error" role="alert">{vehicleOptionsError}</p>}{!vehicleOptionsLoading && !vehicleOptionsError && eligibleVehiclePrices.length === 0 && <p className="cruise-vehicle-status error">선택한 크루즈에 적용되는 차량 요금이 없습니다.</p>}{!vehicleOptionsLoading && eligibleVehiclePrices.length > 0 && <><div className="cruise-vehicle-fields"><label><span>이용 방식</span><select value={vehicleForm.wayType} onChange={(event) => updateVehicleForm('wayType', event.target.value)}>{vehicleWayTypes.map((way) => <option value={way} key={way}>{vehicleWayLabel(way)}</option>)}</select></label>{vehicleMode === 'cruise_shuttle' && <label><span>탑승 인원</span><input type="number" min="1" value={vehicleForm.passengerCount} onChange={(event) => updateVehicleForm('passengerCount', event.target.value)} /></label>}{vehicleMode === 'private_rental' && <><label><span>경로</span><select value={vehicleForm.route} onChange={(event) => updateVehicleForm('route', event.target.value)}><option value="">경로를 선택해 주세요</option>{vehicleRoutes.map((route) => <option value={route} key={route}>{route}</option>)}</select></label><label><span>차량 유형</span><select value={vehicleForm.vehicleType} onChange={(event) => updateVehicleForm('vehicleType', event.target.value)} disabled={!vehicleForm.route}><option value="">차량 유형을 선택해 주세요</option>{vehicleTypes.map((vehicleType) => <option value={vehicleType} key={vehicleType}>{vehicleType}</option>)}</select></label><label><span>차량 수</span><input type="number" min="1" max="6" value={vehicleForm.carCount} onChange={(event) => updateVehicleForm('carCount', event.target.value)} /></label></>}</div>{vehicleMode === 'cruise_shuttle' && <label className="cruise-vehicle-addon"><input type="checkbox" checked={vehicleForm.hoanKiemOutsidePickup} onChange={(event) => updateVehicleForm('hoanKiemOutsidePickup', event.target.checked)} /><span><strong>호안키엠 외 승차</strong><small>팀당 추가비용</small></span><b>+500,000 VND</b></label>}{selectedVehiclePrice && <div className="cruise-vehicle-total"><span>선택 금액{vehicleForm.hoanKiemOutsidePickup ? ' (추가비용 포함)' : ''}</span><strong>{formatVnd(vehicleMode === 'cruise_shuttle' ? Math.max(1, Number(vehicleForm.passengerCount || 1)) * CRUISE_SHUTTLE_PRICE_PER_PERSON + (vehicleForm.hoanKiemOutsidePickup ? HOAN_KIEM_OUTSIDE_PICKUP_SURCHARGE : 0) : Number(selectedVehiclePrice.price || 0) * Math.max(1, Number(vehicleForm.carCount || 1)), 'VND')}</strong></div>}<button type="button" className="cruise-vehicle-save" onClick={addVehicleToCart} disabled={vehicleSaving || !selectedVehiclePrice}>{vehicleSaving ? '장바구니 저장 중…' : '차량 선택을 장바구니에 저장 →'}</button></>}</div>}
            </div>
          </section>
        </div>
      )}

      {detailCabin && (
        <div className="cabin-detail-modal" role="dialog" aria-modal="true" aria-labelledby="cabin-detail-title" onClick={(event) => { if (event.target === event.currentTarget) setDetailCabinId(null); }}>
          <section className="cabin-detail-modal-panel">
            <header>
              <div><span>CABIN DETAIL</span><h2 id="cabin-detail-title">{detailCabin.name} 객실 안내</h2></div>
              <button type="button" onClick={() => setDetailCabinId(null)} aria-label="객실 상세 안내 닫기">닫기 ×</button>
            </header>
            <div className="cabin-detail-modal-content">
              {detailCabin.nameEn && <p className="cabin-name-en">{detailCabin.nameEn}</p>}
              <div className="feature-list">
                {cabinFeatures(detailCabin).map((feature) => <span key={feature}>{feature}</span>)}
              </div>
              {detailCabin.description && <div className="cabin-guide-block"><strong>객실 상세</strong><p>{detailCabin.description}</p></div>}
              {detailCabin.specialAmenities && <div className="amenity-note"><strong>스페셜 어메니티</strong><p>{detailCabin.specialAmenities}</p></div>}
              {detailFacilities.length > 0 && <div className="facility-block"><strong>등록 시설</strong><div>{detailFacilities.map((facility) => <span key={facility}>{facility}</span>)}</div></div>}
              {detailCabin.inclusions && <div className="cabin-guide-block"><strong>포함 사항</strong><p>{detailCabin.inclusions}</p></div>}
              {detailCabin.exclusions && <div className="cabin-guide-block"><strong>불포함 사항</strong><p>{detailCabin.exclusions}</p></div>}
              {detailCabin.warnings && <div className="cabin-guide-block cabin-guide-warning"><strong>이용 안내</strong><p>{detailCabin.warnings}</p></div>}
              <div className="rate-reference">
                <strong>선택 조건의 등록 요금</strong>
                <dl>
                  <div><dt>기준 등록값</dt><dd>{formatVnd(detailRate?.price_adult, detailRate?.currency)}</dd></div>
                  <div><dt>아동 등록값</dt><dd>{formatVnd(detailRate?.price_child, detailRate?.currency)}</dd></div>
                  <div><dt>유아 등록값</dt><dd>{formatVnd(detailRate?.price_infant, detailRate?.currency)}</dd></div>
                  <div><dt>유효 기간</dt><dd>{detailRate ? `${detailRate.valid_from} ~ ${detailRate.valid_to}` : '선택일 적용 요금 없음'}</dd></div>
                  <div><dt>가격 단위</dt><dd>{detailRate?.price_basis === 'unknown' || !detailRate ? '상담 확인 필요' : detailRate.price_basis}</dd></div>
                </dl>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
