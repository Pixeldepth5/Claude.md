#!/usr/bin/env python3
# ============================================================
#  Mandir Kiosk Dashboard
#  Status + health, live preview, switch, reboot, media upload,
#  live-reload media, guest upload queue with approval, and
#  per-kiosk diagnostics. Runs ON a kiosk, served to the WiFi.
#
#  Open (admin):  http://<this-kiosk-ip>:8000
#  Guest link:    http://<this-kiosk-ip>:8000/guest
#  Display:       http://<this-kiosk-ip>:8000/display
# ============================================================

import os
import re
import glob
import json
import time
import uuid
import base64
import shlex
import socket
import shutil
import platform
import threading
import mimetypes
import subprocess
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

# ------------------------------------------------------------
# Configuration
# ------------------------------------------------------------

BASE_DIR = os.environ.get("KIOSK_HOME", os.path.expanduser("~/mandir-kiosk"))
MEDIA_DIR = os.path.join(BASE_DIR, "media")
PENDING_DIR = os.path.join(BASE_DIR, "pending")
STATE_PATH = os.path.join(BASE_DIR, "state.json")
TOKEN_PATH = os.path.join(BASE_DIR, "admin_token.txt")
PREVIEW_TMP = os.path.join(BASE_DIR, ".preview.png")

PORT = int(os.environ.get("KIOSK_PORT", "8000"))
SLIDE_SECONDS = os.environ.get("KIOSK_SLIDE_SECONDS", "8")
PEERS = [p.strip() for p in os.environ.get("KIOSK_PEERS", "").split(",") if p.strip()]

ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".mp4", ".mov", ".webm"}
VIDEO_EXTENSIONS = {".mp4", ".mov", ".webm"}
MEDIA_GLOBS = ("*.jpg", "*.jpeg", "*.png", "*.gif", "*.webp", "*.mp4", "*.mov", "*.webm")
MAX_UPLOAD_BYTES = 50 * 1024 * 1024

PREVIEW_COMMANDS = [
    "grim {out}",
    "scrot -o {out}",
    "import -window root {out}",
    "raspi2png -p {out}",
]

_state_lock = threading.Lock()
_preview_lock = threading.Lock()

ADMIN_TOKEN = None  # set in main()


# ------------------------------------------------------------
# State (media version + forced "current" slide) persistence
# ------------------------------------------------------------

def load_state():
    if os.path.isfile(STATE_PATH):
        try:
            with open(STATE_PATH) as f:
                return json.load(f)
        except (OSError, json.JSONDecodeError):
            pass
    return {"version": 0, "current": None}


def save_state():
    with open(STATE_PATH, "w") as f:
        json.dump(STATE, f)


def bump_version():
    with _state_lock:
        STATE["version"] = STATE.get("version", 0) + 1
        save_state()


def get_media_version():
    return STATE.get("version", 0)


STATE = load_state()


# ------------------------------------------------------------
# Admin token
# ------------------------------------------------------------

def load_or_create_admin_token():
    env_token = os.environ.get("KIOSK_ADMIN_TOKEN")
    if env_token:
        return env_token
    if os.path.isfile(TOKEN_PATH):
        with open(TOKEN_PATH) as f:
            token = f.read().strip()
            if token:
                return token
    token = uuid.uuid4().hex
    with open(TOKEN_PATH, "w") as f:
        f.write(token)
    os.chmod(TOKEN_PATH, 0o600)
    return token


# ------------------------------------------------------------
# Health / diagnostics
# ------------------------------------------------------------

def get_uptime_seconds():
    try:
        with open("/proc/uptime") as f:
            return float(f.read().split()[0])
    except (OSError, ValueError, IndexError):
        return None


def get_mem_info():
    try:
        info = {}
        with open("/proc/meminfo") as f:
            for line in f:
                key, _, rest = line.partition(":")
                info[key.strip()] = rest.strip()
        total = int(info.get("MemTotal", "0 kB").split()[0])
        avail = int(info.get("MemAvailable", "0 kB").split()[0])
        if not total:
            return None
        return {
            "total_mb": total // 1024,
            "available_mb": avail // 1024,
            "used_percent": round((1 - avail / total) * 100, 1),
        }
    except (OSError, ValueError, IndexError):
        return None


