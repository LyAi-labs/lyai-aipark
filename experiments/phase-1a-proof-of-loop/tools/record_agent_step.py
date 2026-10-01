#!/usr/bin/env python3
"""
record_agent_step.py — Records the real Antigravity Agent's observation, diagnosis, and action
without hardcoding any simulation logic.
"""

import sys
import os
import json
import hashlib
import argparse
from state_manager import log_event, load_state, save_state, check_loop_detection

EXPERIMENT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def main():
    parser = argparse.ArgumentParser(description="Record agent observation, diagnosis, and action proposal.")
    parser.add_argument("--qa-report", required=True)
    parser.add_argument("--observation", required=True)
    parser.add_argument("--diagnosis", required=True)
    parser.add_argument("--proposed-action", required=True)
    args = parser.parse_args()

    state = load_state()
    with open(args.qa_report, "r", encoding="utf-8") as f:
        qa_data = json.load(f)

    # Compute deterministic error hash
    error_sig = json.dumps(qa_data.get("failedChecks", []), sort_keys=True) + f":{qa_data['facts'].get('driftSeconds')}"
    error_hash = hashlib.sha256(error_sig.encode()).hexdigest()[:12]

    # Verify loop detection
    loop_check = check_loop_detection(state, args.proposed_action, error_hash)
    if loop_check["isLoop"]:
        log_event(
            stage="AGENT_CONTROL",
            event="LOOP_DETECTED_HALT",
            actor="SYSTEM",
            action="check_loop_detection",
            result="HALT",
            details=loop_check
        )
        print(f"HALT: {loop_check['reason']}")
        sys.exit(2)

    # Record Agent Observation
    log_event(
        stage="PHASE_5_AGENT_DIAGNOSIS",
        event="AGENT_OBSERVATION",
        actor="AGENT",
        action="OBSERVE_QA_REPORT",
        result="FAIL_ACKNOWLEDGED",
        details={
            "observation": args.observation,
            "facts": qa_data.get("facts", {})
        }
    )

    # Record Agent Diagnosis
    log_event(
        stage="PHASE_5_AGENT_DIAGNOSIS",
        event="AGENT_DIAGNOSIS",
        actor="AGENT",
        action="DIAGNOSE_ROOT_CAUSE",
        result="DIAGNOSED",
        details={
            "diagnosis": args.diagnosis,
            "errorHash": error_hash
        }
    )

    # Record Agent Action Proposal
    log_event(
        stage="PHASE_5_AGENT_DIAGNOSIS",
        event="AGENT_ACTION_PROPOSAL",
        actor="AGENT",
        action="PROPOSE_CORRECTION",
        result="PROPOSED",
        details={
            "proposedAction": args.proposed_action
        }
    )

    # Update persistent state
    state["currentStage"] = "PHASE_5_AGENT_DIAGNOSIS"
    state["lastAction"] = "PROPOSE_CORRECTION"
    state["lastResult"] = "PROPOSED"
    state["lastError"] = qa_data.get("failedChecks", [])
    state["errorHash"] = error_hash
    state["history"].append({
        "attempt": qa_data.get("attempt", state.get("attempt", 1)),
        "artifact": qa_data.get("artifact"),
        "status": qa_data.get("status"),
        "failedChecks": qa_data.get("failedChecks", []),
        "errorHash": error_hash,
        "proposedAction": args.proposed_action
    })
    save_state(state)
    print("Agent observation, diagnosis, and action proposal recorded successfully.")


if __name__ == "__main__":
    main()
