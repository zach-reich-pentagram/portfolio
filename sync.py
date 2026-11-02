#!/usr/bin/env python3
"""Pull the Instagram posts into posts.json and media/, for the site to read.

    IG_TOKEN=… python3 sync.py            fetch the posts
    IG_TOKEN=… python3 sync.py --refresh  print a renewed token (Instagram Login: another 60 days)
    IG_TOKEN=… IG_APP_ID=… IG_APP_SECRET=… python3 sync.py --page-token
                                          print a lasting token (Facebook Login)
    python3 sync.py --check               self-check, no network

Pictures and videos are downloaded because Instagram's own URLs expire. The token stays in the
environment and never goes in a file here: the page only ever reads posts.json, so visitors never
get near it.

The token says which API to use: one starting EA is Facebook Login, whose Instagram account is
looked up through its Facebook Page; anything else is Instagram Login. IG_API overrides this.
"""
import json
import os
import pathlib
import ssl
import struct
import sys
import tempfile
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent
INSTAGRAM, FACEBOOK = 'https://graph.instagram.com/v26.0', 'https://graph.facebook.com/v26.0'
FIELDS = 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,children{id,media_type,media_url,thumbnail_url}'


# python.org's Python on a Mac has no certificates until its installer script is run: use the system's
TLS = ssl.create_default_context()
if not TLS.cert_store_stats()['x509_ca'] and os.path.exists('/etc/ssl/cert.pem'):
    TLS.load_verify_locations('/etc/ssl/cert.pem')


def fetch(url):
    with urllib.request.urlopen(url, timeout=120, context=TLS) as r:
        return r.read()


def facebook_pages(token, fields):
    """The Pages a Facebook Login token reaches. A Page token is its own Page, and has no list of them."""
    q = urllib.parse.urlencode({'fields': fields, 'access_token': token})
    try:
        return json.loads(fetch(f'{FACEBOOK}/me/accounts?{q}'))['data']
    except urllib.error.HTTPError:
        return [json.loads(fetch(f'{FACEBOOK}/me?{q}'))]


def linked_page(pages):
    """The Page linked to the portfolio's Instagram account, or else the first with any account linked."""
    linked = [p for p in pages if p.get('instagram_business_account')]
    if not linked:
        sys.exit('This token reaches no Facebook Page with an Instagram account linked. Link @zachalligraphy to a '
                 'Page, and give the token the instagram_basic and pages_show_list permissions.')
    return next((p for p in linked if p['instagram_business_account'].get('username') == 'zachalligraphy'), linked[0])


def api(token):
    if os.environ.get('IG_API'):
        return os.environ['IG_API']
    if token.startswith('EA'):
        page = linked_page(facebook_pages(token, 'instagram_business_account{id,username}'))
        return f"{FACEBOOK}/{page['instagram_business_account']['id']}"
    return f'{INSTAGRAM}/me'


def granted_pages(token, app_id, secret, fields):
    """Pages named in the token's own grant: /me/accounts can come back empty even when the token works."""
    q = urllib.parse.urlencode({'input_token': token, 'access_token': f'{app_id}|{secret}'})
    scopes = json.loads(fetch(f'{FACEBOOK}/debug_token?{q}'))['data'].get('granular_scopes', [])
    ids = {i for s in scopes if s['scope'].startswith('pages_') for i in s.get('target_ids', [])}
    q = urllib.parse.urlencode({'fields': fields, 'access_token': token})
    pages = []
    for i in ids:
        try:
            pages.append(json.loads(fetch(f'{FACEBOOK}/{i}?{q}')))
        except urllib.error.HTTPError:
            pass
    return pages


def page_token(token, app_id, secret):
    """Short-lived user token → 60-day user token → its Page's token, which has no set expiry."""
    q = urllib.parse.urlencode({'grant_type': 'fb_exchange_token', 'client_id': app_id, 'client_secret': secret, 'fb_exchange_token': token})
    long_lived = json.loads(fetch(f'{FACEBOOK}/oauth/access_token?{q}'))['access_token']
    fields = 'access_token,instagram_business_account{id,username}'
    pages = facebook_pages(long_lived, fields)
    if not any(p.get('instagram_business_account') for p in pages):
        pages = granted_pages(long_lived, app_id, secret, fields)
    if not any(p.get('instagram_business_account') and p.get('access_token') for p in pages):
        # ponytail: lasts 60 days with no renewal; replace by hand, or use a Business system user token
        print('No Page token available. This is a 60-day user token: it needs IG_API too (see README.md).', file=sys.stderr)
        return long_lived
    return linked_page(pages)['access_token']


def jpeg_size(data):
    """Width and height from a JPEG's header. The API doesn't report them, and a video's cover has the same shape."""
    i = 2
    while i + 9 < len(data) and data[:2] == b'\xff\xd8':
        marker, length = data[i + 1], struct.unpack('>H', data[i + 2:i + 4])[0]
        if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
            h, w = struct.unpack('>HH', data[i + 5:i + 9])
            return w, h
        i += 2 + length
    return 1, 1     # not a JPEG we can read: the page treats it as square and crops to fit