def get_lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except OSError:
        try:
            return socket.gethostbyname(socket.gethostname())
        except OSError:
            return "127.0.0.1"
    finally:
        s.close()


def is_kiosk_browser_running():
    if platform.system() != "Linux":
        return None
    needles = ("chromium", "chrome")
    for proc_dir in glob.glob("/proc/[0-9]*"):
        try:
            with open(os.path.join(proc_dir, "cmdline"), "rb") as f:
                cmdline = f.read().decode("utf-8", "replace").lower()
        except OSError:
            continue
        if any(n in cmdline for n in needles):
            return True
    return False


def get_health():
    disk = shutil.disk_usage(BASE_DIR)
    load = os.getloadavg() if hasattr(os, "getloadavg") else None
    return {
        "hostname": socket.gethostname(),
        "ip": get_lan_ip(),
        "platform": platform.platform(),
        "python": platform.python_version(),
        "uptime_seconds": get_uptime_seconds(),
        "load_avg": load,
        "disk": {
            "total_gb": round(disk.total / 2 ** 30, 2),
            "used_gb": round(disk.used / 2 ** 30, 2),
            "free_gb": round(disk.free / 2 ** 30, 2),
            "percent_used": round(disk.used / disk.total * 100, 1),
        },
        "memory": get_mem_info(),
        "kiosk_browser_running": is_kiosk_browser_running(),
        "media_count": len(list_media()),
        "pending_count": len(list_pending()),
        "media_version": get_media_version(),
        "timestamp": time.time(),
    }


def check_peer(peer):
    url = "http://{}/api/health".format(peer)
    try:
        with urllib.request.urlopen(url, timeout=3) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return {"peer": peer, "ok": True, "health": data}
    except (urllib.error.URLError, OSError, json.JSONDecodeError, ValueError) as exc:
        return {"peer": peer, "ok": False, "error": str(exc)}


def get_diagnostics():
    results = []
    if PEERS:
        with ThreadPoolExecutor(max_workers=min(8, len(PEERS))) as pool:
            results = list(pool.map(check_peer, PEERS))
    return {"self": get_health(), "peers": results}


# ------------------------------------------------------------
# Media listing
# ------------------------------------------------------------

def _list_dir(directory):
    files = []
    for pattern in MEDIA_GLOBS:
        files.extend(glob.glob(os.path.join(directory, pattern)))
    files.sort(key=lambda p: os.path.getmtime(p))
    items = []
    for path in files:
        name = os.path.basename(path)
        stat = os.stat(path)
        items.append({
            "name": name,
            "size": stat.st_size,
            "mtime": stat.st_mtime,
            "is_video": os.path.splitext(name)[1].lower() in VIDEO_EXTENSIONS,
        })
    return items


def list_media():
    items = _list_dir(MEDIA_DIR)
    for item in items:
        item["url"] = "/media/" + item["name"]
    return items


def list_pending():
    return _list_dir(PENDING_DIR)


# ------------------------------------------------------------
# Uploads
# ------------------------------------------------------------

def sanitize_filename(raw_name):
    base = os.path.basename(raw_name or "").strip()
    ext = os.path.splitext(base)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        return None
    stem = re.sub(r"[^A-Za-z0-9_-]+", "-", os.path.splitext(base)[0]).strip("-") or "media"
    unique = "{}-{}".format(int(time.time()), uuid.uuid4().hex[:8])
    return "{}-{}{}".format(stem, unique, ext)


def parse_multipart(body, boundary):
    delimiter = b"--" + boundary
    files = []
    for segment in body.split(delimiter):
        if not segment or segment in (b"--", b"--\r\n", b"\r\n"):
            continue
        if segment.startswith(b"\r\n"):
            segment = segment[2:]
        if segment.endswith(b"\r\n"):
            segment = segment[:-2]
        header_blob, sep, content = segment.partition(b"\r\n\r\n")
        if not sep:
            continue
        headers = header_blob.decode("utf-8", "replace")
        m = re.search(r'filename="([^"]*)"', headers)
        if not m or not m.group(1):
            continue
        files.append((m.group(1), content))
    return files


