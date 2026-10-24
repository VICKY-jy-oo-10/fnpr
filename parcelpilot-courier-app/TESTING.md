# Testing guide

## Automated checks

```bash
npm run check
npm test
```

Current automated unit tests cover role normalization, selected status transitions, terminal statuses and AWB format/uniqueness. They do not replace integration tests with a real configured SMS provider or browser GPS.

## Manual regression matrix

| Scenario | Steps | Expected result |
|---|---|---|
| Fresh session | Open `/` without a session | Only role selection/sign-in is shown |
| Admin login | `admin@parcelpilot.test` / `Admin@12345` | Admin dashboard loads; admin-only modules work |
| Courier login | `courier@parcelpilot.test` / `Courier@12345` | Only assigned deliveries/pickups and courier modules are shown |
| Customer OTP | Use `+919876543210`, request OTP, enter the displayed dev code | Customer dashboard loads and sees only linked shipments |
| Wrong role login | Select Admin and enter courier credentials | Login rejected; account is not promoted |
| Customer ownership | Search `PP2610010001` while logged in as demo customer | Shipment timeline is visible |
| Customer privacy | Try to track an unrelated shipment AWB | Backend returns access denied rather than shipment data |
| Booking | Admin creates a shipment with valid sender/receiver data | Unique AWB returned, record appears in list and audit log |
| Assignment | Admin assigns shipment to active courier | Courier can see the assigned shipment; a notification is stored |
| Status transition | Attempt a skipped/illegal transition | Backend returns a transition error; history is not advanced |
| DRS | Admin selects courier + shipments and generates DRS | DRS has a number and items; courier sees their DRS |
| Pickup | Create, assign and update a pickup | The request and audit events persist |
| GPS | Courier starts an eligible delivery and grants browser location | Periodic movement/time-throttled updates are stored and broadcast |
| Demo GPS | Admin uses Live operations → Simulate route on an Out for Delivery parcel | Authorized map clients receive demo points every 2.5 sec |
| POD | Assigned courier captures receiver name and optional photo | POD is persisted, shipment becomes Delivered, tracking is stopped |
| POD privacy | Attempt to read photo without shipment relationship | API returns 403 |
| Finance | Admin creates income and expense entries | Totals update and ledger records persist |
| Report export | Admin clicks Download shipment CSV | Browser downloads CSV with shipment records |
| Logout | Sign out and attempt to visit a previous route | The session cookie is cleared; protected APIs require sign-in |
| Persistent login | Reload before logging out | `/api/auth/me` resolves the same user and database role |

## Limitations in this starter

- Development customer OTP is not SMS and is stored in in-memory challenge state.
- A normal online SQLite-backed workflow exists, but robust offline-first local mutation queues/conflict merging are not implemented.
- No push provider is connected; notifications are persisted in the app database.
- Location works while browser permissions/session/platform allow it. Reliable mobile background GPS requires a native app and platform permissions.
- No routing/ETA service is connected; distance and ETA are not claimed.
