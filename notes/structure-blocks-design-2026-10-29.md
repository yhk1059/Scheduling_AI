# 구조 설정 + 범용 제약 블록 설계 (2026-10-29, 승인)

지금 제품이 코드에 박아 둔 구조 전제를 병동이 정하는 설정으로 열고, 템플릿 12개를 조합할 수 있는 범용 블록 3종으로 바꾸는 계획이다.
**기본값은 지금 동작과 같다.** 기존 병동은 변환 후 같은 근무표가 나와야 한다.
2026-10-29 사용자가 계획 전체(☆ 기본값 포함)를 승인했다. 0단계로 ADR-018을 `docs/ADR.md`에 넣고 PRD·ARCHITECTURE·UI_GUIDE를 고쳤다. 맨 끝의 초안은 그 원본이다.

★ = 2026-10-29 사용자와 합의한 결정. ☆ = 이 문서가 제안한 기본값(계획 승인 때 함께 승인, 구현 중 숫자 조정 가능).

## 0. 합의한 결정

| # | 질문 | 결정 |
|---|---|---|
| ★1 | 템플릿과 블록의 관계 | **블록 하나로 통일.** 저장·솔버·LLM 출력 모두 블록 3종(세기·순서·고르게)만 쓴다. 템플릿 이름은 카드 제목용 프리셋으로만 남는다. 칸 고정만 별도 타입으로 둔다 |
| ★2 | 하루 두 근무(더블) | **복합 코드.** `DE` 같은 코드 하나가 "세는 근무조"(D, E)와 시간을 가진다. 칸마다 코드 하나라는 전제는 유지 |
| ★3 | 구조 설정을 말로 바꾸기 | **말 + 설정 화면 둘 다.** 병동 규칙 입력에서 LLM이 "설정 변경 카드"를 제안하고, 사람이 [적용]해야 반영 |
| ★4 | 가중치 | **중요도 3단계**(높음·보통·낮음). "가능하면" 규칙에만 있다 |
| ★5 | 명단 태그 | **도입.** 나이트 전담도 태그 + 블록 규칙으로 바꾸고 솔버 특수 처리를 없앤다 |
| ★6 | 시작일 | **첫 근무표는 아무 날이나, 이후는 연속.** 다음 근무표 시작일은 뒤로 미루는 것만 허용 |
| ★7 | 저장된 병동 | **자동 변환.** v4 → v5 순수 함수로 localStorage와 Supabase 문서를 모두 옮긴다 |
| ★8 | 나이트 다음 k일 휴무 | 순서 블록의 **전용 필드** `after` + `then_off`. 금지 패턴 조립을 쓰지 않는다 |
| ★9 | eval 목표 | 기존 44건 ≥ 95%, 새 케이스 ≥ 85%(완전 일치). 못 미치면 3단계에서 멈추고 보강 |
| ★10 | 처음 설정의 근무 형태 | ② 필요 인원 위에 **접힌 요약** 한 줄 + [바꾸기]. 단계는 늘리지 않는다 |
| ★11 | 달력 월 단위 시작일 | 1~28일만 |
| ★12 | 변환 전 확정본의 통계 | 형식을 바꾸지 않고, 화면에서 **배정으로 다시 센다** |
| ★13 | 구현 브랜치 | 1~6단계를 **기능 브랜치 하나**에 쌓고 끝난 뒤 main에 합친다 |

## 1. 지금 박혀 있는 전제와 여는 방법

| 전제 | 지금 위치 | 바뀐 뒤 |
|---|---|---|
| 근무 코드 D/E/N/O | `ShiftCode` Literal, `model.SHIFTS`, `NurseStats.D/E/N/O`, TS `Code` | 병동 구조 `shifts[]`. 기본값 D/E/N/O |
| 하루 정확히 한 근무 | `model.py:66` `add_exactly_one` | 그대로 둔다. 더블은 복합 코드로 표현(★2) |
| 근무 시간 없음 | — | 코드마다 `hours`. 세기 블록이 시간 합을 셀 수 있다 |
| 평일/주말 두 구분 | `DailyCoverageParams.day_kind`, `stats.is_weekend` | 날짜 고르기(종류·요일·특정일). 주말(토·일·공휴일) 정의는 프리셋으로 남는다 |
| 가중치 상수 | `DEFAULT_WEIGHT`, `DEFAULT_SOFT_WEIGHTS` | 규칙마다 중요도 3단계. 숫자는 상수 표 |
| 나이트 전담 특수 처리 | `Nurse.night_only`, `model.py:68`, 나이트 공정성 제외 | 태그 `나이트전담` + 기본 규칙 카드 2개 |
| 기간 시작일 자동(월요일·1일) | `lib/period.ts firstPeriodStart` | 첫 근무표는 날짜 선택. 이후 연속, 미루기만 |
| 누적 부담은 나이트·주말 두 숫자 | `HistoryLoad{nights, weekends}` | 지난 28일 배정 원본을 보내고, 백엔드가 고르게 블록마다 센다 |

## 2. 데이터 형식

### 2.1 병동 구조 `WardConfig`