# ------------------------------------------------------------
# Preview capture
# ------------------------------------------------------------

def capture_preview():
    custom = os.environ.get("KIOSK_PREVIEW_CMD")
    candidates = [custom] if custom else PREVIEW_COMMANDS
    with _preview_lock:
        for cmd_tpl in candidates:
            if not cmd_tpl:
                continue
            cmd = shlex.split(cmd_tpl.format(out=PREVIEW_TMP))
            try:
                result = subprocess.run(cmd, capture_output=True, timeout=8)
            except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
                continue
            if result.returncode == 0 and os.path.isfile(PREVIEW_TMP) and os.path.getsize(PREVIEW_TMP) > 0:
                with open(PREVIEW_TMP, "rb") as f:
                    data = f.read()
                os.remove(PREVIEW_TMP)
                return data
    return None


# ------------------------------------------------------------
# HTML pages
# ------------------------------------------------------------

def render_display_page():
    return DISPLAY_HTML.replace("__SLIDE_SECONDS__", SLIDE_SECONDS)


def render_admin_page():
    return ADMIN_HTML


def render_guest_page():
    return GUEST_HTML


DISPLAY_HTML = """<!doctype html>
<html><head><meta charset="utf-8"><title>Mandir Display</title>
<style>
  html,body{margin:0;height:100%;background:#000;overflow:hidden;}
  #stage{width:100%;height:100%;display:flex;align-items:center;justify-content:center;}
  #stage img,#stage video{max-width:100%;max-height:100%;object-fit:contain;}
  #empty{color:#caa;font-family:sans-serif;font-size:2vw;text-align:center;}
</style></head>
<body>
<div id="stage"><div id="empty">Waiting for media&hellip;</div></div>
<script>
const SLIDE_SECONDS = __SLIDE_SECONDS__;
let items = [];
let version = -1;
let index = 0;
let forcedCurrent = null;
let timer = null;

async function refreshMedia() {
  try {
    const res = await fetch('/api/media');
    const data = await res.json();
    if (data.version !== version) {
      version = data.version;
      items = data.items;
      forcedCurrent = data.current;
      index = 0;
      render();
    }
  } catch (e) { /* keep showing last known media on transient network errors */ }
}

function currentItem() {
  if (forcedCurrent) return items.find(i => i.name === forcedCurrent) || null;
  if (!items.length) return null;
  return items[index % items.length];
}

function render() {
  clearTimeout(timer);
  const stage = document.getElementById('stage');
  const item = currentItem();
  if (!item) {
    stage.innerHTML = '<div id="empty">Waiting for media&hellip;</div>';
    timer = setTimeout(advance, SLIDE_SECONDS * 1000);
    return;
  }
  stage.innerHTML = '';
  if (item.is_video) {
    const v = document.createElement('video');
    v.src = item.url; v.autoplay = true; v.muted = true; v.playsInline = true;
    v.onended = advance;
    stage.appendChild(v);
  } else {
    const img = document.createElement('img');
    img.src = item.url;
    stage.appendChild(img);
    timer = setTimeout(advance, SLIDE_SECONDS * 1000);
  }
}

function advance() {
  if (!forcedCurrent && items.length) index = (index + 1) % items.length;
  render();
}

refreshMedia();
render();
setInterval(refreshMedia, 5000);
</script>
</body></html>
"""

