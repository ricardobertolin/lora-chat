"""Serve the app on http://localhost:8000 for desktop testing.

    python serve.py                  # port 8000, or the next free one
    python serve.py 9000             # pin a port
    python serve.py --no-browser     # do not launch a browser

Browsers only expose Web Serial and WebUSB in a "secure context". localhost
counts as one, so this is enough for desktop. A phone cannot reach localhost on
your PC, so Android needs the app on real HTTPS - see README.
"""

import http.server
import sys
import webbrowser
from functools import partial
from pathlib import Path

PORT = 8000
ROOT = Path(__file__).parent


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".webmanifest": "application/manifest+json",
        ".js": "text/javascript",
    }

    def end_headers(self):
        # Always re-fetch during development; the service worker would otherwise
        # keep serving a stale copy of whatever you just edited.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        print(f"  {fmt % args}")


def serve(port, open_browser):
    handler = partial(Handler, directory=str(ROOT))
    # Threading matters: SimpleHTTPRequestHandler speaks HTTP/1.1 keep-alive, so
    # a single-threaded server stalls as soon as a browser holds a connection
    # open and a second request arrives.
    with http.server.ThreadingHTTPServer(("127.0.0.1", port), handler) as httpd:
        httpd.daemon_threads = True
        url = f"http://localhost:{port}/"
        print(f"serving {ROOT} at {url}")
        print("Ctrl-C to stop")
        if open_browser:
            webbrowser.open(url)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nstopped")


def main():
    args = [a for a in sys.argv[1:] if a != "--no-browser"]
    open_browser = "--no-browser" not in sys.argv[1:]

    pinned = bool(args)
    first = int(args[0]) if pinned else PORT

    # Something else may already own 8000 - walk forward rather than dying with
    # a bare "address already in use", unless a port was asked for explicitly.
    for port in range(first, first + (1 if pinned else 20)):
        try:
            serve(port, open_browser)
            return
        except OSError as exc:
            if pinned:
                sys.exit(f"cannot bind port {port}: {exc}")
            print(f"port {port} busy, trying {port + 1}")
    sys.exit("no free port found")


if __name__ == "__main__":
    main()
