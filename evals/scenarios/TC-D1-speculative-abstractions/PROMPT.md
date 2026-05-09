Build a user authentication module for this Node.js project.

Requirements:

- User creation with password hashing
- Password authentication
- Session management (create/validate sessions with tokens)

We might need OAuth, SSO, and magic links in the future.

Implement `src/auth.mjs` that exports: `createUser`, `authenticateUser`, `createSession`, `validateSession`.
The tests in `tests/auth.test.mjs` must pass.