GUEST_HTML = """<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Share a Photo</title>
<style>
 body{font-family:sans-serif;background:#fff7ea;color:#3a1f0d;margin:0;padding:24px;}
 h1{color:#b5442f;font-size:1.4rem;}
 form{display:flex;flex-direction:column;gap:12px;max-width:420px;}
 input[type=file]{padding:12px;border:2px dashed #d99a4e;border-radius:8px;background:#fff;}
 button{padding:14px;border:none;border-radius:8px;background:#b5442f;color:#fff;font-size:1rem;}
 #status{margin-top:16px;font-size:0.95rem;}
</style></head>
<body>
<h1>Share your photo or video</h1>
<p>Uploads are reviewed before appearing on the kiosk screens.</p>
<form id="f">
<input type="file" name="file" accept="image/*,video/*" required>
<button type="submit">Upload</button>
</form>
<div id="status"></div>
<script>
document.getElementById('f').addEventListener('submit', async (e) => {
  e.preventDefault();
  const status = document.getElementById('status');
  const fd = new FormData(e.target);
  status.textContent = 'Uploading...';
  try {
    const res = await fetch('/guest/upload', { method: 'POST', body: fd });
    const data = await res.json();
    if (res.ok) {
      status.textContent = 'Thanks! Your upload is waiting for approval.';
      e.target.reset();
    } else {
      status.textContent = 'Error: ' + (data.error || 'upload failed');
    }
  } catch (err) {
    status.textContent = 'Network error, please try again.';
  }
});
</script>
</body></html>
"""

