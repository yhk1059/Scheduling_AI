# 규칙 식 언어 설계 (2026-10-30, 승인)

블록 3종(ADR-018)을 **제한된 식 언어** 하나로 바꾸는 계획이다. LLM의 역할을 "블록을 고르고 칸을 채우는 번역기"에서 **"수간호사의 말을 최적화 문제로 세우는 모델러이자 해설자"**로 넓힌다.
**기본값은 지금 동작과 같다.** 기존 병동은 변환 후 같은 근무표가 나와야 한다(hard 전부, soft는 기존 모양).
2026-10-30 사용자가 결정 ★1~★9를 추천안대로 승인했다. 0단계로 ADR-019를 `docs/ADR.md`에 넣고 PRD·ARCHITECTURE·UI_GUIDE를 고쳤다.

★ = 2026-10-30 사용자와 합의한 결정. ☆ = 이 문서가 제안한 기본값(구현 중 숫자 조정 가능).

## 0. 왜 바꾸나

- 핵심 가치는 수학을 모르는 수간호사가 말로 최적화 문제를 세우는 것이다(ADR-018 이유와 같음).
- 블록 3종도 결국 **정해 둔 틀**이다. "신규가 나이트면 책임도 나이트에 1명"(조건부), "A와 B는 같은 날 나이트 금지"(짝) 같은 규칙이 거절되거나 억지로 끼워진다.
- 구조 전제 일부가 시스템이 강제하는 폼으로 남아 있다. 필요 인원은 처음 설정의 필수 폼이고 "정확히 n명"만 받으며, 근무조 합계로 "쉴 사람이 없어요" 경고를 띄운다(복합 코드를 고려하지 않음).
- 실행 코드 생성(LLM이 OR-Tools 코드를 씀)은 보안·의미 검증·규칙 단위 기능(카드, 충돌 설명, 통계, 재스케줄)을 모두 다시 풀어야 해서 고르지 않았다. 식 언어로 표현이 안 되는 규칙이 eval에서 실제로 쌓이면 그때 다시 본다.

## 1. 합의한 결정

| # | 질문 | 결정 |
|---|---|---|
| ★1 | 식의 모양 | **범위(for_each) + 본문.** 본문은 세기(`count`)·비교·그리고/또는·만약 ~면(`when`)·날짜 이동(`offset`)과 내장 함수 고르게(`balance`). 셀렉터(People·Days·Shifts)는 그대로 쓴다 |
| ★2 | 블록 3종 | **식으로 통일.** 저장·솔버 입력·LLM 출력 모두 식 하나. 세기·순서·고르게는 식의 기본 연산과 내장 함수로 흡수한다. 칸 고정만 별도 타입 |
| ★3 | 하루 한 근무 | **유지.** 칸 하나에 코드 하나. 더블은 복합 코드. 결과·이월·CSV·표가 이 전제 위에 있다 |
| ★4 | 필요 인원 | **기본 규칙 카드.** 범위("이상", "3~4명")를 받는다. 처음 설정 ②는 **병동 소개 입력 바**(말) + 접힌 숫자 폼. 근무조 합계 경고는 없애고 가능 여부는 솔버가 판정 |
| ★5 | 기본 규칙 | 병동 규칙 맨 위에 `기본` 배지 카드(필요 인원, 나이트전담). 말로 고치거나 끌 수 있다 |
| ★6 | 의미 확인 | 카드에 **결정적 문장**(식 → 문장, LLM이 쓰지 않음) + **예시 판정**(서버가 샘플 근무표에서 찾은 위반 사례 ≤ 3) |
| ★7 | 조정 가능한 값 | 식 안의 숫자에 이름을 붙인 `values`. 카드 [수정]과 해 없음 완화 제안은 이 값(과 켜기/끄기, 반드시/가능하면)만 바꾼다 |
| ★8 | 이전·eval | 저장 문서 v5 → v6 자동 변환(블록 → 식), 골든 목적값 비교. eval은 의미 판정기 유지, 기존 79건 ≥ 95%, 새 케이스(조건부·짝 등) ≥ 85% |
| ★9 | 범위 | **새로 지원**: 조건부 규칙, 사람 사이 짝 규칙(같이·따로). **계속 범위 밖**: 근무 시각 겹침, 하루 세 근무 이상, 코드보다 잘게 쪼갠 시간(교육·회의) |

## 2. 식 언어

### 2.1 규칙 `Rule`

