CREATE TABLE IF NOT EXISTS bills (
  id UUID PRIMARY KEY,
  recurrence_group UUID NULL,
  description TEXT NOT NULL,
  supplier TEXT NOT NULL DEFAULT '',
  area TEXT NOT NULL DEFAULT 'Pessoal',
  category TEXT NOT NULL DEFAULT 'Outros',
  amount NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  due_date DATE NOT NULL,
  original_due_date DATE NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid')),
  payment_date DATE NULL,
  postponed_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bills_due_date ON bills(due_date);
CREATE INDEX IF NOT EXISTS idx_bills_status ON bills(status);