```python
class ShiftDef(_Strict):
    code: str            # 1~3자, 영문 대문자·숫자. "O"는 예약(휴무)
    name: str            # "데이", "미드", "더블"
    hours: float         # 0 < hours ≤ 24, 0.5 단위. 휴무는 0
    parts: list[str] = []  # 복합 코드면 세는 근무조(기본 코드). 예: DE → ["D", "E"]
    start: str | None = None  # "07:00" 표시용(계산에 쓰지 않음)
    active: bool = True  # 한 번이라도 쓰인 코드는 지우지 않고 끈다(새 배정에서만 빠짐)

class WardConfig(_Strict):
    shifts: list[ShiftDef]   # 기본: D 데이 8h, E 이브닝 8h, N 나이트 8h, O 휴무 0h
```
- 검증: 코드 중복 금지, `O` 필수·변경 불가, `parts`는 복합이 아닌 활성 근무 코드만, 코드 수 ≤ `MAX_SHIFT_CODES`(☆8).
- **세는 근무조** `covers(code) = {code} ∪ parts`. "데이 3명"은 D와 DE를 모두 세고, "DE 월 2회"는 DE만 센다.
- 하루 최대 근무 수와 허용 조합은 따로 두지 않는다. 정의한 복합 코드가 곧 허용 조합이다(기본: 복합 코드 없음 = 하루 1근무).
- 근무 시간은 시작한 날에 붙는다(N 23–07은 시작한 날의 8시간).
- `ScheduleRequest`, `TranslateContext`에 `config: WardConfig`가 들어간다. `ShiftCode` Literal은 `str`이 되고, 코드 참조는 모두 `config`로 참조 무결성 검사를 한다.

### 2.2 명단 `Nurse`

```python
class Nurse(_Strict):
    id: str
    name: str
    years: int
    tags: list[str] = []   # 태그마다 1~10자, 한 사람 ≤ 5개. 예: "책임", "신규", "나이트전담"
```
- `night_only`는 없어진다. 변환 때 `night_only=true`면 `tags`에 `"나이트전담"`을 넣는다.
- 태그는 가명 치환 대상이 아니다. 화면에서 "태그에 이름을 쓰지 마세요"를 안내한다.

### 2.3 고르기 문법(셀렉터)

```python
class People(_Strict):        # 모든 조건 AND. 비어 있으면 모든 사람
    ids: list[str] | None = None        # 명단에서 직접
    tags: list[str] | None = None       # 이 태그 중 하나라도
    exclude_tags: list[str] = []
    min_years: int | None = None
    max_years: int | None = None

class Days(_Strict):          # 모든 조건 AND. 비어 있으면 기간 전체
    kind: Literal["all", "weekday", "weekend", "holiday"] = "all"
        # weekend = 토·일 ∪ 공휴일, weekday = 그 나머지, holiday = 체크한 공휴일만
    weekdays: list[int] | None = None   # 0=월 … 6=일
    days: list[int] | None = None       # 기간 안 날짜 인덱스(1..length)

class Shifts(_Strict):        # 둘 중 하나만
    in_: list[str] | None = Field(None, alias="in")
    not_in: list[str] | None = None     # 예: not_in ["O"] = 모든 근무
```
- 칸 (사람, 날)이 `Shifts`에 맞는다 = 그 칸 코드의 `covers`가 `in`과 겹친다(또는 `not_in`과 겹치지 않는다).
- `not_in`을 두는 이유: "나이트 다음 날은 휴무"를 `[N] → not_in [N, O]`로 저장하면 나중에 M을 추가해도 규칙이 M을 막는다. `in [D, E]`로 저장하면 M이 빠져나간다.

### 2.4 블록 3종 + 칸 고정

모든 블록이 공유하는 필드(`_ConstraintBase`에서 `weight`만 바뀜):
```python
id, scope, hardness: "hard" | "soft", priority: "high" | "normal" | "low" = "normal",
source_text, enabled
```

**세기 `count`** — 대상 × 날짜 × 근무를 묶음마다 세어 범위를 건다.
```python
class CountParams(_Strict):
    people: People = People()
    days: Days = Days()
    shifts: Shifts
    per: Literal["day", "person", "person_week", "person_window"]
    window: int | None = None    # per=person_window일 때 연속 며칠(2..14 ☆)
    measure: Literal["count", "hours"] = "count"
    min: float | None = None
    max: float | None = None     # 둘 중 하나 이상. 같으면 "정확히"
```
| per | 묶음 | 예 |
|---|---|---|
| `day` | 날마다, 대상 사람들의 합 | 필요 인원, 연차별 배치, "책임 1명 이상" |
| `person` | 사람마다, 기간 안 대상 날짜의 합 | 최소 휴무, 휴가, 고정 희망, "DE 기간에 2번까지" |
| `person_week` | 사람마다, 달력 주(월~일)마다 | "주 52시간", "주에 휴무 2일" |
| `person_window` | 사람마다, 연속 `window`일마다 | "7일 중 휴무 1일 이상" |

- `person_week`/`person_window`는 기간 첫 주에 이월 칸(상수)을 포함하고, 기간 끝의 잘린 주는 기간 안 날짜만 센다.

