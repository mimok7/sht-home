import { getHomepageDatabase } from '@/lib/homepage-admin';
import { resolveR2PublicMediaUrl } from '@/lib/public-media-url';

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function normalizedCruiseName(value) {
  return text(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/크루즈|cruise/g, '')
    .replace(/[^a-z0-9가-힣]/g, '');
}

function publicMediaList(...values) {
  const urls = values.flatMap((value) => Array.isArray(value) ? value : [value])
    .map((value) => resolveR2PublicMediaUrl(value))
    .filter(Boolean);
  return [...new Set(urls)];
}

async function loadRows(database, sourceTable, keyField, key) {
  const rows = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await database
      .from('platform_source_records')
      .select('source_id,payload')
      .eq('source', 'sht-platform')
      .eq('source_table', sourceTable)
      .eq(`payload->>${keyField}`, key)
      .order('source_id')
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const page = data || [];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows.map((row) => ({ ...(row.payload || {}), __source_id: row.source_id }));
}

async function findCruiseSourceAlias(database, key) {
  const normalizedKey = normalizedCruiseName(key);
  if (!normalizedKey) return '';
  const { data, error } = await database
    .from('cruises_v2')
    .select('name_ko,legacy_name,hero_image,is_active')
    .eq('is_active', true);
  if (error) throw error;
  const candidates = (data || [])
    .filter((row) => [row.name_ko, row.legacy_name].some((name) => normalizedCruiseName(name) === normalizedKey))
    .filter((row) => text(row.name_ko) && text(row.name_ko) !== key)
    .sort((left, right) => Number(Boolean(right.hero_image)) - Number(Boolean(left.hero_image)));
  return text(candidates[0]?.name_ko);
}

function translatedRoomNames(rates) {
  const names = new Map();
  for (const rate of rates || []) {
    const name = text(rate.room_type) || text(rate.room_name);
    const nameEn = text(rate.room_type_en) || text(rate.room_name_en);
    if (name && nameEn && !names.has(name)) names.set(name, nameEn);
  }
  return names;
}

function publicImage(image, roomNames = new Map()) {
  const url = resolveR2PublicMediaUrl(image.image_url, image.storage_bucket, image.storage_path)
    || resolveR2PublicMediaUrl(image.source_image_url);
  if (!url) return null;
  return {
    id: text(image.id) || text(image.__source_id) || url,
    roomName: text(image.room_name),
    roomNameEn: text(image.room_name_en) || roomNames.get(text(image.room_name)) || '',
    hotelPriceCode: text(image.hotel_price_code),
    collection: text(image.collection),
    imageName: text(image.image_name),
    url,
    sortOrder: Number(image.sort_order) || 0,
    isPrimary: Boolean(image.is_primary),
  };
}

function publicCruiseRate(rate) {
  const scheduleType = text(rate.schedule_type);
  const roomName = text(rate.room_type) || text(rate.room_name);
  const platformRateCardId = text(rate.id) || text(rate.__source_id);
  if (!scheduleType || !roomName || !platformRateCardId || rate.is_active === false || rate.is_active === 'false') return null;
  return {
    id: platformRateCardId,
    scheduleType,
    roomName,
    roomNameEn: text(rate.room_type_en) || text(rate.room_name_en),
    validFrom: text(rate.valid_from),
    validTo: text(rate.valid_to),
    currency: text(rate.currency) || 'VND',
    priceAdult: Number(rate.price_adult) || null,
    priceChild: Number(rate.price_child) || null,
    priceInfant: Number(rate.price_infant) || null,
    priceSingle: Number(rate.price_single) || null,
    priceExtraBed: Number(rate.price_extra_bed) || null,
    singleAvailable: Boolean(rate.single_available),
    extraBedAvailable: Boolean(rate.extra_bed_available),
    platformRateCardId,
  };
}

