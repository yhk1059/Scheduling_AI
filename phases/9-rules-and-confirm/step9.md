# Step 9: e2e-sync

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 설계 의도를 파악하라:

- `/CLAUDE.md`
- `/phases/9-rules-and-confirm/index.json` — **step 0~8의 summary 전부**. 특히 "바뀐 화면 문구·접근성 이름·버튼 위치"와 "e2e에 영향"으로 적힌 것
- `/docs/BROWSER_TEST_SCENARIOS.md` — 시나리오 S1~S18, "실행 환경"
- `/docs/UI_GUIDE.md` — "문구" 표, "매장 설정 › [매장 조건]", "요약 지표", "직원 가능 시간 입력 › 잠긴 뒤", "대화상자", "반복 사용 컴포넌트 › 꺼진 규칙"
- `/docs/PRD.md` — "핵심 기능 1 › 기본 규칙", J2 ③ 확정, J8 직원 링크 오류, "MVP 제외 사항"(직원용 근무표 열람)
- `/docs/ARCHITECTURE.md` — "패턴 › 직원 링크"(DB 함수 목록), "디렉토리 구조 › supabase/migrations"
- `/docs/ADR.md` — 마지막 ADR 번호와 형식
- `/e2e/test-helpers.ts`, `/e2e/*.spec.ts` — 특히 `journey.spec.ts`의 S8(카드 버튼), S10(제안 카드·끄기), S12(확정 → 잠긴 직원 화면), `operating.spec.ts` S3-c·S4(확정·다시 확정), `expressions.spec.ts` S18(필요 인원 "정확히"로 사람이 모자란 매장)
- `/playwright.config.ts`
- `/scripts/record-dining.ts` — 데모 영상 녹화의 [확정] 클릭(349행 부근)
- `/README.md`

## 배경

step 0~8이 화면을 바꾸는 동안 e2e는 돌리지 않았다(실제 Anthropic·Supabase 키가 들어가고, 중간에 돌리면 실패 원인이 섞인다). 이 step은 누적 summary를 바탕으로 e2e와 문서를 새 화면에 맞추고 전부 통과시킨다. 앱 코드는 e2e를 통과시키기 위한 최소 수정만 한다.

이 phase에서 바뀐 것(summary로 확인하라):
- 필요 인원 기본 해석이 "이상"(step 2) → S18처럼 "정확히"에 기대던 시나리오는 말에 "정확히"를 넣거나 기대값을 바꾼다. 랜딩·README의 정확도 수치.
- 대기 필요 인원 카드의 충돌 경고 + [기존 규칙 끄기](step 1).
- 카드 [수정]의 이상/정확히 select(step 3).
- 영구 끄기 문구 "매장 조건에서 끄기"/"매장 조건에서 꺼짐", 요약 지표의 "끈 규칙 N개" 배지와 "이번 근무표에서 끈 규칙" 칸(step 4).
- 공정성 기본 규칙 2개가 모든 매장에 더해진다(step 5) → "매장 조건 N개" 수, 카드 수(`appliedCards`), soft 규칙이 늘어 근무표 결과·최소 변경 칸 수가 달라질 수 있다.
- [확정] 확인 대화상자(step 6) → `getByRole("button", { name: "확정", exact: true })`가 둘이 된다. 제안 카드의 안내 줄.
- 잠긴 직원 링크에서 이름을 고르면 확정 근무표(step 7·8) → S12 11~13단계, 보기 전용 캘린더 없음.

## 작업

1. `npm run test:e2e`를 돌려 실패를 모은다. 실패마다 원인을 셀렉터·문구·구조·결과 변화 중 어느 것인지 적는다.
2. `e2e/test-helpers.ts`와 spec을 새 화면에 맞춘다. 역할·접근 가능한 이름 우선. 시나리오가 검증하는 것(반드시 규칙 준수, 가능 시간 안 배정, 최소 변경, 확정 뒤 링크 잠금, 이월 표)은 바꾸지 않는다.
   - S12: [확정] → 대화상자 [확정](`getByRole("dialog").getByRole("button", { name: "확정" })`) 순서. 잠긴 직원 화면은 이름을 고르면 "내 근무"와 "전체 근무표"가 보이고, 그 직원의 칸 코드가 매니저가 확정한 근무표(`confirmedGrid`)와 같은지 비교한다. `submit_availability` 거부 검사는 유지.
   - S10: 제안 카드의 안내 줄, [이번 근무표에서만 끄기] 뒤 요약 지표의 `끈 규칙 1개`와 "이번 근무표에서 끈 규칙" 칸.
   - S8-c 등 카드 버튼: [끄기] → [매장 조건에서 끄기].
   - 기본 규칙 2개: `appliedCards` 수, 홈 "매장 조건 N개"(state에서 세므로 보통 그대로), 통과하지 않으면 soft 규칙 때문에 결과가 달라진 것인지 확인한다. 최소 변경(S4) 검사가 흔들리면 테스트의 기대를 느슨하게 하지 말고 원인을 summary에 적고 사용자 판단을 받는다(`blocked`가 아니라 그 검사만 남긴 채 `error`로 보고).
   - S18: "정확히" 해석이 필요한 문장이면 말을 고친다("… 정확히 3명").
