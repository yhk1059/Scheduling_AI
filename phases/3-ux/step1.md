# Step 1: guest-confirm

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- `/docs/PRD.md` (J2 마지막 "게스트도 확정할 수 있다", J3, 핵심 기능 7)
- `/docs/ADR.md` (**ADR-014 게스트**)
- `/docs/UI_GUIDE.md` (기간 작업의 "게스트 확정", 반복 사용 컴포넌트의 "대화상자")
- `/lib/store.ts`, `/lib/store.test.ts` (`PendingAfterLogin`, `pendingAfterLogin`, `requireLogin`, `signedIn`, persist `merge`)
- `/components/Account.tsx` (`LoginRequiredDialog`, `useNeedsLogin`), `/components/ScheduleStep.tsx`, `/components/WardHome.tsx`, `/components/StartScreen.tsx`

## 배경

지금은 게스트가 [확정]이나 [다음 기간 만들기]를 누르면 로그인 대화상자가 뜨고, 로그인하지 않으면 CSV만 받을 수 있다. 그래서 샘플 체험이 ③ 근무표에서 끝나고 기간 연속성 기능을 하나도 볼 수 없었다(2026-10-29 UX 점검).
결정(ADR-014 개정): **게스트도 확정·다음 기간·운영 중 변경을 모두 할 수 있다. 로그인은 요구하지 않고 권한다.** 이 step은 로그인 요구 장치를 store와 화면에서 걷어 낸다. 확정 직후 저장 안내 배너는 step 5에서 만든다.

## 작업

**`lib/store.test.ts`를 먼저 고친다(TDD).**

### 1. store (`lib/store.ts`)
- `PendingAfterLogin` 타입, `pendingAfterLogin` 상태, `requireLogin` 액션을 없앤다.
- `signedIn`에서 "업로드 뒤 pendingAfterLogin 실행" 분기를 없앤다. 나머지 로그인 분기(서버 우선 + 안내, 샘플 선택, 게스트 업로드, 빈 병동)는 그대로 둔다.
- `confirm`, `createPeriod` 등은 이미 게스트에서도 동작한다. 로그인 여부로 막는 코드가 있으면 없앤다.
- **`STORAGE_VERSION`을 올리지 마라.** 서버 문서와 localStorage에 남은 `pendingAfterLogin` 필드는 읽을 때 무시한다(`isData`와 `merge`가 옛 필드를 허용하도록). 이유: 버전을 올리면 로그인 사용자의 서버 문서가 "손상"으로 처리되어 빈 상태가 된다.
- 테스트
  - 게스트(auth null)가 `confirm` → 상태 confirmed, 버전 1개, remote 호출 없음
  - 게스트가 확정 기간 뒤에 `createPeriod` → 다음 기간 생성, 이월 계산 가능
  - `pendingAfterLogin`이 들어 있는 옛 persisted 데이터와 서버 문서를 읽어도 resetNotice 없이 불러온다
  - 기존 로그인 분기 테스트에서 pendingAfterLogin 관련 기대를 정리한다

### 2. 화면 (최소 변경)
- `Account.tsx`의 `LoginRequiredDialog`와 그 사용처(`ScheduleStep.tsx`의 확정, `WardHome.tsx`의 다음 기간 만들기)를 없앤다. 버튼은 게스트에서도 바로 동작한다.
- `useNeedsLogin`이 더 쓰이지 않으면 없앤다. `StartScreen.tsx`가 쓰는 부분은 동작을 유지하는 선에서 정리한다(시작 화면 재구성은 step 6).
- 대화상자 문구, 배너, 레이아웃은 이 step에서 새로 만들지 않는다.

## Acceptance Criteria

```bash
npx vitest run lib/store.test.ts
! grep -rn "requireLogin\|pendingAfterLogin\|LoginRequiredDialog" lib components app --include='*.ts' --include='*.tsx' | grep -v "\.test\.ts"
npm run test
npm run build && npm run lint
```

## 검증 절차

1. 위 AC 커맨드를 실행한다. (테스트 파일에는 옛 필드 호환 테스트를 위해 `pendingAfterLogin` 문자열이 남아도 된다.)
2. 아키텍처 체크리스트를 확인한다:
   - `STORAGE_VERSION`이 그대로인가?
   - 게스트 모드에서 remote를 부르지 않는가?
   - 서버 우선 규칙(로그인 시 서버 병동이 있으면 서버 문서로 교체 + 안내)이 그대로인가?
3. 결과에 따라 `phases/3-ux/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- `STORAGE_VERSION`을 올리지 마라. 이유: 로그인 사용자의 서버 문서가 버려진다.
- 로그인 흐름(signedIn 분기, 자동 저장, 로그아웃, 데이터 삭제)을 바꾸지 마라. 이유: 이번 결정은 "로그인 요구"만 없앤다.
- 확정 후 저장 안내 배너나 화면 문구를 만들지 마라. 이유: step 5·6의 범위다.
- 기존 테스트를 깨뜨리지 마라.