**순서 `sequence`** — 사람마다 날짜 순서 패턴.
```python
class SequenceParams(_Strict):
    people: People = People()
    forbid: list[list[Shifts]] | None = None  # 금지 패턴 목록(패턴마다 2~4칸, ≤ 4개). 하나라도 나오면 위반
    run: Shifts | None = None             # 이 근무가 이어지는 구간의 길이
    min_len: int | None = None            # run 블록 최소 길이(기간 끝에 걸린 구간은 제외)
    max_len: int | None = None            # run 블록 최대 길이
    after: Shifts | None = None           # 이 근무가 이어지던 구간이 끝나면
    then_off: int | None = None           # 그 뒤 며칠은 휴무(O)
```
- `forbid`, `run`, `after`(+`then_off`) 중 하나만.
- `after`는 "나이트가 끝나면 2일 휴무"를 패턴 조립 없이 한 필드로 받기 위한 모양이다(★8). k 제한이 없고 카드 문장도 바로 나온다.

**고르게 `balance`** — 사람 사이 차이를 줄인다.
```python
class BalanceParams(_Strict):
    people: People = People()
    days: Days = Days()
    shifts: Shifts
    measure: Literal["count", "hours"] = "count"
    with_history: bool = True   # 최근 28일 근무를 더해서 센다
    max_gap: int = 1            # hard일 때만: (최대 − 최소) ≤ max_gap
```
- soft는 (최대 − 최소) × 가중치(지금과 같음). soft 위반 목록에는 차이가 `FAIRNESS_TOLERANCE`를 넘을 때만 나온다(지금과 같음).

**칸 고정 `fixed`** — 칸 수정과 지난 날짜 잠금. 규칙이 아니라 데이터라서 블록으로 만들지 않는다. 항상 hard. 형식은 지금 `fixed_assignment`와 같고 `shift`만 `str`이 된다.

```
ConstraintSpec = count | sequence | balance | fixed   (type 판별)
```

### 2.5 템플릿 12종 → 블록 변환표

변환은 저장 이전(§9)과 eval 기대값 재작성(§7)에 같은 표를 쓴다.

| 템플릿 | 블록 |
|---|---|
| 1 daily_coverage {shift, day_kind, min, max} | count{days.kind=day_kind, shifts.in=[shift], per=day, min, max} |
| 2 forbidden_sequence {first, second} | sequence{forbid=[[in [first], in [second]]]} |
| 3 max_consecutive_work {days} | sequence{run=not_in [O], max_len=days} |
| 4 max_consecutive_nights {days} | sequence{run=in [N], max_len=days} |
| 5 min_days_off {days} | count{shifts.in=[O], per=person, min=days} |
| 6 off_after_night_block {days} | sequence{after=in [N], then_off=days} |
| 7 skill_mix {shift, min_years, min_count} | count{people.min_years, shifts.in=[shift], per=day, min=min_count} |
| 8 leave {nurse_id, days} | count{people.ids=[id], days.days, shifts.not_in=[O], per=person, max=0}, hard |
| 9 fixed_assignment | fixed (그대로) |
| 10 shift_preference {nurse_id, shift, prefer, days?, weekends_only} | count{people.ids=[id], days(weekends_only→kind weekend), shifts.in=[shift], per=person, prefer→min=대상 날짜 수 / 기피→max=0}, soft |
| 11 night_fairness | balance{people.exclude_tags=["나이트전담"], shifts.in=[N]}, soft·낮음 |
| 12 weekend_fairness | balance{days.kind=weekend, shifts.not_in=[O]}, soft·낮음 |
| (솔버 내장) 나이트 전담 | count{people.tags=["나이트전담"], shifts.not_in=[N, O], per=person, max=0}, hard — 새 기본 규칙 |

- 10번: 희망 "min=대상 날짜 수" soft의 페널티는 못 맞춘 날 수와 같아서 지금 목적함수와 같다. 기피 "max=0"도 같다.
- 결과 `Summary.preferences_*`는 "한 사람(`people.ids` 1명)·기간 범위(scope period)·soft 세기 블록"을 희망·기피로 세어 지금 숫자를 유지한다.

### 2.6 중요도 → 가중치(★4)

| 중요도 | 가중치 | 지금 기본값과의 대응 |
|---|---|---|
| 높음 | ☆30 | (새로 생김) |
| 보통 | 10 | `DEFAULT_WEIGHT`, 희망·기피, soft로 바꾼 템플릿 1~7, 필요 인원 |
| 낮음 | 5 | 나이트·주말 고르게 |

- 기본값을 이렇게 잡으면 변환한 병동의 목적함수가 지금과 같다.
- hard 블록에는 중요도가 없다(카드에서 숨긴다).
- `measure=hours`의 위반량 단위는 1시간이다. 8시간 근무 하나 초과 = 8단위라서 같은 중요도의 인원 1명 부족(1단위)보다 무겁다. ☆ 시간 기준 블록은 위반량을 `기본 근무 시간(8)`으로 나눠 "근무 하나 분량"에 맞춘다. 숫자는 `constants.py`.
- 재스케줄 변경 페널티 `DIFF_WEIGHT=20`은 그대로 상수다.

### 2.7 요청·결과 형식 변경

