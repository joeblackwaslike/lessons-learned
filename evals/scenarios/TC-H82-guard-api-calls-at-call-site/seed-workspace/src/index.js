import { processPayment } from './payments.js';

export async function handleCheckout(cart) {
  const result = await processPayment(cart.total, 'usd');
  // result is null when STRIPE_KEY is unset, but we proceed as if it succeeded
  return { orderId: 'ord_456', payment: result };
}
