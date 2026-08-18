#!/usr/bin/env python3
"""NOVUM PC Bridge v0.1 - local-only Windows agent for ChatGPT Web extension.

Zero third-party Python dependencies. The agent listens on 127.0.0.1 and requires
an authentication token for every tool call.
"""

from __future__ import annotations

import argparse
import base64
import getpass
import json
import os
import platform
import secrets
import socket
import subprocess
import sys
import tempfile
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

APP_DIR = Path(os.environ.get("NOVUM_HOME", Path.home() / ".novum-pc-bridge"))
CONFIG_PATH = APP_DIR / "config.json"
TOKEN_PATH = APP_DIR / "token.txt"
LOG_PATH = APP_DIR / "actions.jsonl"
SCREENSHOT_DIR = APP_DIR / "screenshots"

DEFAULT_CONFIG = {
    "host": "127.0.0.1",
    "port": 8765,
    "allowed_roots": ["%USERPROFILE%"],
    "allow_write": True,
    "allow_shell": False,
    "shell_timeout_seconds": 120,
    "max_read_bytes": 2_000_000,
    "max_list_entries": 500,
}


def ensure_state() -> None:
    APP_DIR.mkdir(parents=True, exist_ok=True)
    SCREENSHOT_DIR.mkdir(parents=True, exist_ok=True)
    if not CONFIG_PATH.exists():
        CONFIG_PATH.write_text(json.dumps(DEFAULT_CONFIG, indent=2), encoding="utf-8")
    if not TOKEN_PATH.exists():
        TOKEN_PATH.write_text(secrets.token_hex(32), encoding="utf-8")


def load_config() -> dict[str, Any]:
    ensure_state()
    config = dict(DEFAULT_CONFIG)
    try:
        config.update(json.loads(CONFIG_PATH.read_text(encoding="utf-8")))
    except Exception as exc:
        raise RuntimeError(f"Invalid config: {CONFIG_PATH}: {exc}") from exc
    config["allowed_roots"] = [os.path.abspath(os.path.expandvars(os.path.expanduser(p))) for p in config["allowed_roots"]]
    return config


def read_token() -> str:
    ensure_state()
    return TOKEN_PATH.read_text(encoding="utf-8").strip()


def log_action(tool: str, args: dict[str, Any], ok: bool, detail: str = "") -> None:
    record = {
        "ts": time.time(),
        "tool": tool,
        "args": args,
        "ok": ok,
        "detail": detail[:1000],
    }
    with LOG_PATH.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(record, ensure_ascii=False) + "\n")


def is_within(path: Path, root: Path) -> bool:
    try:
        return os.path.commonpath([os.path.normcase(str(path)), os.path.normcase(str(root))]) == os.path.normcase(str(root))
    except ValueError:
        return False


def checked_path(raw: str | None, config: dict[str, Any], *, must_exist: bool = False) -> Path:
    if not raw:
        raw = str(Path.home())
    path = Path(os.path.expandvars(os.path.expanduser(raw))).resolve(strict=False)
    roots = [Path(r).resolve(strict=False) for r in config["allowed_roots"]]
    if not any(is_within(path, root) for root in roots):
        raise PermissionError(f"Path is outside allowed_roots: {path}")
    if must_exist and not path.exists():
        raise FileNotFoundError(str(path))
    return path


def ps_quote(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def powershell(script: str, timeout: int = 30) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["powershell.exe", "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
        capture_output=True,
        text=True,
        timeout=timeout,
        encoding="utf-8",
        errors="replace",
    )


def tool_pc_status(args: dict[str, Any], config: dict[str, Any]) -> dict[str, Any]:
    return {
        "hostname": socket.gethostname(),
        "user": getpass.getuser(),
        "platform": platform.platform(),
        "python": sys.version.split()[0],
        "cwd": os.getcwd(),
        "home": str(Path.home()),
        "allowed_roots": config["allowed_roots"],
        "allow_write": bool(config["allow_write"]),
        "allow_shell": bool(config["allow_shell"]),
    }


def tool_fs_list(args: dict[str, Any], config: dict[str, Any]) -> dict[str, Any]:
    path = checked_path(args.get("path"), config, must_exist=True)
    if not path.is_dir():
        raise NotADirectoryError(str(path))
    entries = []
    limit = min(int(args.get("limit", config["max_list_entries"])), int(config["max_list_entries"]))
    for child in sorted(path.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower())):
        try:
            stat = child.stat()
            entries.append({
                "name": child.name,
                "path": str(child),
                "type": "dir" if child.is_dir() else "file",
                "size": stat.st_size if child.is_file() else None,
                "modified": stat.st_mtime,
            })
        except OSError:
            entries.append({"name": child.name, "path": str(child), "type": "unknown"})
        if len(entries) >= limit:
            break
    return {"path": str(path), "entries": entries, "truncated": len(entries) >= limit}


