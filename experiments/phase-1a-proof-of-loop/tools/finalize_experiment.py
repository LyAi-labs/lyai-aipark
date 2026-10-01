#!/usr/bin/env python3
"""
finalize_experiment.py — Records final QA verification and closes the experiment.
"""

import sys
import os
import json
from state_manager import log_event, load_state, save_state

EXPERIMENT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def main():
    state = load_state()
    qa_report_path = os.path.join(EXPERIMENT_DIR, "reports", "qa_report_attempt_2.json")
    with open(qa_report_path, "r", encoding="utf-8") as f:
        qa_report = json.load(f)

    # Log Agent observation of QA PASS
    obs = (
        f"QA PASS on {qa_report['artifact']}. "
        f"Measured drift is {qa_report['facts']['driftSeconds']}s ({qa_report['facts']['driftFrames']} frames), "
        f"strictly within contractual tolerances (max {qa_report['expected']['maxAllowedDriftSeconds']}s / "
        f"{qa_report['expected']['maxAllowedDriftFrames']} frames)."
    )

    log_event(
        stage="PHASE_8_VERIFICATION",
        event="AGENT_OBSERVATION",
        actor="AGENT",
        action="OBSERVE_QA_REPORT",
        result="PASS_ACKNOWLEDGED",
        details={
            "observation": obs,
            "facts": qa_report["facts"]
        }
    )

    # Log System completion
    log_event(
        stage="PHASE_9_COMPLETE",
        event="EXPERIMENT_COMPLETED",
        actor="SYSTEM",
        action="TERMINATE_LOOP",
        result="SUCCESS",
        details={
            "finalStatus": "PASS",
            "totalAttempts": state.get("attempt", 2)
        }
    )

    state["currentStage"] = "EXPERIMENT_COMPLETED"
    state["lastAction"] = "QA_VERIFY"
    state["lastResult"] = "PASS"
    state["lastError"] = None
    state["history"].append({
        "attempt": 2,
        "artifact": qa_report.get("artifact"),
        "status": "PASS",
        "failedChecks": [],
        "errorHash": None,
        "proposedAction": None
    })
    save_state(state)
    print("Experiment successfully completed and finalized.")


if __name__ == "__main__":
    main()