3. 앱 코드는 접근성 규칙(UI_GUIDE "접근성")을 어겨 e2e가 못 찾는 경우에만 고친다. 그 밖의 앱 수정은 하지 않고 summary에 남긴다.
4. 문서를 새 화면대로 고친다. 시나리오 번호는 유지한다.
   - `docs/BROWSER_TEST_SCENARIOS.md`: S8·S10·S12·S18과 "테스트 데이터"(D1~D6 매장에 기본 규칙 2개가 더해진다는 것), 직원 화면 잠긴 뒤.
   - `docs/UI_GUIDE.md`: "매장 설정 › [매장 조건]"([끄기] → [매장 조건에서 끄기], 기본 규칙 카드가 필요 인원·최대 연속 근무·근무 수 고르게), "꺼진 규칙·요청 카드"(배지 두 종류), "요약 지표"(새 칸·배지), "대화상자"(데이터 삭제 + 확정), "직원 가능 시간 입력 › 잠긴 뒤"(이름 → 내 근무·전체 근무표), "제안 카드"(안내 줄), "규칙·요청 카드"([수정]에 이상/정확히), "문구" 표에 `매장 조건에서 끄기 / 이번 근무표에서만 끄기` 행.
   - `docs/PRD.md`: 핵심 기능 1 "기본 규칙"에 공정성 두 개와 "숫자만 말하면 이상, 정확히·딱이면 같음", J2 ③ 확정 확인, 직원 화면 확정 뒤 열람, "MVP 제외 사항"에서 "직원용 근무표 열람"을 뺀다.
   - `docs/ARCHITECTURE.md`: "직원 링크" 패턴에 `get_confirmed_schedule(공용 토큰)`과 읽는 곳(shops.data의 마지막 확정본), `lib/coverage-conflict.ts`·`lib/confirmed-view.ts`를 디렉토리 구조에.
   - `docs/ADR.md`: ADR-023 한 항목 — 필요 인원 기본 해석 "이상"(저장 규칙은 자동 변환하지 않고 적용 시점 충돌 안내), 공정성 기본 규칙, 직원의 확정 근무표 열람(문서에서 읽는 DB 함수, 직원 id 미반환). 형식은 기존 항목(결정·이유·트레이드오프)과 같게.
5. `scripts/record-dining.ts`의 [확정] 클릭 뒤에 대화상자 [확정] 클릭을 더한다. 영상(`public/demo.mp4`)은 다시 만들지 않는다(summary에 "재녹화 필요"를 적는다).
6. `npm run test:e2e`가 전부 통과할 때까지 2~3을 반복한다.

## Acceptance Criteria

```bash
npx tsc --noEmit
npm run lint
npm test
npm run build
npm run test:e2e
```

## 검증 절차

1. 위 AC 커맨드를 실행한다. `test:e2e`는 `.env.local`의 `ANTHROPIC_API_KEY`·테스트 Supabase 키·`E2E_TEST_EMAIL`/`PASSWORD`가 필요하고, step 7의 마이그레이션이 테스트 프로젝트에 적용돼 있어야 한다. 키가 없거나 마이그레이션이 없으면 `blocked`로 두고 사유를 적는다. **e2e 실패는 `blocked`가 아니라 `error`**로 보고해 재시도되게 한다(실패한 spec 이름과 원인을 `error_message`에).
2. 아키텍처 체크: e2e가 검증하던 불변식이 그대로 검증되는가? 앱 수정이 접근성 수정뿐인가? 문서의 DB 함수 목록이 마이그레이션과 같은가?
3. 문서 체크: BROWSER_TEST_SCENARIOS의 S10·S12·S18은 갱신한 spec 실행으로 갈음한다. 직원 확정 근무표 화면은 S12 spec이 본다.
4. 결과에 따라 `phases/9-rules-and-confirm/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약(고친 spec·헬퍼, 앱 수정, 고친 문서, 남긴 문제, 영상 재녹화 필요)"`. 문서에 없는 세부 결정은 `결정: …`으로 함께 적는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요(키 없음, 마이그레이션 미적용) → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- e2e가 검증하는 조건을 약하게 만들지 마라(기대값 삭제, `force` 남용, 타임아웃만 늘리기). 이유: 테스트는 솔버·LLM 안전 장치의 증거다. 기본 규칙 때문에 결과가 달라진 검사는 원인을 적고 사람이 정한다.
- 시나리오를 통과시키려고 화면 구조나 문구를 되돌리지 마라. 이유: 화면은 step 0~8의 결정이 기준이다. 셀렉터를 바꾼다.
- `NEXT_PUBLIC_E2E_LOGIN`을 `.env.local`에 넣지 마라. 이유: 7-availability step 4 결정(프로덕션 빌드에 들어가지 않게 playwright.config.ts의 서버 env로만 켠다).
- `eval/results.md`를 손으로 고치지 마라. 이유: `eval/run.py`가 쓴다.
- `public/demo.mp4`를 다시 녹화하지 마라. 이유: 시간이 길고 사용자가 따로 한다. 스크립트만 맞춘다.
- Supabase MCP 도구로 마이그레이션을 적용하지 마라. 이유: DB 적용은 사용자가 한다.
- 기존 테스트를 깨뜨리지 마라.
