#!/usr/bin/env python3
"""Writes repos.json and media/: every repo beside this one tagged Green in the Finder, with the
Claude Code prompts sent about it and the images attached to them, read the way
conversation-summary reads them (its serve.py does the reading)."""
import importlib.util, json, mimetypes, plistlib, re, shutil, subprocess
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]  # ~/Documents/GitHub
spec = importlib.util.spec_from_file_location('cs', ROOT / 'conversation-summary' / 'serve.py')
cs = importlib.util.module_from_spec(spec); spec.loader.exec_module(cs)

def green(p):
    r = subprocess.run(['xattr', '-px', 'com.apple.metadata:_kMDItemUserTags', p], capture_output=True, text=True)
    try: return 'Green' in [t.split('\n')[0] for t in plistlib.loads(bytes.fromhex(''.join(r.stdout.split())))]
    except ValueError: return False

def merged(prompts):
    """conversation-summary's 'Merge re-sent drafts': one sent again within ten minutes is one prompt."""
    flat, out = (lambda t: re.sub(r'\s+', ' ', t).strip()), []
    for p in prompts:
        q = out[-1] if out else None
        if q:
            a, b = flat(q['text']), flat(p['text'])
            near = (datetime.fromisoformat(p['ts'].replace('Z', '+00:00')) - datetime.fromisoformat(q['ts'].replace('Z', '+00:00'))).total_seconds() < 600
            if near and (a == b or (len(a) >= 12 and b.startswith(a.rstrip('.')[:len(a) - 3]))):
                out[-1] = {**p, 'images': p['images'] or q['images']}; continue
        out.append(p)
    return out

media = HERE / 'media'; media.mkdir(exist_ok=True)
repos = []
for d in sorted(ROOT.iterdir()):
    if not (d / '.git').exists() or not green(d): continue
    folder = cs.sessions_of(str(d))
    prompts = sorted((cs.read_prompts(folder) if folder else []) + cs.read_elsewhere(str(d), folder), key=lambda p: p['ts'])
    prompts = [{'text': p['text'], 'images': p['images']} for p in merged([p for p in prompts if p['ts']])]
    for p in prompts:
        names = []
        for k in p['images']:
            mime, data = cs.IMAGES[k]
            f = media / (k + (mimetypes.guess_extension(mime) or '.png'))
            if not f.exists(): f.write_bytes(data)
            names.append('media/' + f.name)
        p['images'] = names
    date = subprocess.run(['git', '-C', d, 'log', '-1', '--format=%cI'], capture_output=True, text=True).stdout.strip()
    # the repo's portfolio/ folder: its images and videos, copied in so the site can be published
    gallery = []
    for f in sorted((d / 'portfolio').glob('*')) if (d / 'portfolio').is_dir() else []:
        kind = (mimetypes.guess_type(f.name)[0] or '').split('/')[0]
        if kind not in ('image', 'video'): continue
        out = media / d.name / f.name
        out.parent.mkdir(exist_ok=True)
        if not out.exists() or out.stat().st_mtime < f.stat().st_mtime: shutil.copy2(f, out)
        gallery.append({'type': kind, 'src': f'media/{d.name}/{f.name}'})
    repos.append({'name': d.name, 'date': date, 'prompts': prompts, 'gallery': gallery})
    print(d.name, len(prompts), 'prompts', sum(len(p['images']) for p in prompts), 'images', len(gallery), 'in portfolio')

(HERE / 'repos.json').write_text(json.dumps(repos, indent=1, ensure_ascii=False))