function publicCruiseCabin(cabin, roomNames = new Map()) {
  const name = text(cabin.room_name);
  if (!name) return null;
  const images = publicMediaList(cabin.room_image, cabin.room_images);
  return {
    id: text(cabin.id) || text(cabin.__source_id) || name,
    name,
    nameEn: text(cabin.room_name_en) || roomNames.get(name) || '',
    imageUrl: images[0] || '',
    images,
    roomArea: text(cabin.room_area),
    bedType: text(cabin.bed_type),
    maxAdults: Number(cabin.max_adults) || null,
    maxGuests: Number(cabin.max_guests) || null,
    hasBalcony: Boolean(cabin.has_balcony),
    isVip: Boolean(cabin.is_vip),
    hasButler: Boolean(cabin.has_butler),
    isRecommended: Boolean(cabin.is_recommended),
    connectingAvailable: Boolean(cabin.connecting_available),
    extraBedAvailable: Boolean(cabin.extra_bed_available),
    facilities: cabin.facilities || [],
    specialAmenities: text(cabin.special_amenities),
    description: text(cabin.room_description),
    inclusions: text(cabin.inclusions),
    exclusions: text(cabin.exclusions),
    warnings: text(cabin.warnings),
  };
}

export async function loadPublicCatalog(service, key) {
  const database = getHomepageDatabase();
  if (!database) throw new Error('Public catalog database is unavailable');

  if (service === 'cruise') {
    let [images, rates, cabins] = await Promise.all([
      loadRows(database, 'homepage_cruise_images', 'cruise_name', key),
      loadRows(database, 'cruise_rate_card', 'cruise_name', key),
      loadRows(database, 'cruise_info', 'cruise_name', key),
    ]);
    let roomNameRates = rates;
    if (!images.length || !cabins.length) {
      const alias = await findCruiseSourceAlias(database, key);
      if (alias) {
        const [aliasImages, aliasRates, aliasCabins] = await Promise.all([
          loadRows(database, 'homepage_cruise_images', 'cruise_name', alias),
          loadRows(database, 'cruise_rate_card', 'cruise_name', alias),
          loadRows(database, 'cruise_info', 'cruise_name', alias),
        ]);
        if (!images.length) images = aliasImages;
        if (!cabins.length) cabins = aliasCabins;
        if (!rates.length) rates = aliasRates;
        if (aliasRates.length) roomNameRates = aliasRates;
      }
    }
    const roomNames = translatedRoomNames(roomNameRates);
    return {
      service,
      images: images.map((image) => publicImage(image, roomNames)).filter(Boolean),
      rates: rates.map(publicCruiseRate).filter(Boolean),
      cabins: cabins.map((cabin) => publicCruiseCabin(cabin, roomNames)).filter(Boolean),
    };
  }

  const [infoRows, priceRows, imageRows] = await Promise.all([
    loadRows(database, 'hotel_info', 'hotel_code', key),
    loadRows(database, 'hotel_price', 'hotel_code', key),
    loadRows(database, 'homepage_hotel_images', 'hotel_code', key),
  ]);
  const info = infoRows[0] || {};
  return {
    service,
    hotel: {
      code: key,
      name: text(info.hotel_name) || text(priceRows[0]?.hotel_name) || key,
      description: text(info.notes),
      location: text(info.location),
      rating: Number(info.star_rating) || null,
    },
    rooms: priceRows.map((room) => ({
      id: text(room.hotel_price_code) || text(room.__source_id),
      name: text(room.room_name) || text(room.room_type) || '객실',
      roomType: text(room.room_type),
      category: text(room.room_category),
      maxGuests: Number(room.occupancy_max) || null,
      breakfast: room.include_breakfast,
      childPolicy: text(room.child_policy),
      notes: text(room.notes),
      validFrom: text(room.start_date),
      validTo: text(room.end_date),
      price: Number(room.base_price) || null,
      currency: text(room.currency) || 'VND',
      priceUnit: 'per_room',
    })),
    images: imageRows.map(publicImage).filter(Boolean),
  };
}
