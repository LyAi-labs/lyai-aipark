"""
Schemas for Phase 1A.2-D Autonomous Agent Loop Proof.
Defines strict Pydantic structures for LLM decisions and validations.
Avoids Dict[str, Any] which induces additionalProperties (unsupported by Gemini Developer API).
"""
from typing import Optional
from pydantic import BaseModel, Field


class ActionParameters(BaseModel):
    target_duration_seconds: Optional[float] = Field(
        default=None,
        description="Target duration in seconds for repair_audio or repair_video tools."
    )


class Decision(BaseModel):
    status: str = Field(description="Operational status summary e.g. DIAGNOSING, CORRECTING, READY_TO_FINISH")
    observation: str = Field(description="Objective observation of the provided state and specifications")
    diagnosis: str = Field(description="Root cause identified autonomously from discrepancies")
    action: str = Field(description="Allowed tool action to invoke: repair_audio, repair_video, or finish_pass")
    parameters: ActionParameters = Field(
        default_factory=ActionParameters,
        description="Structured parameters for the selected action"
    )
    reason: str = Field(description="Formal technical rationale for why this action resolves the diagnosis")
    expected_effect: str = Field(description="Quantified expected impact on system metrics")


class ValidationResult(BaseModel):
    valid: bool
    action: str
    error_message: Optional[str] = None
