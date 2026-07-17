# 예약 플랫폼 연동

## 확인된 원본

- 홈페이지 Supabase: `tthwqfhdojncqtwfssqe`
- 예약 플랫폼 Supabase: `jkhookaflhibrcafmlxn`
- 회원 원본: 예약 플랫폼의 `auth.users`, 운영 정보: `public.users`
- 상품 원본: `cruise_rate_card`, `hotel_price`, `tour_pricing`, `rentcar_price`

두 프로젝트는 서로 다른 Supabase 데이터베이스다. 따라서 홈페이지의
`NEXT_PUBLIC_SUPABASE_*` 값을 플랫폼 값으로 교체하면 홈페이지의 `*_v2`
테이블을 읽을 수 없게 된다. 홈페이지 데이터베이스는 큐레이션/표시용으로
유지하고, 플랫폼은 회원·예약·상품 원본으로 사용한다.

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
- 홈페이지의 `*_v2` 편집 권한은 플랫폼 `users.role`을 서버에서 검증하는
  전용 관리 API로 전환한 뒤 사용한다. 서로 다른 Supabase 프로젝트의 JWT는
  자동으로 다른 프로젝트 RLS를 통과하지 않는다.
- 비밀번호, `auth.users` 행, service-role 키를 홈페이지 DB로 복사하지 않는다.
