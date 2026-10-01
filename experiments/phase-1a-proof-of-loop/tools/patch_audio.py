#!/usr/bin/env python3
"""
patch_audio.py — Audiovisual Asset Adaptation Tool
Adheres to: Tool responsibility, real execution, invoked as a result of agent diagnosis.
"""

import sys
import os
import argparse
import subprocess
from state_manager import log_event, verify_spec_integrity

EXPERIMENT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def adapt_audio_duration(input_audio: str, target_duration: float, output_audio: str):
    verify_spec_integrity()
    os.makedirs(os.path.dirname(output_audio), exist_ok=True)

    if not os.path.exists(input_audio):
        raise FileNotFoundError(f"Input audio does not exist: {input_audio}")

    # Precise audio trim & re-encode
    cmd = [
        "ffmpeg", "-y",
        "-i", input_audio,
        "-t", str(target_duration),
        "-c:a", "aac",
        "-b:a", "128k",
        "-ar", "48000",
        output_audio
    ]

    res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if res.returncode != 0:
        log_event(
            stage="PATCH_AUDIO",
            event="PATCH_AUDIO_FAILED",
            actor="TOOL",
            action="patch_audio.py",
            result="FAILURE",
            details={"error": res.stderr}
        )
        raise RuntimeError(f"FFmpeg audio patch failed:\n{res.stderr}")

    file_size = os.path.getsize(output_audio)
    log_event(
        stage="PATCH_AUDIO",
        event="PATCH_AUDIO_COMPLETED",
        actor="TOOL",
        action="patch_audio.py",
        result="SUCCESS",
        details={
            "inputAudio": input_audio,
            "outputAudio": output_audio,
            "targetDuration": target_duration,
            "fileSizeBytes": file_size
        }
    )
    print(f"Patched audio: {output_audio} (target: {target_duration}s, size: {file_size} bytes)")
    return output_audio


def main():
    parser = argparse.ArgumentParser(description="Adapt audio duration to contractual requirement.")
    parser.add_argument("--input", required=True)
    parser.add_argument("--target-duration", type=float, required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    adapt_audio_duration(args.input, args.target_duration, args.output)


if __name__ == "__main__":
    main()
