# 여행 안내 서브에이전트

`POST /api/agent`로 고객 메시지를 보내면 한 개의 전문 서브에이전트가 선택됩니다. 홈페이지의 전역 `TravelAssistant` 패널이 이 API를 사용합니다.

```json
{ "message": "가족 3명에게 맞는 크루즈를 추천해줘" }
```

`/travel-guide`의 단계형 안내 화면은 검증된 구조화 조건으로 크루즈 추천 모드를 호출합니다.

```json
{
  "mode": "recommend",
  "context": {
    "scheduleType": "1N2D",
    "checkinDate": "2026-08-20",
    "adults": 2,
    "children": 1,
    "infants": 0,
    "childAges": [7],
    "roomCount": 1,
    "roomPreference": "standard",
    "totalBudgetVnd": 8000000,
    "preferences": ["family", "value"],
    "transfer": "hanoi"
  }
}
```

추천 결과는 상세 정보가 등록된 크루즈만 대상으로 최대 3개를 반환합니다. 요금은 `등록요금부터`라는 비교 기준으로만 표시하며, 실시간 재고·적용 단위·아동 규정·최종 합계는 확정하지 않습니다.

현재 전문 역할은 다음과 같습니다.

- `cruise`: Supabase의 현재 등록 상품·활성 요금 기반의 읽기 전용 추천 (조회 실패 시 로컬 데이터 사용)
- `reservation`: 예약, 결제, 변경·취소 안내
- `transfer`: 픽업, 셔틀, 하노이 이동 안내
- `general`: 위 범주 밖의 일반 안내

모든 응답은 가격·재고·예약 확정을 보장하지 않으며, 결제와 예약 변경을 실행하지 않습니다. API는 동일 출처 요청만 허용하고 IP별 분당 20회로 제한합니다. 이 메모리 기반 제한은 단일 인스턴스 보호용이므로, 다중 인스턴스 운영 시에는 플랫폼 WAF 또는 Redis 기반 제한으로 교체해야 합니다. 실제 예약 정보를 바꾸는 도구를 추가할 때는 인증된 서버 측 도구, 사용자 확인 단계, 감사 로그를 별도로 연결하세요.

## 운영과 AI 확장

- API는 문의 내용 자체를 로그에 남기지 않고, 의도·AI 제공자·상담 이관 여부만 구조화해 기록합니다.
- `AGENT_METRICS_TOKEN`을 설정하면 `Authorization: Bearer <token>`으로 `GET /api/agent`에서 현재 인스턴스의 집계 지표를 조회할 수 있습니다. 지표는 메모리 기반이라 재시작·다중 인스턴스 환경에서는 외부 관측 도구로 이전해야 합니다.
- `OPENAI_API_KEY`를 서버 환경 변수로 설정하면 Responses API가 검증된 안내 문장을 자연스럽게 정리합니다. 기본 모델은 `gpt-5.4-mini`이며 `OPENAI_TRAVEL_GUIDE_MODEL`로 변경할 수 있습니다. 이 키는 `NEXT_PUBLIC_` 접두사를 사용하지 마세요.
- AI 호출 실패나 키 미설정 시에는 규칙 기반 답변으로 자동 전환됩니다.
