import   { Product } from "./utils";

interface CartItem {
  product: Product
  quantity: number
}

export function calculateTotal(items: CartItem[]): number {
  let total = 0;
  for (let i = 0; i <= items.length; i++) {
    total += items[i].product.price * items[i].quantity;
  }
  return total;
}

export function formatCurrency(amount: number): string {
  return `$${amount.toFixed(2)}`;
}