| 위치 | 지금 | 바뀐 뒤 |
|---|---|---|
| `ScheduleRequest` | — | `config: WardConfig` 추가 |
| `history_load` | `[{nurse_id, nights, weekends}]` | `history: {start_date, rows: {nurse_id: [code…]}, holidays: [date…]} \| None` (최근 28일 원본) |
| `carry_over`, `previous`, `assignments` | `ShiftCode` | `str`, `config` 코드로 검증 |
| `NurseStats` | `D, E, N, O` 필드 | `counts: {code: int}`, `hours: float` 추가. 나머지 그대로 |
| `SoftViolation.detail` | 템플릿별 문구 | 블록별 일반 문구: "{묶음} {값} (기준 {범위})", 코드 이름은 config에서 |
| `TranslateOk` | `constraints` | `constraints` + `config_changes: list[ShiftChange]`(§5.3) |
| `ConstraintChange.params` | 템플릿 params 일부 | 블록 params의 **최상위 키 단위** 교체(셀렉터는 통째로 바꾼다) |

- `history`를 원본으로 바꾸는 이유: 고르게 블록이 임의 셀렉터를 가지므로 클라이언트가 블록마다 미리 세려면 셀렉터 평가를 TS에도 구현해야 한다. 원본을 보내면 평가는 백엔드 한 곳(Python, TDD)에만 있다. 40명 × 28칸이라 크기는 문제없다.
- 입력 상한 추가(☆): 코드 8개, 태그 사람당 5개, forbid 패턴 4칸, window 14일. 넘으면 413/422.

## 3. 솔버 변경

- `build_model`
  - 변수 `x[n, d, c]`의 `c`가 `config.shifts`의 활성 코드가 된다(비활성 코드는 변수를 만들지 않음, 이월·이력에서만 쓰임).
  - `add_exactly_one`은 그대로. 나이트 전담 특수 처리는 지운다(기본 규칙 블록이 대신함).
  - `match(n, d, Shifts)` = 맞는 코드들의 `x` 합(정확히 하나 제약 때문에 0/1). 이월 칸이면 상수.
- `hard.py` / `soft.py`는 템플릿별 함수 12개 대신 블록 3종의 함수를 둔다. hard는 지금처럼 리터럴 + `OnlyEnforceIf`, soft는 같은 식의 위반량 × 가중치.
  - count: 묶음마다 `Σ match`(또는 `Σ match × 분`)에 `add_linear_constraint(min, max)`. soft는 기존 `_shortfall`.
  - sequence.forbid: 패턴·창마다 `Σ_i match(d+i, step_i) ≤ len−1`. sequence.after: 지금 `off_after_night_block_clauses`를 `after` 셀렉터로 일반화한 같은 절(d가 after이고 d+1이 after가 아니면 d+1..d+then_off는 O). run.max_len: 지금 `_max_run`과 같은 식. run.min_len: 길이 L < min_len인 구간 `[¬S][S×L][¬S]`를 금지(기간 끝에 닿는 구간은 제외, 이월로 시작이 보이면 이월 포함).
  - balance: 지금 `_spread` 그대로, 개수에 `history` 원본을 같은 셀렉터로 센 상수를 더한다.
- `stats.py`: `TOGGLEABLE`이 없어진다(fixed 말고는 모두 hard/soft 전환 가능). 위반 계산은 솔버와 같은 셀렉터 평가 함수를 쓴다(`backend/solver/select.py` 새 모듈 하나, 순수 함수).
- `conflicts.py`: 변화 없음. 나이트 전담이 규칙이 되었으므로 이제 unsat core에 나올 수 있다(설명이 좋아진다).
- 시간 예산 10초는 유지. 변수 수는 최대 40 × 31 × 8 = 9,920개.

## 4. 해 없음 설명

- 충돌 단위는 지금처럼 제약 id다. explain 입력의 conflicts에 블록 params와 `source_text`를 그대로 넣고, 프롬프트에 블록·셀렉터 설명과 `config`(코드 이름·시간)를 더한다.
- 제안의 `update`는 params 최상위 키 교체만 허용한다(`min`, `max`, `max_len`, `days`, `people` 등). 바뀐 블록은 지금처럼 Pydantic + 참조 무결성 검사 후 재풀이로 검증한다.
- 프롬프트 규칙: "한 사람의 근무를 막는 기간 요청(휴가)은 마지막 수단", "고정 칸이 충돌하면 해제 제안", "나이트전담 규칙을 끄자는 제안은 하지 않는다"(☆).
- 대체 경로(설명 실패)는 그대로 `source_text` 나열. 변환으로 생긴 기본 규칙에도 `source_text`를 채운다(예: "나이트 전담은 나이트와 휴무만").

## 5. LLM 출력과 검증

### 5.1 translate 출력
```python
class TranslatorOutput(_Strict):
    constraints: list[BlockDraft] = []        # count | sequence | balance (fixed는 LLM이 만들지 않음)
    config_changes: list[ShiftChange] = []   # §5.3
    clarification_question: str | None = None
    unsupported_reason: str | None = None
```
- `BlockDraft` = 블록에서 `id, scope, enabled`를 뺀 것. `hardness`, `priority`는 생략 가능(기본: count/sequence는 hard, balance는 soft·낮음, 희망·기피 표현은 soft).
- 컨텍스트에 추가: `config.shifts`(코드, 이름, 시간, parts), 명단의 `tags`, 병동에 있는 태그 목록.