def tool_fs_read(args: dict[str, Any], config: dict[str, Any]) -> dict[str, Any]:
    path = checked_path(args.get("path"), config, must_exist=True)
    if not path.is_file():
        raise IsADirectoryError(str(path))
    max_bytes = int(config["max_read_bytes"])
    data = path.read_bytes()
    if len(data) > max_bytes:
        raise ValueError(f"File too large ({len(data)} bytes > {max_bytes})")
    encoding = args.get("encoding", "utf-8")
    return {"path": str(path), "size": len(data), "content": data.decode(encoding, errors="replace")}


def tool_fs_write(args: dict[str, Any], config: dict[str, Any]) -> dict[str, Any]:
    if not config.get("allow_write"):
        raise PermissionError("Filesystem writes are disabled in config.json")
    path = checked_path(args.get("path"), config)
    content = args.get("content")
    if not isinstance(content, str):
        raise ValueError("content must be a string")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding=args.get("encoding", "utf-8"))
    return {"path": str(path), "bytes": path.stat().st_size}


def tool_fs_search(args: dict[str, Any], config: dict[str, Any]) -> dict[str, Any]:
    root = checked_path(args.get("path"), config, must_exist=True)
    query = str(args.get("query", "")).lower().strip()
    if not query:
        raise ValueError("query is required")
    limit = min(int(args.get("limit", 100)), 200)
    matches = []
    for current, dirs, files in os.walk(root):
        # Avoid common giant/noisy folders unless explicitly selected as root.
        dirs[:] = [d for d in dirs if d.lower() not in {".git", "node_modules", "__pycache__", ".venv", "venv"}]
        for name in dirs + files:
            if query in name.lower():
                matches.append(str(Path(current) / name))
                if len(matches) >= limit:
                    return {"root": str(root), "query": query, "matches": matches, "truncated": True}
    return {"root": str(root), "query": query, "matches": matches, "truncated": False}


def tool_shell_run(args: dict[str, Any], config: dict[str, Any]) -> dict[str, Any]:
    if not config.get("allow_shell"):
        raise PermissionError("shell.run is disabled. Enable allow_shell in ~/.novum-pc-bridge/config.json")
    command = args.get("command")
    if not isinstance(command, str) or not command.strip():
        raise ValueError("command is required")
    cwd = checked_path(args.get("cwd") or str(Path.home()), config, must_exist=True)
    if not cwd.is_dir():
        raise NotADirectoryError(str(cwd))
    timeout = min(int(args.get("timeout", config["shell_timeout_seconds"])), 600)
    completed = subprocess.run(
        command,
        cwd=str(cwd),
        shell=True,
        capture_output=True,
        text=True,
        timeout=timeout,
        encoding="utf-8",
        errors="replace",
    )
    return {
        "command": command,
        "cwd": str(cwd),
        "exit_code": completed.returncode,
        "stdout": completed.stdout[-200_000:],
        "stderr": completed.stderr[-200_000:],
    }


def tool_screen_capture(args: dict[str, Any], config: dict[str, Any]) -> dict[str, Any]:
    filename = f"screen-{int(time.time() * 1000)}.png"
    target = SCREENSHOT_DIR / filename
    q = ps_quote(str(target))
    script = (
        "Add-Type -AssemblyName System.Windows.Forms; "
        "Add-Type -AssemblyName System.Drawing; "
        "$b=[System.Windows.Forms.SystemInformation]::VirtualScreen; "
        "$bmp=New-Object System.Drawing.Bitmap $b.Width,$b.Height; "
        "$g=[System.Drawing.Graphics]::FromImage($bmp); "
        "$g.CopyFromScreen($b.Left,$b.Top,0,0,$bmp.Size); "
        f"$bmp.Save({q},[System.Drawing.Imaging.ImageFormat]::Png); "
        "$g.Dispose(); $bmp.Dispose();"
    )
    proc = powershell(script, timeout=30)
    if proc.returncode != 0 or not target.exists():
        raise RuntimeError(proc.stderr.strip() or "Screenshot failed")
    raw = target.read_bytes()
    return {
        "path": str(target),
        "mime": "image/png",
        "filename": filename,
        "image_base64": base64.b64encode(raw).decode("ascii"),
        "bytes": len(raw),
    }


