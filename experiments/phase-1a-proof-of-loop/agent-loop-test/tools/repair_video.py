"""
Tool: repair_video
Modifies only system video duration state to the requested target duration.
Deterministic, isolated, no shell access, structured input/output.
"""
from typing import Any, Dict


def run_repair_video(state: Dict[str, Any], target_duration_seconds: float) -> Dict[str, Any]:
    if "system" not in state or "video_duration_seconds" not in state["system"]:
        return {
            "success": False,
            "tool": "repair_video",
            "error": "Invalid state: missing system.video_duration_seconds",
        }

    previous = float(state["system"]["video_duration_seconds"])
    new_duration = round(float(target_duration_seconds), 4)

    # Mutate strictly within allowed boundary
    state["system"]["video_duration_seconds"] = new_duration

    return {
        "success": True,
        "tool": "repair_video",
        "previous_duration": previous,
        "new_duration": new_duration,
        "message": f"Video duration updated from {previous}s to {new_duration}s",
    }
