#!/usr/bin/env python3
"""
render.py — FFmpeg Muxing & Render Tool for Cartoon Factory
Adheres to: Renderer adapter decoupling from control loop.
"""

import sys
import os
import argparse
import subprocess
from state_manager import log_event, verify_spec_integrity

EXPERIMENT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def render_artifact(video_input: str, audio_input: str, output_path: str, stage: str = "RENDER"):
    verify_spec_integrity()
    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    if not os.path.exists(video_input):
        raise FileNotFoundError(f"Video input not found: {video_input}")
    if not os.path.exists(audio_input):
        raise FileNotFoundError(f"Audio input not found: {audio_input}")

    # Standard muxing: encode or copy streams into MP4 container
    # Intentionally mux without -shortest or truncation unless already adapted
    cmd = [
        "ffmpeg", "-y",
        "-i", video_input,
        "-i", audio_input,
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "128k",
        "-movflags", "+faststart",
        output_path
    ]

    res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if res.returncode != 0:
        log_event(
            stage=stage,
            event="RENDER_FAILED",
            actor="TOOL",
            action="render.py",
            result="FAILURE",
            details={"error": res.stderr}
        )
        raise RuntimeError(f"FFmpeg render failed:\n{res.stderr}")

    file_size = os.path.getsize(output_path)
    log_event(
        stage=stage,
        event="RENDER_COMPLETED",
        actor="TOOL",
        action="render.py",
        result="SUCCESS",
        details={
            "outputArtifact": output_path,
            "videoInput": video_input,
            "audioInput": audio_input,
            "fileSizeBytes": file_size
        }
    )
    print(f"Rendered artifact: {output_path} ({file_size} bytes)")
    return output_path


def main():
    parser = argparse.ArgumentParser(description="Render/Mux audiovisual artifact.")
    parser.add_argument("--video-input", required=True)
    parser.add_argument("--audio-input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--stage", default="RENDER")
    args = parser.parse_args()

    render_artifact(args.video_input, args.audio_input, args.output, stage=args.stage)


if __name__ == "__main__":
    main()
