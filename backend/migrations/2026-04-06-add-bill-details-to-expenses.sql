ALTER TABLE expenses
ADD COLUMN bill_items LONGTEXT NULL AFTER expense_date,
ADD COLUMN discount_amount DECIMAL(10,2) NULL AFTER bill_items,
ADD COLUMN item_count INT NULL AFTER discount_amount,
ADD COLUMN auto_item_count BOOLEAN NOT NULL DEFAULT TRUE AFTER item_count;
