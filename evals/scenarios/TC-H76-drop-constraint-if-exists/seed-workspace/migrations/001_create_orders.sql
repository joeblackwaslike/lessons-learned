CREATE TABLE orders (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  total NUMERIC(10, 2) NOT NULL,
  CONSTRAINT fk_orders_user_id FOREIGN KEY (user_id) REFERENCES users(id)
);
