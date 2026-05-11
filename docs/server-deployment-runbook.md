# Storm AI Server Deployment Runbook

This document records the production deployment performed on May 11, 2026 for `www.zlaction.online`.

## Current Production Shape

- Project path: `/usr/storm-ai`
- PM2 cwd alias: `/var/www/storm-ai -> /usr/storm-ai`
- Domain: `https://www.zlaction.online`
- Server IP used in DNS: `107.173.25.225`
- Runtime: Node.js, pnpm through Corepack, PM2, Nginx, Certbot
- App port: `3000`
- Nginx ports: `80` and `443`
- PM2 app name: `storm-ai`

The app is deployed as a Node.js Next.js service, not as a static site.

## What Was Done

1. Installed dependencies with pnpm through Corepack:

   ```bash
   XDG_DATA_HOME=/usr/storm-ai/.pnpm-data corepack pnpm install --frozen-lockfile --store-dir /usr/storm-ai/.pnpm-store
   ```

2. Built the Next.js production bundle:

   ```bash
   XDG_DATA_HOME=/usr/storm-ai/.pnpm-data corepack pnpm build
   ```

3. Installed runtime services:

   ```bash
   apt update
   apt install -y nginx ufw snapd ca-certificates curl gnupg git
   npm install -g pm2
   ```

4. Created the production path expected by `ecosystem.config.cjs`:

   ```bash
   ln -s /usr/storm-ai /var/www/storm-ai
   ```

5. Installed and enabled the Nginx site:

   ```bash
   cp /usr/storm-ai/deploy/nginx/storm-ai.conf /etc/nginx/sites-available/storm-ai
   ln -s /etc/nginx/sites-available/storm-ai /etc/nginx/sites-enabled/storm-ai
   rm /etc/nginx/sites-enabled/default
   nginx -t
   systemctl reload nginx
   ```

6. Synced production environment variables:

   ```bash
   cp .env.local .env.production
   ```

   `APIMART_PROXY_URL` was emptied in `.env.production` so production does not use a local development proxy.

7. Updated PM2 config to run pnpm through Corepack because the server did not expose a direct `pnpm` binary:

   ```js
   script: "corepack"
   args: "pnpm start"
   ```

8. Started and persisted the app:

   ```bash
   pm2 start ecosystem.config.cjs
   pm2 restart storm-ai --update-env
   pm2 save
   pm2 startup systemd -u root --hp /root
   systemctl daemon-reload
   ```

9. Installed Certbot and issued HTTPS certificate:

   ```bash
   apt install -y certbot python3-certbot-nginx
   certbot --nginx -d www.zlaction.online --redirect --non-interactive --agree-tos -m admin@zlaction.online
   ```

10. Added the cron sync job:

    ```cron
    * * * * * curl -fsS -X POST -H "Host: www.zlaction.online" -H "Authorization: Bearer <CRON_SECRET>" http://127.0.0.1/api/cron/sync-generation-jobs >/dev/null 2>&1
    ```

    The cron calls localhost intentionally, so task syncing still hits this server even if external DNS or Cloudflare behavior changes.

## External Setup Confirmed

- `supabase-schema.sql` has already been executed in Supabase.
- Required environment variables are present in `.env.production`.
- DNS for `www.zlaction.online` was changed away from Vercel and toward this server through Cloudflare.
- HTTPS was failing with Cloudflare `521` until Nginx was configured for port `443`; this was fixed by Certbot.

## Verification Commands

Use these checks after deployment or updates:

```bash
pm2 status
curl -I http://127.0.0.1:3000
curl -I -H "Host: www.zlaction.online" http://127.0.0.1
curl -I http://www.zlaction.online
curl -I https://www.zlaction.online
nginx -t
systemctl status nginx --no-pager
systemctl is-enabled pm2-root
systemctl is-enabled certbot.timer
```

Expected healthy results:

- PM2 `storm-ai` status is `online`.
- Local Next.js returns `200 OK` on port `3000`.
- HTTP public domain redirects to HTTPS.
- HTTPS public domain returns `200 OK`.
- Nginx config test succeeds.
- `pm2-root` and `certbot.timer` are enabled.

## Update Procedure

For future releases:

```bash
cd /usr/storm-ai
git pull origin main
XDG_DATA_HOME=/usr/storm-ai/.pnpm-data corepack pnpm install --frozen-lockfile --store-dir /usr/storm-ai/.pnpm-store
XDG_DATA_HOME=/usr/storm-ai/.pnpm-data corepack pnpm build
pm2 restart storm-ai --update-env
pm2 save
```

If `.env.local` changes and should become production config:

```bash
cp .env.local .env.production
perl -0pi -e 's/^APIMART_PROXY_URL=.*$/APIMART_PROXY_URL=/m' .env.production
XDG_DATA_HOME=/usr/storm-ai/.pnpm-data corepack pnpm build
pm2 restart storm-ai --update-env
pm2 save
```

## Known Notes

- Do not commit `.env.local` or `.env.production`.
- The server is currently using Corepack-managed pnpm, so PM2 starts with `corepack pnpm start`.
- `certbot renew --dry-run` was attempted once and hung; the active certificate was issued successfully and `certbot.timer` is enabled.
- The system reported a pending kernel upgrade during apt installs. A reboot can be planned separately if desired, but it was not required for this deployment.
