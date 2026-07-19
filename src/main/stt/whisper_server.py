#!/usr/bin/env python3
"""Susurro STT server.

A tiny stdin/stdout JSON-lines server around faster-whisper, spawned and
managed by the Electron main process. It never opens a socket and never
touches the network: the model directory it loads from was downloaded ahead
of time by the app, and audio arrives as paths to local WAV files.

Protocol (one JSON object per line):
  in : {"id": 1, "cmd": "load", "model_dir": "/path", "compute_type": "int8"}
  out: {"id": 1, "ok": true}
  in : {"id": 2, "cmd": "transcribe", "path": "/tmp/x.wav"}
  out: {"id": 2, "ok": true, "text": "hello world"}
  in : {"id": 3, "cmd": "ping"}
  out: {"id": 3, "ok": true, "pong": true}
On startup emits: {"event": "ready"}
"""

import json
import os
import sys

model = None
model_dir = None


def reply(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def handle_load(msg):
    global model, model_dir
    from faster_whisper import WhisperModel

    requested = msg["model_dir"]
    if model is not None and model_dir == requested:
        return {"ok": True, "cached": True}
    # local_files_only guarantees faster-whisper never reaches for the network.
    model = WhisperModel(
        requested,
        device="cpu",
        compute_type=msg.get("compute_type", "int8"),
        local_files_only=True,
    )
    model_dir = requested
    return {"ok": True}


def handle_transcribe(msg):
    if model is None:
        return {"ok": False, "error": "no model loaded"}
    path = msg["path"]
    if not os.path.isfile(path):
        return {"ok": False, "error": f"audio file not found: {path}"}
    segments, _info = model.transcribe(
        path,
        language=msg.get("language"),
        vad_filter=True,
        beam_size=5,
    )
    text = " ".join(seg.text.strip() for seg in segments).strip()
    return {"ok": True, "text": text}


HANDLERS = {
    "load": handle_load,
    "transcribe": handle_transcribe,
    "ping": lambda msg: {"ok": True, "pong": True},
}


def main():
    reply({"event": "ready"})
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        msg_id = None
        try:
            msg = json.loads(line)
            msg_id = msg.get("id")
            handler = HANDLERS.get(msg.get("cmd"))
            if handler is None:
                out = {"ok": False, "error": f"unknown cmd: {msg.get('cmd')}"}
            else:
                out = handler(msg)
        except Exception as exc:  # surfaced to the app, never swallowed
            out = {"ok": False, "error": str(exc)}
        out["id"] = msg_id
        reply(out)


if __name__ == "__main__":
    main()
