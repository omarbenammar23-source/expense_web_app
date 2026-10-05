ALTER TABLE expenses
ADD COLUMN refunded_amount DECIMAL(10,2) NULL AFTER amount,
ADD COLUMN refund_currency VARCHAR(8) NULL AFTER refunded_amount;