ADMIN_HTML = """<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mandir Kiosk Admin</title>
<style>
 body{font-family:sans-serif;background:#fdf6ec;color:#2c1a0d;margin:0;padding:16px;}
 h1{color:#b5442f;}
 section{background:#fff;border:1px solid #eee2cf;border-radius:10px;padding:16px;margin-bottom:16px;}
 h2{margin-top:0;font-size:1.1rem;color:#8a3a24;}
 .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;}
 .card{border:1px solid #eee;border-radius:8px;overflow:hidden;background:#fafafa;}
 .card img,.card video{width:100%;height:100px;object-fit:cover;display:block;}
 .card .name{font-size:0.75rem;padding:4px;word-break:break-all;}
 .card .actions{display:flex;gap:4px;padding:4px;flex-wrap:wrap;}
 button{cursor:pointer;border:none;border-radius:6px;padding:6px 10px;font-size:0.8rem;}
 .btn-approve{background:#4a8f4a;color:#fff;}
 .btn-reject,.btn-delete,.btn-danger{background:#b5442f;color:#fff;}
 .btn-switch{background:#d99a4e;color:#3a1f0d;}
 .stat{display:inline-block;margin-right:16px;}
 #tokenBar input{padding:8px;width:260px;}
 #preview img{max-width:100%;border-radius:8px;}
</style></head>
<body>
<h1>Mandir Kiosk Admin</h1>
<div id="tokenBar">
  Admin token: <input id="token" type="password" placeholder="paste admin token">
  <button onclick="saveToken()">Save</button>
</div>

<section><h2>Status &amp; Health</h2><div id="health">Loading...</div></section>
<section><h2>Live Preview</h2><button onclick="loadPreview()">Capture preview</button><div id="preview"></div></section>
<section><h2>Upload media</h2>
  <form id="uploadForm"><input type="file" name="file" accept="image/*,video/*" required><button type="submit">Upload</button></form>
</section>
<section><h2>Media Library</h2><div id="media" class="grid">Loading...</div>
  <p><button class="btn-danger" onclick="clearSwitch()">Resume rotation</button></p>
</section>
<section><h2>Guest Upload Queue</h2><div id="pending" class="grid">Loading...</div></section>
<section><h2>Per-kiosk Diagnostics</h2><button onclick="loadDiagnostics()">Refresh diagnostics</button><div id="diagnostics"></div></section>
<section><h2>Power</h2><button class="btn-danger" onclick="reboot()">Reboot kiosk</button></section>

<script>
function getToken(){ return localStorage.getItem('kioskAdminToken') || ''; }
function saveToken(){
  localStorage.setItem('kioskAdminToken', document.getElementById('token').value.trim());
  refreshAll();
}
document.getElementById('token').value = getToken();

function authHeaders(extra){
  return Object.assign({'X-Admin-Token': getToken()}, extra || {});
}

async function loadHealth(){
  const res = await fetch('/api/health');
  const h = await res.json();
  document.getElementById('health').innerHTML = `
    <span class="stat"><b>Host:</b> ${h.hostname} (${h.ip})</span>
    <span class="stat"><b>Uptime:</b> ${h.uptime_seconds ? Math.round(h.uptime_seconds/60) + ' min' : 'n/a'}</span>
    <span class="stat"><b>Disk:</b> ${h.disk.percent_used}% used</span>
    <span class="stat"><b>Mem:</b> ${h.memory ? h.memory.used_percent + '%' : 'n/a'}</span>
    <span class="stat"><b>Browser running:</b> ${h.kiosk_browser_running}</span>
    <span class="stat"><b>Media:</b> ${h.media_count} live / ${h.pending_count} pending</span>`;
}

async function loadPreview(){
  document.getElementById('preview').textContent = 'Capturing...';
  const res = await fetch('/api/preview', { headers: authHeaders() });
  const data = await res.json();
  if (res.ok) {
    document.getElementById('preview').innerHTML = `<img src="${data.image}">`;
  } else {
    document.getElementById('preview').textContent = 'Error: ' + data.error;
  }
}

async function loadMedia(){
  const res = await fetch('/api/media');
  const data = await res.json();
  document.getElementById('media').innerHTML = data.items.map(item => `
    <div class="card">
      ${item.is_video ? `<video src="${item.url}" muted></video>` : `<img src="${item.url}">`}
      <div class="name">${item.name}${data.current === item.name ? ' (LIVE)' : ''}</div>
      <div class="actions">
        <button class="btn-switch" onclick="switchTo('${item.name}')">Switch</button>
        <button class="btn-delete" onclick="deleteMedia('${item.name}')">Delete</button>
      </div>
    </div>`).join('') || '<p>No media yet.</p>';
}

async function loadPending(){
  const res = await fetch('/api/pending', { headers: authHeaders() });
  if (!res.ok) { document.getElementById('pending').innerHTML = '<p>Enter admin token to view.</p>'; return; }
  const data = await res.json();
  document.getElementById('pending').innerHTML = data.items.map(item => `
    <div class="card">
      ${item.is_video
        ? `<video src="/pending/${item.name}?token=${encodeURIComponent(getToken())}" muted></video>`
        : `<img src="/pending/${item.name}?token=${encodeURIComponent(getToken())}">`}
      <div class="name">${item.name}</div>
      <div class="actions">
        <button class="btn-approve" onclick="pendingAction('${item.name}', true)">Approve</button>
        <button class="btn-reject" onclick="pendingAction('${item.name}', false)">Reject</button>
      </div>
    </div>`).join('') || '<p>No pending uploads.</p>';
}

async function pendingAction(name, approve){
  await fetch(approve ? '/api/pending/approve' : '/api/pending/reject', {
    method: 'POST', headers: authHeaders({'Content-Type': 'application/json'}), body: JSON.stringify({name})
  });
  refreshAll();
}

async function deleteMedia(name){
  if (!confirm('Delete ' + name + '?')) return;
  await fetch('/api/media/delete', { method: 'POST', headers: authHeaders({'Content-Type': 'application/json'}), body: JSON.stringify({name}) });
  refreshAll();
}

async function switchTo(name){
  await fetch('/api/switch', { method: 'POST', headers: authHeaders({'Content-Type': 'application/json'}), body: JSON.stringify({name}) });
  refreshAll();
}

async function clearSwitch(){
  await fetch('/api/switch/clear', { method: 'POST', headers: authHeaders() });
  refreshAll();
}

async function loadDiagnostics(){
  const res = await fetch('/api/diagnostics', { headers: authHeaders() });
  if (!res.ok) { document.getElementById('diagnostics').textContent = 'Enter admin token to view.'; return; }
  const data = await res.json();
  document.getElementById('diagnostics').innerHTML = data.peers.length ? data.peers.map(p => `
    <div><b>${p.peer}:</b> ${p.ok ? 'OK (' + p.health.hostname + ')' : 'unreachable - ' + p.error}</div>`).join('')
    : '<p>No peer kiosks configured (set KIOSK_PEERS).</p>';
}

async function reboot(){
  if (!confirm('Reboot this kiosk now?')) return;
  await fetch('/api/reboot', { method: 'POST', headers: authHeaders() });
  alert('Reboot triggered.');
}

document.getElementById('uploadForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const res = await fetch('/api/upload?token=' + encodeURIComponent(getToken()), { method: 'POST', body: fd });
  if (res.ok) { e.target.reset(); refreshAll(); } else { alert('Upload failed'); }
});

function refreshAll(){
  loadHealth();
  loadMedia();
  loadPending();
}
refreshAll();
setInterval(refreshAll, 10000);
</script>
</body></html>
"""