### 5.2 검증(서버, 재시도 ≤ 2)
1. Pydantic(형식, min ≤ max, forbid/run/after 중 하나, per=person_window면 window 필수 등).
2. 참조 무결성: 간호사 id, 태그(병동에 있는 태그만), 코드(`config` ∪ 같은 응답의 `config_changes`), 날짜 범위.
3. **빈 대상 검사**: 셀렉터가 이번 기간·명단에서 사람 0명 또는 날 0일을 고르면 `clarify`("신규 태그를 가진 사람이 없어요. 누구를 말씀하시는 건가요?").
4. **명백한 모순 검사**(☆ 싼 것만): count per=day의 min이 대상 인원 수보다 크면 clarify.
- 결과는 지금처럼 제안 카드다. [적용] 전에는 근무표에 들어가지 않는다(ADR-004 그대로).

### 5.3 설정 변경 카드(★3)
```python
class ShiftChange(_Strict):
    action: Literal["add", "update"]
    shift: ShiftDef
```
- 예: "미드 근무 M 11시~19시 추가" → `add M 미드 8h`. "D+E 더블 허용, 사람마다 월 2회까지" → `add DE 더블 16h parts [D,E]` + 블록 `count{shifts.in=[DE], per=person, max=2}`.
- 같은 응답 안에서 블록이 새 코드를 참조하면 그 블록 카드는 설정 카드에 **딸린 카드**가 된다. 블록 카드의 [적용]은 설정 카드도 함께 적용하고("근무 코드 DE 추가가 함께 적용돼요"), 설정 카드를 삭제하면 딸린 카드도 지운다.
- 코드 삭제는 LLM이 하지 않는다(설정 화면에서만, §8).
- 시작일과 중요도는 설정 카드로 다루지 않는다. 시작일은 근무표 화면에서, 중요도는 규칙 카드에서 바꾼다. 말 속의 "제일 중요", "웬만하면" 같은 표현은 그 규칙의 `priority`로 나온다.

## 6. 카드 표현(블록 → 사람이 읽는 문장)

`lib/wording.ts`에 `describeBlock(block, config, nurses, period)`와 `presetName(block)`을 두고 TDD로 만든다. 카드 = 제목(프리셋 이름 또는 블록 종류) · 문장 한 줄 · 원문 · 반드시/가능하면 · 중요도(가능하면일 때) · 버튼.

문장 틀: **[사람] [날짜·묶음] [근무] [수·범위]**

| 블록 | 문장 예 | 제목(프리셋) |
|---|---|---|
| count day | "평일마다 데이 3명" / "주말·공휴일마다 3년차 이상 나이트 1명 이상" / "매일 책임 태그 데이 1명 이상" | 필요 인원 / 연차별 배치 / 태그별 배치 |
| count person | "모든 사람 근무표마다 휴무 8일 이상" / "김OO 11/15~11/17 근무 없음" / "모든 사람 더블(DE) 근무표마다 2번까지" | 최소 휴무 / 휴가 / 근무 횟수 |
| count person_week | "모든 사람 주마다 근무 시간 52시간 이하" | 근무 시간 |
| count person_window | "모든 사람 7일마다 휴무 1일 이상" | 휴무 간격 |
| count soft 1인 | "이OO 주말·공휴일 데이 희망" / "박OO 나이트 기피" | 희망·기피 |
| sequence forbid | "나이트 다음 날 데이·이브닝 금지" | 금지 순서 |
| sequence after | "나이트가 끝나면 2일 휴무" | 나이트 다음 휴무 |
| sequence run | "근무 5일 연속까지" / "나이트는 2~3일씩 이어서" | 최대 연속 근무 / 나이트 블록 길이 |
| balance | "나이트전담 빼고 나이트 수를 고르게(최근 4주 포함)" | 나이트 고르게 / 주말·공휴일 고르게 / 고르게 |

- 사람: 비어 있으면 "모든 사람", ids는 이름(3명 넘으면 "김OO 외 2명"), 태그는 "책임 태그", 연차는 "3년차 이상".
- 날짜: kind + 요일 + 특정일을 "평일 중 월·수", "11/15~11/17" 식으로 이어 붙인다. 특정일은 지금 `formatDays` 그대로.
- 근무: `in`은 이름을 "·"로, `not_in [O]`는 "근무", `not_in [N, O]`는 "나이트 말고 다른 근무".
- 프리셋에 안 맞으면 제목은 "세는 규칙 / 순서 규칙 / 고르게 규칙"이고 문장은 같은 틀로 만든다.
- 테스트: 변환표의 13가지 모양과 새 예시 10개 이상을 문장 스냅숏으로 고정한다.

## 7. eval

- **비교를 의미 기준으로 바꾼다.** 같은 규칙도 블록으로는 여러 모양이 가능하다(예: 휴가를 per=person max 0 또는 per=day). 그래서 `eval/run.py`의 `_key` 문자열 비교 대신:
  - eval 병동·기간에서 고정 시드로 무작위 근무표 K개(☆50)를 만들고, 기대 블록과 실제 블록의 **칸별 위반 여부 벡터**가 K개 모두에서 같으면 일치로 본다(`stats`의 위반 계산 함수를 그대로 쓴다). hardness·priority는 따로 비교한다.
  - 이 판정기는 `backend/tests/test_eval_runner.py`에 같은 규칙의 다른 모양 쌍으로 TDD한다.
