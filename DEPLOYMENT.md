# Deploying Bela-HRMS to a private VPS

One company, one machine, three containers. This is deliberately not a Kubernetes
deployment: an orchestrator to run a single Next.js process is a second system to
operate, and the person operating this is an IT team of one or two.

Everything below has been written to be run in order, once, by somebody who has
not seen the codebase.

---

## What you need

| | |
|---|---|
| VPS | 2 vCPU, 4 GB RAM, 40 GB SSD. Comfortable for ~200 staff; 2 GB is enough for ~50 but leaves no room for a rebuild |
| OS | Debian 12 or Ubuntu 24.04 |
| DNS | An **A record** for your hostname pointing at the VPS, resolving *before* you start the stack |
| Ports | 80 and 443 inbound. Nothing else |

The DNS record has to exist first. Caddy requests a certificate on startup, and
Let's Encrypt rate-limits failures — five per week per hostname, which is easy to
burn through while debugging.

---

## 1 · Prepare the server

```bash
adduser --disabled-password --gecos "" bela
usermod -aG sudo bela

curl -fsSL https://get.docker.com | sh
usermod -aG docker bela

ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
```

Postgres is **not** in that list, and must not be. It listens only on the compose
network; a Postgres exposed on a public VPS is found by scanners within hours.

Harden SSH while you are here — `PasswordAuthentication no`, keys only. An HRMS
holds salary figures, citizenship numbers and bank accounts.

---

## 2 · Fetch the code and configure

```bash
sudo mkdir -p /opt/bela-hrms && sudo chown bela:bela /opt/bela-hrms
git clone <your-repo> /opt/bela-hrms
cd /opt/bela-hrms

cp .env.example .env
openssl rand -base64 48        # paste into BETTER_AUTH_SECRET
openssl rand -base64 24        # paste into POSTGRES_PASSWORD
chmod 600 .env
```

Fill in `.env`:

```ini
POSTGRES_USER=bela
POSTGRES_PASSWORD=<the generated one>
POSTGRES_DB=bela_hrms
DATABASE_URL=postgres://bela:<the same password>@postgres:5432/bela_hrms
BETTER_AUTH_SECRET=<the generated one>
APP_DOMAIN=hrms.yourcompany.com.np
ACME_EMAIL=it@yourcompany.com.np
```

Three things that silently break a deployment if they are wrong:

- **`DATABASE_URL` host is `postgres`, not `localhost`.** Inside the compose
  network the service name is the hostname.
- **`APP_DOMAIN` has no scheme and no trailing slash.** Compose builds
  `BETTER_AUTH_URL` as `https://${APP_DOMAIN}`; a mismatch makes the browser drop
  the session cookie and sign-in appears to succeed and then does nothing.
- **The password appears twice** and both must match.

---

## 3 · Start

```bash
docker compose up -d --build
docker compose logs -f app
```

The order is enforced by the compose file: Postgres becomes healthy, `migrate`
runs to completion, then `app` starts. If migrations fail the application never
starts — which is correct. A half-migrated schema serving traffic is worse than
an outage.

Verify:

```bash
curl -s https://hrms.yourcompany.com.np/api/health
# {"status":"ok","database":"up","latencyMs":3}
```

---

## 4 · Create the first administrator

The seed is demo data and does not belong in production. Create a real
organisation and a real administrator instead:

```bash
docker compose exec app node -e "…"   # or run your own bootstrap script
docker compose run --rm app node scripts/migrate.mjs   # if you skipped it
```

Then grant the break-glass flag, at the console, to the account that will
administer the system:

```bash
docker compose exec app pnpm admin:unlock it@yourcompany.com.np
```

A system administrator holds every permission regardless of their roles, so no
role edit can lock the organisation out. Read
[the note in `user_accounts.isSystemAdmin`](src/db/schema/core.ts) for why that
exists — it is the one failure the permission model cannot recover from on its
own.

**For a demonstration** rather than production, seed instead:

```bash
docker compose exec app pnpm db:seed          # current year, 24 staff
docker compose exec app pnpm db:seed:history  # a full closed previous year
```

---

## 5 · Backups, before you need them

```bash
crontab -e
15 2 * * *  /opt/bela-hrms/deploy/backup.sh >> /var/log/bela-backup.log 2>&1
```

`deploy/backup.sh` dumps, **verifies the archive is readable**, and only then
applies retention — so a run of failures can never delete the last good backup.
Set `OFFSITE_TARGET` in the environment to mirror somewhere else; a backup on the
same disk as the database survives a bad migration and nothing else.

**Restore is a quarterly drill, not a theory:**

```bash
./deploy/restore.sh backups/bela-hrms-20260913-021500.dump
```

The first time anybody runs a restore should not be during an outage.

---

## 6 · Upgrading

```bash
cd /opt/bela-hrms
./deploy/backup.sh          # always, before a migration
git pull
docker compose up -d --build
```

Compose rebuilds, runs migrations to completion, then replaces the app container.
Roll back by checking out the previous tag and rebuilding — but note that a
migration is not automatically reversible: if the release changed the schema,
restore the pre-upgrade dump as well.

Check `/api/health` and sign in before you walk away.

---

## Operating notes

**Logs.** `docker compose logs -f app`. Caddy writes JSON access logs to its own
volume. Neither is rotated by Docker's default driver — set one in
`/etc/docker/daemon.json`:

```json
{ "log-driver": "json-file", "log-opts": { "max-size": "20m", "max-file": "5" } }
```

Without it a chatty container fills the disk in a few months, and a full disk on
a database server is the worst common outage there is.

**Timezone.** The app container runs `TZ=Asia/Kathmandu`, but nothing in the
application depends on the host clock's zone: Bikram Sambat conversion and the
header clock both pin `Asia/Kathmandu` explicitly. Timestamps are stored UTC.

**Memory.** The build is the peak, not the runtime. On a 2 GB VPS build the image
elsewhere and push it to a registry rather than running `--build` on the server;
`next build` will be OOM-killed.

**Sessions.** Eight hours, matching a working day. Changing `BETTER_AUTH_SECRET`
signs everybody out immediately — occasionally the fastest response to a
suspected compromise.

**What is not here yet.** No outbound email, so password resets are done by an
administrator from *Administration › Users*. No object storage, so document
uploads record metadata and a URL rather than the file. Both are deliberate:
neither can be configured without decisions the business has not made.

---

## Verifying a deployment

Run the same checks CI runs, against the deployed database:

```bash
docker compose exec app pnpm check:isolation   # module boundaries hold
docker compose exec app pnpm check:org         # structure rules
docker compose exec app pnpm check:leave       # leave → attendance → payroll
docker compose exec app pnpm check:self        # nobody can read another's desk
docker compose exec app pnpm check:pagination  # paging invariants
```

These are not unit tests against fixtures — they assert against the real
database, which is exactly what you want to know about a server you have just
stood up.

Then, by hand:

1. Sign in. The header shows today in both calendars and the current fiscal year.
2. Open **My Desk**. Balances, attendance and notices are yours alone.
3. Open **Administration › Modules**. Everything reads *Running*, the event queue
   is empty.
4. Switch to the previous fiscal year and try an attendance correction against a
   date inside it. It must be refused — that is the period lock working.