def pages(token):
    url = f'{api(token)}/media?' + urllib.parse.urlencode({'fields': FIELDS, 'limit': 50, 'access_token': token})
    while url:
        page = json.loads(fetch(url))
        yield from page.get('data', [])
        url = page.get('paging', {}).get('next')


def save(folder, name, url):
    """Download once: a post's media never changes, and a file already here needs no new URL."""
    path = folder / name
    if not path.exists():
        data = fetch(url)
        tmp = path.with_suffix(path.suffix + '.part')
        tmp.write_bytes(data)
        tmp.replace(path)   # never leaves half a file behind for the next run to trust
    return path


def frame(item, root):
    """One box on the grid, from a single post or a carousel's child."""
    media, fid = root / 'media', item['id']
    url, thumb = item.get('media_url'), item.get('thumbnail_url')
    rel = lambda p: p.relative_to(root).as_posix()
    if item.get('media_type') == 'VIDEO':
        # Instagram leaves media_url off videos with licensed audio: play your own copy from
        # originals/<id>.mp4 if there is one, otherwise show the cover as a still
        cover = save(media, f'{fid}-cover.jpg', thumb) if thumb else None
        size = jpeg_size(cover.read_bytes()) if cover else (1, 1)
        if url:
            out = {'id': fid, 'type': 'video', 'src': rel(save(media, f'{fid}.mp4', url))}
            if cover:
                out['poster'] = rel(cover)
        elif (root / 'originals' / f'{fid}.mp4').exists():
            out = {'id': fid, 'type': 'video', 'src': f'originals/{fid}.mp4'}
            if cover:
                out['poster'] = rel(cover)
        elif cover:
            out = {'id': fid, 'type': 'image', 'src': rel(cover)}
        else:
            return None
    elif url:
        pic = save(media, f'{fid}.jpg', url)
        size = jpeg_size(pic.read_bytes())
        out = {'id': fid, 'type': 'image', 'src': rel(pic)}
    else:
        return None
    return {**out, 'w': size[0], 'h': size[1]}


def sync(token, root=ROOT, items=None):
    (root / 'media').mkdir(exist_ok=True)
    posts = []
    for p in (pages(token) if items is None else items):
        kids = p.get('children', {}).get('data') if p.get('media_type') == 'CAROUSEL_ALBUM' else [p]
        media = [f for f in (frame(k, root) for k in kids or []) if f]
        if media:
            posts.append({'id': p['id'], 'caption': p.get('caption', ''), 'timestamp': p.get('timestamp', ''),
                          'permalink': p.get('permalink', ''), 'media': media})
    # Written only once everything has downloaded, so a failed run leaves the site as it was
    tmp = root / 'posts.json.part'
    tmp.write_text(json.dumps({'posts': posts}, indent=1, ensure_ascii=False) + '\n')
    tmp.replace(root / 'posts.json')
    # media of posts since deleted goes too, so the site follows the account
    keep = {f[k] for p in posts for f in p['media'] for k in ('src', 'poster') if k in f}
    for f in (root / 'media').iterdir():
        if f.relative_to(root).as_posix() not in keep:
            f.unlink()
    frames = sum(len(p['media']) for p in posts)
    print(f'{len(posts)} posts, {frames} frames')
    blank = sum(not p['caption'] for p in posts)
    if blank:
        print(f'WARNING: {blank} of {len(posts)} posts have no caption, so no title or description. If that is all '
              'of them, Instagram Login is not returning captions: use a Facebook Login token (see README.md).',
              file=sys.stderr)
    return posts


