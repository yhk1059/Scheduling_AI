/* eslint-disable */
// 자동 생성 파일. 직접 수정하지 말고 `npm run gen:types`로 다시 만든다(backend/domain/models.py 기준).

export type SolveResponse = SolveOk | SolveInfeasible | SolveTimeout;
export type TranslateResponse = TranslateOk | TranslateClarify | TranslateUnsupported;
export type ConstraintSpec =
  | DailyCoverage
  | ForbiddenSequence
  | MaxConsecutiveWork
  | MaxConsecutiveNights
  | MinDaysOff
  | OffAfterNightBlock
  | SkillMix
  | Leave
  | FixedAssignment
  | ShiftPreference
  | NightFairness
  | WeekendFairness;

export interface ApiTypes {
  ScheduleRequest: ScheduleRequest;
  SolveResponse: SolveResponse;
  TranslateRequest: TranslateRequest;
  TranslateResponse: TranslateResponse;
  ExplainRequest: ExplainRequest;
  ExplainResponse: ExplainResponse;
  ErrorBody: ErrorBody;
  ConstraintSpec: ConstraintSpec;
  [k: string]: unknown;
}
export interface ScheduleRequest {
  /**
   * @minItems 1
   */
  nurses: [Nurse, ...Nurse[]];
  period: Period;
  holidays?: number[];
  constraints?: (
    | DailyCoverage
    | ForbiddenSequence
    | MaxConsecutiveWork
    | MaxConsecutiveNights
    | MinDaysOff
    | OffAfterNightBlock
    | SkillMix
    | Leave
    | FixedAssignment
    | ShiftPreference
    | NightFairness
    | WeekendFairness
  )[];
  carry_over?: CarryOverRow[];
  previous?: {
    [k: string]: ("D" | "E" | "N" | "O")[];
  } | null;
  input_version: number;
}
export interface Nurse {
  id: string;
  name: string;
  years: number;
  night_only?: boolean;
}
/**
 * 시작일 + 길이(ADR-015). 날짜는 기간 안의 1..length 인덱스로 다룬다.
 */
