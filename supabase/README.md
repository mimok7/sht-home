# Supabase 마이그레이션

`migrations/202607160001_cruise_recommendation_v2.sql`은 현재 운영 테이블을 삭제하거나 수정하지 않는 추천용 v2 스키마입니다.

`migrations/20260716134509_backfill_cruise_recommendation_v2.sql`은 기존 `cruise_info`와 `cruise_rate_card`를 읽어 v2 테이블을 채웁니다. 다음 원칙으로 안전하게 범위를 제한합니다.

이 파일은 전체 백필과 마지막 검증을 하나의 트랜잭션으로 묶으므로 SQL 에디터에서는 파일 전체를 한 번에 실행하는 것을 권장합니다. 매핑은 CTE로 처리되어 임시 테이블 세션 오류가 발생하지 않습니다.

- 상세정보가 있는 기존 17개 크루즈와 유효한 객실 행만 활성화
- `DAY`, `1N2D`, `2N3D` 일정과 정상 날짜 범위만 이관
- 객실명이 명확하게 일치하거나 검토된 별칭이 있는 요금만 이관
- 같은 객실·일정·기간의 중복 요금은 활성 요금, 낮은 성인 요금, 최신 수정 순으로 한 건 선택
- 가격 단위는 확정 전까지 `unknown`
- 불완전한 아동 규정은 `confirm`으로 보존하되 자동 계산에는 사용하지 않음
- `cruise_tour_options`는 이동 상품이 아니므로 `cruise_transfers_v2`에 잘못 복사하지 않음

홈페이지의 홈 카운트, 크루즈 목록, 상품 상세, 여행 안내 및 추천 API는 `cruises_v2`와 `public_cruise_recommendation_v2`만 조회합니다. v2 조회가 실패하거나 결과가 비어 있어도 기존 운영 테이블로 자동 전환하지 않으며, 화면에는 상품 없음 또는 상담 필요 상태를 표시합니다. 아래 항목이 확정되기 전에는 v2 요금을 최종 견적 또는 결제 금액으로 사용하지 않습니다.

- `price_adult`가 객실 기준인지 성인 1인 기준인지
- 크루즈별 아동·유아 나이 및 요금 규정
- 요금표의 상품명·객실명 별칭
- 상세 정보가 없는 요금 상품 9개의 처리 방식
- 중복 요금 8건의 최종 선택값

운영 적용 순서는 다음과 같습니다.

1. `202607160001_cruise_recommendation_v2.sql` 적용
2. `20260716134509_backfill_cruise_recommendation_v2.sql` 적용
3. 마이그레이션 완료 알림의 크루즈·객실·요금·공개 뷰 행 수 확인
4. Supabase 보안·성능 Advisor와 `supabase db lint` 확인
5. 대표 추천 시나리오를 검수한 뒤 가격 단위와 추가 별칭 확정

운영 프로젝트에는 Supabase 관리자 연결과 백업 확인 없이 직접 적용하지 마세요.

## 연결 명령

전역 설치 없이 저장소에서 고정 버전 CLI를 실행할 수 있습니다.

```powershell
node scripts/supabase-cli.mjs --version
npm run db:cli -- projects list
npm run db:cli -- link --project-ref <project-ref>
```

현재 CLI 계정에서는 `.env.local`의 프로젝트에 대한 관리 권한이 없어 `link`가 실패합니다. 프로젝트 멤버 초대 또는 올바른 Supabase 로그인 후 다시 실행하세요. 저장소 루트의 `.mcp.json`에는 공식 Supabase MCP 서버 주소를 등록해 두었으므로, 세션에서 OAuth 인증을 완료한 뒤 MCP로 프로젝트 목록·SQL·Advisor를 사용할 수 있습니다.

## 브라우저 검증

인앱 브라우저 연결이 세션에 노출되지 않는 경우에도 로컬 앱을 검증할 수 있도록 Puppeteer 스모크 명령을 제공합니다.

```powershell
npm run browser:smoke -- http://localhost:3000/travel-guide
$env:BROWSER_WIDTH = '1440'; npm run browser:smoke -- http://localhost:3000/travel-guide
```

이 명령은 페이지 오류, 가로 넘침, 기본 제목과 안내 페이지의 중복 바로가기 여부를 출력하고 문제가 있으면 실패 코드로 종료합니다.
