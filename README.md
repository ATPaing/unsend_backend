# Unsend Backend

API server for **Unsend** — an end-to-end encrypted journal app. The backend stores ciphertext and account metadata only. It never receives plaintext journals, PINs, or private keys.

## Stack

- Node.js (ESM)
- Express 5
- Prisma + MySQL / MariaDB
- Argon2id password hashing (`@node-rs/argon2`)
- HTTP-only session cookies
- Server-Sent Events (SSE) for realtime updates

## Requirements

- Node.js 20+
- MySQL or MariaDB
- npm

## Setup

```bash
cd backend
npm install
cp .env.example .env   # or create .env manually
```

### Environment

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | yes | — | Prisma MySQL connection string |
| `PORT` | no | `3000` | HTTP port |
| `CORS_ORIGIN` | no | `http://localhost:5173` | Allowed frontend origin |
| `SESSION_COOKIE_NAME` | no | `sid` | Session cookie name |
| `SESSION_TTL_MS` | no | 7 days | Session lifetime |
| `NODE_ENV` | no | `development` | Runtime mode |

Example `.env`:

```env
DATABASE_URL="mysql://USER:PASSWORD@localhost:3306/unsend"
PORT=3000
CORS_ORIGIN=http://localhost:5173
```

### Database

```bash
npx prisma migrate deploy
# or during development:
npx prisma migrate dev

npm run prisma:generate
```

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start API with `--watch` |
| `npm start` | Start API |
| `npm run prisma:generate` | Generate Prisma Client |
| `npm run prisma:validate` | Validate schema |
| `npm run prisma:studio` | Open Prisma Studio |

## API overview

Base URL (local): `http://localhost:3000`

| Area | Prefix |
|---|---|
| Health | `GET /health` |
| Auth | `/api/auth` |
| Users / crypto / account | `/api/users` |
| Journals / time capsules | `/api/journals` |
| Friends | `/api/friends` |
| Notifications | `/api/notifications` |
| Realtime SSE | `/api/sse` |

Full contract: see `docs/API.md` in the repo root (or monorepo `docs/` folder).

### Important security rules

- Passwords are hashed with Argon2id; never logged or returned.
- Journal title/content arrive as ciphertext + nonces only.
- PIN and private keys stay on the client; the API stores wrapped private-key material only.
- Time capsules unlock by **server time** (`unlockAt`); keys/ciphertext are withheld while locked.
- Changing PIN re-wraps the **same** private key (`PATCH /api/users/me/crypto`) — public key does not change.

## Project layout

```text
backend/
├── prisma/           # schema + migrations
├── src/
│   ├── app.js
│   ├── server.js
│   ├── config/
│   ├── controllers/
│   ├── middleware/
│   ├── routes/
│   ├── services/
│   └── utils/
├── package.json
└── .gitignore
```

## Development notes

- Frontend expects credentials (`credentials: "include"`) for cookie sessions.
- Successful JSON responses may include `data.serverNow` for client clock sync.
- Account deletion (`DELETE /api/users/me`) cascades related rows per Prisma relations.

## License

