import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const targetSlug = process.argv[2] || '';
const outputFile = process.argv[3] ? path.resolve(process.argv[3]) : '';

async function envFile(filename) {
  const source = await fs.readFile(filename, 'utf8');
  return Object.fromEntries(source.split(/\r?\n/).map((line) => {
    const index = line.indexOf('=');
    return index > 0 && !line.trimStart().startsWith('#')
      ? [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^"|"$/g, '')]
      : null;
  }).filter(Boolean));
}

async function all(query, label) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await query(from, from + 999);
    if (error) throw new Error(`${label}: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < 1000) return rows;
  }
}

function by(values, key) {
  const groups = new Map();
  for (const value of values) {
    const groupKey = value[key];
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(value);
  }
  return groups;
}

async function main() {
  const env = await envFile(path.join(root, '.env.local'));
  const url = env.PLATFORM_SUPABASE_URL || env.NEXT_PUBLIC_PLATFORM_SUPABASE_URL;
  const key = env.PLATFORM_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('플랫폼 Supabase URL과 service role key가 필요합니다.');
  const database = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const [cruises, recommendations, itineraries, cabins, rates, sourceImages, cafeImages, cabinImages, legacyCruises] = await Promise.all([
    all((from, to) => database.from('cruises_v2').select('id,slug,legacy_name,name_ko,hero_image,is_active').range(from, to), '크루즈 조회 실패'),
    all((from, to) => database.from('public_cruise_recommendation_v2').select('cruise_id,slug,itinerary_id,schedule_type,cabin_id,rate_plan_id').range(from, to), '공개 추천 뷰 조회 실패'),
    all((from, to) => database.from('cruise_itineraries_v2').select('id,cruise_id,schedule_type,is_active').range(from, to), '일정 조회 실패'),
    all((from, to) => database.from('cabins_v2').select('id,cruise_id,legacy_room_name,name_ko,image_url,is_active').range(from, to), '객실 조회 실패'),
    all((from, to) => database.from('rate_plans_v2').select('id,cabin_id,itinerary_id,source_rate_id,is_active,valid_during,price_adult').range(from, to), '요금 조회 실패'),
    all((from, to) => database.from('homepage_cruise_images').select('id,cruise_name,room_name,collection,image_name,image_url,storage_bucket,storage_path,sort_order,is_primary').range(from, to), '원본 이미지 조회 실패'),
    all((from, to) => database.from('cruise_cafe_import_images_v2').select('id,cruise_id,cabin_id,image_name,storage_bucket,storage_path,sort_order').range(from, to), '크루즈 갤러리 조회 실패'),
    all((from, to) => database.from('cabin_images_v2').select('id,cabin_id,storage_bucket,storage_path,sort_order,is_primary').range(from, to), '객실 갤러리 조회 실패'),
    all((from, to) => database.from('cruise_info').select('cruise_name,room_name,cruise_image,cruise_images,room_image,room_images').range(from, to), '기존 크루즈 이미지 조회 실패'),
  ]);

  const recommendationsByCruise = by(recommendations, 'cruise_id');
  const itinerariesByCruise = by(itineraries, 'cruise_id');
  const cabinsByCruise = by(cabins, 'cruise_id');
  const sourceImagesByCruise = by(sourceImages, 'cruise_name');
  const cafeImagesByCruise = by(cafeImages, 'cruise_id');
  const ratesByCabin = by(rates, 'cabin_id');
  const cabinImagesByCabin = by(cabinImages, 'cabin_id');

  const coverage = cruises.filter((cruise) => cruise.is_active).map((cruise) => {
    const cruiseCabins = cabinsByCruise.get(cruise.id) || [];
    const source = sourceImagesByCruise.get(cruise.legacy_name) || sourceImagesByCruise.get(cruise.name_ko) || [];
    const imported = cafeImagesByCruise.get(cruise.id) || [];
    const general = imported.filter((image) => !image.cabin_id);
    const main = general.filter((image) => /(^|\/)main-/i.test(image.storage_path || '') || /^main-/i.test(image.image_name || ''));
    return {
      id: cruise.id,
      slug: cruise.slug,
      name: cruise.name_ko,
      legacyName: cruise.legacy_name,
      recommendationRows: (recommendationsByCruise.get(cruise.id) || []).length,
      activeItineraries: (itinerariesByCruise.get(cruise.id) || []).filter((row) => row.is_active).length,
      activeCabins: cruiseCabins.filter((row) => row.is_active).length,
      activeRates: cruiseCabins.flatMap((cabin) => ratesByCabin.get(cabin.id) || []).filter((row) => row.is_active).length,
      sourceImages: source.length,
      derivedImportImages: imported.length,
      generalImages: general.length,
      mainImages: main.length,
      cabinImages: cruiseCabins.flatMap((cabin) => cabinImagesByCabin.get(cabin.id) || []).length,
      heroImage: cruise.hero_image || null,
    };
  }).sort((left, right) => left.name.localeCompare(right.name, 'ko'));

  const report = {
    generatedAt: new Date().toISOString(),
    totals: {
      activeCruises: coverage.length,
      recommendationRows: recommendations.length,
      sourceImages: sourceImages.length,
      sourceUniquePaths: new Set(sourceImages.map((row) => row.storage_path).filter(Boolean)).size,
      derivedImportImages: cafeImages.length,
      cabinImages: cabinImages.length,
    },
    sourceCollections: Object.fromEntries([...by(sourceImages, 'collection')].map(([collection, rows]) => [collection, rows.length])),
    unmatchedSourceCruiseNames: [...sourceImagesByCruise.entries()]
      .filter(([name]) => !cruises.some((cruise) => cruise.legacy_name === name || cruise.name_ko === name))
      .map(([name, rows]) => ({ name, rows: rows.length })),
    legacyImageCandidates: Object.fromEntries(
      cruises.filter((cruise) => cruise.is_active).map((cruise) => {
        const rows = legacyCruises.filter((row) => row.cruise_name === cruise.legacy_name || row.cruise_name === cruise.name_ko);
        const urls = [...new Set(rows.flatMap((row) => [
          row.cruise_image,
          ...(Array.isArray(row.cruise_images) ? row.cruise_images : []),
          row.room_image,
          ...(Array.isArray(row.room_images) ? row.room_images : []),
        ]).filter(Boolean))];
        return [cruise.name_ko, urls];
      })
    ),
    unmappedLegacyImageNames: [...new Set(legacyCruises
      .filter((row) => row.cruise_image || (Array.isArray(row.cruise_images) && row.cruise_images.length) || row.room_image || (Array.isArray(row.room_images) && row.room_images.length))
      .map((row) => row.cruise_name)
      .filter((name) => !cruises.some((cruise) => cruise.legacy_name === name || cruise.name_ko === name)))].sort((left, right) => left.localeCompare(right, 'ko')),
    target: coverage.find((cruise) => cruise.slug === targetSlug) || null,
    missingDetail: coverage.filter((cruise) => cruise.recommendationRows === 0),
    missingAnySourceImage: coverage.filter((cruise) => cruise.sourceImages === 0).map(({ id, slug, name }) => ({ id, slug, name })),
    missingDerivedImages: coverage.filter((cruise) => cruise.sourceImages > 0 && cruise.derivedImportImages + cruise.cabinImages === 0),
    missingMainImage: coverage.filter((cruise) => cruise.mainImages === 0).map(({ id, slug, name, sourceImages, generalImages, heroImage }) => ({ id, slug, name, sourceImages, generalImages, heroImage })),
    coverage,
  };
  if (outputFile) {
    await fs.mkdir(path.dirname(outputFile), { recursive: true });
    await fs.writeFile(outputFile, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({
      outputFile,
      totals: report.totals,
      target: report.target,
      missingDetail: report.missingDetail.map(({ slug, name }) => ({ slug, name })),
      missingAnySourceImage: report.missingAnySourceImage,
      missingDerivedImages: report.missingDerivedImages.map(({ slug, name }) => ({ slug, name })),
      missingMainImage: report.missingMainImage.map(({ slug, name, sourceImages, heroImage }) => ({ slug, name, sourceImages, heroImage })),
      unmappedLegacyImageNames: report.unmappedLegacyImageNames,
    }, null, 2));
    return;
  }
  console.log(JSON.stringify(report, null, 2));
}

await main();
