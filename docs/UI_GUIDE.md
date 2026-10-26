# UI 디자인 가이드

시안: [간호사 근무표 디자인](https://claude.ai/artifact/JkfNaqQHwVvjVs2WK669fZ) (디자인 시스템 · ④ 근무표 · 랜딩 페이지). 라이트 테마, 데스크톱(1280px 이상) 전용.

## 디자인 원칙
1. 엑셀 옆에 둬도 어색하지 않은 업무 도구다. 정보 밀도가 먼저다. 장식, 일러스트, 히어로 영역을 두지 않는다. 표는 표답게 촘촘하게.
2. 결정은 사람이 한다. LLM이 해석한 결과는 항상 카드로 제안되고, [적용]이나 [수락]을 누르기 전에는 근무표에 반영되지 않는다.
3. 색은 근무 코드와 상태에만 쓴다. 나머지 화면은 무채색이다. 색이 보이면 의미가 있다: D/E/N/O, 성공·오류·주의, 변경된 칸.

## AI 슬롭 안티패턴 — 하지 마라
| 금지 사항 | 이유 |
|-----------|------|
| backdrop-filter: blur() | glass morphism은 AI 템플릿의 가장 흔한 징후 |
| gradient-text (배경 그라데이션 텍스트) | AI가 만든 SaaS 랜딩의 1번 특징 |
| "Powered by AI" 배지 | 기능이 아니라 장식. 사용자에게 가치 없음 |
| box-shadow 글로우 애니메이션 | 네온 글로우 = AI 슬롭 |
| 보라/인디고 브랜드 색상 | "AI = 보라색" 클리셰 |
| 모든 카드에 동일한 rounded-2xl | 균일한 둥근 모서리는 템플릿 느낌 |
| 배경 gradient orb (blur-3xl 원형) | 모든 AI 랜딩 페이지에 있는 장식 |

## 색상
강조색은 청록(`#155E75`) 하나뿐이다.

### 배경
| 용도 | 값 |
|------|------|
| 페이지 | `bg-[#F6F6F3]` |
| 카드·표 | `bg-white` |
| 눌림·hover | `bg-[#EFEFEB]` |
| 테두리 | `border-[#E2E2DC]` |
| 입력·보조 버튼 테두리 | `border-[#C9C9C1]` |
| 표 안 구분선 | `border-[#EFEFEB]` |

### 텍스트
| 용도 | 값 |
|------|------|
| 주 텍스트 | `text-[#1B1B18]` |
| 본문 | `text-[#3D3D38]` |
| 보조 | `text-[#66665E]` |
| 비활성 | `text-[#9A9A91]` |
| placeholder | `placeholder:text-[#8A8A80]` |

### 강조
| 용도 | 값 |
|------|------|
| 강조·Primary | `#155E75` |
| 강조 hover | `#0E4A5C` |
| 강조 옅게 (완료 단계 배경) | `#E3F0F3` |

### 데이터/시맨틱 색상
| 용도 | 값 |
|------|------|
| 성공·해 있음 | `#1E7A46` (배지: `bg-[#E6F2EA] text-[#1E6B3F]`) |
| 오류·해 없음 | `#B42318` (배지: `bg-[#FBE9E7] text-[#9F1F14]`, 패널 테두리 `border-[#E8B4AE]`) |
| 주의·soft 위반 | `#A15C07` (배지: `bg-[#FDF0DC] text-[#7A4506]`) |
| 변경된 칸 | `#D97706` (월중 변경 배너: `bg-[#FDF0DC] border-[#F1D3A8]`) |
| 주말·공휴일 열 | `bg-[#F1EEE6]` |
| 날짜 헤더 일요일·공휴일 / 토요일 | `text-[#B42318]` / `text-[#155E75]` |

### 근무 코드
글자를 항상 함께 표시한다. 색만으로 구분하지 않고, 밝기도 O > D > E > N 순으로 다르다.

| 코드 | 값 |
|------|------|
| D 데이 | `bg-[#FFF1C2] text-[#5C4300]` |
| E 이브닝 | `bg-[#F9CFAE] text-[#6E2A04]` |
| N 나이트 | `bg-[#263248] text-white` |
| O 오프 | `bg-white text-[#6B6B63] font-normal border border-[#E2E2DC]` (주말·공휴일이면 `bg-[#F1EEE6]`) |

## 컴포넌트
모서리는 크기에 따라 다르게 한다: 셀 `rounded-xs`(2px) · 배지 `rounded-sm`(4px) · 버튼·입력 `rounded-md`(6px) · 카드 `rounded-lg`(8px).

### 카드
```
rounded-lg bg-white border border-[#E2E2DC] px-[18px] py-4
```
- 적용 대기 카드: 테두리만 `border-[#C9C9C1]`로 한 단계 진하게
- 해 없음 패널: `border-[#E8B4AE]`
- 카드에 왼쪽 굵은 테두리 강조나 그림자를 넣지 않는다

### 버튼
```
공통:      inline-flex items-center gap-2 h-10 px-4 rounded-md text-sm font-medium transition-colors duration-[120ms]
Primary:   bg-[#155E75] text-white border border-[#155E75] hover:bg-[#0E4A5C]
Secondary: bg-white text-[#1B1B18] border border-[#C9C9C1] hover:bg-[#EFEFEB]
Text:      px-2 text-[#3D3D38] hover:bg-[#EFEFEB] hover:text-[#1B1B18]
Danger:    px-2 text-[#B42318]  (삭제 등)
Disabled:  bg-[#EFEFEB] text-[#9A9A91] border border-[#E2E2DC] cursor-not-allowed
카드 안:   h-8 text-[13px]
랜딩:      h-11 text-[15px] px-[18px]
```
한 영역에 Primary는 하나만 둔다.

### 입력 필드
```
h-10 rounded-md bg-white border border-[#C9C9C1] px-3 text-sm text-[#1B1B18] placeholder:text-[#8A8A80]
focus:outline-2 focus:outline-[#155E75] focus:-outline-offset-1 focus:border-[#155E75]
```
- 레이블은 항상 `<label>`로 위에 둔다: `text-xs font-medium text-[#3D3D38]`
- 자연어 입력 바(규칙·요청·월중 변경 공통): 입력 `flex-1` + 오른쪽 Primary 버튼, `gap-2`. placeholder는 "예: 나이트 다음 날은 무조건 쉬게"처럼 실제 말투 예시

### 배지
```
inline-flex items-center h-[22px] px-2 rounded-sm text-xs font-semibold
hard:      bg-[#1B1B18] text-white
soft:      bg-white text-[#3D3D38] border border-[#C9C9C1]
검증됨:    bg-[#E6F2EA] text-[#1E6B3F]
적용 대기: bg-[#FDF0DC] text-[#7A4506]
해 없음:   bg-[#FBE9E7] text-[#9F1F14]
```

### hard/soft 토글
```
컨테이너: inline-flex rounded-md border border-[#C9C9C1] overflow-hidden
버튼:     h-7 px-3 text-xs font-medium bg-white text-[#66665E]
선택됨:   aria-pressed="true" → bg-[#1B1B18] text-white
```

### 규칙·요청 카드
위에서부터 템플릿 이름(`text-[13px] font-semibold`) + hard/soft 토글, 원문 인용(“…”, `text-sm text-[#1B1B18]`), 해석 결과(`font-mono text-xs text-[#66665E] bg-[#F6F6F3] rounded-sm px-2.5 py-2`), 상태 배지 + 버튼(적용됨이면 수정·삭제, 대기면 삭제·적용).

### 제안 카드
제목 + `검증됨` 배지, 설명 한 줄, 재풀이 결과(`font-mono text-xs text-[#66665E]`, 예: "재풀이 결과 · 해 있음 · 희망 반영 14/16"), 오른쪽 아래 [무시] Text + [수락] Primary. 재풀이로 검증되지 않은 제안은 보여주지 않는다.

### 스테퍼
- 완료: `size-[22px] rounded-full bg-[#E3F0F3] text-[#155E75]` 안에 체크 SVG, 레이블 `text-[#3D3D38]`
- 현재: `bg-[#155E75] text-white` 숫자(mono), 레이블 `font-semibold text-[#1B1B18]`, `aria-current="step"`
- 단계 사이: `w-6 h-px bg-[#C9C9C1]`

### 근무 셀
```
relative w-[30px] h-7 rounded-xs inline-flex items-center justify-center font-mono text-[13px] font-semibold border border-transparent
+ 근무 코드 색상
고정:      오른쪽 위 자물쇠 SVG (absolute top-px right-px size-[9px])
변경됨:    shadow-[inset_0_0_0_2px_#D97706]
선택·편집: outline-2 outline-[#155E75] outline-offset-1
```
- 셀은 `<button>`으로 만들고 `aria-label="{이름} 11월 {일}일 {코드}"`
- 행 그리드: `grid-cols-[150px_44px_repeat(N,30px)_repeat(4,34px)] gap-x-0.5`, 행 간격 2px
- 표 하단에 날짜별 D/E/N 합계 행, 오른쪽에 개인별 D/E/N/O 합계 열

### 요약 지표
카드 안 가로 배치, 칸마다 `px-5 py-3.5 border-r border-[#E2E2DC]`. 레이블 `text-xs font-medium text-[#66665E]`, 값 `font-mono text-xl font-semibold text-[#1B1B18]`. soft 위반 값만 `text-[#A15C07]`.

## 레이아웃
- 전체 너비: `max-w-[1360px] mx-auto px-8`
- 정렬: 좌측 정렬 기본. 중앙 정렬 히어로 금지
- 간격: 카드 사이 `gap-4`~`gap-5`, 앱 화면 섹션 사이 `gap-5`, 카드 안 `gap-2.5`~`gap-3.5`
- 앱 상단 바: `bg-white border-b border-[#E2E2DC]`, 왼쪽 앱 이름 + 병동·월, 오른쪽 스테퍼
- 근무표·통계 표는 `overflow-x-auto` 상자 안에 둔다. 표를 줄이거나 셀을 30px보다 작게 만들지 않는다
- 랜딩 페이지: 섹션 `py-[72px] border-t border-[#E2E2DC]`, 첫 화면은 좌측 텍스트 + 우측 실제 제품 화면 조각(규칙 카드, 근무표 일부). 장식 이미지나 근거 없는 수치·후기를 넣지 않는다

## 타이포그래피
글꼴: 본문·UI는 IBM Plex Sans KR(`font-sans`), 숫자·근무 코드·날짜·해석 결과는 IBM Plex Mono(`font-mono`).

| 용도 | 스타일 |
|------|--------|
| 페이지 제목 | `text-[22px] font-semibold text-[#1B1B18]` |
| 섹션·카드 제목 | `text-[15px] font-semibold text-[#1B1B18]` |
| 카드 안 항목 제목 | `text-[13px] font-semibold text-[#1B1B18]` |
| 본문 | `text-sm leading-relaxed text-[#3D3D38]` (line-height 1.6) |
| 레이블·보조 | `text-xs font-medium text-[#66665E]` |
| 숫자·코드 | `font-mono text-[13px] font-medium text-[#1B1B18]` |
| 랜딩 h1 | `text-[42px] leading-[1.3] font-semibold tracking-[-0.02em] text-[#1B1B18]` |
| 랜딩 h2 | `text-[26px] leading-[1.35] font-semibold tracking-[-0.01em] text-[#1B1B18]` |
| 랜딩 섹션 머리말 | `font-mono text-xs font-semibold text-[#155E75]` |

## 애니메이션
- hover 색 전환만 허용: `transition-colors duration-[120ms]`
- 풀이 중에는 버튼 텍스트를 "푸는 중…"으로 바꾸고 스피너 하나만 둔다
- 그 외 모든 애니메이션 금지

## 아이콘
- SVG 인라인, `stroke="currentColor"`, strokeWidth 1.5~1.8, 크기 12~14px
- 아이콘 컨테이너(둥근 배경 박스)로 감싸지 않는다 (스테퍼 단계 원은 예외)
- 이모지를 쓰지 않는다. 고정 표시는 🔒 대신 자물쇠 SVG
- 장식용 SVG는 `aria-hidden="true"`, 아이콘만 있는 버튼은 `aria-label`