```python
class Rule(_ConstraintBase):          # id, scope, hardness, priority, source_text, enabled
    type: Literal["rule"]
    default: bool = False             # 기본 규칙(필요 인원·나이트전담). 카드에 `기본` 배지
    values: dict[ValueName, Value] = {}   # 조정 가능한 값(★7), ≤ ☆5개
    body: Require | Balance           # kind 판별

class Value(_Strict):
    value: float                      # ≥ 0
    label: str                        # 카드 [수정]에 보일 이름. 예: "최대 연속 나이트"
```

- `ValueName` = `^[a-z][a-z0-9_]{0,23}$`.
- `ConstraintSpec = rule | fixed_assignment`(type 판별). 칸 고정은 지금 그대로다.
- 중요도·가중치는 ADR-018 그대로(`priority` → `PRIORITY_WEIGHTS`).

### 2.2 범위 `ForEach`

```python
class ForEach(_Strict):
    per: Literal["period", "day", "person", "person_day", "person_week", "person_window"]
    people: People = People()         # 어떤 사람마다(사람이 묶이는 per만)
    days: Days = Days()               # 어떤 날마다(날이 묶이는 per만). week/window/person/period면 세는 날을 거른다
    window: int | None = None         # per=person_window일 때만, 2..14
```

| per | 묶이는 것 | 인스턴스 | 예 |
|---|---|---|---|
| `period` | 없음 | 1개(기간 전체) | "기간 전체 더블 10번 이하" |
| `day` | 날 d | 고른 날마다 | 필요 인원, 책임 배치, 짝 규칙 |
| `person` | 사람 p | 고른 사람마다(기간 전체) | 최소 휴무, 휴가, 희망·기피 |
| `person_day` | 사람 p, 날 d | 사람 × 날마다 | 금지 순서, 나이트 다음 휴무, 블록 최소 길이 |
| `person_week` | 사람 p, 달력 주 | 사람 × 주마다 | 주 52시간 |
| `person_window` | 사람 p, 연속 window일 | 사람 × 꽉 찬 창마다 | 최대 연속 근무, 7일 중 휴무 |

week·window의 경계 규칙은 지금 세기 블록과 같다(첫 주는 이월 포함, 잘린 끝 주는 기간 안만, 창은 꽉 찬 것만).

### 2.3 본문 `Require`

```python
class Require(_Strict):
    kind: Literal["require"]
    for_each: ForEach
    when: Cond | None = None          # 이 조건이 참인 인스턴스에서만
    then: Cond                        # 이 조건을 지킨다

Cond = Cmp | All | Any                # 재귀하지 않는다(☆ tool 스키마·문장·검증을 단순하게)
class All(_Strict): all: list[Cmp]    # 2..4개
class Any(_Strict): any: list[Cmp]    # 2..4개

class Cmp(_Strict):
    left: Count
    op: Literal["ge", "le", "eq"]
    right: float | ValueRef | Count   # 숫자, 조정 가능한 값, 다른 세기

class ValueRef(_Strict):
    value: ValueName                  # Rule.values에 있어야 한다

class Count(_Strict):
    who: People | None = None         # 없으면: 사람이 묶인 범위에서는 그 사람, 아니면 모든 사람
    days: Days = Days()               # 세는 날을 거른다
    offset: tuple[int, int] | None = None  # 날이 묶인 범위(day, person_day)에서만. d+a..d+b. 없으면 (0, 0)
    shifts: Shifts
    measure: Literal["count", "hours"] = "count"
```

- **세는 칸**: (사람 집합) × (날 집합) 중 `shifts`에 맞는 칸의 수(또는 근무 시간 합). 사람 집합은 `who`(없으면 묶인 사람 또는 모두), 날 집합은 범위가 묶은 날(day·person_day면 `offset` 구간, week·window면 그 주·창, person·period면 기간 전체)을 `days`로 거른 것.
- **모르는 날은 세지 않는다**: 기간 뒤, 또는 이월로도 모르는 기간 앞의 날은 0으로 본다. 그래서 순서 규칙은 경계를 아는 쪽만 조건으로 건다(§2.5 예시).
- `Shifts` 맞음 판정은 지금과 같다(`covers` 기준, `in`/`not_in`).
- 상한 ☆: `offset`은 −7..+14이고 폭 ≤ 14, Cmp는 when·then 합쳐 ≤ 6개.

### 2.4 본문 `Balance` (내장 함수)

