// /api/py/* fetch 래퍼. 요청마다 현재 inputVersion을 담고, 오류는 ApiError로 throw한다.
import { useAppStore } from "./store";
import type {
  Conflict,
  ErrorBody,
  ExplainResponse,
  ScheduleRequest,
  SolveResponse,
  TranslateRequest,
  TranslateResponse,
} from "./types.gen";

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly requestId: string | null = null,
  ) {
    super(message);
  }
}

/** 오류 코드별 UI 문구. */
export function errorMessage(e: ApiError): string {
  switch (e.code) {
    case "PAYLOAD_TOO_LARGE":
      return "입력이 너무 커요";
    case "VALIDATION_ERROR":
      return e.message;
    case "LLM_INVALID_OUTPUT":
      return "다르게 표현해 주세요";
    case "LLM_UNAVAILABLE":
      return "잠시 후 다시 시도해 주세요";
    case "NETWORK":
      return "서버에 연결하지 못했어요. 네트워크를 확인해 주세요";
    default:
      return `문제가 생겼어요 (요청 ID: ${e.requestId ?? "없음"})`;
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/py/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError("NETWORK", "네트워크 오류");
  }

  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (data as ErrorBody | null)?.error;
    throw new ApiError(err?.code ?? "INTERNAL", err?.message ?? `HTTP ${res.status}`, err?.request_id ?? null);
  }
  return data as T;
}

const currentVersion = () => useAppStore.getState().inputVersion;

export function translate(req: Omit<TranslateRequest, "input_version">): Promise<TranslateResponse> {
  return post("translate", { ...req, input_version: currentVersion() });
}

export function solve(req: Omit<ScheduleRequest, "input_version">): Promise<SolveResponse> {
  return post("solve", { ...req, input_version: currentVersion() });
}

export function explain(req: Omit<ScheduleRequest, "input_version">, conflicts: Conflict[]): Promise<ExplainResponse> {
  return post("explain", { request: { ...req, input_version: currentVersion() }, conflicts });
}
