#!/usr/bin/env python3
"""Serve this folder on this machine, and save the app's exports into it.

    python3 serve.py [port]        (default 8000)

GET serves the folder, as `python3 -m http.server` does.
POST /__save/<name> writes the request body to ./<type>/<name>, the folder named for the file's
type: png/, jpg/, svg/, mp4/, webm/ … A name already taken gets -2, -3 … rather than being
overwritten. Only plain file names of a known type are accepted, only from pages this server
served (the X-Save header keeps other sites out), and it listens on 127.0.0.1 only.
POST /__settings replaces ./settings.json, which dev mode's Save writes (portfolio only).
"""
import http.server
import json
import os
import re
import sys
import urllib.parse

ROOT = os.path.dirname(os.path.abspath(__file__))
FOLDER = {'png': 'png', 'jpg': 'jpg', 'jpeg': 'jpg', 'webp': 'webp', 'gif': 'gif', 'svg': 'svg', 'pdf': 'pdf',
          'mp4': 'mp4', 'webm': 'webm', 'mov': 'mov', 'json': 'json', 'csv': 'csv', 'txt': 'txt',
          'otf': 'otf', 'ttf': 'ttf', 'woff': 'woff', 'woff2': 'woff2'}
NAME = re.compile(r'[A-Za-z0-9][A-Za-z0-9 ._-]{0,150}\.([A-Za-z0-9]{2,5})')
LIMIT = 4 * 1024 ** 3   # 4 GB: long recordings are big


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')   # always the app as it is on disk
        super().end_headers()

    def reply(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def save_settings(self):
        if self.headers.get('X-Save') != '1':
            return self.reply(403, {'error': 'missing X-Save header'})
        body = self.rfile.read(int(self.headers.get('Content-Length') or 0))
        try:
            if not isinstance(json.loads(body), dict):
                raise ValueError
        except ValueError:
            return self.reply(400, {'error': 'not a settings object'})
        tmp = os.path.join(ROOT, 'settings.json.part')
        with open(tmp, 'wb') as f:
            f.write(body)
        os.replace(tmp, os.path.join(ROOT, 'settings.json'))   # all or nothing
        return self.reply(200, {'path': 'settings.json'})

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        if path == '/__settings':
            return self.save_settings()
        if not path.startswith('/__save/'):
            return self.reply(404, {'error': 'not found'})
        # a custom header can't be sent cross-origin without a preflight, which this server never allows
        if self.headers.get('X-Save') != '1':
            return self.reply(403, {'error': 'missing X-Save header'})
        name = urllib.parse.unquote(path[len('/__save/'):])
        m = NAME.fullmatch(name)
        if not m or '..' in name or m.group(1).lower() not in FOLDER:
            return self.reply(400, {'error': f'not a plain file name of a known type: {name!r}'})
        length = int(self.headers.get('Content-Length') or 0)
        if not 0 < length <= LIMIT:
            return self.reply(413, {'error': 'empty or too large'})
        ext = m.group(1).lower()
        folder = os.path.join(ROOT, FOLDER[ext])
        os.makedirs(folder, exist_ok=True)
        stem, target, n = name[:-(len(ext) + 1)], os.path.join(folder, name), 2
        while os.path.exists(target):
            target = os.path.join(folder, f'{stem}-{n}.{ext}')
            n += 1
        with open(target, 'xb') as f:
            left = length
            while left:
                chunk = self.rfile.read(min(left, 1 << 20))
                if not chunk:
                    break
                f.write(chunk)
                left -= len(chunk)
        if left:
            os.remove(target)
            return self.reply(400, {'error': 'upload cut short'})
        rel = os.path.relpath(target, ROOT)
        print(f'saved {rel} ({length:,} bytes)', flush=True)
        return self.reply(200, {'path': rel})


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    print(f'Serving {ROOT} at http://127.0.0.1:{port}/ — exports save into png/, jpg/, svg/, mp4/ …', flush=True)
    http.server.ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever()
