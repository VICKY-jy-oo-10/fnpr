# Database model

SQLite schema is initialized in `src/db.js`. IDs are UUID-like strings except append-only tracking/audit/sync rows, which use integer keys where appropriate. Date/time values are stored in SQLite text form; server-side event writes use database timestamps unless a client/device timestamp is explicitly relevant.

| Table | Purpose | Key relationships |
|---|---|---|
| `users` | Authenticated identities and canonical roles | `id`, unique email/phone, role, active |
| `customers` | Customer contact/profile directory | optional `user_id` → `users` |
| `shipments` | Main booking/AWB and lifecycle record | customer user, created-by user, assigned courier |
| `tracking_events` | Append-only shipment status timeline | shipment + actor |
| `pickups` | Collection jobs | assigned courier + created-by user |
| `drs` | Delivery run sheets | assigned courier + creator |
| `drs_items` | DRS-to-shipment membership | DRS + shipment, unique pair |
| `pod_records` | Delivery acknowledgement, optional photo and GPS | one POD per shipment in this starter |
| `courier_locations` | Last/current courier position history | courier + optional shipment |
| `financial_entries` | Income/expense records | creator, amount/category/date |
| `notifications` | User-visible system and shipment messages | optional user recipient |
| `audit_logs` | Important mutations with old/new value JSON | actor, entity type/id |
| `sync_queue` | Backend mutation activity ledger | entity type/id/action/state |

## Important indexes

- `shipments(awb)` unique and separately indexed for AWB lookup.
- `shipments(status)`, `shipments(customer_user_id)`, `shipments(courier_user_id)`, `shipments(created_at)`.
- `customers(phone)` and `tracking_events(shipment_id, created_at)`.
- `courier_locations(courier_user_id, updated_at)` and `notifications(user_id, created_at)`.
- `financial_entries(entry_date)`.

## Shipment status model

`BOOKED → PICKUP_ASSIGNED → PICKED_UP → AT_ORIGIN_HUB → IN_TRANSIT → AT_DESTINATION_HUB → OUT_FOR_DELIVERY → DELIVERED`

Exceptions include `UNDELIVERED`, `RTO_INITIATED`, `RTO_IN_TRANSIT`, `RTO_DELIVERED`, `MISROUTE` and `CANCELLED`. Legal next steps are centralized in `src/status.js`. Courier transitions are deliberately narrower than admin/staff transitions.

## Data-handling notes

- Customer shipment ownership is stored as `customer_user_id` after matching the verified phone to a customer account. If there is no match, staff can still create the shipment, but that record is not automatically visible in the customer's portal.
- Shipment list queries are role-scoped and capped/paginated.
- POD file paths are not public URLs; `/api/pod/:id/photo` authorizes the caller before streaming a file.
- This is not a full accounting ledger; financial records should be reconciled against invoices/payment processors before production usage.
