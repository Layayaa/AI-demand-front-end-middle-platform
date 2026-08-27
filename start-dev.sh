#!/usr/bin/env bash

set -u

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$ROOT_DIR/platform/backend"
FRONTEND_DIR="$ROOT_DIR/platform/frontend"
RUNTIME_DIR="$ROOT_DIR/.runtime"

BACKEND_PID="$RUNTIME_DIR/backend.pid"
FRONTEND_PID="$RUNTIME_DIR/frontend.pid"
BACKEND_LOG="$RUNTIME_DIR/backend.log"
FRONTEND_LOG="$RUNTIME_DIR/frontend.log"

mkdir -p "$RUNTIME_DIR"

is_running() {
  local pid_file="$1"
  [ -f "$pid_file" ] || return 1
  local pid
  pid="$(tr -d '[:space:]' < "$pid_file")"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

clear_stale_pid() {
  local pid_file="$1"
  if [ -f "$pid_file" ] && ! is_running "$pid_file"; then
    rm -f "$pid_file"
  fi
}

start_backend() {
  clear_stale_pid "$BACKEND_PID"
  if is_running "$BACKEND_PID"; then
    printf '%s\n' "backend already running"
    return
  fi
  if curl -fsS --max-time 2 http://127.0.0.1:8001/api/health >/dev/null 2>&1; then
    printf '%s\n' "backend already listening on port 8001"
    return
  fi
  if [ ! -x "$BACKEND_DIR/.venv/bin/python" ]; then
    printf '%s\n' "backend venv not found: $BACKEND_DIR/.venv/bin/python" >&2
    exit 1
  fi
  (
    cd "$BACKEND_DIR" || exit 1
    nohup .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8001 \
      >"$BACKEND_LOG" 2>&1 &
    printf '%s' "$!" >"$BACKEND_PID"
  )
}

start_frontend() {
  clear_stale_pid "$FRONTEND_PID"
  if is_running "$FRONTEND_PID"; then
    printf '%s\n' "frontend already running"
    return
  fi
  if curl -fsS --max-time 2 http://127.0.0.1:4173/ >/dev/null 2>&1; then
    printf '%s\n' "frontend already listening on port 4173"
    return
  fi
  if [ ! -x "$FRONTEND_DIR/node_modules/.bin/vite" ]; then
    printf '%s\n' "frontend dependencies not found; run npm install in $FRONTEND_DIR" >&2
    exit 1
  fi
  (
    cd "$FRONTEND_DIR" || exit 1
    nohup npm run dev -- --host 0.0.0.0 --port 4173 \
      >"$FRONTEND_LOG" 2>&1 &
    printf '%s' "$!" >"$FRONTEND_PID"
  )
}

stop_service() {
  local name="$1"
  local pid_file="$2"
  if ! is_running "$pid_file"; then
    rm -f "$pid_file"
    printf '%s\n' "$name is not managed by this script"
    return
  fi
  local pid
  pid="$(tr -d '[:space:]' < "$pid_file")"
  kill -TERM "$pid" 2>/dev/null || true
  rm -f "$pid_file"
  printf '%s\n' "$name stopped"
}

status() {
  if is_running "$BACKEND_PID"; then
    printf '%s\n' "backend: running (pid $(tr -d '[:space:]' < "$BACKEND_PID"))"
  elif curl -fsS --max-time 2 http://127.0.0.1:8001/api/health >/dev/null 2>&1; then
    printf '%s\n' "backend: listening on 8001 (started elsewhere)"
  else
    printf '%s\n' "backend: stopped"
  fi

  if is_running "$FRONTEND_PID"; then
    printf '%s\n' "frontend: running (pid $(tr -d '[:space:]' < "$FRONTEND_PID"))"
  elif curl -fsS --max-time 2 http://127.0.0.1:4173/ >/dev/null 2>&1; then
    printf '%s\n' "frontend: listening on 4173 (started elsewhere)"
  else
    printf '%s\n' "frontend: stopped"
  fi
}

get_lan_ip() {
  local interface
  local ip
  for interface in en0 en1; do
    ip="$(ipconfig getifaddr "$interface" 2>/dev/null || true)"
    if [ -n "$ip" ]; then
      printf '%s' "$ip"
      return
    fi
  done
  ifconfig 2>/dev/null | awk '
    $1 == "inet" &&
    ($2 ~ /^10\./ || $2 ~ /^192\.168\./ || $2 ~ /^172\.(1[6-9]|2[0-9]|3[0-1])\./) {
      print $2
      exit
    }
  '
}

print_share_url() {
  local lan_ip
  lan_ip="$(get_lan_ip)"
  if [ -n "$lan_ip" ]; then
    printf '%s\n' "http://$lan_ip:4173/"
  else
    printf '%s\n' "未检测到局域网 IP，请先连接 Wi-Fi 或办公网络"
  fi
}

case "${1:-start}" in
  start)
    start_backend
    start_frontend
    sleep 2
    status
    printf '\n%s\n' "share this address with coworkers on the same network:"
    print_share_url
    printf '%s\n' "logs: $RUNTIME_DIR/*.log"
    ;;
  stop)
    stop_service "frontend" "$FRONTEND_PID"
    stop_service "backend" "$BACKEND_PID"
    ;;
  restart)
    "$0" stop
    sleep 1
    "$0" start
    ;;
  status)
    status
    ;;
  share-url)
    print_share_url
    ;;
  *)
    printf '%s\n' "usage: $0 {start|stop|restart|status}" >&2
    exit 2
    ;;
esac
