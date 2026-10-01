#!/usr/bin/env python3
"""
generate_assets.py — Deterministic Audiovisual Asset Generator
Adheres to: Minimal System, Maximum Signal & Real physical media creation.
"""

import sys
import os
import argparse
import subprocess
from state_manager import log_event, verify_spec_integrity

EXPERIMENT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
ASSETS_DIR = os.path.join(EXPERIMENT_DIR, "assets")


def generate_video_asset(output_path: str, duration: float = 3.0, fps: int = 30, width: int = 1280, height: int = 720):
    """
    Generates a real 1280x720 30fps H.264 animation with a bouncing ball and frame indicators.
    Total frames = int(duration * fps).
    """
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    total_frames = int(duration * fps)

    # Complex filter producing a rich, deterministic visual:
    # 1. Dark blue canvas
    # 2. Bouncing hero (gold circle/box)
    # 3. Dynamic frame number / time indicator
    filter_complex = (
        f"color=c=0x101828:s={width}x{height}:d={duration}:r={fps},"
        f"drawbox=x='(w-80)/2+sin(t*3.5)*350':y='h-120-abs(sin(t*4))*(h-200)':w=80:h=80:color=0xF59E0B:t=fill,"
        f"drawtext=text='CARTOON FACTORY - PROOF OF LOOP':fontcolor=white:fontsize=32:x=50:y=50,"
        f"drawtext=text='FRAME %{{n}} / {total_frames}':fontcolor=0x94A3B8:fontsize=24:x=50:y=95,"
        f"drawtext=text='TIME %{{pts\\:hms}}':fontcolor=0x94A3B8:fontsize=24:x=50:y=130"
    )

    cmd = [
        "ffmpeg", "-y",
        "-f", "lavfi",
        "-i", filter_complex,
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-r", str(fps),
        "-t", str(duration),
        output_path
    ]

    res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if res.returncode != 0:
        raise RuntimeError(f"FFmpeg video generation failed:\n{res.stderr}")
    return output_path


def generate_audio_asset(output_path: str, duration: float = 4.2, sample_rate: int = 48000):
    """
    Generates a real AAC audio asset of specified duration.
    Produces harmonic arpeggio/tones.
    """
    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    # Audio synthesis: harmonic combination modulated over time
    filter_complex = (
        f"sine=frequency=440:sample_rate={sample_rate}:duration={duration},"
        f"volume=0.4"
    )

    cmd = [
        "ffmpeg", "-y",
        "-f", "lavfi",
        "-i", filter_complex,
        "-c:a", "aac",
        "-b:a", "128k",
        "-ar", str(sample_rate),
        "-t", str(duration),
        output_path
    ]

    res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if res.returncode != 0:
        raise RuntimeError(f"FFmpeg audio generation failed:\n{res.stderr}")
    return output_path


def main():
    parser = argparse.ArgumentParser(description="Generate raw audiovisual assets for Phase 1A.")
    parser.add_argument("--video-out", default=os.path.join(ASSETS_DIR, "hero_video_3s.mp4"))
    parser.add_argument("--audio-out", default=os.path.join(ASSETS_DIR, "audio_raw_4.2s.aac"))
    parser.add_argument("--audio-duration", type=float, default=4.20, help="Audio duration in seconds (deliberate 4.2s)")
    parser.add_argument("--video-duration", type=float, default=3.00, help="Video duration in seconds (3.0s)")
    parser.add_argument("--stage", default="PHASE_2_BASELINE_ASSETS")
    args = parser.parse_args()

    verify_spec_integrity()

    print(f"Generating video asset: {args.video_out} ({args.video_duration}s)...")
    generate_video_asset(args.video_out, duration=args.video_duration)

    print(f"Generating audio asset: {args.audio_out} ({args.audio_duration}s)...")
    generate_audio_asset(args.audio_out, duration=args.audio_duration)

    log_event(
        stage=args.stage,
        event="ASSETS_GENERATED",
        actor="TOOL",
        action="generate_assets.py",
        result="SUCCESS",
        details={
            "videoAsset": args.video_out,
            "videoDuration": args.video_duration,
            "audioAsset": args.audio_out,
            "audioDuration": args.audio_duration
        }
    )
    print("Assets successfully generated on disk.")


if __name__ == "__main__":
    main()
