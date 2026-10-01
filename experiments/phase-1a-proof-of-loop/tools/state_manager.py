#!/usr/bin/env python3
"""
state_manager.py — Persistent State & Structured Event Logging for Cartoon Factory
Adheres to: Minimal System, Maximum Signal & Strict Separation of Responsibilities.
"""

import sys
import os
import json
import hashlib
from datetime import datetime, timezone

WORKSPACE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SPEC_PATH = os.path.join(WORKSPACE_ROOT, "spec.json")
CONFIG_PATH = os.path.join(WORKSPACE_ROOT, "loop.config.json")
STATE_PATH = os.path.join(WORKSPACE_ROOT, "state", "pipeline.state.json")
EVENTS_PATH = os.path.join(WORKSPACE_ROOT, "logs", "events.jsonl")


def get_file_sha256(filepath: str) -> str:
    h = hashlib.sha256()
    with open(filepath, "rb") as f:
        while chunk := f.read(8192):
            h.update(chunk)
    return h.hexdigest()


def verify_spec_integrity() -> bool:
    """Invariance Check: spec.json must match immutable sha256."""
    if not os.path.exists(CONFIG_PATH):
        raise FileNotFoundError(f"Missing loop.config.json at {CONFIG_PATH}")
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        cfg = json.load(f)
    expected_hash = cfg.get("specSha256")
    actual_hash = get_file_sha256(SPEC_PATH)
    if expected_hash and actual_hash != expected_hash:
        raise ValueError(
            f"CRITICAL: Immutable contract violation! Expected {expected_hash}, got {actual_hash}"
        )
    return True


def log_event(stage: str, event: str, actor: str, action: str, result: str, details: dict):
    """Atomic append to events.jsonl."""
    os.makedirs(os.path.dirname(EVENTS_PATH), exist_ok=True)
    entry = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "stage": stage,
        "event": event,
        "actor": actor,  # SYSTEM | AGENT | TOOL | QA
        "action": action,
        "result": result,
        "details": details
    }
    with open(EVENTS_PATH, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    print(f"[{actor}][{stage}] {event}: {result}")


def load_state() -> dict:
    verify_spec_integrity()
    if not os.path.exists(STATE_PATH):
        raise FileNotFoundError(f"State file not found: {STATE_PATH}")
    with open(STATE_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def save_state(state: dict):
    verify_spec_integrity()
    os.makedirs(os.path.dirname(STATE_PATH), exist_ok=True)
    with open(STATE_PATH, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2, ensure_ascii=False)


def check_loop_detection(state: dict, proposed_action: str, error_hash: str) -> dict:
    """
    Extensible loop detector:
    - Detects repetitive failures (same error + same proposed action).
    - Detects attempt exhaustion against maxAttempts.
    """
    attempt = state.get("attempt", 0)
    max_attempts = state.get("maxAttempts", 3)
    history = state.get("history", [])

    if attempt >= max_attempts:
        return {
            "isLoop": True,
            "reason": f"Maximum retry attempts reached ({attempt}/{max_attempts})"
        }

    # Check consecutive identical errors & proposed actions
    identical_consecutive = 0
    for h in reversed(history):
        if h.get("errorHash") == error_hash and h.get("proposedAction") == proposed_action:
            identical_consecutive += 1
        else:
            break

    if identical_consecutive >= 2:
        return {
            "isLoop": True,
            "reason": f"Loop detected: Identical failure ({error_hash}) and action repeated {identical_consecutive} times"
        }

    return {"isLoop": False, "reason": None}


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "verify":
        verify_spec_integrity()
        print("Contract integrity verified: spec.json is unmodified.")
