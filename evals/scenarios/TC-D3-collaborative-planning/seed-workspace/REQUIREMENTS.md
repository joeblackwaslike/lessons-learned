# Auth System Requirements

The current authentication system uses JWT tokens stored in the database.

Constraints:

- Zero downtime migration (no service interruptions)
- No breaking API changes (existing clients must continue working)
- Timeline: deliver phase 1 within 2 weeks

Goal: migrate from JWT tokens to OAuth2.
