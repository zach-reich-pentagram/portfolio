#!/bin/bash
# Double-click to run this app: starts serve.py (which also saves exports into png/, mp4/ …)
# and opens the app in the browser. Close this window, or press Ctrl-C, to stop it.
# The port is the one in .claude/launch.json, so the preview and this open the same address.
cd "$(dirname "$0")" || exit 1
PORT=$(python3 -c 'import json; print(next(c["port"] for c in json.load(open(".claude/launch.json"))["configurations"] if "serve.py" in c.get("runtimeArgs", [])))' 2>/dev/null || echo 8000)
URL="http://127.0.0.1:$PORT/"
close() { read -n 1 -s -r -p "Press any key to close this window."; echo; exit "${1:-0}"; }

# What's on the port? serve.py refuses a save without its header (403); a plain server can't
# save at all (501); nothing listening is 000.
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 1 -X POST "${URL}__save/probe.png")
if [ "$code" = 403 ]; then
  echo "Already running at $URL"
  open "$URL"
  exit 0
fi
if [ "$code" != 000 ]; then
  pid=$(lsof -t -nP -iTCP:"$PORT" -sTCP:LISTEN | head -1)
  cwd=$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')
  # an older `python3 -m http.server` for this same folder can't save exports: swap it for serve.py
  if ps -o command= -p "$pid" | grep -q 'http.server' && [ "$cwd" = "$PWD" ]; then
    echo "Replacing the plain server on port $PORT with serve.py, so exports save into this folder"
    kill "$pid"
    for i in $(seq 1 20); do lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null || break; sleep 0.25; done
  else
    echo "Port $PORT is in use by something else:"
    ps -o pid=,command= -p "$pid"
    echo "Stop that, or change this project's port in .claude/launch.json, then double-click again."
    close 1
  fi
fi

echo "Starting $(basename "$PWD") at $URL"
( for i in $(seq 1 20); do curl -s -o /dev/null --max-time 1 "$URL" && break; sleep 0.25; done; open "$URL" ) &
python3 serve.py "$PORT" || close 1
