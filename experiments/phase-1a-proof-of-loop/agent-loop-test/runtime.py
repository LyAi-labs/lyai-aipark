"""
Agent Runtime Abstraction and Gemini Implementation for Phase 1A.2-D.
Communicates strictly with the LLM API and parses responses into typed Decision objects.
Does NOT execute tools or modify state.
"""
import os
import time
from abc import ABC, abstractmethod
from typing import Any, Dict

from dotenv import load_dotenv
from google import genai
from schemas import Decision

MODEL_NAME = "gemini-3.8-flash"


class AgentRuntime(ABC):
    @abstractmethod
    def decide(self, context: Dict[str, Any]) -> Decision:
        pass


class GeminiRuntime(AgentRuntime):
    def __init__(self, model_name: str = MODEL_NAME) -> None:
        # Load local .env with override=True to ensure file takes precedence over process env
        load_dotenv(override=True)
        api_key = os.environ.get("GEMINI_API_KEY", "")
        if not api_key:
            raise RuntimeError("GEMINI_API_KEY is missing from environment")

        self.client = genai.Client()
        self.model_name = model_name

    def decide(self, context: Dict[str, Any]) -> Decision:
        """
        Submits neutral system state, targets, and tool catalog to LLM.
        Demands structured decision matching the Decision Pydantic schema.
        Includes robust retry/backoff for transient HTTP errors (503/UNAVAILABLE).
        """
        system_prompt = (
            "You are an autonomous quality assurance and correction agent for a media rendering system.\n"
            "Analyze the provided system state against the target specifications.\n"
            "Available Actions Allowlist:\n"
            "- 'repair_audio': Parameters: {'target_duration_seconds': float}. Adjusts system audio duration.\n"
            "- 'repair_video': Parameters: {'target_duration_seconds': float}. Adjusts system video duration.\n"
            "- 'finish_pass': Parameters: {}. Declares that system state strictly meets all target specifications.\n\n"
            "Requirements:\n"
            "1. Evaluate discrepancies between current system metrics and target specifications.\n"
            "2. Formulate your own objective observation, autonomous diagnosis, and rational justification.\n"
            "3. Select the single appropriate action from the allowlist to correct the discrepancy, "
            "or 'finish_pass' if all metrics are within tolerance.\n"
            "4. Return a structured JSON response matching the Decision schema."
        )

        user_content = (
            f"Current System Context:\n{context}\n\n"
            "Determine your diagnosis and select the next action."
        )

        prompt = f"{system_prompt}\n\n{user_content}"

        last_exc: Exception | None = None
        for attempt in range(1, 6):
            try:
                response = self.client.models.generate_content(
                    model=self.model_name,
                    contents=prompt,
                    config=genai.types.GenerateContentConfig(
                        response_mime_type="application/json",
                        response_schema=Decision,
                        temperature=0.1,
                    ),
                )
                if not response.text:
                    raise ValueError("Received empty response from Gemini model")
                decision = Decision.model_validate_json(response.text)
                return decision
            except Exception as exc:
                last_exc = exc
                err_str = str(exc)
                is_transient = (
                    "503" in err_str
                    or "UNAVAILABLE" in err_str
                    or "RESOURCE_EXHAUSTED" in err_str
                    or "high demand" in err_str
                    or "429" in err_str
                )
                if is_transient and attempt < 5:
                    backoff = 3 * (2 ** (attempt - 1))  # 3s, 6s, 12s, 24s
                    print(f"    [API Retry {attempt}/5] Transient server load spike, sleeping {backoff}s...")
                    time.sleep(backoff)
                else:
                    raise exc

        raise RuntimeError(f"GeminiRuntime failed after 5 attempts. Last error: {last_exc}")

