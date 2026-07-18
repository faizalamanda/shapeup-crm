-- Create B-Tree indexes for fast indexing on columns used in expenses filtering & sorting
CREATE INDEX IF NOT EXISTS idx_expenses_business_id_date_created ON public.expenses (business_id, date DESC, created_at DESC);

-- Create foreign key indexes on expenses table
CREATE INDEX IF NOT EXISTS idx_expenses_category_account_id ON public.expenses (category_account_id);
CREATE INDEX IF NOT EXISTS idx_expenses_payment_account_id ON public.expenses (payment_account_id);
CREATE INDEX IF NOT EXISTS idx_expenses_transaction_id ON public.expenses (transaction_id);

-- Create foreign key and tenant indexes on expense_payments table
CREATE INDEX IF NOT EXISTS idx_expense_payments_expense_id ON public.expense_payments (expense_id);
CREATE INDEX IF NOT EXISTS idx_expense_payments_transaction_id ON public.expense_payments (transaction_id);
CREATE INDEX IF NOT EXISTS idx_expense_payments_payment_method_account_id ON public.expense_payments (payment_method_account_id);
CREATE INDEX IF NOT EXISTS idx_expense_payments_business_id ON public.expense_payments (business_id);
