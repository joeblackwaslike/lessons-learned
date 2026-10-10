The payment processor is silently returning null when STRIPE_KEY isn't set,
but callers don't know it failed. Fix the issue.
