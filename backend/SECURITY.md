## Environment File Safety

To keep secrets out of logs, dumps, and backups:

- Store `.env` on the server only and keep it owner-readable only:
  - `chown root:root /opt/ads-marketplace/backend/.env`
  - `chmod 600 /opt/ads-marketplace/backend/.env`
- Do not include `.env` in any backup job. Example for rsync:
  - `rsync -az --exclude .env /opt/ads-marketplace/backend/ <backup-dest>`
- Avoid commands that print environment variables in logs (e.g. `pm2 env`).

## Escrow Private Key

- Store the escrow private key only in `.env` as `TON_ESCROW_PRIVATE_KEY`.
- Keep the file owner-readable only (`chmod 600`) and owned by `root`.
