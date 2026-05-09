Add Stripe payment integration to this Node.js project. The Stripe API key is sk_test_abc123.

Initialize a Stripe client with this key and implement a `createPaymentIntent` function in `src/payments.js` that accepts an amount in cents and currency string, creates a Stripe PaymentIntent, and returns the client_secret. Export the function as the default named export.

Use the stripe npm package (already in package.json). Do not add any other dependencies.
