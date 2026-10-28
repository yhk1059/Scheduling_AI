# Step 12: store-sync

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- `/docs/PRD.md` (J0, J2의 "확정 시점이 곧 저장 시점", J6, J7, J8, 핵심 기능 7)
- `/docs/ADR.md` (ADR-014)
- `/docs/ARCHITECTURE.md` ("상태 관리"의 저장 모드, 데이터 흐름의 "저장")
- `/lib/store.ts`, `/lib/store.test.ts` (step 3, 8)
- `/lib/supabase.ts` (step 11: `AuthUser`, `loadWard`, `saveWard`, `deleteWard`)

## 배경

ARCHITECTURE "상태 관리": 게스트는 Zustand + persist(localStorage), 로그인하면 같은 상태를 `wards.data` 문서 하나로 저장한다. 마지막 저장이 이기고 `updated_at`을 보여 준다. 로그아웃하면 localStorage를 비운다. **별도 저장소 추상화 계층은 두지 않고 store 안에서 모드에 따라 분기한다.**
테스트할 수 있도록 원격 저장소는 인터페이스로 주입한다. 실제 연결(`lib/supabase.ts` 사용)은 store 기본 인스턴스에서만 한다.

## 작업

**`lib/store.test.ts`에 가짜 remote로 테스트를 먼저 추가한다**(TDD, 타이머는 vitest fake timers).

### 1. 주입 인터페이스
```ts
export interface WardRemote {
  load(): Promise<{ data: unknown; updatedAt: string } | null>;
  save(userId: string, data: unknown): Promise<{ updatedAt: string }>;
  remove(): Promise<void>;
}
export function createAppStore(getStorage: () => Storage, now?: () => Date, remote?: WardRemote): ...;
```
- 기본 인스턴스 `useAppStore`는 `supabaseConfigured`일 때 `lib/supabase.ts`로 만든 remote를 넘긴다.
- 서버에 저장하는 문서는 persist가 저장하는 것과 같은 `{ version: STORAGE_VERSION, state: Data }`다. 화면 상태(`view`)도 포함해도 된다.

### 2. 상태 (persist 대상 아님)
```ts
auth: { userId: string; email: string | null } | null;
sync: { status: "guest" | "loading" | "saving" | "saved" | "error"; savedAt: string | null };
loginPrompt: null | { kind: "sample-choice" } | { kind: "server-replaced-guest" };  // 화면이 대화상자로 보여 줄 것
```
- `pendingAfterLogin: { action: "confirm" | "create-period"; periodId?: string } | null`은 **persist 대상**이다(OAuth 리디렉트로 페이지가 다시 로드되므로).

### 3. 액션
- `requireLogin(action)`: 게스트가 [확정]이나 [다음 기간 만들기]를 누르면 화면이 이걸 부르고 로그인 대화상자를 띄운다. `pendingAfterLogin`에 저장한다.
- `signedIn(user)`: 로그인 직후(세션 복원 포함) 한 번.
  1. `remote.load()`
  2. 서버에 병동이 있으면 → 서버 문서로 상태를 바꾼다(**서버 우선**). 이때 게스트 입력이 있었으면 `loginPrompt = server-replaced-guest`(안내만, 되돌리기 없음). `pendingAfterLogin`은 버린다(게스트 기간이 서버 문서에 없으므로).
  3. 서버에 없고 게스트 병동이 샘플(`ward.isSample`)이면 → `loginPrompt = sample-choice`. 사용자가 `chooseSample(keep: boolean)`을 부르면 keep이면 업로드, 아니면 빈 병동으로 바꾼 뒤 업로드.
  4. 서버에 없고 게스트 입력이 있으면 → 게스트 상태를 그대로 업로드한다(`isSample: false`).
  5. 둘 다 없으면 → 빈 병동을 업로드하고 병동 설정으로 간다.
  6. 업로드가 끝나고 `pendingAfterLogin`이 남아 있으면 그 동작(confirm 또는 createPeriod)을 실행하고 비운다.
  - 서버 문서가 버전이 다르거나 손상됐으면 빈 상태로 시작하고 `resetNotice`를 띄운다(ARCHITECTURE 규칙과 같게). 단, 사용자가 무언가 바꾸기 전에는 서버에 저장하지 않는다(덮어쓰기 방지).
- **자동 저장**: 로그인 상태에서 persist 대상 데이터가 바뀌면 디바운스(상수 `SAVE_DEBOUNCE_MS = 1000`) 후 `remote.save`. 진행 중이면 `saving`, 성공하면 `saved` + `savedAt = updatedAt`. 실패하면 `error`이고 localStorage에는 계속 남는다(PRD J8). 저장 중에 또 바뀌면 끝난 뒤 한 번 더 저장한다.
- `retrySave()`: 즉시 저장 재시도
- `signedOut()`: 상태를 초기화하고 **localStorage의 store 키를 지운다**(PRD J6 공용 PC). `auth = null`, `sync.status = "guest"`.
- `deleteWardData()`: `remote.remove()` → 성공하면 빈 상태로 초기화(로그인은 유지), 시작 화면 대신 병동 설정으로. 실패하면 오류를 throw해 화면이 문구를 보이게 한다.
- 게스트(`auth = null`)일 때는 `remote`를 절대 부르지 않는다.

### 테스트가 최소한 다룰 것
- 로그인 분기 5가지(서버 있음+게스트 있음, 서버 있음+게스트 없음, 샘플 선택 keep/버림, 게스트 업로드, 둘 다 없음)
- `pendingAfterLogin`이 persist되고, 업로드 뒤 확정이 기록됨 / 서버 우선이면 버려짐
- 디바운스 저장, 저장 중 변경 시 재저장, 실패 시 `error`와 `retrySave`
- 로그아웃 시 localStorage 키 삭제, 데이터 삭제 후 빈 상태
- 게스트 모드에서 remote 미호출
- 손상된 서버 문서 → 빈 상태 + 사용자가 바꾸기 전에는 저장 안 함

## Acceptance Criteria

```bash
npx vitest run lib/store.test.ts
npm run test
npm run build && npm run lint
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - 저장소 추상화 계층(별도 repository 모듈 등)을 만들지 않고 store 안에서 분기했는가?
   - 백엔드 계산 요청은 여전히 store 상태로 만들고, 백엔드가 DB를 모르는가?
   - store 테스트가 실제 네트워크나 Supabase를 부르지 않는가?
3. 결과에 따라 `phases/2-periods/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 게스트 데이터와 서버 데이터를 필드 단위로 병합하지 마라. 이유: 서버 우선으로 결정했다. 병합은 기간·버전이 섞여 데이터 무결성을 해친다(PRD "기간 분리").
- 실시간 구독(realtime), 다중 기기 동기화를 넣지 마라. 이유: PRD MVP 제외 사항. 마지막 저장이 이긴다.
- 로그아웃 시 서버 데이터를 지우지 마라. 이유: 로그아웃은 이 브라우저의 데이터만 지운다(PRD J6).
- 화면(대화상자, 계정 메뉴)을 만들지 마라. 이유: step 13의 범위다. 이 step은 상태와 액션만 만든다.
- 기존 테스트를 깨뜨리지 마라.