```python
class Balance(_Strict):
    kind: Literal["balance"]
    people: People = People()
    days: Days = Days()
    shifts: Shifts
    measure: Literal["count", "hours"] = "count"
    with_history: bool = True
    max_gap: float | ValueRef = 1     # hard일 때만: (최대 − 최소) ≤ max_gap
```
지금 고르게 블록과 같다. 사람 사이 차이는 선형 비교로 쓸 수 없어서 내장 함수로 둔다.

### 2.5 블록 → 식 변환표

변환은 저장 이전(§8)·골든 동등성·eval 기대값 재작성에 같은 표를 쓴다. Python(`backend/domain/convert.py`)과 TS(`lib/migrate.ts`)가 같은 결과를 내야 한다(공유 픽스처).

| 블록 | 식 |
|---|---|
| count{people, days, shifts, per=day, measure, min, max} | for_each{day, days}: then Count{who=people, shifts, measure} ≥ min / ≤ max (둘 다면 All, 같으면 eq) |
| count{…, per=person} | for_each{person, people, days}: then Count{shifts, measure} … |
| count{…, per=person_week} / person_window{window} | for_each{person_week·person_window, people, days, window}: then Count{…} … |
| sequence{forbid=[[A, B, …]]} | 패턴마다: for_each{person_day, people}: then Any[Count{offset (0,0), A} eq 0, Count{offset (1,1), B} eq 0, …]. 패턴이 여러 개면 ☆ 패턴 수만큼 규칙을 나눈다(id `{원 id}`, `{원 id}-2`…) |
| sequence{run=S, max_len=k} | for_each{person_window, people, window=k+1}: then Count{S} ≤ k |
| sequence{run=S, min_len=k} | for_each{person_day, people}: when All[Count{offset (−1,−1), not S} ≥ 1, Count{offset (0,0), S} ≥ 1] then Count{offset (1, k−1), not S} eq 0 |
| sequence{after=S, then_off=k} | for_each{person_day, people}: when All[Count{offset (0,0), S} ≥ 1, Count{offset (1,1), not S} ≥ 1] then Count{offset (1, k), not_in [O]} eq 0 |
| balance{…} | Balance{…} 그대로 |
| fixed_assignment | 그대로 |

- `not S`는 `in` ↔ `not_in`을 뒤집은 셀렉터다.
- 숫자 min·max·max_len·then_off·max_gap은 `values`로 옮긴다(이름 ☆ `min`, `max`, `max_len`, `min_len`, `off_days`, `max_gap`, label은 프리셋 이름 기준).
- 금지 패턴 여러 개를 한 규칙에 두려면 Require 목록이 필요하다. 식을 단순하게 두려고 규칙을 나눈다(카드도 나뉜다). 원래 블록에서 패턴이 2개 이상인 경우는 드물다.

### 2.6 새로 표현되는 규칙 예

| 말 | 식 |
|---|---|
| 신규가 나이트면 책임도 나이트에 1명 | day: when Count{who tags[신규], N} ≥ 1 then Count{who tags[책임], N} ≥ 1 |
| 김OO와 이OO는 같은 날 나이트 금지 | day: then Count{who ids[a, b], N} ≤ 1 |
| 김OO와 이OO는 데이를 같이 | day: then Count{who ids[a], D} eq Count{who ids[b], D} |
| 책임이 신규보다 적으면 안 됨(나이트) | day: then Count{who tags[책임], N} ≥ Count{who tags[신규], N} |
| 주말 나이트 다음 월요일은 휴무 | person_day{days weekdays[6]}: when Count{offset (0,0), N} ≥ 1 then Count{offset (1,1), O} eq 1 |
| 나이트 블록은 2~3일씩 | min_len·max_len 두 규칙(§2.5 모양) |

## 3. 솔버

- `build_model`의 변수·`add_exactly_one`·복합 코드 처리는 그대로(★3).
- 컴파일(`backend/solver/compile.py` 새 모듈, 순수하게 식 → CP-SAT):
  - Count → 선형식(이월 칸은 상수). Cmp → 선형 제약. All/Any → 리터럴로 reify(Cmp마다 참·거짓 양방향 강제).
  - hard: `when`이 없으면 `then`을 `OnlyEnforceIf(lit)`. 있으면 `lit ∧ when → then`.
  - soft 위반량: `then`이 Cmp 하나면 **벗어난 양**(시간은 기본 근무 분량으로 올림, ADR-018과 같음), All/Any면 인스턴스마다 **1**. `when`이 있으면 when이 참일 때만 센다.
  - Balance: 지금 `_spread` 그대로.
