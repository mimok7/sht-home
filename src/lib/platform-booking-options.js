// 고객앱 예약 화면과 동일한 플랫폼 상품 옵션을 조회한다.
import { platformSupabase } from './platform-supabase';

function assertResult(result, label) {
  if (result.error) throw new Error(`${label} 정보를 불러오지 못했습니다.`);
  return result.data || [];
}

export function uniqueValues(rows, field) {
  return [...new Set((rows || []).map((row) => String(row?.[field] || '').trim()).filter(Boolean))];
}

export function validOn(row, date, fromField = 'valid_from', toField = 'valid_to') {
  if (!date) return true;
  return (!row?.[fromField] || row[fromField] <= date) && (!row?.[toField] || row[toField] >= date);
}

export async function loadPlatformBookingOptions(type) {
  if (type === 'cruise') {
    const [rates, inclusions, tourOptions] = await Promise.all([
      platformSupabase.from('cruise_rate_card').select('id,cruise_name,schedule_type,room_type,room_type_en,price_adult,price_child,price_child_older,price_child_extra_bed,price_infant,price_extra_bed,price_single,valid_year,valid_from,valid_to,currency,is_active,notes,includes_vehicle,vehicle_type,infant_policy,season_name,is_promotion,extra_bed_available,single_available,display_order').eq('is_active', true).order('display_order').order('price_adult'),
      platformSupabase.from('cruise_rate_card_inclusions').select('rate_card_id,inclusion_text,display_order').order('display_order'),
      platformSupabase.from('cruise_tour_options').select('option_id,cruise_name,schedule_type,option_name,option_price,option_type,is_active').eq('is_active', true).order('option_name'),
    ]);
    return { rates: assertResult(rates, '크루즈 객실'), inclusions: assertResult(inclusions, '크루즈 포함 사항'), tourOptions: assertResult(tourOptions, '크루즈 투어 옵션') };
  }

  if (type === 'hotel') {
    const [hotels, prices] = await Promise.all([
      platformSupabase.from('hotel_info').select('hotel_code,hotel_name,product_type,location,star_rating,check_in_time,check_out_time,currency,notes,active').eq('active', true).order('hotel_name'),
      platformSupabase.from('hotel_price').select('hotel_price_code,hotel_code,hotel_name,room_type,room_name,room_category,occupancy_max,include_breakfast,base_price,extra_person_price,child_policy,season_name,start_date,end_date,weekday_type,notes').order('base_price'),
    ]);
    return { hotels: assertResult(hotels, '호텔'), prices: assertResult(prices, '호텔 객실') };
  }

  if (type === 'airport') {
    const [prices, airports] = await Promise.all([
      platformSupabase.from('airport_price').select('airport_code,service_type,route,vehicle_type,vehicle_examples,recommended_capacity,max_capacity,price,year,is_active,valid_from,valid_to').eq('is_active', true).order('service_type').order('route').order('vehicle_type'),
      platformSupabase.from('airport_name').select('airport_code,airport_name').order('airport_name'),
    ]);
    return { prices: assertResult(prices, '공항 요금'), airports: assertResult(airports, '공항명') };
  }

  if (type === 'rentcar' || type === 'cruise_vehicle') {
    const prices = await platformSupabase.from('rentcar_price').select('rent_code,category,car_category_code,vehicle_type,route,route_from,route_to,way_type,price,capacity,duration_hours,rental_type,year,description,is_active,cruise').eq('is_active', true).order('way_type').order('route').order('vehicle_type');
    return { prices: assertResult(prices, '차량 요금') };
  }

  if (type === 'tour') {
    const allowedNames = ['닌빈 한국어 가이드 투어', '하노이 역사투어', '하노이 오후 투어', '하노이 원데이 당일투어'];
    const [tours, prices, payments, inclusions, addons, cruiseIntegrations] = await Promise.all([
      platformSupabase.from('tour').select('tour_id,tour_code,tour_name,category,duration,location,program_type,description,overview,payment_notes,is_cruise_addon,is_active').eq('is_active', true).neq('is_cruise_addon', true).in('tour_name', allowedNames).order('category').order('tour_name'),
      platformSupabase.from('tour_pricing').select('pricing_id,tour_id,min_guests,max_guests,price_per_person,vehicle_type,deposit_amount,deposit_rate,default_payment_method,adult_price,child_price,is_active,valid_from,valid_until').eq('is_active', true).order('min_guests'),
      platformSupabase.from('tour_payment_pricing').select('payment_pricing_id,tour_id,payment_method,price,price_adjustment,currency,valid_from,valid_until,notes,is_active').eq('is_active', true),
      platformSupabase.from('tour_inclusions').select('inclusion_id,tour_id,order_seq,description,category').order('order_seq'),
      platformSupabase.from('tour_addon_options').select('option_id,tour_id,option_name,option_category,description,price,price_type,price_currency,is_required,is_available,order_seq').order('order_seq'),
      platformSupabase.from('tour_cruise_integration').select('*'),
    ]);
    return { tours: assertResult(tours, '투어'), prices: assertResult(prices, '투어 요금'), payments: assertResult(payments, '결제 방식'), inclusions: assertResult(inclusions, '포함 사항'), addons: assertResult(addons, '추가 옵션'), cruiseIntegrations: assertResult(cruiseIntegrations, '크루즈 연계 정보') };
  }

  if (type === 'package') {
    const [packages, airports] = await Promise.all([
      platformSupabase.from('package_master').select('id,package_code,name,description,base_price,price_config,price_child_extra_bed,price_child_no_extra_bed,price_infant_tour,price_infant_extra_bed,price_infant_seat,vehicle_config,is_active,items:package_items(id,service_type,item_order,default_data,description)').eq('is_active', true).order('name'),
      platformSupabase.from('airport_name').select('airport_code,airport_name').order('airport_name'),
    ]);
    return { packages: assertResult(packages, '패키지'), airports: assertResult(airports, '공항명') };
  }

  if (type === 'ticket') {
    const [tours, prices] = await Promise.all([
      platformSupabase.from('tour').select('tour_id,tour_code,tour_name,description,location,duration,program_type,is_cruise_addon,is_active').eq('is_active', true).order('tour_name'),
      platformSupabase.from('ticket_price').select('ticket_price_code,ticket_type,ticket_name,price_item,official_price_vnd,stay_card_price_vnd,stay_krw_price_krw,valid_from,valid_to,sort_order,is_active,notes').eq('is_active', true).order('sort_order'),
    ]);
    return { tours: assertResult(tours, '티켓 상품'), prices: assertResult(prices, '티켓 요금') };
  }

  return {};
}
