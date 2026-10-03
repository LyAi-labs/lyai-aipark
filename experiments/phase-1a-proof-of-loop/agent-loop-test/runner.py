"""
Autonomous Agent Loop Runner for Phase 1A.2-D.
Orchestrates: STATE -> OBSERVE -> DECIDE -> VALIDATE -> EXECUTE -> OBSERVE -> DECIDE.
ZERO hardcoding: The runner contains NO mapping between failure types and tool choices.
"""
import copy
import json
from pathlib import Path
from typing import Any, Callable, Dict, List

from runtime import AgentRuntime
from schemas import Decision, ValidationResult
from tools.repair_audio import run_repair_audio
from tools.repair_video import run_repair_video
from validator import LocalValidator

TOOL_DISPATCH: Dict[str, Callable[..., Dict[str, Any]]] = {
    "repair_audio": run_repair_audio,
    "repair_video": run_repair_video,
}


def observe_system(state: Dict[str, Any]) -> Dict[str, Any]:
    """Extracts purely objective metrics without diagnosis or instructions."""
    system = state.get("system", {})
    target = state.get("target", {})

    audio_dur = system.get("audio_duration_seconds", 0.0)
    video_dur = system.get("video_duration_seconds", 0.0)
    target_dur = target.get("target_duration_seconds", 0.0)
    max_drift = target.get("max_duration_drift_seconds", 0.05)

    drift_between_tracks = round(abs(audio_dur - video_dur), 4)
    audio_drift_from_target = round(abs(audio_dur - target_dur), 4)
    video_drift_from_target = round(abs(video_dur - target_dur), 4)

    return {
        "current_audio_duration_seconds": audio_dur,
        "current_video_duration_seconds": video_dur,
        "target_duration_seconds": target_dur,
        "max_allowed_drift_seconds": max_drift,
        "inter_track_drift_seconds": drift_between_tracks,
        "audio_drift_from_target_seconds": audio_drift_from_target,
        "video_drift_from_target_seconds": video_drift_from_target,
        "is_within_drift_tolerance": drift_between_tracks <= max_drift,
    }


class LoopRunner:
    def __init__(
        self,
        runtime: AgentRuntime,
        validator: LocalValidator,
        state_file: Path,
        events_file: Path,
        max_iterations: int = 5,
    ) -> None:
        self.runtime = runtime
        self.validator = validator
        self.state_file = state_file
        self.events_file = events_file
        self.max_iterations = max_iterations

    def append_event(self, event_data: Dict[str, Any]) -> None:
        with open(self.events_file, "a", encoding="utf-8") as f:
            f.write(json.dumps(event_data, ensure_ascii=False) + "\n")

    def save_state(self, state: Dict[str, Any]) -> None:
        with open(self.state_file, "w", encoding="utf-8") as f:
            json.dump(state, f, indent=2, ensure_ascii=False)

    def run(self, initial_state: Dict[str, Any]) -> Dict[str, Any]:
        state = copy.deepcopy(initial_state)
        self.save_state(state)

        # Clear or initialize events file
        with open(self.events_file, "w", encoding="utf-8") as f:
            pass

        history: List[Dict[str, Any]] = []

        for iteration in range(1, self.max_iterations + 1):
            state_before = copy.deepcopy(state)
            observation = observe_system(state_before)

            context = {
                "iteration": iteration,
                "state": state_before,
                "observation": observation,
            }

            # 1. LLM Decision
            decision = self.runtime.decide(context)

            # 2. Local Validation
            val_result = self.validator.validate(decision)

            if not val_result.valid:
                # Failure path: Invalid decision rejected by software guardrail
                event = {
                    "event_type": "DECISION_REJECTED",
                    "iteration": iteration,
                    "state_before": state_before,
                    "observation": observation,
                    "model_decision": decision.model_dump(),
                    "validation_error": val_result.error_message,
                    "state_after": state_before,
                }
                self.append_event(event)
                state["status"] = "BLOCKED"
                self.save_state(state)
                return {
                    "status": "BLOCKED",
                    "reason": val_result.error_message,
                    "iterations": iteration,
                    "final_state": state,
                }

            # 3. Handle termination action
            if decision.action == "finish_pass":
                # Evaluate objective stop condition
                is_pass = observation["is_within_drift_tolerance"] and (
                    observation["audio_drift_from_target_seconds"] <= observation["max_allowed_drift_seconds"]
                )
                final_status = "PASS" if is_pass else "FAIL"
                state["status"] = final_status
                state["iteration"] = iteration
                self.save_state(state)

                event = {
                    "event_type": "LOOP_TERMINATED",
                    "iteration": iteration,
                    "state_before": state_before,
                    "observation": observation,
                    "model_decision": decision.model_dump(),
                    "validated_action": decision.action,
                    "objective_verification": {
                        "is_within_drift_tolerance": observation["is_within_drift_tolerance"],
                        "target_drift": observation["audio_drift_from_target_seconds"],
                        "result_status": final_status,
                    },
                    "state_after": state,
                }
                self.append_event(event)

                return {
                    "status": final_status,
                    "iterations": iteration,
                    "final_state": state,
                }

            # 4. Dispatch allowed tool
            tool_fn = TOOL_DISPATCH.get(decision.action)
            if not tool_fn:
                raise RuntimeError(f"Action '{decision.action}' passed validator but missing in dispatch")

            # Execute tool safely
            params_dict = decision.parameters.model_dump(exclude_none=True)
            tool_result = tool_fn(state, **params_dict)
            state["iteration"] = iteration
            self.save_state(state)

            event = {
                "event_type": "TOOL_EXECUTION",
                "iteration": iteration,
                "state_before": state_before,
                "observation": observation,
                "model_decision": decision.model_dump(),
                "validated_action": decision.action,
                "tool_result": tool_result,
                "state_after": copy.deepcopy(state),
            }
            self.append_event(event)

        # Max iterations reached without finish_pass
        state["status"] = "EXHAUSTED"
        self.save_state(state)
        return {
            "status": "EXHAUSTED",
            "iterations": self.max_iterations,
            "final_state": state,
        }
