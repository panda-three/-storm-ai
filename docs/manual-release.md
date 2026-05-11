# Manual Release Guide

Use this guide when code changes have already been pushed to GitHub and you want to deploy them to the current production server.

## Before Releasing

Confirm the target server and app state:

```bash
cd /usr/storm-ai
git status --short
pm2 status
curl -I https://www.zlaction.online
```

Do not continue if there are unexpected local source changes on the server. Commit or intentionally discard them first.

## Standard Release

Run these commands on the server:

```bash
cd /usr/storm-ai
git pull origin main
XDG_DATA_HOME=/usr/storm-ai/.pnpm-data corepack pnpm install --frozen-lockfile --store-dir /usr/storm-ai/.pnpm-store
XDG_DATA_HOME=/usr/storm-ai/.pnpm-data corepack pnpm build
pm2 restart storm-ai --update-env
pm2 save
```

Then verify:

```bash
pm2 status
curl -I http://127.0.0.1:3000
curl -I -H "Host: www.zlaction.online" http://127.0.0.1
curl -I https://www.zlaction.online
```

Healthy results:

- `storm-ai` is `online` in PM2.
- Local port `3000` returns `200 OK`.
- Nginx localhost proxy returns `200 OK` or redirects as expected.
- Public HTTPS returns `200 OK`.

## When Environment Variables Change

If `.env.local` was updated and should become production config:

```bash
cd /usr/storm-ai
cp .env.local .env.production
perl -0pi -e 's/^APIMART_PROXY_URL=.*$/APIMART_PROXY_URL=/m' .env.production
XDG_DATA_HOME=/usr/storm-ai/.pnpm-data corepack pnpm build
pm2 restart storm-ai --update-env
pm2 save
```

Rebuilding is required when `NEXT_PUBLIC_*` variables change because those values are embedded into the browser bundle.

## When Database Schema Changes

If the release changes Supabase tables, indexes, policies, or RPC functions:

1. Apply the SQL in Supabase first.
2. Confirm the SQL completed successfully.
3. Deploy the server code with the standard release commands.
4. Manually test login, admin pages, credit balance, generation, and history.

Do not deploy code that calls new RPC signatures before the SQL is applied.

## Cron Route Check

After releases that touch generation jobs, task sync, APIMart, MengFactory, or Supabase server code, manually test the cron route:

```bash
secret=$(grep -E '^CRON_SECRET=' /usr/storm-ai/.env.production | sed 's/^CRON_SECRET=//')
curl -fsS -X POST \
  -H "Host: www.zlaction.online" \
  -H "Authorization: Bearer ${secret}" \
  http://127.0.0.1/api/cron/sync-generation-jobs
```

A healthy response includes:

```json
{"ok":true}
```

## Rollback

If a release fails after `git pull`, inspect recent commits:

```bash
cd /usr/storm-ai
git log --oneline -5
```

Rollback to a known good commit:

```bash
git checkout <GOOD_COMMIT_SHA>
XDG_DATA_HOME=/usr/storm-ai/.pnpm-data corepack pnpm install --frozen-lockfile --store-dir /usr/storm-ai/.pnpm-store
XDG_DATA_HOME=/usr/storm-ai/.pnpm-data corepack pnpm build
pm2 restart storm-ai --update-env
pm2 save
```

After rollback, verify:

```bash
pm2 status
curl -I https://www.zlaction.online
pm2 logs storm-ai --lines 100
```

When the issue is fixed, return to the normal branch:

```bash
git checkout main
git pull origin main
```

## Useful Diagnostics

Application logs:

```bash
pm2 logs storm-ai --lines 100
```

Nginx errors:

```bash
tail -n 100 /var/log/nginx/error.log
```

Nginx config:

```bash
nginx -t
systemctl status nginx --no-pager
```

See `docs/logging.md` for the full logging guide.