def tool_clipboard_read(args: dict[str, Any], config: dict[str, Any]) -> dict[str, Any]:
    proc = powershell("Get-Clipboard -Raw", timeout=10)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or "Clipboard read failed")
    return {"text": proc.stdout}


def tool_clipboard_write(args: dict[str, Any], config: dict[str, Any]) -> dict[str, Any]:
    if not config.get("allow_write"):
        raise PermissionError("Writes are disabled in config.json")
    text = args.get("text")
    if not isinstance(text, str):
        raise ValueError("text must be a string")
    proc = powershell(f"Set-Clipboard -Value {ps_quote(text)}", timeout=10)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or "Clipboard write failed")
    return {"ok": True, "characters": len(text)}


TOOLS = {
    "pc.status": tool_pc_status,
    "fs.list": tool_fs_list,
    "fs.read": tool_fs_read,
    "fs.write": tool_fs_write,
    "fs.search": tool_fs_search,
    "shell.run": tool_shell_run,
    "screen.capture": tool_screen_capture,
    "clipboard.read": tool_clipboard_read,
    "clipboard.write": tool_clipboard_write,
}


class Handler(BaseHTTPRequestHandler):
    server_version = "NOVUM-PC-Bridge/0.1"

    def _json(self, status: int, payload: dict[str, Any]) -> None:
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Novum-Token")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()
        self.wfile.write(raw)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self._json(204, {})

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            self._json(200, {"ok": True, "version": "0.1.0", "tools": sorted(TOOLS)})
            return
        self._json(404, {"ok": False, "error": "not_found"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/tool":
            self._json(404, {"ok": False, "error": "not_found"})
            return
        if not secrets.compare_digest(self.headers.get("X-Novum-Token", ""), read_token()):
            self._json(401, {"ok": False, "error": "unauthorized"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 2_000_000:
                raise ValueError("Invalid request size")
            payload = json.loads(self.rfile.read(length))
            tool = payload.get("tool")
            args = payload.get("args") or {}
            if tool not in TOOLS:
                raise ValueError(f"Unknown tool: {tool}")
            if not isinstance(args, dict):
                raise ValueError("args must be an object")
            config = load_config()
            result = TOOLS[tool](args, config)
            log_action(tool, args, True)
            self._json(200, {"ok": True, "tool": tool, "result": result})
        except Exception as exc:
            tool = locals().get("tool", "unknown")
            args = locals().get("args", {}) if isinstance(locals().get("args", {}), dict) else {}
            log_action(str(tool), args, False, f"{type(exc).__name__}: {exc}")
            self._json(400, {"ok": False, "error": type(exc).__name__, "message": str(exc)})

    def log_message(self, fmt: str, *args: Any) -> None:
        # Keep terminal output quiet except startup; actions are persisted to actions.jsonl.
        return


def main() -> None:
    parser = argparse.ArgumentParser(description="NOVUM local PC bridge")
    parser.add_argument("--host", default=None)
    parser.add_argument("--port", type=int, default=None)
    args = parser.parse_args()

    ensure_state()
    config = load_config()
    host = args.host or config["host"]
    port = args.port or int(config["port"])

    if host not in {"127.0.0.1", "localhost", "::1"}:
        print("WARNING: non-loopback binding requested. v0.1 is designed for localhost only.", file=sys.stderr)

    server = ThreadingHTTPServer((host, port), Handler)
    print("NOVUM PC Bridge v0.1")
    print(f"Listening: http://{host}:{port}")
    print(f"Token:     {read_token()}")
    print(f"Config:    {CONFIG_PATH}")
    print(f"Logs:      {LOG_PATH}")
    print("Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