- 위반 계산(`stats.violations`)은 같은 의미를 근무표 위에서 평가하는 순수 함수(`backend/solver/evaluate.py` ☆)로 한다. 솔버 결과 통계·eval 판정기·예시 판정이 모두 이 함수를 쓴다.
- 충돌(unsat core)은 지금처럼 규칙 id 단위.
- 성능: 컴파일 결과가 블록 시절보다 커질 수 있다(reify 보조 변수). 입력 상한(§2.3)과 벤치로 관리, 넘으면 상한을 낮춘다.

## 4. LLM

### 4.1 translate
```python
class TranslatorOutput(_Strict):
    rules: list[RuleDraft] = []           # Rule에서 id·scope·enabled·default를 뺀 것
    config_changes: list[ShiftChange] = []
    clarification_question: str | None = None
    unsupported_reason: str | None = None
```
- tool 스키마는 식 모양 그대로(재귀 없음, ★1). 프롬프트는 범위 고르기 → 세기 → 비교 → 조건 순서로 생각하게 하고, §2.5·§2.6의 모양별 예시를 둔다.
- 검증(재시도 ≤ 2): Pydantic → 설정 변경(ADR-018 그대로) → 참조(id·태그·코드·날짜·ValueRef가 values에 있음, offset은 날이 묶인 범위에서만) → 빈 대상(사람 0명·날 0일) → 싼 모순(day 범위의 Count ≥ 대상 인원 초과).
- 기본값: `hardness` 생략 시 require는 hard, balance는 soft·낮음, 희망·기피 표현은 soft.

### 4.2 예시 판정(★6)
- `/translate` 응답의 규칙마다 `examples: list[RuleExample]`(≤ 3). `routes.py`가 검증된 규칙을 `solver.evaluate`로 고정 시드 무작위 근무표 위에서 평가해 위반 인스턴스를 고른다(solver와 llm의 조합은 routes에서만).
- `RuleExample` = `{ nurse_ids, days: [int], cells: {nurse_id: [code]}, detail }` — 카드가 작은 근무 띠로 그린다. 위반이 하나도 안 나오면 빈 목록(카드는 "예시 없음"을 쓰지 않고 숨긴다).

### 4.3 explain
- 제안 변경은 `disable | set_value{name, value} | set_hardness`만 허용한다(★7). 식 구조는 LLM이 고치지 않는다.
- 재풀이 검증은 그대로.

## 5. 카드 표현

`lib/wording.ts`의 `describeRule(rule, config, nurses, period)`와 `presetName(rule)`:
- 프리셋(§2.5 표의 모양 + 필요 인원·휴가·희망·기피·나이트전담)은 지금 문장 그대로 나온다(모양 인식).
- 그 밖은 일반 틀: **"[범위]마다, [when]이면 [then]"**. Cmp는 "[사람] [날] [근무] [수]"(ADR-018 문장 틀), 세기끼리 비교는 "[A]가 [B] 이상".
- 조정 가능한 값은 문장 안에서 밑줄로 보이고, [수정]에서 label과 숫자 입력으로 고친다.
- 테스트: 변환표 모양 전부와 §2.6 예시를 스냅숏으로 고정.

## 6. 화면

| 화면 | 변경 |
|---|---|
| 처음 설정 ② | 제목 "병동 소개". 자연어 입력 바(예시: "데이 평일 3명 이상, 주말 2명, 더블도 있어") → 근무 형태 카드 + 필요 인원 카드. 그 아래 접힌 "숫자로 입력하기"(지금 필요 인원 폼, 값은 기본 규칙 카드와 같은 것을 고친다). [다음]은 항상 누를 수 있고, 필요 인원 규칙이 없으면 "필요 인원 없이 만들면 인원을 맞추지 않아요" 한 줄(☆) |
| 필요 인원 폼 | "정확히" 고정 대신 칸마다 최소·최대(같으면 정확히). 근무조 합계 "쉴 사람이 없어요" 오류 삭제 |
| 병동 규칙 | 기본 규칙 카드를 맨 위에 `기본` 배지로. 삭제 대신 [끄기] |
| 규칙·요청 카드 | 결정적 문장(밑줄 값), 예시 판정 띠(≤ 3, 접힘 가능), [수정] = 값 입력, 반드시/가능하면·중요도 그대로 |
| 해 없음 | 제안 = 값 바꾸기·끄기·반드시→가능하면. 문장은 "최대 연속 나이트 3 → 4" |
| 그 밖 | 변화 없음(홈, 기간 흐름, 확정, 재스케줄, CSV, 로그인) |

