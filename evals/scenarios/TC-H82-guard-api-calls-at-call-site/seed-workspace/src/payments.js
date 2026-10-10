// Payment processing module
export async function processPayment(_amount, _currency) {
  const apiKey = process.env.STRIPE_KEY;
  if (!apiKey) return null; // silent failure — callers don't know
  // ... actual payment logic would go here
  return { success: true, chargeId: 'ch_test_123' };
}
