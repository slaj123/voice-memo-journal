"""
Transcribes every unarchived audio file in a folder locally with
faster-whisper, then submits each transcript to the Voice Memo Logger
Worker's /upload-transcript route (skips the Worker's own Whisper API call,
which is capped at 25MB — this is for the rare huge file that exceeds that).

Point this at a folder you drop big memos into (e.g. a synced Google Drive /
Dropbox folder). Each file that's successfully submitted gets moved into an
"archived" subfolder, so re-running only processes files you haven't dropped
in yet.

Usage:
    python transcribe_large_memo.py <folder> [--model medium]
        [--worker-url URL] [--upload-secret SECRET] [--app APP]

--app selects which app's /upload-transcript route to submit to: "legacy"
(default, un-prefixed /upload-transcript), "journal", "workout", or
"dailylog" (submits to /<app>/upload-transcript). Worker URL, secret, and
a default app can also be stored once in scripts/config.json (see
config.example.json) instead of passing them every time.

Example:
    python transcribe_large_memo.py "C:\\path\\to\\big-memos" --model medium --app journal
"""

import argparse
import json
import sys
import time
import urllib.request
from pathlib import Path

from faster_whisper import WhisperModel

AUDIO_EXTENSIONS = {".m4a", ".wav", ".mp3", ".caf", ".aac", ".mp4"}
CONFIG_PATH = Path(__file__).parent / "config.json"


def load_config():
    if CONFIG_PATH.exists():
        return json.loads(CONFIG_PATH.read_text())
    return {}


def find_pending_files(folder):
    archived_dir = folder / "archived"
    return sorted(
        f
        for f in folder.iterdir()
        if f.is_file() and f.suffix.lower() in AUDIO_EXTENSIONS and f.parent != archived_dir
    )


def transcribe(model, audio_path):
    segments, info = model.transcribe(str(audio_path))
    print(f"  Detected language: {info.language} (p={info.language_probability:.2f})", file=sys.stderr)
    return " ".join(segment.text.strip() for segment in segments).strip()


def submit_transcript(worker_url, upload_secret, transcript, app):
    prefix = "" if app == "legacy" else f"/{app}"
    url = worker_url.rstrip("/") + prefix + "/upload-transcript"
    body = json.dumps({"transcript": transcript}).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "X-Upload-Secret": upload_secret,
            "User-Agent": "Mozilla/5.0 (compatible; voice-memo-logger-script/1.0)",
        },
    )
    with urllib.request.urlopen(request) as response:
        return response.status, response.read().decode("utf-8")


def archive(audio_path, archived_dir):
    archived_dir.mkdir(exist_ok=True)
    destination = archived_dir / audio_path.name
    if destination.exists():
        destination = archived_dir / f"{audio_path.stem}-{int(time.time())}{audio_path.suffix}"
    audio_path.rename(destination)
    return destination


def main():
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("folder", help="Folder to scan for audio files")
    parser.add_argument(
        "--model",
        default="medium",
        help="faster-whisper model size (tiny/base/small/medium/large-v3). Default: medium",
    )
    parser.add_argument("--worker-url", help="Base URL of the deployed Worker (or set in config.json)")
    parser.add_argument("--upload-secret", help="Worker's UPLOAD_SECRET value (or set in config.json)")
    parser.add_argument(
        "--app",
        choices=["legacy", "journal", "workout", "dailylog"],
        help="Which app's /upload-transcript route to submit to (or set 'app' in config.json). Default: legacy",
    )
    args = parser.parse_args()

    config = load_config()
    worker_url = args.worker_url or config.get("worker_url")
    upload_secret = args.upload_secret or config.get("upload_secret")
    app = args.app or config.get("app", "legacy")
    if not worker_url or not upload_secret:
        print(
            "Missing worker URL / upload secret. Pass --worker-url and --upload-secret, "
            "or create scripts/config.json (see config.example.json).",
            file=sys.stderr,
        )
        sys.exit(1)

    folder = Path(args.folder)
    archived_dir = folder / "archived"
    pending = find_pending_files(folder)

    if not pending:
        print("No new audio files to process.")
        return

    print(f"Found {len(pending)} file(s) to process for app '{app}'. Loading model '{args.model}'...", file=sys.stderr)
    model = WhisperModel(args.model, device="cpu", compute_type="int8")

    for audio_path in pending:
        print(f"\n{audio_path.name}:", file=sys.stderr)
        try:
            transcript = transcribe(model, audio_path)
        except Exception as err:
            print(f"  Transcription failed: {err} — leaving file in place for retry.", file=sys.stderr)
            continue

        if not transcript:
            print("  Transcription produced no text — leaving file in place, not archiving.", file=sys.stderr)
            continue

        print(f"  Transcript ({len(transcript)} chars). Submitting...", file=sys.stderr)
        try:
            status, body = submit_transcript(worker_url, upload_secret, transcript, app)
        except Exception as err:
            print(f"  Submission failed: {err} — leaving file in place for retry.", file=sys.stderr)
            continue

        if status >= 300:
            print(f"  Worker returned {status}: {body} — leaving file in place for retry.", file=sys.stderr)
            continue

        destination = archive(audio_path, archived_dir)
        print(f"  Submitted (status {status}). Archived to {destination}", file=sys.stderr)

    print("\nDone.")


if __name__ == "__main__":
    main()
