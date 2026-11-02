# Zach Reich

A portfolio that shows the posts from Instagram ([@zachalligraphy](https://www.instagram.com/zachalligraphy/)) as a bento grid, rearranged on every refresh.

## Run it

1. Double-click **Start.command**.

Until Instagram is connected, the grid shows sample posts in flat colours, one colour per post, from `posts.json`. The first real sync replaces them.

## Edit it

- **Your name and description:** in `index.html`, between the `YOUR DESCRIPTION` comments near the top of the body.
- **Everything else:** type `69420`, then press Enter, anywhere on the page.
  - Change the layout, type and colour, and rewrite any post's text. Click a frame to pick its post.
  - **Preview** shows the real site at tablet or phone width.
  - **Save** writes `settings.json`. Commit and push that file to publish the changes.

The code isn't a password. It only opens the panels, and anyone who finds it on the live site can change only what their own browser shows.

## Connect Instagram

The account has to be a professional one (Creator or Business).

`sync.py` works with either kind of token and can tell which it has from how it starts. Captions matter here, because they hold your titles and descriptions: Meta's reference lists `caption` as Facebook Login only, so if a sync warns that captions are missing, use a Facebook Login token.

- **Instagram Login token (starts `IG`):** the simplest. In your app at [developers.facebook.com/apps](https://developers.facebook.com/apps), open **Instagram > API setup with Instagram business login** and press **Generate token**. It lasts 60 days and the workflow doesn't renew it, so `python3 sync.py --refresh` has to be run by hand.
- **Facebook Login token (starts `EA`):** the Instagram account must be linked to a Facebook Page, and the token needs the `instagram_basic` and `pages_show_list` permissions. These often last only an hour or two, so turn yours into a lasting one (below).

Run the first sync like this. Paste the token after the first line and press Enter. Nothing shows on screen, and it stays out of your shell history:

```sh
read -rs IG_TOKEN && export IG_TOKEN
python3 sync.py
```

This fills `posts.json` and `media/`.

**To get a lasting Facebook Login token,** add your app's ID and secret from **App settings > Basic**, in the same Terminal window:

```sh
read -rs IG_APP_SECRET && export IG_APP_SECRET
IG_APP_ID=your-app-id python3 sync.py --page-token
```

It prints a Page token with no set expiry. That's the one to give GitHub. Treat it like a password.

If it says **No Page token available**, what it printed is a 60-day user token, which can't find your account by itself. Give it to GitHub anyway, and add a repository variable (not a secret) `IG_API` set to `https://graph.facebook.com/v26.0/<your Instagram account ID>`. Run the same command with a new token before the 60 days are up, or syncs will start failing.

## Reels with licensed music

Instagram won't hand over the video of a reel that uses music from its library, so the site would only get its cover as a still. To make one play, put your own copy in `originals/`, named with the post's video ID: the `media/<id>-cover.jpg` shown for it in `posts.json` gives the ID. Use H.264 MP4, without audio, at about 720 wide. Every sync after that plays it. Commit the file: `originals/` isn't touched by the sync.

## Publish it

`.github/workflows/sync.yml` checks for new posts every 6 hours and publishes to GitHub Pages.

1. Push this repo to GitHub.
2. In **Settings > Pages**, set the source to **GitHub Actions**.
3. In **Settings > Secrets and variables > Actions**, add:
   - Secret `IG_TOKEN`: a token that doesn't expire. Use a system user token from Meta's Business settings, with expiry set to **Never**.
   - Variable `IG_API`: `https://graph.facebook.com/v26.0/<your Instagram account ID>`.

Media is committed to the repo because Instagram's own URLs expire. A very large video archive would eventually press against GitHub Pages' 1 GB limit, and the media would then need to move to separate storage.

## Check it

```sh
node check.mjs           # the grid and the caption parsing
python3 sync.py --check  # the Instagram sync, without the network
```
