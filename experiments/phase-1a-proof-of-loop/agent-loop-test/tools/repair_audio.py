"""
Tool: repair_audio
Modifies only system audio duration state to the requested target duration.
Deterministic, isolated, no shell access, structured input/output.
"""
from typing import Any, Dict


def run_repair_audio(state: Dict[str, Any], target_duration_seconds: float) -> Dict[str, Any]:
    if "system" not in state or "audio_duration_seconds" not in state["system"]:
        return {
            "success": False,
            "tool": "repair_audio",
            "error": "Invalid state: missing system.audio_duration_seconds",
        }

    previous = float(state["system"]["audio_duration_seconds"])
    new_duration = round(float(target_duration_seconds), 4)

    # Mutate strictly within allowed boundary
    state["system"]["audio_duration_seconds"] = new_duration

    return {
        "success": True,
        "tool": "repair_audio",
        "previous_duration": previous,
        "new_duration": new_duration,
        "message": f"Audio duration updated from {previous}s to {new_duration}s",
    }
