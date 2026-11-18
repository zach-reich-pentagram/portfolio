#!/usr/bin/env python3
"""Writes repos.json and media/: every repo beside this one tagged Green in the Finder, with the
Claude Code prompts sent about it and the images attached to them, read the way
conversation-summary reads them (its serve.py does the reading)."""
import importlib.util, json, mimetypes, plistlib, re, shutil, subprocess
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
VIDEO_MBPS = 4  # the site's videos: about 4 MB per 8 s, like a web compressor's Low at 1080p
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

# Sessions started in one repo that went on to work in another, which build.py can't tell by
# itself (a cloud session's paths aren't this Mac's): repo → the repos its sessions started in.
# Only the transcripts there that carry one of this repo's Claude-Session links are taken.
STARTED_IN = {'bad-news': ['auto-letterspace']}

def started_elsewhere(d):
    ids = set(re.findall(r'claude\.ai/code/(session_\w+)', subprocess.run(['git', '-C', d, 'log', '--all', '--format=%B'], capture_output=True, text=True).stdout))
    out = []
    for other in STARTED_IN.get(d.name, []):
        folder = cs.sessions_of(str(ROOT / other))
        for f in sorted(Path(folder).glob('*.jsonl')) if folder and ids else []:
            lines = f.read_text(errors='replace').splitlines()
            if any(i in l for l in lines for i in ids):
                for l in lines:
                    try: p = cs.prompt_of(json.loads(l), f.stem)
                    except ValueError: continue
                    if p: out.append(p)
    return out

own = {f.stem for f in Path(cs.sessions_of(str(HERE.parent)) or '/nonexistent').glob('*.jsonl')}
about = json.loads((HERE / 'about.json').read_text())
media = HERE / 'media'; media.mkdir(exist_ok=True)
repos = []
for d in sorted(ROOT.iterdir()):
    if not (d / '.git').exists() or not green(d): continue
    folder = cs.sessions_of(str(d))
    prompts = sorted((cs.read_prompts(folder) if folder else []) + cs.read_elsewhere(str(d), folder) + started_elsewhere(d), key=lambda p: p['ts'])
    # not this site's own sessions (building it runs commands in every repo), nor a teleport typed as a prompt
    prompts = [p for p in prompts if p['ts'] and p['session'] not in own and not re.match(r'\s*(claude\s+)?--teleport\b', p['text'])]
    prompts = [{'text': p['text'], 'images': p['images']} for p in merged(prompts)]
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
        out = media / d.name / (f.stem + '.mp4' if kind == 'video' else f.name)
        out.parent.mkdir(exist_ok=True)
        if not out.exists() or out.stat().st_mtime < f.stat().st_mtime:
            if kind == 'video':   # never the full file: H.264, 1080p at most, 4 Mbps, no audio (compress.swift)
                r = subprocess.run(['swift', HERE / 'compress.swift', f, out, str(VIDEO_MBPS)], capture_output=True, text=True)
                if r.returncode: print(f'  couldn’t compress {f.name}:', r.stdout.strip()[-300:]); continue
                print(f'  {f.name}: {f.stat().st_size / 1e6:.1f} MB → {out.stat().st_size / 1e6:.1f} MB')
            else: shutil.copy2(f, out)
        gallery.append({'type': kind, 'src': f'media/{d.name}/{out.name}'})
    repos.append({'name': d.name, **about.get(d.name, {}), 'date': date, 'prompts': prompts, 'gallery': gallery})
    print(d.name, len(prompts), 'prompts', sum(len(p['images']) for p in prompts), 'images', len(gallery), 'in portfolio')

for n in sorted(set(r['name'] for r in repos) - set(about)): print('  no title or description in about.json:', n)
(HERE / 'repos.json').write_text(json.dumps(repos, indent=1, ensure_ascii=False))