- **기존 44건**: 기대값을 §2.5 변환표로 기계 변환한다(손으로 다시 쓰지 않음). 목표 ★ 완전 일치 ≥ 95%(지금 100%).
- **새 케이스 ☆25건 이상**: M 추가 설정 카드, 더블 + 월 2회, 주 52시간, 태그(책임·신규) 배치, 요일(토요일만), 7일 중 휴무, 나이트 블록 최소 길이, 중요도 표현, 빈 대상 clarify, 없는 태그 clarify, 불가능한 구조(하루 세 근무) unsupported. 목표 ★ 완전 일치 ≥ 85%, 스키마 유효율 100%.
- 목표에 못 미치면 3단계에서 멈추고 프롬프트를 보강한다. 4단계로 넘어가지 않는다.
- eval 실패가 목표 아래면 프롬프트의 예시(변환표의 모양별 few-shot)부터 보강한다.

## 8. 화면 변경

| 화면 | 변경 |
|---|---|
| 병동 설정 / 처음 설정 ① | 명단 표의 "나이트 전담" 체크박스 → **태그** 칸(칩 입력, 병동에 있는 태그 자동 완성, `나이트전담`은 추천 태그로 항상 보임) |
| 병동 설정 새 탭 **근무 형태** | 근무 코드 표: 코드 · 이름 · 시작 시각 · 시간 · 세는 근무조(복합) · [끄기]. 맨 아래 입력 줄로 추가(명단 표와 같은 방식). 쓰인 적 있는 코드는 [지우기] 대신 [끄기] |
| 처음 설정 ② 필요 인원 | ★ 표 위에 접힌 요약 한 줄 "데이·이브닝·나이트 3교대, 각 8시간 [바꾸기]"(`aria-expanded`). 펼치면 근무 형태 탭과 같은 근무 코드 표. 단계 수는 그대로이고, 미드가 있는 병동은 인원을 넣기 전에 M을 추가할 수 있다 |
| 처음 설정 ② / 병동 설정 필요 인원 | 표의 행이 활성 **기본 코드**(복합 제외)를 따른다. 열은 그대로 평일 / 주말·공휴일. 다른 날 구분은 말로("토요일 데이는 2명") |
| 규칙·요청 카드 | §6의 제목·문장. "가능하면"이면 중요도 셀렉트(높음·보통·낮음). 설정 변경 카드는 같은 목록에 "근무 형태" 배지로, 딸린 카드는 바로 아래에 들여 놓는다 |
| 근무표 표·CSV·통계 | 코드 색은 기본 4개 외 코드에 중립 색. 통계 표 열은 활성 코드 + 근무 시간 |
| 홈 / 근무표 작성 | 첫 근무표: [첫 근무표 만들기] 전에 시작일 선택(기본값 오늘 이후 첫 월요일/1일, 아무 날 가능). 다음 근무표: 준비 요약의 [바꾸기] 안에 "시작일 미루기"(직전 끝 다음 날 이후만). 미루면 이월이 끊겨 "지난 근무 없음"이 되고 수동 입력으로 돌아간다 |
| 달력 월 단위 + 1일 아닌 시작일 | 길이 = 시작일 ~ 다음 달 같은 날 전날. ★ 시작일은 1~28일만 고를 수 있다(다음 달에 같은 날이 없는 29~31일을 막는다). 근무표 이름은 "11/15~12/14 근무표" |

## 9. 저장 이전 (STORAGE_VERSION 4 → 5)

- `lib/migrate.ts`(새 순수 함수, vitest TDD) `migrateV4(doc) → v5 doc | null`.
  - `ward.config` = 기본 구조.
  - 명단 `night_only` → 태그.
  - `ward.rules`, `pendingRules`, 모든 기간의 `requests`, `pendingRequests`, `ruleOverrides`, 확정본 버전의 `requests`, `snapshot.rules`를 §2.5 표로 변환. id와 `source_text`, `enabled`, hardness는 유지. weight → 중요도(10→보통, 5→낮음, 그 밖은 가장 가까운 단계).
  - 기본 규칙 "나이트 전담은 나이트와 휴무만"(hard)을 병동 규칙에 넣는다. 나이트 전담이 없는 병동에도 넣는다(태그만 붙이면 동작하도록).
  - ★ 옛 결과(`result`, 버전의 `result`)는 형식을 바꾸지 않는다. 확정본은 `assignments`만 믿고, 통계 표(코드별 수·근무 시간·주말·공휴일 근무·최대 연속 근무·편차)는 `lib/`의 새 순수 함수 `statsFromAssignments(assignments, config, period, holidays)`로 화면에서 다시 센다(TDD). 희망 반영률과 못 지킨 규칙 목록은 변환 전 결과에서는 숨기고 "변환 전에 확정한 근무표" 한 줄을 둔다. 작성 중·운영 중 기간의 `result`는 stale로 표시해 다음 [다시 만들기] 때 새로 만든다.
  - 변환 실패(예상하지 못한 params)는 그 규칙만 꺼진 원문 카드로 남기고 "다시 입력해 주세요" 표시. 문서 전체를 버리지 않는다.
