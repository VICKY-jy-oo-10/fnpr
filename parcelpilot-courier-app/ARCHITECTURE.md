# Architecture

## Request and identity flow

```text
Browser (HTML/CSS/JS)
  ├─ same-origin HTTP-only session cookie
  ├─ REST calls (/api/*)
  └─ authenticated Socket.IO connection
          ↓
Express + Helmet + auth rate limiter
  ├─ Auth routes (customer demo OTP / staff password login)
  ├─ Authentication middleware (session → current database user)
  ├─ Canonical role resolver (CUSTOMER / ADMIN / COURIER)
  ├─ Role and ownership guards per operation
  ├─ Shipment status transition service
  ├─ Audit / notification / sync activity services
  └─ Socket.IO rooms (role:ADMIN, user:{id}, shipment:{id})
          ↓
SQLite database + private POD file storage
```

## Design decisions

- **Existing uploaded requirements were used as the feature basis.** No working repository was supplied, so this project is a new HTML/CSS/JavaScript implementation rather than a patch to an existing app.
- **SQLite + Express** is used to make the prototype easy to run locally. For a multi-office production rollout, use a managed transactional database, migrations and backup/restore procedures.
- Authentication is not authorization. Every API request loads the active user from the database and normalizes the actual stored role. Role selection on the login screen cannot grant permission.
- Session is a signed HTTP-only cookie. On logout, the server clears the cookie, marks the courier's active location records inactive and disconnects that user's Socket.IO connections.
- Socket rooms are authorized by checking the actual shipment relationship before a customer/courier joins a shipment tracking room.
- Customer tracking returns only an authorized shipment. A customer cannot access another account's shipment by guessing an AWB.
- `src/status.js` centrally defines statuses and transition rules. API routes validate each change and record tracking history / audit information.
- POD images are stored outside the public web root. The image endpoint checks the user's relationship to the shipment before sending the file.
- Demo route simulation is available only when `DEMO_MODE=true`; simulated location records are labelled `DEMO`.

## Feature folders

- `public/`: HTML shell, visual system and client-side navigation / views.
- `src/middleware/`: session authentication and role guard.
- `src/routes/`: authentication, shipment, operations, financial and report APIs.
- `src/services/`: AWB generation, shipment status mutation, notifications, audit and sync activity.
- `src/db.js`: schema/index initialization and initial local demonstration data.
- `tests/`: lightweight Node test suite.

## Production gaps to close

- Real SMS OTP provider and abuse controls.
- Hardened admin/courier onboarding and password-reset flows.
- CSRF strategy and deployment-origin validation suited to the selected hosting topology.
- Database migrations, backup retention, multi-instance concurrency strategy and restore testing.
- Durable offline outbox and conflict resolution for intermittently connected courier devices.
- Push notifications, service worker/native background GPS, route/ETA provider and device-permission workflow.
- Security review, dependency scanning, logging/monitoring, retention and privacy/legal review.
