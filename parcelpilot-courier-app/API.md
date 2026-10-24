# API overview

All `/api` routes except health and OTP request are authenticated where appropriate. Session uses the `pp_session` HTTP-only cookie. Mutating routes apply role and shipment/pickup ownership checks.

## Authentication

| Method | Path | Access | Purpose |
|---|---|---|---|
| POST | `/api/auth/customer/request-otp` | Demo mode | Generate development OTP for a valid phone |
| POST | `/api/auth/customer/verify-otp` | Public with challenge | Verify OTP, create/link customer account, set session |
| POST | `/api/auth/staff/login` | Public | Authenticate staff/courier password and verify requested role |
| GET | `/api/auth/me` | Authenticated | Resolve current user and actual database role |
| POST | `/api/auth/logout` | Optional session | Clear session, stop courier location and disconnect user sockets |
| GET | `/api/health` | Public | Basic health and demo-mode status |

## Shipments

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/api/shipments` | Any role, scope-limited | Search/filter shipments |
| POST | `/api/shipments` | ADMIN | Create shipment and unique AWB |
| GET | `/api/shipments/track/:awb` | Any role, ownership checked | Shipment, event timeline, permitted POD metadata and active location |
| GET | `/api/shipments/:id/events` | Authorized shipment user | Timeline events |
| POST | `/api/shipments/:id/assign` | ADMIN | Assign courier |
| POST | `/api/shipments/:id/status` | ADMIN or assigned COURIER | Validated lifecycle update |
| POST | `/api/shipments/:id/start` | Assigned COURIER | Start an eligible delivery and status/location session |
| POST | `/api/tracking/:shipmentId/location` | Assigned COURIER | Store GPS coordinate and publish location to authorized rooms |
| GET | `/api/tracking/live` | ADMIN | Active courier locations |
| POST | `/api/demo/simulate/:shipmentId` | ADMIN + demo mode | Publish deterministic demo locations for an Out for Delivery shipment |

## Operations

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/api/customers` | ADMIN | Customer directory and shipment counts |
| GET | `/api/couriers` | ADMIN | Active/inactive courier directory and workload |
| PATCH | `/api/couriers/:id` | ADMIN | Activate/deactivate a courier |
| GET/POST | `/api/pickups` | Role/ownership scoped | List or create pickup requests |
| POST | `/api/pickups/:id/assign` | ADMIN | Assign pickup courier |
| PATCH | `/api/pickups/:id/status` | ADMIN or assigned courier | Progress pickup |
| GET | `/api/drs` | ADMIN or assigned courier | List DRS |
| GET | `/api/drs/:id` | ADMIN or assigned courier | DRS details and shipments |
| POST | `/api/drs` | ADMIN | Generate DRS and assign selected shipments |
| GET | `/api/pod` | ADMIN or COURIER | List authorized POD records |
| POST | `/api/pod/:shipmentId` | ADMIN or assigned courier | Capture receiver acknowledgement and optional image |
| GET | `/api/pod/:id/photo` | Related customer/courier or ADMIN | Protected POD photo streaming |
| GET | `/api/notifications` | Signed-in user | Read notifications |
| PATCH | `/api/notifications/:id/read` | Recipient | Mark notification read |
| GET | `/api/sync` | ADMIN or COURIER | Review sync activity |
| POST | `/api/sync/:id/retry` | ADMIN | Verify local persistence and mark sync item resolved |
| GET | `/api/audit` | ADMIN | Audit trail |

## Finance & reports

- `GET /api/finance` — ADMIN: list records and totals; supports `from` and `to` date parameters.
- `POST /api/finance` — ADMIN: create income/expense record.
- `DELETE /api/finance/:id` — ADMIN: delete entry (the deletion is audited).
- `GET /api/reports/dashboard` — role-scoped dashboard KPIs, status distribution and recent shipments; admin also receives operational metrics.
- `GET /api/reports` — ADMIN: performance summary, status counts and date-based trend.
- `GET /api/reports/export.csv` — ADMIN: CSV shipment export.

## Socket.IO events

- `join-shipment` (client → server): asks to join a shipment-specific room; server checks actual ownership/assignment first.
- `courier:location` (server → `role:ADMIN` and authorized `shipment:{id}`): latest location payload.
- `shipment:updated` (server → admin / authorized shipment room): status summary after relevant mutations.
- `assignment:updated` (server → assigned courier user room): assignment notification.

Payload validation is intentionally kept server-side. Extend input schemas and endpoint-specific abuse controls before internet deployment.