- 연결 지점: persist `migrate`(지금 `() => null`)를 `fromVersion === 4 ? migrateV4 : null`로, Supabase 불러오기의 버전 비교(`store.ts:670`)도 같은 함수를 거친다. 변환한 문서는 다음 저장 때 v5로 올라간다.
- 테스트: `e2e/fixtures/ward-oct.json`과 샘플 병동을 v4 → v5로 바꾼 뒤, 백엔드에서 변환 전 템플릿 요청과 변환 후 블록 요청이 **같은 목적값**을 내는지 확인(골든 테스트, §10 1단계에서 미리 저장).
- `lib/samples/ward-15.json`, `demo-schedule.json`도 새 형식으로 다시 만든다(`npm run gen:demo`).

## 10. 구현 순서와 완료 기준

★ API가 한 번에 바뀌어 중간 상태에서는 앱이 동작하지 않으므로, 1~6단계를 기능 브랜치 하나에 쌓고 6단계가 끝난 뒤 main에 합친다. 평소의 "main에 바로 push" 규칙의 예외다. 단계마다 harness phase 하나.

| 단계 | 내용 | 완료 기준 |
|---|---|---|
| 0 | 이 문서 승인 → ADR-018 반영, PRD(규칙·용어)·ARCHITECTURE(API 계약·패턴)·UI_GUIDE(§8) 수정 | 사용자 승인. 문서 diff만 |
| 1 | **골든 기록**: 지금 솔버로 테스트 픽스처·샘플 병동·e2e 픽스처의 목적값과 배정을 `backend/tests/golden/`에 저장 | 기록 스크립트와 파일 커밋 |
| 2 | **도메인 + 솔버**: `WardConfig`, 태그, 셀렉터, 블록 3종, `select.py`, hard/soft/stats 교체, `history` 원본. 템플릿 → 블록 변환 함수(Python, eval·테스트용) | 기존 솔버 테스트를 블록으로 옮겨 모두 통과. 골든 케이스 목적값 동일. 새 기능 테스트(M 코드, DE 더블 커버, 주 52시간, 7일 창, run.min_len, after·then_off, 태그, hard balance). `npm run test` 통과 |
| 3 | **LLM + eval**: 프롬프트·tool 스키마, 설정 변경 카드, 빈 대상·모순 검사, explain 블록화, 의미 기준 판정기, 데이터셋 변환 + 새 케이스 | 판정기 TDD 통과. eval: 기존 44건 ≥ 95%, 새 케이스 ≥ 85%, 스키마 유효 100%. `eval/results.md` 갱신 |
| 4 | **클라이언트 데이터**: `types.gen.ts`, `migrate.ts`, `describeBlock`/`presetName`, `continuity`(history 원본), `period`(시작일 선택·미루기), store 액션(설정·태그·중요도·딸린 카드) | vitest 통과. v4 픽스처 변환 후 /solve 결과가 골든과 같음 |
| 5 | **화면**: §8 전부, 샘플·데모 재생성 | `npm run build`, `npm run lint` 통과. `docs/BROWSER_TEST_SCENARIOS.md`에 시나리오 추가(M 추가, 더블, 태그, 시작일, v4 저장본 열기)하고 e2e 갱신·통과 |
| 6 | **성능 확인** | 최악 병동(40명 × 31일 × 코드 8개, 블록 60개, window·hours·min_len 포함) 벤치 스크립트가 10초 안에 해를 낸다. 넘으면 상한(코드 수, window, 블록 수)을 낮춘다 |

## 11. 위험

| 위험 | 내용 | 대응 |
|---|---|---|
| LLM 정확도 | 템플릿 선택 + 숫자 채우기에서 셀렉터 조합으로 자유도가 커진다. 특히 per(묶음)와 `in`/`not_in` 선택 | 변환표 모양별 few-shot, 의미 기준 eval, 빈 대상·모순 검사로 clarify, 카드 문장을 결정적으로 만들어 사람이 확인. 목표 미달이면 3단계에서 멈추고 보강 |
| 솔버 성능 | 코드 수 × 창 × 시간 합 × min_len 패턴이 곱으로 늘 수 있다 | 입력 상한, 6단계 벤치, 시간 초과 시 `optimal:false`(지금과 같음) |
| 카드 가독성 | 일반 블록 문장이 템플릿 문장보다 길고 어색해질 수 있다 | 프리셋 제목, 문장 틀 하나, 스냅숏 테스트, 프리셋 밖 모양은 원문을 크게 보여 준다 |
| 가중치 척도 | 개수·시간·차이의 단위가 달라 같은 중요도라도 무게가 다르다 | 시간은 기본 근무 시간으로 정규화(§2.6). 문서에 단위 명시 |
| 설명 제안 품질 | 셀렉터를 고치는 제안은 틀리기 쉽다 | 최상위 키 교체만 허용, 재풀이로 검증(지금과 같음) |
| 이전 정확성 | 저장본이 조용히 다른 규칙으로 바뀔 위험 | 골든 목적값 비교, 실패 규칙은 꺼진 카드로 노출 |
| 휴가 hard 보장 약화 | 지금은 schema가 leave를 항상 hard로 강제한다. 블록에서는 일반 count라 사용자가 soft로 바꿀 수 있다 | ☆ 휴가 프리셋 카드는 반드시/가능하면 토글을 숨긴다(화면 규칙). explain 프롬프트에서 마지막 수단 유지 |
| 범위 팽창 | 블록이 열리면 "이것도 되나요"가 늘어난다 | unsupported 유지: 하루 세 근무 이상, 사람 사이 짝 규칙(같이/따로), 근무 시각 겹침 계산은 이번 범위 밖 |