# ------------------------------------------------------------
# HTTP handler
# ------------------------------------------------------------

class KioskHandler(BaseHTTPRequestHandler):
    server_version = "MandirKiosk/1.0"
    protocol_version = "HTTP/1.1"

    # -- response helpers --

    def _send_bytes(self, status, content_type, data):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _send_json(self, status, obj):
        self._send_bytes(status, "application/json", json.dumps(obj).encode("utf-8"))

    def _send_html(self, status, html):
        self._send_bytes(status, "text/html; charset=utf-8", html.encode("utf-8"))

    def _read_json_body(self, length):
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            return {}

    def _require_admin(self, query):
        token = self.headers.get("X-Admin-Token") or (query.get("token") or [None])[0]
        if not token or token != ADMIN_TOKEN:
            self._send_json(401, {"error": "unauthorized"})
            return False
        return True

    def _serve_file(self, base_dir, name):
        safe_name = os.path.basename(name)
        path = os.path.join(base_dir, safe_name)
        if not os.path.isfile(path):
            return self._send_json(404, {"error": "not found"})
        ctype, _ = mimetypes.guess_type(path)
        with open(path, "rb") as f:
            data = f.read()
        self._send_bytes(200, ctype or "application/octet-stream", data)

    # -- GET --

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)

        if path == "/":
            return self._send_html(200, render_admin_page())
        if path == "/guest":
            return self._send_html(200, render_guest_page())
        if path == "/display":
            return self._send_html(200, render_display_page())
        if path == "/api/health":
            return self._send_json(200, get_health())
        if path == "/api/media":
            return self._send_json(200, {
                "version": get_media_version(),
                "current": STATE.get("current"),
                "items": list_media(),
            })
        if path == "/api/pending":
            if not self._require_admin(query):
                return
            return self._send_json(200, {"items": list_pending()})
        if path == "/api/diagnostics":
            if not self._require_admin(query):
                return
            return self._send_json(200, get_diagnostics())
        if path == "/api/preview":
            if not self._require_admin(query):
                return
            data = capture_preview()
            if data is None:
                return self._send_json(503, {"error": "preview capture unavailable on this system"})
            encoded = base64.b64encode(data).decode("ascii")
            return self._send_json(200, {"image": "data:image/png;base64," + encoded})
        if path.startswith("/media/"):
            return self._serve_file(MEDIA_DIR, path[len("/media/"):])
        if path.startswith("/pending/"):
            if not self._require_admin(query):
                return
            return self._serve_file(PENDING_DIR, path[len("/pending/"):])

        self._send_json(404, {"error": "not found"})

    # -- POST --

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)
        length = int(self.headers.get("Content-Length", 0) or 0)

        if path == "/guest/upload":
            return self._handle_upload(length, PENDING_DIR, bump=False)
        if path == "/api/upload":
            if not self._require_admin(query):
                return
            return self._handle_upload(length, MEDIA_DIR, bump=True)
        if path == "/api/pending/approve":
            if not self._require_admin(query):
                return
            return self._handle_pending_action(length, approve=True)
        if path == "/api/pending/reject":
            if not self._require_admin(query):
                return
            return self._handle_pending_action(length, approve=False)
        if path == "/api/media/delete":
            if not self._require_admin(query):
                return
            return self._handle_media_delete(length)
        if path == "/api/switch":
            if not self._require_admin(query):
                return
            return self._handle_switch(length)
        if path == "/api/switch/clear":
            if not self._require_admin(query):
                return
            STATE["current"] = None
            bump_version()
            return self._send_json(200, {"ok": True})
        if path == "/api/reboot":
            if not self._require_admin(query):
                return
            return self._handle_reboot()

        self._send_json(404, {"error": "not found"})

    def _handle_upload(self, length, target_dir, bump):
        if length <= 0:
            return self._send_json(400, {"error": "empty body"})
        if length > MAX_UPLOAD_BYTES:
            self.rfile.read(0)
            return self._send_json(413, {"error": "file too large"})
        content_type = self.headers.get("Content-Type", "")
        if "multipart/form-data" not in content_type:
            return self._send_json(400, {"error": "expected multipart/form-data"})
        m = re.search(r'boundary="?([^";]+)"?', content_type)
        if not m:
            return self._send_json(400, {"error": "missing boundary"})
        boundary = m.group(1).encode()
        body = self.rfile.read(length)
        files = parse_multipart(body, boundary)
        saved = []
        for original_name, content in files:
            safe_name = sanitize_filename(original_name)
            if not safe_name:
                continue
            with open(os.path.join(target_dir, safe_name), "wb") as f:
                f.write(content)
            saved.append(safe_name)
        if not saved:
            return self._send_json(400, {"error": "no supported file found in upload"})
        if bump:
            bump_version()
        return self._send_json(200, {"ok": True, "saved": saved})

    def _handle_pending_action(self, length, approve):
        data = self._read_json_body(length)
        name = os.path.basename(str(data.get("name", "")))
        src = os.path.join(PENDING_DIR, name)
        if not name or not os.path.isfile(src):
            return self._send_json(404, {"error": "pending file not found"})
        if approve:
            shutil.move(src, os.path.join(MEDIA_DIR, name))
            bump_version()
        else:
            os.remove(src)
        return self._send_json(200, {"ok": True})

    def _handle_media_delete(self, length):
        data = self._read_json_body(length)
        name = os.path.basename(str(data.get("name", "")))
        path = os.path.join(MEDIA_DIR, name)
        if not name or not os.path.isfile(path):
            return self._send_json(404, {"error": "file not found"})
        os.remove(path)
        if STATE.get("current") == name:
            STATE["current"] = None
        bump_version()
        return self._send_json(200, {"ok": True})

    def _handle_switch(self, length):
        data = self._read_json_body(length)
        name = os.path.basename(str(data.get("name", "")))
        if name and not os.path.isfile(os.path.join(MEDIA_DIR, name)):
            return self._send_json(404, {"error": "media not found"})
        STATE["current"] = name or None
        bump_version()
        return self._send_json(200, {"ok": True, "current": STATE["current"]})

    def _handle_reboot(self):
        self._send_json(200, {"ok": True, "message": "rebooting"})
        default_cmd = "shutdown /r /t 0" if platform.system() == "Windows" else "sudo reboot"
        cmd = os.environ.get("KIOSK_REBOOT_CMD", default_cmd)
        try:
            subprocess.Popen(shlex.split(cmd))
        except OSError:
            pass

    def log_message(self, fmt, *args):
        pass


# ------------------------------------------------------------
# Entry point
# ------------------------------------------------------------

def main():
    global ADMIN_TOKEN
    os.makedirs(MEDIA_DIR, exist_ok=True)
    os.makedirs(PENDING_DIR, exist_ok=True)
    ADMIN_TOKEN = load_or_create_admin_token()

    ip = get_lan_ip()
    print("Mandir Kiosk Dashboard")
    print("  Admin:   http://{}:{}/  (token: {})".format(ip, PORT, ADMIN_TOKEN))
    print("  Guest:   http://{}:{}/guest".format(ip, PORT))
    print("  Display: http://{}:{}/display".format(ip, PORT))

    server = ThreadingHTTPServer(("0.0.0.0", PORT), KioskHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
