# 예약 플랫폼 연동

## 확인된 원본

- 이전 홈페이지 Supabase(이관 점검·복구 전용, 운영 사용 금지): `tthwqfhdojncqtwfssqe`
- 예약 플랫폼 Supabase: `jkhookaflhibrcafmlxn`
- 회원 원본: 예약 플랫폼의 `auth.users`, 운영 정보: `public.users`
- 상품 원본: `cruise_rate_card`, `hotel_price`, `tour_pricing`, `rentcar_price`

운영 홈페이지는 플랫폼 프로젝트만 사용한다. 공개 상품 `*_v2`, 관리자 편집,
이미지 Storage, 인증, 장바구니와 발행 견적서도 모두 플랫폼에 저장한다.
`src/lib/supabase.js`는 `platformSupabase`를 재사용한다. 이전 프로젝트의
`NEXT_PUBLIC_SUPABASE_*`, `HOMEPAGE_SUPABASE_SERVICE_ROLE_KEY`는 운영에 필요하지 않다.
연결 통합과 원본 데이터의 완전한 이관은 별도 검증 대상이다. 테이블 수가
비슷하다는 이유로 원본을 삭제하지 말고 누락 행·첨부파일·권한까지 대조한다.

## 환경 설정

`sht-platform/apps/customer/.env.local`에서 플랫폼의 URL과 anon/publishable
key를 확인하여 홈페이지의 `.env.local`에 다음 값을 추가한다. 값은 저장소에
커밋하지 않는다.

```dotenv
NEXT_PUBLIC_PLATFORM_SUPABASE_URL=https://jkhookaflhibrcafmlxn.supabase.co
NEXT_PUBLIC_PLATFORM_SUPABASE_ANON_KEY=<platform anon or publishable key>

# 서버 API에만 별도 값을 쓰고 싶을 때 선택적으로 설정한다.
PLATFORM_SUPABASE_URL=https://jkhookaflhibrcafmlxn.supabase.co
PLATFORM_SUPABASE_ANON_KEY=<platform anon or publishable key>

# 관리자 API, 이미지 저장, 장바구니 및 견적서 서버 처리 전용. 브라우저 노출 금지.
PLATFORM_SUPABASE_SERVICE_ROLE_KEY=<platform service role key>

# 홈페이지 상품에서 예약 플랫폼으로 이동할 서버 측 목적지
PLATFORM_CUSTOMER_URL=https://customer.stayhalong.com
```

개발 서버를 재시작한다. 홈페이지의 로그인·회원가입·헤더는
`platformSupabase`를 사용하므로, 어느 사이트에서 가입해도 플랫폼의 같은
`auth.users.id`를 사용한다.

## 상품 원본 API

홈페이지에는 다음 읽기 전용 API가 추가되어 있다.

```text
GET /api/platform/catalog?service=cruise
GET /api/platform/catalog?service=hotel
GET /api/platform/catalog?service=tour
GET /api/platform/catalog?service=vehicle
```

이 API는 플랫폼의 원본 테이블을 수정하지 않으며, 화면용 v2 모델로 변환하는
동기화 작업의 입력으로 사용한다. 플랫폼 RLS가 응답을 거부하면 원본 테이블을
브라우저에 직접 공개하지 말고, 플랫폼에 노출 전용 뷰 또는 API를 만들어
필요한 공개 컬럼만 반환한다.

## 권한 경계

- 예약 생성·변경·결제는 계속 플랫폼 API/DB에서만 처리한다.
- 홈페이지의 `*_v2` 편집 권한은 플랫폼 인증 및 `users.role`을 서버에서 검증하는
  전용 관리 API를 사용한다. 이전 홈페이지 JWT로 관리 기능을 허용하지 않는다.
- 비밀번호, `auth.users` 행, service-role 키를 홈페이지 DB로 복사하지 않는다.
- 이전 회원관리 마이그레이션을 플랫폼에 그대로 실행하지 않는다. Auth 트리거와
  역할 정책이 운영중인 플랫폼에 영향을 줄 수 있어 별도 승인과 호환성 검토가 필요하다.

## 예약 handoff

홈페이지 상품 상세는 예약을 홈페이지 `reservations` 테이블에 만들지 않는다.
`GET /api/platform/booking-handoff`가 상품·객실·일정·인원과 플랫폼 원본
`cruise_rate_card.id`를 검증 가능한 쿼리로 전달하고, 예약 플랫폼의
`/mypage/direct-booking/cruise`로 이동시킨다.

handoff 값은 사용자 브라우저에서 바꿀 수 있으므로 플랫폼은 금액과 상품
상태를 반드시 `rateCardId`로 다시 조회해야 한다. 이름·전화번호·이메일 같은
개인정보와 결제 금액은 URL로 전달하지 않는다.
