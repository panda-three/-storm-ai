# Logging and Runtime Diagnostics

This document lists the common commands for checking production logs on the Storm AI server.

## Application Logs

The Next.js app is managed by PM2 under the app name `storm-ai`.

Follow live logs:

```bash
pm2 logs storm-ai
```

Show recent lines:

```bash
pm2 logs storm-ai --lines 100
```

PM2 log files:

```bash
tail -n 100 /root/.pm2/logs/storm-ai-out.log
tail -n 100 /root/.pm2/logs/storm-ai-error.log
tail -f /root/.pm2/logs/storm-ai-error.log
```

Check process status:

```bash
pm2 status
pm2 describe storm-ai
```

## Nginx Logs

Access log:

```bash
tail -f /var/log/nginx/access.log
tail -n 100 /var/log/nginx/access.log
```

Error log:

```bash
tail -f /var/log/nginx/error.log
tail -n 100 /var/log/nginx/error.log
```

Check Nginx status and config:

```bash
systemctl status nginx --no-pager
nginx -t
```

## HTTPS and Certbot Logs

Certbot log:

```bash
tail -n 100 /var/log/letsencrypt/letsencrypt.log
tail -f /var/log/letsencrypt/letsencrypt.log
```

Check automatic renewal timer:

```bash
systemctl status certbot.timer --no-pager
systemctl is-enabled certbot.timer
```

## Cron Sync Logs

The generation sync cron suppresses output by default:

```cron
* * * * * curl -fsS -X POST -H "Host: www.zlaction.online" -H "Authorization: Bearer <CRON_SECRET>" http://127.0.0.1/api/cron/sync-generation-jobs >/dev/null 2>&1
```

View installed cron entries without exposing the secret:

```bash
crontab -l | sed 's/Bearer [^\"]*/Bearer ***REDACTED***/'
```

Manually test the cron route:

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

## Quick Triage

Use this sequence when the website has a problem:

```bash
pm2 status
pm2 logs storm-ai --lines 100
tail -n 100 /var/log/nginx/error.log
curl -I http://127.0.0.1:3000
curl -I -H "Host: www.zlaction.online" http://127.0.0.1
curl -I https://www.zlaction.online
```

Common signals:

- `pm2 status` is not `online`: inspect `pm2 logs storm-ai`.
- Local `3000` fails: the Next.js process is not serving correctly.
- Local `3000` works but Nginx fails: inspect `/var/log/nginx/error.log` and run `nginx -t`.
- Public HTTPS returns Cloudflare `521`: confirm Nginx is listening on `443` and the certificate is installed.
- Cron route returns `401`: confirm `CRON_SECRET` in `.env.production` matches the Authorization header.
