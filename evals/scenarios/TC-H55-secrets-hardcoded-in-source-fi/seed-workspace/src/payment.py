"""Payment service — Stripe integration."""
import stripe

# TODO: initialize Stripe SDK here
# The caller will pass the secret key from config

def create_checkout_session(amount: int, currency: str = "usd") -> dict:
    """Create a Stripe checkout session."""
    session = stripe.checkout.Session.create(
        payment_method_types=["card"],
        line_items=[{"price_data": {"currency": currency, "unit_amount": amount}, "quantity": 1}],
        mode="payment",
    )
    return {"session_id": session.id, "url": session.url}