export interface Period {
  start_date: string;
  length: number;
}
export interface DailyCoverage {
  id: string;
  scope: "ward" | "period";
  hardness?: "hard" | "soft";
  weight?: number;
  source_text: string;
  enabled?: boolean;
  type: "daily_coverage";
  params: DailyCoverageParams;
}
export interface DailyCoverageParams {
  shift: "D" | "E" | "N";
  day_kind: "weekday" | "weekend";
  min: number;
  max: number;
}
export interface ForbiddenSequence {
  id: string;
  scope: "ward" | "period";
  hardness?: "hard" | "soft";
  weight?: number;
  source_text: string;
  enabled?: boolean;
  type: "forbidden_sequence";
  params: ForbiddenSequenceParams;
}
export interface ForbiddenSequenceParams {
  first: "D" | "E" | "N" | "O";
  second: "D" | "E" | "N" | "O";
}
export interface MaxConsecutiveWork {
  id: string;
  scope: "ward" | "period";
  hardness?: "hard" | "soft";
  weight?: number;
  source_text: string;
  enabled?: boolean;
  type: "max_consecutive_work";
  params: DaysParams;
}
export interface DaysParams {
  days: number;
}
export interface MaxConsecutiveNights {
  id: string;
  scope: "ward" | "period";
  hardness?: "hard" | "soft";
  weight?: number;
  source_text: string;
  enabled?: boolean;
  type: "max_consecutive_nights";
  params: DaysParams;
}
export interface MinDaysOff {
  id: string;
  scope: "ward" | "period";
  hardness?: "hard" | "soft";
  weight?: number;
  source_text: string;
  enabled?: boolean;
  type: "min_days_off";
  params: DaysParams;
}
export interface OffAfterNightBlock {
  id: string;
  scope: "ward" | "period";
  hardness?: "hard" | "soft";
  weight?: number;
  source_text: string;
  enabled?: boolean;
  type: "off_after_night_block";
  params: DaysParams;
}
export interface SkillMix {
  id: string;
  scope: "ward" | "period";
  hardness?: "hard" | "soft";
  weight?: number;
  source_text: string;
  enabled?: boolean;
  type: "skill_mix";
  params: SkillMixParams;
}
export interface SkillMixParams {
  shift: "D" | "E" | "N";
  min_years: number;
  min_count: number;
}
export interface Leave {
  id: string;
  scope: "ward" | "period";
  hardness?: "hard" | "soft";
  weight?: number;
  source_text: string;
  enabled?: boolean;
  type: "leave";
  params: LeaveParams;
}
export interface LeaveParams {
  nurse_id: string;
  /**
   * @minItems 1
   */
  days: [number, ...number[]];
}
export interface FixedAssignment {
  id: string;
  scope: "ward" | "period";
  hardness?: "hard" | "soft";
  weight?: number;
  source_text: string;
  enabled?: boolean;
  type: "fixed_assignment";
  params: FixedAssignmentParams;
}
export interface FixedAssignmentParams {
  nurse_id: string;
  day: number;
  shift: "D" | "E" | "N" | "O";
}
export interface ShiftPreference {
  id: string;
  scope: "ward" | "period";
  hardness?: "hard" | "soft";
  weight?: number;
  source_text: string;
  enabled?: boolean;
  type: "shift_preference";
  params: ShiftPreferenceParams;
}
export interface ShiftPreferenceParams {
  nurse_id: string;
  shift: "D" | "E" | "N" | "O";
  prefer: boolean;
  days?: number[] | null;
  weekends_only?: boolean;
}
export interface NightFairness {
  id: string;
  scope: "ward" | "period";
  hardness?: "hard" | "soft";
  weight?: number;
  source_text: string;
  enabled?: boolean;
  type: "night_fairness";
  params?: EmptyParams;
}
export interface EmptyParams {}
export interface WeekendFairness {
  id: string;
  scope: "ward" | "period";
  hardness?: "hard" | "soft";
  weight?: number;
  source_text: string;
  enabled?: boolean;
  type: "weekend_fairness";
  params?: EmptyParams;
}
export interface CarryOverRow {
  nurse_id: string;
  /**
   * @maxItems 7
   */
  shifts: ("D" | "E" | "N" | "O")[];
}
export interface SolveOk {
  status: "ok";
  input_version: number;
  result: ScheduleResult;
}
export interface ScheduleResult {
  assignments: {
    [k: string]: ("D" | "E" | "N" | "O")[];
  };
  summary: Summary;
  stats: {
    [k: string]: NurseStats;
  };
  soft_violations: SoftViolation[];
  diff?: DiffCell[] | null;
  optimal: boolean;
}
export interface Summary {
  preferences_total: number;
  preferences_met: number;
  soft_violation_count: number;
}
export interface NurseStats {
  D: number;
  E: number;
  N: number;
  O: number;
  weekend_holiday_work: number;
  max_consecutive_work: number;
  preference_rate: number | null;
  deviation: number;
}
export interface SoftViolation {
  constraint_id: string;
  nurse_id?: string | null;
  day?: number | null;
  detail: string;
}
export interface DiffCell {
  nurse_id: string;
  day: number;
  before: "D" | "E" | "N" | "O";
  after: "D" | "E" | "N" | "O";
}
export interface SolveInfeasible {
  status: "infeasible";
  input_version: number;
  conflicts: Conflict[];
}
export interface Conflict {
  constraint_id: string;
  type: string;
  source_text: string;
}
export interface SolveTimeout {
  status: "timeout";
  input_version: number;
}
export interface TranslateRequest {
  text: string;
  scope: "ward" | "period";
  context: TranslateContext;
  input_version: number;
}
export interface TranslateContext {
  nurses: Nurse[];
  period: Period;
  holidays?: number[];
  today: string;
}
export interface TranslateOk {
  status: "ok";
  input_version: number;
  constraints: (
    | DailyCoverage
    | ForbiddenSequence
    | MaxConsecutiveWork
    | MaxConsecutiveNights
    | MinDaysOff
    | OffAfterNightBlock
    | SkillMix
    | Leave
    | FixedAssignment
    | ShiftPreference
    | NightFairness
    | WeekendFairness
  )[];
}
export interface TranslateClarify {
  status: "clarify";
  input_version: number;
  question: string;
}
export interface TranslateUnsupported {
  status: "unsupported";
  input_version: number;
  reason: string;
}
export interface ExplainRequest {
  request: ScheduleRequest;
  conflicts: Conflict[];
}
export interface ExplainResponse {
  text: string;
  proposals: RelaxationProposal[];
  fallback: boolean;
  input_version: number;
}
export interface RelaxationProposal {
  title: string;
  description: string;
  changes: ConstraintChange[];
  verified_summary?: Summary | null;
}
export interface ConstraintChange {
  action: "disable" | "update";
  constraint_id: string;
  params?: {
    [k: string]: unknown;
  } | null;
  hardness?: ("hard" | "soft") | null;
}
export interface ErrorBody {
  error: ErrorDetail;
}
export interface ErrorDetail {
  code: string;
  message: string;
  request_id: string;
}
