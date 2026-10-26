"""LLM 클라이언트. tool 호출을 강제하고 SDK 예외를 도메인 예외로 바꾼다. 키 값은 로그·예외에 넣지 않는다."""

import os
from dataclasses import dataclass
from typing import Any, Protocol

import anthropic

from backend.domain.constants import DEFAULT_MODEL, LLM_MAX_TOKENS, LLM_TIMEOUT_S


class LLMConfigError(Exception):
    """키 누락, 인증 실패 → 500 CONFIG_ERROR."""


class LLMUnavailableError(Exception):
    """장애, 한도 초과, 타임아웃 → 503 LLM_UNAVAILABLE."""


class LLMInvalidOutputError(Exception):
    """재시도 후에도 스키마 위반 → 502 LLM_INVALID_OUTPUT."""


@dataclass(frozen=True)
class ToolCallResult:
    tool_input: dict[str, Any] | None
    stop_reason: str | None
    input_tokens: int
    output_tokens: int


class LLMClient(Protocol):
    def call_tool(self, *, system: str, messages: list[dict], tool: dict) -> ToolCallResult: ...


class AnthropicClient:
    def __init__(self, model: str | None = None):
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            raise LLMConfigError("ANTHROPIC_API_KEY가 설정되지 않았습니다")
        self.model = model or os.environ.get("ANTHROPIC_MODEL") or DEFAULT_MODEL
        self._client = anthropic.Anthropic(api_key=api_key, timeout=LLM_TIMEOUT_S)

    def call_tool(self, *, system: str, messages: list[dict], tool: dict) -> ToolCallResult:
        try:
            message = self._client.messages.create(
                model=self.model,
                max_tokens=LLM_MAX_TOKENS,
                system=system,
                messages=messages,
                tools=[tool],
                tool_choice={"type": "tool", "name": tool["name"]},
                timeout=LLM_TIMEOUT_S,
            )
        except (anthropic.AuthenticationError, anthropic.PermissionDeniedError) as e:
            raise LLMConfigError(f"Anthropic 인증 실패(HTTP {e.status_code})") from e
        except anthropic.APIConnectionError as e:  # APITimeoutError 포함
            raise LLMUnavailableError(f"Anthropic 연결 실패: {type(e).__name__}") from e
        except anthropic.APIStatusError as e:
            if e.status_code == 429 or e.status_code >= 500:
                raise LLMUnavailableError(f"Anthropic 사용 불가(HTTP {e.status_code})") from e
            raise

        tool_input = next(
            (b.input for b in message.content if b.type == "tool_use" and b.name == tool["name"]),
            None,
        )
        return ToolCallResult(
            tool_input=tool_input if isinstance(tool_input, dict) else None,
            stop_reason=message.stop_reason,
            input_tokens=message.usage.input_tokens,
            output_tokens=message.usage.output_tokens,
        )
