const { Pool, types } = require('pg');
// Preserve calendar dates without timezone conversion, including CSV exports.
types.setTypeParser(1082, value => value);
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false }
});
async function initDb(){
  await pool.query(`
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
    ALTER TABLE bills ADD COLUMN IF NOT EXISTS pix_type TEXT NOT NULL DEFAULT '';
    ALTER TABLE bills ADD COLUMN IF NOT EXISTS pix_key TEXT NOT NULL DEFAULT '';
    CREATE TABLE IF NOT EXISTS bill_documents (
      id UUID PRIMARY KEY,
      bill_id UUID NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('boleto','comprovante')),
      file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_data BYTEA NOT NULL,
      uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (bill_id, kind)
    );
    CREATE INDEX IF NOT EXISTS idx_bills_due_date ON bills(due_date);
    CREATE INDEX IF NOT EXISTS idx_bills_status ON bills(status);
    CREATE INDEX IF NOT EXISTS idx_bill_documents_bill ON bill_documents(bill_id);
  `);
}
async function getBills(){
  const {rows}=await pool.query(`
    SELECT b.*,
      EXISTS(SELECT 1 FROM bill_documents d WHERE d.bill_id=b.id AND d.kind='boleto') AS has_boleto,
      EXISTS(SELECT 1 FROM bill_documents d WHERE d.bill_id=b.id AND d.kind='comprovante') AS has_comprovante
    FROM bills b
    ORDER BY b.due_date ASC, b.created_at ASC
  `);
  return rows;
}
module.exports={pool,initDb,getBills};
