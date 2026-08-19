import crypto from 'node:crypto';

const SCHEDULE_TYPES = new Set(['DAY', '1N2D', '2N3D']);

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function displayText(value) {
  if (typeof value === 'string') return text(value);
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean).join(', ') || null;
  return value && typeof value === 'object' ? JSON.stringify(value) : null;
}

function number(value) {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = typeof value === 'string'
    ? Number(value.match(/-?\d+(?:\.\d+)?/)?.[0])
    : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalized(value) {
  return String(value || '').replace(/\([^)]*\)/g, '').replace(/[^a-zA-Z0-9가-힣]/g, '').toLowerCase();
}

function stableSuffix(value) {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 12);
}

function nextDay(dateText) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText || '')) return null;
  const date = new Date(`${dateText}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function pickLatest(rows) {
  return [...rows].sort((left, right) => String(right.updated_at || '').localeCompare(String(left.updated_at || '')))[0];
}

function findCabin(rate, cabins, aliasCabins = new Map()) {
  // 괄호 안의 인원·층수는 서로 다른 객실/요금일 수 있다. 정규화 전에
  // 원본 객실명이 정확히 일치하는지 우선 확인해 2인·3인, 2층·3층 요금이
  // 하나의 객실로 합쳐지는 일을 막는다.
  const rawNames = [text(rate.room_type), text(rate.room_type_en)].filter(Boolean);
  const rawExact = cabins.filter((cabin) => rawNames.includes(text(cabin.legacy_room_name)) || rawNames.includes(text(cabin.name_ko)) || rawNames.includes(text(cabin.name_en)));
  if (rawExact.length === 1) return rawExact[0];

  const aliases = [rate.room_type, rate.room_type_en].map(normalized).filter(Boolean);
  if (!aliases.length) return null;
  const aliased = aliases.map((alias) => aliasCabins.get(alias)).filter(Boolean);
  if (aliased.length && aliased.every((cabin) => cabin.id === aliased[0].id)) return aliased[0];
  const exact = cabins.filter((cabin) => aliases.includes(normalized(cabin.legacy_room_name || cabin.name_ko)) || aliases.includes(normalized(cabin.name_en)));
  if (exact.length === 1) return exact[0];
  const candidates = cabins.filter((cabin) => {
    const cabinName = normalized(cabin.legacy_room_name || cabin.name_ko);
    return cabinName && aliases.some((alias) => cabinName.includes(alias) || alias.includes(cabinName));
  });
  return candidates.length === 1 ? candidates[0] : null;
}

async function throwOnError(result, label) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data || [];
}

export async function syncPlatformCruiseV2(database, catalogs) {
  const cruiseInfo = Array.isArray(catalogs.cruise_info) ? catalogs.cruise_info : [];
  const rateCards = Array.isArray(catalogs.cruise_rate_card) ? catalogs.cruise_rate_card : [];
  const contentByCruise = new Map((catalogs.homepage_cruise_content || []).map((row) => [text(row.cruise_name), row]));
  const cabinOverrides = new Map((catalogs.homepage_cruise_cabin_overrides || []).map((row) => [
    `${text(row.cruise_name)}\u0000${text(row.room_name)}`,
    row.values && typeof row.values === 'object' ? row.values : {},
  ]));
  const now = new Date().toISOString();

  const cruiseGroups = new Map();
  for (const row of cruiseInfo) {
    const name = text(row.cruise_name) || text(row.name);
    if (!name) continue;
    if (!cruiseGroups.has(name)) cruiseGroups.set(name, []);
    cruiseGroups.get(name).push(row);
  }
  // 요금표만 먼저 등록된 크루즈도 홈페이지에서 객실·일정·요금을 연결할 수
  // 있어야 한다. cruise_info가 없는 경우에도 요금표의 크루즈명과 객실명을
  // 보조 원본으로 사용한다.
  for (const row of rateCards) {
    const name = text(row.cruise_name);
    if (!name) continue;
    if (!cruiseGroups.has(name)) cruiseGroups.set(name, []);
    cruiseGroups.get(name).push(row);
  }
  for (const row of catalogs.homepage_cruise_content || []) {
    const name = text(row.cruise_name);
    if (name && !cruiseGroups.has(name)) cruiseGroups.set(name, []);
  }

  const existingCruises = await throwOnError(
    await database.from('cruises_v2').select('id,legacy_name,slug,code,name_en,hero_image'),
    '크루즈 캐시 조회 실패',
  );
  const existingByName = new Map(existingCruises.filter((row) => row.legacy_name).map((row) => [row.legacy_name, row]));
  const cruiseRows = [...cruiseGroups.entries()].map(([name, rows]) => {
    const source = pickLatest(rows) || {};
    const content = contentByCruise.get(name) || {};
    const existing = existingByName.get(name);
    const suffix = stableSuffix(name);
    const sourceRating = number(content.star_rating) ?? number(source.star_rating);
    return {
      legacy_name: name,
      slug: existing?.slug || `platform-${suffix}`,
      code: existing?.code || `PLATFORM-${suffix.toUpperCase()}`,
      name_ko: text(content.name_ko) || name,
      name_en: text(content.name_en) || text(source.name) || existing?.name_en || null,
      description: text(content.description) || text(source.description),
      category: null,
      star_rating: sourceRating === null ? null : Math.max(0, Math.min(6, sourceRating)),
      hero_image: text(content.hero_image) || text(source.cruise_image) || existing?.hero_image || null,
      is_active: content.is_active === undefined ? true : Boolean(content.is_active),
      updated_at: now,
    };
  });
  if (cruiseRows.length) {
    await throwOnError(await database.from('cruises_v2').upsert(cruiseRows, { onConflict: 'legacy_name' }), '크루즈 캐시 저장 실패');
  }

  const activeCruiseNames = [...cruiseGroups.keys()];
  const staleCruiseIds = existingCruises.filter((row) => row.legacy_name && !cruiseGroups.has(row.legacy_name)).map((row) => row.id);
  if (staleCruiseIds.length) {
    await throwOnError(await database.from('cruises_v2').update({ is_active: false, updated_at: now }).in('id', staleCruiseIds), '삭제 크루즈 비활성화 실패');
  }

  const cruises = activeCruiseNames.length
    ? await throwOnError(await database.from('cruises_v2').select('id,legacy_name').in('legacy_name', activeCruiseNames), '크루즈 캐시 재조회 실패')
    : [];
  const cruiseByName = new Map(cruises.map((row) => [row.legacy_name, row]));
  const cruiseIds = cruises.map((row) => row.id);
  const existingCabins = cruiseIds.length
    ? await throwOnError(await database.from('cabins_v2').select('id,cruise_id,legacy_room_name,name_ko').in('cruise_id', cruiseIds), '객실 캐시 조회 실패')
    : [];
  const existingCabinBySource = new Map(existingCabins.filter((row) => row.legacy_room_name).map((row) => [`${row.cruise_id}|${row.legacy_room_name}`, row]));
  const existingCabinByDisplay = new Map(existingCabins.map((row) => [`${row.cruise_id}|${row.name_ko}`, row]));

  if (cruises.length) {
    await throwOnError(
      await database.from('cruise_aliases_v2').upsert(cruises.map((row) => ({ alias: row.legacy_name, cruise_id: row.id })), { onConflict: 'alias' }),
      '크루즈 별칭 저장 실패',
    );
  }

  const itineraryMap = new Map();
  for (const rate of rateCards) {
    const cruise = cruiseByName.get(text(rate.cruise_name));
    if (!cruise || !SCHEDULE_TYPES.has(rate.schedule_type)) continue;
    const key = `${cruise.id}|${rate.schedule_type}`;
    itineraryMap.set(key, {
      cruise_id: cruise.id,
      schedule_type: rate.schedule_type,
      nights: rate.schedule_type === 'DAY' ? 0 : rate.schedule_type === '1N2D' ? 1 : 2,
      is_active: Boolean(rate.is_active),
      updated_at: now,
    });
  }
  for (const row of catalogs.homepage_cruise_itineraries || []) {
    const cruise = cruiseByName.get(text(row.cruise_name));
    if (!cruise || !SCHEDULE_TYPES.has(row.schedule_type)) continue;
    const key = `${cruise.id}|${row.schedule_type}`;
    itineraryMap.set(key, {
      cruise_id: cruise.id,
      schedule_type: row.schedule_type,
      nights: row.schedule_type === 'DAY' ? 0 : row.schedule_type === '1N2D' ? 1 : 2,
      description: text(row.description),
      is_active: Boolean(row.is_active),
      updated_at: now,
    });
  }
  const itineraryRows = [...itineraryMap.values()];
  if (itineraryRows.length) {
    await throwOnError(await database.from('cruise_itineraries_v2').upsert(itineraryRows, { onConflict: 'cruise_id,schedule_type' }), '크루즈 일정 저장 실패');
  }
  if (cruiseIds.length) {
    const cachedItineraries = await throwOnError(await database.from('cruise_itineraries_v2').select('id,cruise_id,schedule_type').in('cruise_id', cruiseIds), '크루즈 일정 캐시 조회 실패');
    const activeItineraryKeys = new Set(itineraryRows.map((row) => `${row.cruise_id}|${row.schedule_type}`));
    const staleItineraryIds = cachedItineraries.filter((row) => !activeItineraryKeys.has(`${row.cruise_id}|${row.schedule_type}`)).map((row) => row.id);
    if (staleItineraryIds.length) await throwOnError(await database.from('cruise_itineraries_v2').delete().in('id', staleItineraryIds), '크루즈 일정 캐시 정리 실패');
  }

  const cabinRows = [];
  for (const [name, rows] of cruiseGroups) {
    const cruise = cruiseByName.get(name);
    if (!cruise) continue;
    const rooms = new Map();
    for (const row of rows) {
      const roomName = text(row.room_name) || text(row.room_type);
      if (!roomName) continue;
      if (!rooms.has(roomName)) rooms.set(roomName, []);
      rooms.get(roomName).push(row);
    }
    for (const row of catalogs.homepage_cruise_cabin_overrides || []) {
      if (text(row.cruise_name) !== name) continue;
      const roomName = text(row.room_name);
      if (roomName && !rooms.has(roomName)) rooms.set(roomName, [{ room_name: roomName }]);
    }
    for (const [roomName, roomRows] of rooms) {
      const source = pickLatest(roomRows);
      const override = cabinOverrides.get(`${name}\u0000${roomName}`) || {};
      const displayName = text(override.name_ko) || roomName;
      const existing = existingCabinByDisplay.get(`${cruise.id}|${displayName}`) || existingCabinBySource.get(`${cruise.id}|${roomName}`);
      const knownMaxAdults = roomRows.map((row) => number(row.max_adults)).filter((value) => value !== null && value > 0);
      const knownMaxGuests = roomRows.map((row) => number(row.max_guests)).filter((value) => value !== null && value > 0);
      // 원본 객실 정원이 없을 때에도 2인 기준 요금표를 표시할 수 있도록
      // 최소 정원만 보완한다. 원본 정원이 있으면 그 값을 그대로 사용한다.
      const maxAdults = knownMaxAdults.length ? Math.max(...knownMaxAdults) : 2;
      const maxGuests = knownMaxGuests.length ? Math.max(maxAdults, ...knownMaxGuests) : maxAdults;
      cabinRows.push({
        id: existing?.id || crypto.randomUUID(),
        cruise_id: cruise.id,
        legacy_room_name: roomName,
        name_ko: displayName,
        name_en: text(override.name_en) || text(source.room_name_en) || text(source.room_type_en) || text(source.name_en),
        image_url: text(override.image_url) || text(source.room_image),
        room_area_text: text(override.room_area_text) || text(source.room_area),
        bed_type: text(override.bed_type) || text(source.bed_type),
        max_adults: number(override.max_adults) ?? maxAdults,
        max_guests: number(override.max_guests) ?? maxGuests,
        has_balcony: override.has_balcony === undefined ? roomRows.some((row) => Boolean(row.has_balcony)) : Boolean(override.has_balcony),
        is_vip: override.is_vip === undefined ? roomRows.some((row) => Boolean(row.is_vip)) : Boolean(override.is_vip),
        has_butler: override.has_butler === undefined ? roomRows.some((row) => Boolean(row.has_butler)) : Boolean(override.has_butler),
        is_recommended: override.is_recommended === undefined ? roomRows.some((row) => Boolean(row.is_recommended)) : Boolean(override.is_recommended),
        connecting_available: override.connecting_available === undefined ? roomRows.some((row) => Boolean(row.connecting_available)) : Boolean(override.connecting_available),
        extra_bed_available: override.extra_bed_available === undefined ? roomRows.some((row) => Boolean(row.extra_bed_available)) : Boolean(override.extra_bed_available),
        facilities: text(override.facilities) || displayText(source.facilities),
        special_amenities: text(override.special_amenities) || text(source.special_amenities),
        is_active: override.is_active === undefined ? true : Boolean(override.is_active),
        updated_at: now,
      });
    }
  }
  if (cabinRows.length) {
    await throwOnError(await database.from('cabins_v2').upsert(cabinRows, { onConflict: 'id' }), '크루즈 객실 저장 실패');
  }

  const cabins = cruiseIds.length
    ? await throwOnError(await database.from('cabins_v2').select('id,cruise_id,legacy_room_name,name_ko,name_en').in('cruise_id', cruiseIds), '크루즈 객실 재조회 실패')
    : [];
  const activeCabinKeys = new Set(cabinRows.map((row) => `${row.cruise_id}|${row.legacy_room_name}`));
  const staleCabinIds = cabins.filter((row) => row.legacy_room_name && !activeCabinKeys.has(`${row.cruise_id}|${row.legacy_room_name}`)).map((row) => row.id);
  if (staleCabinIds.length) {
    await throwOnError(await database.from('cabins_v2').update({ is_active: false, updated_at: now }).in('id', staleCabinIds), '삭제 객실 비활성화 실패');
  }
  if (cabins.length) {
    await throwOnError(
      await database.from('cabin_aliases_v2').upsert(cabins.filter((row) => row.legacy_room_name).map((row) => ({ cruise_id: row.cruise_id, alias: row.legacy_room_name, cabin_id: row.id })), { onConflict: 'cruise_id,alias' }),
      '객실 별칭 저장 실패',
    );
  }

  const itineraries = cruiseIds.length
    ? await throwOnError(await database.from('cruise_itineraries_v2').select('id,cruise_id,schedule_type').in('cruise_id', cruiseIds), '크루즈 일정 재조회 실패')
    : [];
  const activeItineraryKeys = new Set(itineraryRows.map((row) => `${row.cruise_id}|${row.schedule_type}`));
  const staleItineraryIds = itineraries.filter((row) => !activeItineraryKeys.has(`${row.cruise_id}|${row.schedule_type}`)).map((row) => row.id);
  if (staleItineraryIds.length) {
    await throwOnError(await database.from('cruise_itineraries_v2').update({ is_active: false, updated_at: now }).in('id', staleItineraryIds), '삭제 일정 비활성화 실패');
  }
  const itineraryByKey = new Map(itineraries.map((row) => [`${row.cruise_id}|${row.schedule_type}`, row]));
  const cabinsByCruise = new Map();
  const cabinById = new Map(cabins.map((cabin) => [cabin.id, cabin]));
  for (const cabin of cabins) {
    if (!cabinsByCruise.has(cabin.cruise_id)) cabinsByCruise.set(cabin.cruise_id, []);
    cabinsByCruise.get(cabin.cruise_id).push(cabin);
  }
  const cabinAliases = cruiseIds.length
    ? await throwOnError(await database.from('cabin_aliases_v2').select('cruise_id,alias,cabin_id').in('cruise_id', cruiseIds), '객실 별칭 재조회 실패')
    : [];
  const aliasCabinsByCruise = new Map();
  for (const alias of cabinAliases) {
    const cabin = cabinById.get(alias.cabin_id);
    if (!cabin || !activeCabinKeys.has(`${cabin.cruise_id}|${cabin.legacy_room_name}`)) continue;
    if (!aliasCabinsByCruise.has(alias.cruise_id)) aliasCabinsByCruise.set(alias.cruise_id, new Map());
    aliasCabinsByCruise.get(alias.cruise_id).set(normalized(alias.alias), cabin);
  }
  const existingRates = await throwOnError(await database.from('rate_plans_v2').select('source_rate_id,cabin_id,itinerary_id,valid_during,price_basis').not('source_rate_id', 'is', null), '크루즈 요금 캐시 조회 실패');
  const existingRateBySourceId = new Map(existingRates.map((row) => [String(row.source_rate_id), row]));
  const basisBySourceId = new Map(existingRates.map((row) => [String(row.source_rate_id), row.price_basis]));
  const dedupedRates = new Map();
  let unmatchedRates = 0;
  for (const rate of rateCards) {
    const sourceId = text(rate.__source_id) || text(rate.id);
    const cruise = cruiseByName.get(text(rate.cruise_name));
    const itinerary = cruise && itineraryByKey.get(`${cruise.id}|${rate.schedule_type}`);
    const existingCabin = sourceId ? cabinById.get(existingRateBySourceId.get(sourceId)?.cabin_id) : null;
    const cabin = cruise && existingCabin?.cruise_id === cruise.id && activeCabinKeys.has(`${cruise.id}|${existingCabin.legacy_room_name}`)
      ? existingCabin
      : cruise && findCabin(rate, cabinsByCruise.get(cruise.id) || [], aliasCabinsByCruise.get(cruise.id));
    const endExclusive = nextDay(rate.valid_to);
    if (!sourceId || !cruise || !itinerary || !cabin || !/^\d{4}-\d{2}-\d{2}$/.test(rate.valid_from || '') || !endExclusive || rate.valid_from > rate.valid_to) {
      unmatchedRates += 1;
      continue;
    }
    const row = {
      source_rate_id: sourceId,
      cabin_id: cabin.id,
      itinerary_id: itinerary.id,
      valid_during: `[${rate.valid_from},${endExclusive})`,
      price_basis: basisBySourceId.get(sourceId) || 'unknown',
      currency: 'VND',
      price_adult: number(rate.price_adult),
      price_child: number(rate.price_child),
      price_infant: number(rate.price_infant),
      price_single: number(rate.price_single),
      price_extra_bed: number(rate.price_extra_bed),
      single_available: Boolean(rate.single_available),
      extra_bed_available: Boolean(rate.extra_bed_available),
      season_name: text(rate.season_name),
      is_active: Boolean(rate.is_active),
      updated_at: now,
    };
    const key = `${row.cabin_id}|${row.itinerary_id}|${row.valid_during}|${row.price_basis}`;
    const current = dedupedRates.get(key);
    if (!current || (row.is_active && !current.is_active) || ((row.price_adult ?? Infinity) < (current.price_adult ?? Infinity))) dedupedRates.set(key, row);
  }
  const rateRows = [...dedupedRates.values()];
  const rateBySourceId = new Map(rateRows.map((row) => [row.source_rate_id, row]));
  const replacedRateIds = existingRates.filter((existing) => {
    const next = rateBySourceId.get(String(existing.source_rate_id));
    if (!next) return true;
    const currentRange = String(existing.valid_during || '').replaceAll('"', '');
    return existing.cabin_id !== next.cabin_id || existing.itinerary_id !== next.itinerary_id
      || currentRange !== next.valid_during || existing.price_basis !== next.price_basis;
  }).map((row) => String(row.source_rate_id));
  if (replacedRateIds.length) {
    await throwOnError(await database.from('rate_plans_v2').delete().in('source_rate_id', replacedRateIds), '삭제 요금 정리 실패');
  }
  if (rateRows.length) {
    await throwOnError(await database.from('rate_plans_v2').upsert(rateRows, { onConflict: 'source_rate_id' }), '크루즈 요금 저장 실패');
  }

  const tagRows = (catalogs.homepage_cruise_tags || []).map((row) => {
    const cruise = cruiseByName.get(text(row.cruise_name));
    return cruise && text(row.tag) && text(row.evidence) ? { cruise_id: cruise.id, tag: row.tag, evidence: row.evidence, is_active: Boolean(row.is_active) } : null;
  }).filter(Boolean);
  if (tagRows.length) {
    await throwOnError(await database.from('cruise_tags_v2').upsert(tagRows, { onConflict: 'cruise_id,tag' }), '추천 태그 저장 실패');
  }
  if (cruiseIds.length) {
    const cachedTags = await throwOnError(await database.from('cruise_tags_v2').select('cruise_id,tag').in('cruise_id', cruiseIds), '추천 태그 캐시 조회 실패');
    const activeTagKeys = new Set(tagRows.map((row) => `${row.cruise_id}|${row.tag}`));
    for (const row of cachedTags.filter((item) => !activeTagKeys.has(`${item.cruise_id}|${item.tag}`))) {
      await throwOnError(await database.from('cruise_tags_v2').delete().eq('cruise_id', row.cruise_id).eq('tag', row.tag), '추천 태그 캐시 정리 실패');
    }
  }

  const images = catalogs.homepage_cruise_images || [];
  const cabinImageRows = [];
  const cafeImageRows = [];
  for (const row of images) {
    const cruise = cruiseByName.get(text(row.cruise_name));
    if (!cruise || !row.id) continue;
    const cabin = text(row.room_name) ? (cabinsByCruise.get(cruise.id) || []).find((item) => item.legacy_room_name === text(row.room_name) || item.name_ko === text(row.room_name)) : null;
    if (row.collection === 'cabin_gallery' && cabin && row.storage_bucket && row.storage_path) {
      cabinImageRows.push({ id: row.id, cabin_id: cabin.id, storage_bucket: row.storage_bucket, storage_path: row.storage_path, alt_text: text(row.image_name), sort_order: number(row.sort_order) || 0, is_primary: Boolean(row.is_primary), updated_at: now });
    }
    if (row.collection === 'cafe_import' && row.storage_bucket && row.storage_path) {
      cafeImageRows.push({ id: row.id, cruise_id: cruise.id, cabin_id: cabin?.id || null, source_url: text(row.source_url) || row.image_url, source_image_url: text(row.source_image_url) || row.image_url, image_name: text(row.image_name), storage_bucket: row.storage_bucket, storage_path: row.storage_path, sort_order: number(row.sort_order) || 0 });
    }
  }
  const [cachedCabinImages, cachedCafeImages] = await Promise.all([
    database.from('cabin_images_v2').select('id'), database.from('cruise_cafe_import_images_v2').select('id'),
  ]);
  if (cachedCabinImages.error || cachedCafeImages.error) throw cachedCabinImages.error || cachedCafeImages.error;
  await throwOnError(await database.from('cabin_images_v2').update({ is_primary: false, updated_at: now }).eq('is_primary', true), '객실 이미지 대표 상태 초기화 실패');
  if (cabinImageRows.length) await throwOnError(await database.from('cabin_images_v2').upsert(cabinImageRows, { onConflict: 'id' }), '객실 이미지 캐시 저장 실패');
  if (cafeImageRows.length) await throwOnError(await database.from('cruise_cafe_import_images_v2').upsert(cafeImageRows, { onConflict: 'id' }), '가져온 이미지 캐시 저장 실패');
  const incomingCabinImageIds = new Set(cabinImageRows.map((row) => row.id));
  const incomingCafeImageIds = new Set(cafeImageRows.map((row) => row.id));
  const staleCabinImageIds = (cachedCabinImages.data || []).filter((row) => !incomingCabinImageIds.has(row.id)).map((row) => row.id);
  const staleCafeImageIds = (cachedCafeImages.data || []).filter((row) => !incomingCafeImageIds.has(row.id)).map((row) => row.id);
  for (let index = 0; index < staleCabinImageIds.length; index += 200) {
    await throwOnError(await database.from('cabin_images_v2').delete().in('id', staleCabinImageIds.slice(index, index + 200)), '객실 이미지 캐시 정리 실패');
  }
  for (let index = 0; index < staleCafeImageIds.length; index += 200) {
    await throwOnError(await database.from('cruise_cafe_import_images_v2').delete().in('id', staleCafeImageIds.slice(index, index + 200)), '가져온 이미지 캐시 정리 실패');
  }

  return { cruises: cruiseRows.length, cabins: cabinRows.length, itineraries: itineraryRows.length, rates: rateRows.length, tags: tagRows.length, images: images.length, unmatchedRates };
}
