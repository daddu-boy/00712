#!/usr/bin/env python3
"""
Broadcast a matter to everyone on your wifi, for as long as you hold Play down.

    ./relay.py

Then on this Mac open   https://localhost:8443/
and on any other device https://<the address it prints>:8443/

Nothing leaves your network. The matter is held in this process's memory only:
never written to disk, never sent anywhere, and gone the moment you quit.

Why the host controls are safe without a password: this server can see where each
request came from. A request from 127.0.0.1 is you, sitting at this Mac, so it is
served the Play/Stop control. A request from anywhere else on the network is a
viewer, and the write endpoints refuse it outright. There is no secret to leak
because there is no secret.

Self-signed certificate: browsers will warn once, and you accept it once per
device. That step is unavoidable for a server on a home network, and it is also
what makes VR work at all: WebXR requires a secure context, so a plain http://
address would silently offer no ENTER VR button.
"""

import http.server
import json
import os
import socket
import ssl
import subprocess
import sys
import threading
from pathlib import Path

HERE = Path(__file__).resolve().parent
PORT = int(os.environ.get("PORT", "8443"))
CERT_DIR = HERE / ".relay-cert"
CERT = CERT_DIR / "cert.pem"
KEY = CERT_DIR / "key.pem"

# The broadcast. One matter at a time, in memory, guarded by a lock because
# ThreadingHTTPServer will touch it from several threads at once.
_state = {"live": False, "version": 0, "project": None, "selectedLayerId": None}
_lock = threading.Lock()


def lan_ip() -> str:
    """Best guess at this Mac's address on the local network."""
    for iface in ("en0", "en1", "en2"):
        try:
            out = subprocess.run(["ipconfig", "getifaddr", iface],
                                 capture_output=True, text=True, timeout=3)
            if out.returncode == 0 and out.stdout.strip():
                return out.stdout.strip()
        except Exception:
            pass
    # Fall back to asking the routing table which address would be used outbound.
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("192.0.2.1", 1))       # reserved, never actually reached
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


def ensure_cert(ip: str) -> None:
    """Make a self-signed certificate once, naming both localhost and the LAN IP."""
    if CERT.exists() and KEY.exists():
        return
    CERT_DIR.mkdir(exist_ok=True)
    print("Making a self-signed certificate (once)…")
    subprocess.run([
        "openssl", "req", "-x509", "-newkey", "rsa:2048", "-sha256",
        "-days", "365", "-nodes",
        "-keyout", str(KEY), "-out", str(CERT),
        "-subj", "/CN=chauhaddi-relay",
        "-addext", f"subjectAltName=DNS:localhost,IP:127.0.0.1,IP:{ip}",
    ], check=True, capture_output=True)


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(HERE), **kw)

    # --- who is asking -----------------------------------------------------
    def is_host(self) -> bool:
        addr = self.client_address[0]
        return addr in ("127.0.0.1", "::1", "localhost")

    # --- plumbing ----------------------------------------------------------
    def _json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _deny(self):
        self._json({"error": "Only the Mac running this relay can control the broadcast."}, 403)

    def end_headers(self):
        # Never let a viewer's browser cache the app or the state.
        if self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        # One line per API call is useful; the flood of asset requests is not.
        if self.path.startswith("/api/state") and self.command == "GET":
            return
        sys.stderr.write("  %s %s %s\n" % (self.client_address[0], self.command, self.path))

    # --- routes ------------------------------------------------------------
    def do_GET(self):
        if self.path.startswith("/api/whoami"):
            return self._json({"relay": True, "host": self.is_host(), "port": PORT})
        if self.path.startswith("/api/state"):
            with _lock:
                if not _state["live"]:
                    return self._json({"live": False, "version": _state["version"]})
                return self._json({
                    "live": True,
                    "version": _state["version"],
                    "project": _state["project"],
                    "selectedLayerId": _state["selectedLayerId"],
                })
        return super().do_GET()

    def do_POST(self):
        if not self.path.startswith("/api/state"):
            return self.send_error(404)
        if not self.is_host():
            return self._deny()
        try:
            n = int(self.headers.get("Content-Length") or 0)
            if n > 12_000_000:
                return self._json({"error": "too large"}, 413)
            payload = json.loads(self.rfile.read(n) or b"{}")
        except Exception as e:
            return self._json({"error": f"bad payload: {e}"}, 400)

        with _lock:
            _state["live"] = True
            _state["version"] += 1
            _state["project"] = payload.get("project")
            _state["selectedLayerId"] = payload.get("selectedLayerId")
            v = _state["version"]
        return self._json({"ok": True, "version": v})

    def do_DELETE(self):
        if not self.path.startswith("/api/state"):
            return self.send_error(404)
        if not self.is_host():
            return self._deny()
        with _lock:
            _state["live"] = False
            _state["version"] += 1
            _state["project"] = None
            _state["selectedLayerId"] = None
        print("  broadcast stopped")
        return self._json({"ok": True, "live": False})


def main():
    ip = lan_ip()
    try:
        ensure_cert(ip)
    except FileNotFoundError:
        sys.exit("openssl not found. Install the Xcode command line tools and retry.")
    except subprocess.CalledProcessError as e:
        sys.exit(f"Could not make a certificate: {e.stderr.decode()[:400]}")

    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(certfile=str(CERT), keyfile=str(KEY))

    srv = http.server.ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    srv.socket = ctx.wrap_socket(srv.socket, server_side=True)

    print(f"""
  Chauhaddi relay is up. Nothing leaves this network.

    You, on this Mac      https://localhost:{PORT}/
    Everyone else         https://{ip}:{PORT}/

  Prepare the matter on this Mac, then press BROADCAST in the top bar. Anyone on
  this wifi who has the second address open will see it, and can enter VR from it.
  Press it again to stop, and it disappears from their screens.

  Every device sees a certificate warning the first time. Accept it once:
  Advanced, then proceed. It is your own Mac, and it is the reason VR works.

  Ctrl-C to stop the relay and erase the matter from memory.
""")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n  stopped, memory cleared")
        srv.shutdown()


if __name__ == "__main__":
    main()
