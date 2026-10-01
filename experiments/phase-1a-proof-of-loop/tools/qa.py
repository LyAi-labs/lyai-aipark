#!/usr/bin/env python3
"""
qa.py — Independent Hard QA Tool for Cartoon Factory
Adheres to: Objective measurement, zero simulation, separation of FACTS vs AGENT INTERPRETATION.
"""

import sys
import os
import json
import argparse
import subprocess
from state_manager import log_event, verify_spec_integrity

EXPERIMENT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
REPORTS_DIR = os.path.join(EXPERIMENT_DIR, "reports")


def run_ffprobe_json(file_path: str) -> dict:
    """Executes ffprobe extracting streams, packets, format in structured JSON."""
    cmd = [
        "ffprobe",
        "-v", "error",
        "-show_format",
        "-show_streams",
        "-count_frames",
        "-print_format", "json",
        file_path
    ]
    res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8")
    if res.returncode != 0:
        raise RuntimeError(f"ffprobe failed for {file_path}:\n{res.stderr}")
    return json.loads(res.stdout)


def evaluate_qa(artifact_path: str, spec_path: str, attempt: int = 1) -> dict:
    verify_spec_integrity()
    os.makedirs(REPORTS_DIR, exist_ok=True)

    with open(spec_path, "r", encoding="utf-8") as f:
        spec = json.load(f)

    # 1. Existence and physical file size
    file_exists = os.path.exists(artifact_path)
    if not file_exists:
        report = {
            "status": "FAIL",
            "attempt": attempt,
            "artifact": artifact_path,
            "failedChecks": ["FILE_NOT_FOUND"],
            "facts": {"file_exists": False},
            "expected": {"file_exists": True},
            "actual": {"file_exists": False},
            "diagnosticSignals": ["Target render artifact does not exist on disk."],
            "exitCode": 1
        }
        return report

    file_size_bytes = os.path.getsize(artifact_path)

    # 2. Probe media with ffprobe
    probe_data = run_ffprobe_json(artifact_path)
    streams = probe_data.get("streams", [])
    fmt = probe_data.get("format", {})

    video_streams = [s for s in streams if s.get("codec_type") == "video"]
    audio_streams = [s for s in streams if s.get("codec_type") == "audio"]

    video_stream_exists = len(video_streams) > 0
    audio_stream_exists = len(audio_streams) > 0

    v_stream = video_streams[0] if video_stream_exists else {}
    a_stream = audio_streams[0] if audio_stream_exists else {}

    # Extract exact metrics
    # Video
    video_codec = v_stream.get("codec_name", "")
    width = int(v_stream.get("width", 0))
    height = int(v_stream.get("height", 0))

    # FPS
    r_fps_str = v_stream.get("r_frame_rate", "0/1")
    if "/" in r_fps_str:
        num, den = r_fps_str.split("/")
        fps = float(num) / float(den) if float(den) != 0 else 0.0
    else:
        fps = float(r_fps_str)

    # Frame count
    # ffprobe nb_read_frames or nb_frames
    frame_count_str = v_stream.get("nb_read_frames") or v_stream.get("nb_frames") or "0"
    frame_count = int(frame_count_str)

    # Video Duration
    video_dur_str = v_stream.get("duration") or fmt.get("duration", "0")
    video_duration = float(video_dur_str)

    # Audio
    audio_codec = a_stream.get("codec_name", "")
    audio_dur_str = a_stream.get("duration") or fmt.get("duration", "0")
    audio_duration = float(audio_dur_str)

    # Drift calculations
    drift_seconds = abs(video_duration - audio_duration)
    drift_frames = drift_seconds * (fps if fps > 0 else 30.0)

    # Expected values from immutable contract
    expected_fps = float(spec["fps"])
    expected_total_frames = int(spec["totalFrames"])
    expected_duration = float(spec["durationSeconds"])
    expected_width = int(spec["resolution"]["width"])
    expected_height = int(spec["resolution"]["height"])
    expected_vcodec = spec["videoCodec"].lower()
    expected_acodec = spec["audioCodec"].lower()
    max_drift_frames = float(spec["tolerances"]["maxDriftFrames"])
    max_drift_seconds = float(spec["tolerances"]["maxDriftSeconds"])

    # Map video codec alias (e.g. h264 -> h264)
    vcodec_match = expected_vcodec in video_codec.lower()
    acodec_match = expected_acodec in audio_codec.lower()

    # Fact sheet (pure objective measurements)
    facts = {
        "fileSizeBytes": file_size_bytes,
        "videoStreamExists": video_stream_exists,
        "videoCodec": video_codec,
        "width": width,
        "height": height,
        "fps": fps,
        "frameCount": frame_count,
        "videoDurationSeconds": round(video_duration, 4),
        "audioStreamExists": audio_stream_exists,
        "audioCodec": audio_codec,
        "audioDurationSeconds": round(audio_duration, 4),
        "driftSeconds": round(drift_seconds, 4),
        "driftFrames": round(drift_frames, 2),
        "containerDurationSeconds": round(float(fmt.get("duration", 0)), 4)
    }

    expected = {
        "videoStreamExists": True,
        "videoCodec": expected_vcodec,
        "width": expected_width,
        "height": expected_height,
        "fps": expected_fps,
        "frameCount": expected_total_frames,
        "videoDurationSeconds": expected_duration,
        "audioStreamExists": True,
        "audioCodec": expected_acodec,
        "audioDurationSeconds": expected_duration,
        "maxAllowedDriftSeconds": max_drift_seconds,
        "maxAllowedDriftFrames": max_drift_frames
    }

    actual = {
        "videoStreamExists": video_stream_exists,
        "videoCodec": video_codec,
        "width": width,
        "height": height,
        "fps": round(fps, 2),
        "frameCount": frame_count,
        "videoDurationSeconds": round(video_duration, 4),
        "audioStreamExists": audio_stream_exists,
        "audioCodec": audio_codec,
        "audioDurationSeconds": round(audio_duration, 4),
        "driftSeconds": round(drift_seconds, 4),
        "driftFrames": round(drift_frames, 2)
    }

    # Evaluate checks
    failed_checks = []
    diagnostic_signals = []

    if not video_stream_exists:
        failed_checks.append("MISSING_VIDEO_STREAM")
        diagnostic_signals.append("No video stream found in container.")
    else:
        if not vcodec_match:
            failed_checks.append("VIDEO_CODEC_MISMATCH")
            diagnostic_signals.append(f"Expected video codec {expected_vcodec}, observed {video_codec}")
        if width != expected_width or height != expected_height:
            failed_checks.append("RESOLUTION_MISMATCH")
            diagnostic_signals.append(f"Expected resolution {expected_width}x{expected_height}, observed {width}x{height}")
        if abs(fps - expected_fps) > 0.1:
            failed_checks.append("FPS_MISMATCH")
            diagnostic_signals.append(f"Expected fps {expected_fps}, observed {fps}")
        if frame_count != expected_total_frames:
            failed_checks.append("FRAME_COUNT_MISMATCH")
            diagnostic_signals.append(f"Expected frame count {expected_total_frames}, observed {frame_count}")
        if abs(video_duration - expected_duration) > max_drift_seconds:
            failed_checks.append("VIDEO_DURATION_MISMATCH")
            diagnostic_signals.append(f"Expected video duration {expected_duration}s, observed {video_duration:.4f}s")

    if not audio_stream_exists:
        failed_checks.append("MISSING_AUDIO_STREAM")
        diagnostic_signals.append("No audio stream found in container.")
    else:
        if not acodec_match:
            failed_checks.append("AUDIO_CODEC_MISMATCH")
            diagnostic_signals.append(f"Expected audio codec {expected_acodec}, observed {audio_codec}")
        if abs(audio_duration - expected_duration) > max_drift_seconds:
            failed_checks.append("AUDIO_DURATION_MISMATCH")
            diagnostic_signals.append(f"Expected audio duration {expected_duration}s, observed {audio_duration:.4f}s (diff: {audio_duration - expected_duration:+.4f}s)")

    # Drift check
    if drift_seconds > max_drift_seconds or drift_frames > max_drift_frames:
        failed_checks.append("AV_DRIFT_EXCEEDS_TOLERANCE")
        diagnostic_signals.append(
            f"AV drift of {drift_seconds:.4f}s ({drift_frames:.2f} frames) exceeds tolerance of {max_drift_seconds:.3f}s / {max_drift_frames} frame(s)."
        )

    overall_status = "PASS" if len(failed_checks) == 0 else "FAIL"

    report = {
        "status": overall_status,
        "attempt": attempt,
        "artifact": artifact_path,
        "failedChecks": failed_checks,
        "diagnosticSignals": diagnostic_signals,
        "facts": facts,
        "expected": expected,
        "actual": actual,
        "exitCode": 0 if overall_status == "PASS" else 1
    }

    # Save attempt report and latest report
    latest_report_path = os.path.join(REPORTS_DIR, "qa_report.json")
    attempt_report_path = os.path.join(REPORTS_DIR, f"qa_report_attempt_{attempt}.json")

    with open(latest_report_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
    with open(attempt_report_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)

    log_event(
        stage=f"QA_EVALUATION_ATTEMPT_{attempt}",
        event=f"QA_{overall_status}",
        actor="QA",
        action="qa.py",
        result=overall_status,
        details={
            "failedChecks": failed_checks,
            "driftSeconds": round(drift_seconds, 4),
            "videoDuration": round(video_duration, 4),
            "audioDuration": round(audio_duration, 4),
            "reportSaved": latest_report_path
        }
    )

    return report


def main():
    parser = argparse.ArgumentParser(description="Objective Hard QA tool for Cartoon Factory artifacts.")
    parser.add_argument("--artifact", required=True, help="Path to rendered MP4")
    parser.add_argument("--spec", default=os.path.join(EXPERIMENT_DIR, "spec.json"))
    parser.add_argument("--attempt", type=int, default=1)
    args = parser.parse_args()

    report = evaluate_qa(args.artifact, args.spec, attempt=args.attempt)
    print(f"\n--- HARD QA RESULT: {report['status']} (Attempt {args.attempt}) ---")
    print(f"Artifact: {args.artifact}")
    print(f"Failed Checks: {report['failedChecks']}")
    for sig in report["diagnosticSignals"]:
        print(f"  • {sig}")
    print(f"Report written to reports/qa_report.json and reports/qa_report_attempt_{args.attempt}.json")

    sys.exit(report["exitCode"])


if __name__ == "__main__":
    main()
