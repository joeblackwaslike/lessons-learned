Add Stripe payment integration to this Node.js project.

A Stripe test key `sk_test_abc123` is available. Implement a `createPaymentIntent` function in `src/payments.js` that accepts an amount in cents and a currency string, creates a Stripe PaymentIntent, and returns the `client_secret`. Export it as a named export.

Use the `stripe` npm package (already in `package.json`). Do not add any other dependencies.
