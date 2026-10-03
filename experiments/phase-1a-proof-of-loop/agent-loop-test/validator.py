"""
Local Validator for Phase 1A.2-D.
Enforces allowlist and parameter constraints locally before any tool execution.
"""
from typing import Set
from schemas import Decision, ValidationResult

ALLOWED_ACTIONS: Set[str] = {
    "repair_audio",
    "repair_video",
    "finish_pass",
}


class LocalValidator:
    def __init__(self, allowed_actions: Set[str] | None = None) -> None:
        self.allowed_actions = allowed_actions or ALLOWED_ACTIONS

    def validate(self, decision: Decision) -> ValidationResult:
        if decision.action not in self.allowed_actions:
            return ValidationResult(
                valid=False,
                action=decision.action,
                error_message=f"Action '{decision.action}' is forbidden. Allowed actions: {sorted(list(self.allowed_actions))}",
            )

        if decision.action in ("repair_audio", "repair_video"):
            duration = decision.parameters.target_duration_seconds
            if duration is None:
                return ValidationResult(
                    valid=False,
                    action=decision.action,
                    error_message=f"Action '{decision.action}' requires 'target_duration_seconds' in parameters",
                )
            if duration <= 0:
                return ValidationResult(
                    valid=False,
                    action=decision.action,
                    error_message="target_duration_seconds must be > 0",
                )

        return ValidationResult(valid=True, action=decision.action)
