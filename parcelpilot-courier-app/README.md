# ParcelPilot — Courier Management & Tracking

ParcelPilot is a role-aware full-stack courier operations starter built from the workflows and visual reference you uploaded. It is intended as a runnable SIH prototype foundation, with a modern browser UI and a backend that actually persists records.

## Features included

- Role-aware customer, admin/staff and courier sign-in.
- Development OTP flow for customers (no production OTP is hardcoded).
- Server-side authorization: role is reloaded from SQLite for every API request; customer and courier shipment queries are scoped to their own records.
- Unique AWB generation, new booking and previous-booking reuse, lifecycle status validation, history timeline, delivery entry, courier assignment and AWB lookup.
- Live courier location endpoint over GPS, role-authorized Socket.IO rooms, an OpenStreetMap view and a development-only route simulator.
- Pickups, DRS creation/list/detail, delivery entry by status update, and protected proof-of-delivery photo access.
- Customer and courier directories, notifications, digital financial entries, reports and CSV export.
- Audit log, sync activity ledger, SQLite indexes and seed data.
- Responsive shell inspired by the navy/indigo Northstar Express / ParcelPilot screen.

## Stack

- Frontend: HTML, CSS, vanilla JavaScript, Leaflet maps.
- Backend: Node.js 20+, Express, Socket.IO.
- Data: SQLite through `better-sqlite3`.
- Security building blocks: bcrypt password hashes, server-side role checks, signed HTTP-only session cookie, Helmet, auth rate limits, upload size/type restrictions, and private POD file storage.

> This is a functional prototype / development starter, not a production-certified courier system. Before a workplace pilot, add a real SMS OTP provider, deployment-grade secret management, backups and migrations, robust offline sync, operational monitoring, rate limits on all high-risk endpoints, retention policies, and a review of authorization/security rules. Routing ETA/distance is not calculated without a configured routing service.

## Quick start

1. Install Node.js 20 or newer.
2. Extract the ZIP and open a terminal in the `parcelpilot-courier-app` folder.
3. Install dependencies:

   ```bash
   npm install
   ```

4. Create `.env` from `.env.example` and set a unique `JWT_SECRET` (at least 32 characters):

   **Windows PowerShell**
   ```powershell
   Copy-Item .env.example .env
   ```

   **macOS/Linux**
   ```bash
   cp .env.example .env
   ```

5. Start the app:

   ```bash
   npm start
   ```

6. Open [http://localhost:3000](http://localhost:3000).

The SQLite database is created automatically at `data/parcelpilot.sqlite`; the schema, indexes and demonstration records are seeded on first run. Uploaded POD photos are kept under `private_uploads/`, which is not served as a public static directory.

## Demo accounts

The initial local demo seed runs only when the matching records do not already exist. Change these passwords before any shared environment is used.

| Role | Sign-in | Password / OTP |
|---|---|---|
| Admin / Staff | `admin@parcelpilot.test` | `Admin@12345` |
| Delivery executive | `courier@parcelpilot.test` | `Courier@12345` |
| Delivery executive 2 | `courier2@parcelpilot.test` | `Courier@12345` |
| Customer | `+919876543210` | Request OTP; development UI displays `DEMO_OTP` from `.env` (default `483921`) |

Customer OTP works only while `DEMO_MODE=true` and `DEMO_OTP` is configured. This code path is a development simulation, not SMS delivery. In production, set `NODE_ENV=production`, disable demo mode, connect an SMS provider, set `COOKIE_SECURE=true` behind HTTPS, and use managed secrets.

## Useful demo flow

1. Sign in as admin.
2. Open Shipments → New booking and create a shipment using the verified customer phone `+919876543210` to link it to the demo customer account.
3. Assign an active courier. For normal lifecycle testing, staff can update it through the allowed progression to `AT_DESTINATION_HUB`.
4. Sign in as courier, open Assigned deliveries, start an eligible delivery and allow browser geolocation to share GPS. Location updates are throttled by movement/time thresholds.
5. For a deterministic SIH presentation without device GPS, use the seeded `PP2610010001` Out for Delivery shipment and click **Simulate route** in Live operations. It emits demo-only coordinates every 2.5 seconds. Stop demo mode in `.env` for production use.
6. Open the customer account with the linked phone and track the same AWB. Only shipments linked to that customer account are visible.
7. Capture POD with receiver name and optional photo; the backend stores the record, marks the shipment Delivered, stops live location and triggers the notification/audit path.

## Provision an administrator or courier account

Demo accounts are local-only. In a production configuration (`NODE_ENV=production`, `DEMO_MODE=false`), no demo account or synthetic shipment is seeded. Create the first authorized workplace account through the local provisioning script, run from the app folder after configuring `.env` and the production database:

```bash
node scripts/provision-user.js --role ADMIN --name "Operations Admin" --email admin@your-company.com --phone +919876500001 --password "Use-A-Long-Unique-Password"
node scripts/provision-user.js --role COURIER --name "Courier Name" --email courier@your-company.com --phone +919876500002 --password "Use-Another-Long-Password"
```

The password must be at least 12 characters. This command is a trusted local/operations task and is not exposed as a public signup API. Use a secrets manager and avoid entering passwords into shell history where possible.

## Role behavior

- **CUSTOMER** can see shipments linked by the verified customer account, view tracking/events, create pickup requests, and read their notifications. A customer cannot change shipment statuses or see unrelated courier locations.
- **ADMIN** can manage bookings, shipment assignments/statuses, DRS, pickups, couriers, customers, POD records, reports, finances, sync activity and audit logs.
- **COURIER** can see shipments and pickups assigned to their account, progress eligible delivery statuses, share GPS for an active assigned shipment and capture POD for assigned Out for Delivery shipments.

Route/UI visibility is convenience only; every API operation performs its own server-side role/ownership check.

## Scripts

```bash
npm start   # run server
npm run dev # restart server on changes (Node --watch)
npm test    # unit tests for roles/status/AWB
npm run check # syntax checks for key JavaScript files
```

## Environment variables

See `.env.example`: `PORT`, `APP_ORIGIN`, `JWT_SECRET`, `DB_PATH`, `DEMO_MODE`, `DEMO_OTP`, `COOKIE_SECURE`, `UPLOAD_MAX_MB`, and `NODE_ENV`.

## Database and API

See [ARCHITECTURE.md](ARCHITECTURE.md), [DATABASE.md](DATABASE.md), [API.md](API.md) and [TESTING.md](TESTING.md) for the current architecture, data model, endpoint overview and manual regression scenarios.