## 12. ☆ 기본값

열린 질문 6개는 ★8~★13으로 정했다. 아래 기본값은 계획 승인 때 함께 승인했고, 구현하면서 숫자만 조정할 수 있다.
- 상한: 코드 8개, 태그 사람당 5개, forbid 패턴 4칸·4개, window 2~14일
- 중요도 높음 = 30, 시간 기준 위반량은 8시간으로 나눠 정규화
- eval 새 케이스 25건 이상, 의미 판정용 무작위 근무표 50개
- 휴가 프리셋 카드는 반드시/가능하면 토글을 숨긴다
- explain은 나이트전담 규칙을 끄자는 제안을 하지 않는다
- 싼 모순 검사(인원 기준 > 대상 인원)만 translate에서 한다

---

## ADR-018 초안: 제약은 범용 블록 3종, 근무 구조는 병동 설정

> ADR-002를 대체한다. ADR-010의 "3교대 고정", "가중치는 상수로만", "나이트 전담" 항목과 ADR-015의 "주 단위는 월요일에 시작"을 고친다.

**결정**
- **병동 구조**: 근무 코드(이름, 시간, 세는 근무조)를 병동이 정한다. 기본값은 D/E/N 8시간 + O. 하루 두 근무는 복합 코드(예: DE = D와 E를 세고 16시간)로 표현하고, 칸마다 코드 하나라는 모델은 유지한다.
- **블록**: 제약은 세기(대상 × 날짜 × 근무를 묶음마다 세어 범위), 순서(금지 패턴, 연속 구간 길이, 구간이 끝난 뒤 휴무), 고르게(사람 사이 차이) 3종과 칸 고정뿐이다. 대상은 사람(명단·연차·태그), 날짜(종류·요일·특정일), 근무(코드 집합 또는 제외 집합)로 고른다. 템플릿 12개는 블록 모양의 이름(카드 제목)으로만 남는다.
- **LLM**: tool use로 블록과 설정 변경만 출력한다. 코드를 생성하지 않는다. Pydantic, 참조 무결성, 빈 대상 검사를 통과한 것만 카드로 제안하고, 사람이 [적용]해야 반영된다(ADR-004 유지). 설정 변경 카드에 딸린 규칙 카드는 함께 적용된다.
- **우선순위**: "가능하면" 규칙마다 중요도 3단계(높음·보통·낮음)를 두고 상수 가중치로 바꾼다. 기본값은 지금 가중치와 같다.
- **명단 태그**: 간호사에 자유 태그를 둔다. 나이트 전담은 태그와 기본 규칙(hard)으로 바꾸고 솔버의 특수 처리를 없앤다.
- **기간 시작일**: 첫 근무표는 아무 날에서 시작할 수 있고(달력 월 단위는 1~28일), 이후는 연속이다. 다음 근무표 시작일은 뒤로만 미룰 수 있다.
- **누적 부담**: 클라이언트는 최근 28일 배정 원본을 보내고, 백엔드가 고르게 블록의 셀렉터로 센다.
- **이전**: 저장 문서 v4는 순수 함수로 v5로 바꾼다. 템플릿은 1:1로 블록이 되고 목적값이 같아야 한다.

**이유**
- 핵심 가치는 수학을 모르는 수간호사가 말로 최적화 문제를 세우는 것이다. 템플릿 고정과 구조 전제(D/E/N/O, 하루 한 근무, 평일/주말, 고정 가중치) 때문에 실제 병동 규칙의 상당수가 말로도 표현되지 않았다.
- 블록 3종은 템플릿 12개를 모두 표현하면서 조합으로 새 규칙(미드 근무, 더블, 주 52시간, 책임 배치, 블록 길이)을 덮는다. 출력이 여전히 닫힌 스키마라 검증과 eval이 가능하다(ADR-002의 이유 유지).
- 솔버 경로가 블록 3종으로 줄어 템플릿별 hard/soft/stats 구현 36개가 9개 남짓으로 준다.
- 복합 코드는 결과·이월·CSV·표가 칸마다 코드 하나라는 전제를 깨지 않는다.

**트레이드오프**
- LLM 출력 자유도가 커져 정확도 위험이 있다. eval을 의미 기준(무작위 근무표에서 위반이 같은지)으로 바꾸고 새 케이스를 더한다.
- 카드 문장이 일반 문법으로 만들어져 템플릿 문장보다 길 수 있다.
- 휴가가 일반 세기 블록이 되어 schema 수준의 "항상 hard" 보장이 화면 규칙으로 내려간다.
- 하루 세 근무 이상, 사람 사이 짝 규칙, 근무 시각 겹침 계산은 여전히 `unsupported`다.
- 코드 수와 블록 조합에 따라 풀이 시간이 늘 수 있어 입력 상한을 더한다.