def check():
    global fetch
    # a smallest possible JPEG header: SOI, an APP0 to skip, SOF0 giving 1350 tall by 1080 wide
    jpg = b'\xff\xd8\xff\xe0\x00\x04ab\xff\xc0\x00\x11\x08' + struct.pack('>HH', 1350, 1080) + b'\x03' + b'\0' * 9
    assert jpeg_size(jpg) == (1080, 1350)
    assert jpeg_size(b'not a jpeg at all') == (1, 1)
    fetch = lambda url: jpg
    items = [
        {'id': '1', 'media_type': 'IMAGE', 'media_url': 'u', 'caption': 'Title\nBody', 'timestamp': 't', 'permalink': 'p'},
        {'id': '2', 'media_type': 'CAROUSEL_ALBUM', 'caption': 'Album', 'children': {'data': [
            {'id': '21', 'media_type': 'IMAGE', 'media_url': 'u'},
            {'id': '22', 'media_type': 'VIDEO', 'media_url': 'u', 'thumbnail_url': 'u'},
        ]}},
        {'id': '3', 'media_type': 'VIDEO', 'thumbnail_url': 'u', 'caption': 'Licensed audio'},
        {'id': '4', 'media_type': 'VIDEO', 'caption': 'Nothing to show'},
    ]
    with tempfile.TemporaryDirectory() as d:
        root = pathlib.Path(d)
        (root / 'media').mkdir()
        (root / 'media' / 'deleted-post.jpg').write_bytes(b'x')
        posts = sync('', root, items)
        assert [p['id'] for p in posts] == ['1', '2', '3']
        assert (posts[0]['media'][0]['w'], posts[0]['media'][0]['h']) == (1080, 1350)
        assert [f['type'] for f in posts[1]['media']] == ['image', 'video'] and posts[1]['media'][1]['poster'] == 'media/22-cover.jpg'
        assert posts[2]['media'][0] == {'id': '3', 'type': 'image', 'src': 'media/3-cover.jpg', 'w': 1080, 'h': 1350}
        assert not (root / 'media' / 'deleted-post.jpg').exists() and (root / 'media' / '1.jpg').exists()
        assert json.loads((root / 'posts.json').read_text())['posts'] == posts
        # your own copy of a licensed-audio video plays instead of the still, and survives the sync
        (root / 'originals').mkdir()
        (root / 'originals' / '3.mp4').write_bytes(b'x')
        posts = sync('', root, items)
        assert posts[2]['media'][0] == {'id': '3', 'type': 'video', 'src': 'originals/3.mp4', 'poster': 'media/3-cover.jpg', 'w': 1080, 'h': 1350}
        assert (root / 'originals' / '3.mp4').exists() and (root / 'media' / '3-cover.jpg').exists()

    # which API a token uses, and finding the account behind a Facebook Login token
    os.environ.pop('IG_API', None)
    assert api('IGAA123') == f'{INSTAGRAM}/me'
    other = {'id': '9', 'username': 'someone_else'}
    mine = {'id': '7', 'username': 'zachalligraphy'}
    fetch = lambda url: json.dumps({'data': [{'id': '1'}, {'instagram_business_account': other}, {'instagram_business_account': mine}]}).encode()
    assert api('EAA123') == f'{FACEBOOK}/7'
    def page_only(url):     # a Page token: no list of Pages, the Page itself instead
        if '/me/accounts' in url:
            raise urllib.error.HTTPError(url, 400, 'no', {}, None)
        return json.dumps({'instagram_business_account': mine}).encode()
    fetch = page_only
    assert api('EAA456') == f'{FACEBOOK}/7'
    fetch = lambda url: json.dumps({'data': [{'id': '1'}]}).encode()
    try:
        api('EAA789')
        raise AssertionError('should have stopped: no account linked')
    except SystemExit as e:
        assert 'no Facebook Page' in str(e)
    def exchange(url):
        if 'oauth/access_token' in url:
            assert 'fb_exchange_token=short' in url
            return b'{"access_token": "long"}'
        assert 'access_token=long' in url
        return json.dumps({'data': [{'access_token': 'lasting', 'instagram_business_account': mine}]}).encode()
    fetch = exchange
    assert page_token('short', 'id', 'secret') == 'lasting'
    def granted(url):       # an empty list of Pages, but the grant names one
        if 'oauth/access_token' in url:
            return b'{"access_token": "long"}'
        if '/me/accounts' in url:
            return b'{"data": []}'
        if '/debug_token' in url:
            return json.dumps({'data': {'granular_scopes': [{'scope': 'instagram_basic', 'target_ids': ['7']},
                                                            {'scope': 'pages_show_list', 'target_ids': ['5', '6']}]}}).encode()
        assert '/7?' not in url
        if '/6?' in url:
            raise urllib.error.HTTPError(url, 400, 'no', {}, None)
        return json.dumps({'access_token': 'lasting', 'instagram_business_account': mine}).encode()
    fetch = granted
    assert page_token('short', 'id', 'secret') == 'lasting'
    def nothing(url):
        if 'oauth/access_token' in url:
            return b'{"access_token": "long"}'
        return b'{"data": {}}' if '/debug_token' in url else b'{"data": []}'
    fetch = nothing
    assert page_token('short', 'id', 'secret') == 'long'    # nothing found: the 60-day user token
    print('ok')


if __name__ == '__main__':
    if '--check' in sys.argv:
        check()
        sys.exit()
    token = os.environ.get('IG_TOKEN')
    if not token:
        sys.exit('Set IG_TOKEN first (see README.md).')
    try:
        if '--page-token' in sys.argv:
            app_id, secret = os.environ.get('IG_APP_ID'), os.environ.get('IG_APP_SECRET')
            if not app_id or not secret:
                sys.exit('Set IG_APP_ID and IG_APP_SECRET too (see README.md).')
            print(page_token(token, app_id, secret))
        elif '--refresh' in sys.argv:
            if token.startswith('EA'):      # a Page token has no set expiry and no refresh endpoint
                print(token)
            else:
                url = 'https://graph.instagram.com/refresh_access_token?' + urllib.parse.urlencode({'grant_type': 'ig_refresh_token', 'access_token': token})
                print(json.loads(fetch(url))['access_token'])
        else:
            sync(token)
    except urllib.error.HTTPError as e:     # Instagram's own explanation, never the URL: it holds the token
        sys.exit(f'Instagram said {e.code}: {e.read().decode(errors="replace")[:400]}')
    except urllib.error.URLError as e:
        sys.exit(f"Couldn't reach Instagram: {e.reason}")