## 7. eval

- 의미 판정기(무작위 근무표 50개 + 뒤집은 근무표, `evaluate`로 위반 집합 비교)는 그대로.
- 기존 79건: 기대값을 §2.5로 기계 변환. 목표 ★ ≥ 95%.
- 새 케이스 ☆ 20건 이상: 조건부(태그·연차), 짝(같이·따로), 세기끼리 비교, 요일 조건부 순서, 값 이름·label, 범위 필요 인원, 병동 소개 한 문장에서 설정 + 필요 인원 여러 개, 여전히 unsupported(시각 겹침, 하루 세 근무, 교육 시간). 목표 ★ ≥ 85%, 스키마 유효 100%.
- 목표 미달이면 LLM 단계에서 멈추고 프롬프트를 보강한다.

## 8. 저장 이전 (STORAGE_VERSION 5 → 6)

- `lib/migrate.ts`에 `migrateV5(doc)`: 블록을 §2.5로 식 규칙으로 바꾼다(병동 규칙, 대기 카드, 기간 요청, 꺼진 id 목록, 확정본 버전의 요청). 금지 패턴이 나뉘면 꺼진 id 목록도 나뉜 id로 늘린다. 필요 인원(`cov-*`)과 나이트전담(`night-only`) 규칙은 `default: true`.
- v4 문서는 `migrateV4` → `migrateV5`로 잇는다.
- 실패한 규칙은 ADR-018처럼 `unconverted` 원문으로 남긴다.
- 옛 결과는 바꾸지 않는다(ADR-018 ★12와 같음). 작성 중·운영 중 결과는 stale.
- 골든: 변환 전 블록 요청과 변환 후 식 요청이 hard 위반 0·같은 목적값(soft 모양이 바뀌는 min_len은 별도 기록).

## 9. 구현 순서(phase `5-expressions`)

API가 한 번에 바뀌므로 harness 기능 브랜치 하나에 쌓고 끝난 뒤 main에 합친다(ADR-018 ★13과 같음).

| 단계 | 내용 |
|---|---|
| 0 | 이 문서 → ADR-019, PRD·ARCHITECTURE·UI_GUIDE 수정(완료) |
| 1 | 골든 기록(블록 요청의 목적값·배정) |
| 2 | 도메인: 식 모델, 블록 → 식 변환, 상한 |
| 3 | 솔버: 컴파일(hard·soft), evaluate, stats·conflicts 교체, 골든 동등성 |
| 4 | LLM: translate 출력·검증·프롬프트, 예시 판정 route, explain 값 변경 |
| 5 | eval: 데이터셋 변환 + 새 케이스, 게이트 |
| 6 | 클라이언트 데이터: types, migrateV5, describeRule, store(기본 규칙, 값 수정, 필요 인원 범위) |
| 7 | 화면: 처음 설정 ② 병동 소개, 필요 인원 폼, 카드(문장·예시·값), 해 없음 |
| 8 | 샘플·e2e·벤치 |

## 10. 위험

| 위험 | 대응 |
|---|---|
| 그럴듯한 오역(가장 큼) | 결정적 문장, 예시 판정, 빈 대상·모순 clarify, 의미 기준 eval |
| 충돌 설명이 어려워짐 | 규칙 id 단위 core 유지, 완화는 값만 움직임 |
| 솔버 성능(reify) | Cmp·offset 상한, 벤치, 넘으면 상한을 낮춤 |
| soft 위반량 모양 변화 | 골든 비교, 바뀌는 모양(min_len soft)은 문서에 기록 |
| 금지 패턴 규칙 분리 | id `-2` 접미, 꺼진 id 목록도 함께 변환 |
| 표현력 밖 규칙 | unsupported 유지, eval의 unsupported 케이스로 경계 확인 |

## 11. ☆ 기본값

- 상한: values 5개, Cmp 6개(All/Any는 2~4개), offset −7..+14·폭 14, window 2~14
- 예시 판정 ≤ 3개, 고정 시드 무작위 근무표에서
- 처음 설정 ②는 항상 다음으로 넘어갈 수 있다
- eval 새 케이스 20건 이상
