require("dotenv").config();
const express = require("express");
const path = require("path");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL || "";
const APP_PIN = String(process.env.APP_PIN || "").trim();

if (!DATABASE_URL) {
  console.warn("ATENÇÃO: DATABASE_URL não configurada. A sincronização online não funcionará.");
}

const pool = DATABASE_URL ? new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
}) : null;

app.use(express.json({ limit: "35mb" }));
app.use(express.static(path.join(__dirname, "public")));

function requirePin(req, res, next) {
  if (!APP_PIN) return next();
  const pin = String(req.header("x-app-pin") || "");
  if (pin !== APP_PIN) return res.status(401).json({ error: "PIN inválido" });
  next();
}

async function initDb() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS trips (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      vehicle TEXT,
      start_km NUMERIC,
      notes TEXT,
      started_at BIGINT NOT NULL,
      finished_at BIGINT,
      updated_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS places (
      id TEXT PRIMARY KEY,
      trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      date TEXT,
      time TEXT,
      notes TEXT,
      rating INTEGER,
      photos JSONB DEFAULT '[]'::jsonb,
      lat DOUBLE PRECISION,
      lon DOUBLE PRECISION,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS expenses (
      id TEXT PRIMARY KEY,
      trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      category TEXT NOT NULL,
      description TEXT,
      amount NUMERIC NOT NULL DEFAULT 0,
      date TEXT,
      liters NUMERIC,
      unit_price NUMERIC,
      notes TEXT,
      receipt TEXT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS gps_points (
      id TEXT PRIMARY KEY,
      trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      lat DOUBLE PRECISION NOT NULL,
      lon DOUBLE PRECISION NOT NULL,
      accuracy DOUBLE PRECISION,
      ts BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_places_trip ON places(trip_id);
    CREATE INDEX IF NOT EXISTS idx_expenses_trip ON expenses(trip_id);
    CREATE INDEX IF NOT EXISTS idx_gps_trip ON gps_points(trip_id);
  `);
}

function normalizeState(rows) {
  return {
    trips: rows.trips.map(r => ({
      id:r.id,name:r.name,vehicle:r.vehicle,startKm:r.start_km===null?null:Number(r.start_km),
      notes:r.notes,startedAt:Number(r.started_at),finishedAt:r.finished_at===null?null:Number(r.finished_at),
      updatedAt:Number(r.updated_at)
    })),
    places: rows.places.map(r => ({
      id:r.id,tripId:r.trip_id,name:r.name,date:r.date,time:r.time,notes:r.notes,rating:r.rating,
      photos:r.photos||[],lat:r.lat,lon:r.lon,createdAt:Number(r.created_at),updatedAt:Number(r.updated_at)
    })),
    expenses: rows.expenses.map(r => ({
      id:r.id,tripId:r.trip_id,category:r.category,description:r.description,amount:Number(r.amount||0),
      date:r.date,liters:r.liters===null?null:Number(r.liters),unitPrice:r.unit_price===null?null:Number(r.unit_price),
      notes:r.notes,receipt:r.receipt,createdAt:Number(r.created_at),updatedAt:Number(r.updated_at)
    })),
    gps: rows.gps.map(r => ({
      id:r.id,tripId:r.trip_id,lat:r.lat,lon:r.lon,accuracy:r.accuracy,ts:Number(r.ts),updatedAt:Number(r.updated_at)
    }))
  };
}

async function readState(client=pool) {
  const [trips, places, expenses, gps] = await Promise.all([
    client.query("SELECT * FROM trips ORDER BY started_at DESC"),
    client.query("SELECT * FROM places ORDER BY created_at DESC"),
    client.query("SELECT * FROM expenses ORDER BY created_at DESC"),
    client.query("SELECT * FROM gps_points ORDER BY ts ASC")
  ]);
  return normalizeState({ trips:trips.rows, places:places.rows, expenses:expenses.rows, gps:gps.rows });
}

app.get("/api/health", async (req,res) => {
  try {
    if (!pool) return res.json({ ok:true, database:false, pinRequired:!!APP_PIN });
    await pool.query("SELECT 1");
    res.json({ ok:true, database:true, pinRequired:!!APP_PIN });
  } catch (e) {
    res.status(500).json({ ok:false, error:e.message, pinRequired:!!APP_PIN });
  }
});

app.use("/api", requirePin);

app.get("/api/state", async (req,res) => {
  if (!pool) return res.status(503).json({ error:"Banco online não configurado" });
  try { res.json(await readState()); }
  catch(e){ res.status(500).json({ error:e.message }); }
});

app.post("/api/sync", async (req,res) => {
  if (!pool) return res.status(503).json({ error:"Banco online não configurado" });
  const body = req.body || {};
  const trips = Array.isArray(body.trips) ? body.trips : [];
  const places = Array.isArray(body.places) ? body.places : [];
  const expenses = Array.isArray(body.expenses) ? body.expenses : [];
  const gps = Array.isArray(body.gps) ? body.gps : [];
  const deletes = Array.isArray(body.deletes) ? body.deletes : [];

  const c = await pool.connect();
  try {
    await c.query("BEGIN");

    for (const t of trips) {
      await c.query(`
        INSERT INTO trips(id,name,vehicle,start_km,notes,started_at,finished_at,updated_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT(id) DO UPDATE SET
          name=EXCLUDED.name, vehicle=EXCLUDED.vehicle, start_km=EXCLUDED.start_km,
          notes=EXCLUDED.notes, started_at=EXCLUDED.started_at, finished_at=EXCLUDED.finished_at,
          updated_at=EXCLUDED.updated_at
        WHERE EXCLUDED.updated_at >= trips.updated_at
      `,[t.id,t.name,t.vehicle||null,t.startKm||null,t.notes||null,t.startedAt,t.finishedAt||null,t.updatedAt||Date.now()]);
    }

    for (const p of places) {
      await c.query(`
        INSERT INTO places(id,trip_id,name,date,time,notes,rating,photos,lat,lon,created_at,updated_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12)
        ON CONFLICT(id) DO UPDATE SET
          trip_id=EXCLUDED.trip_id,name=EXCLUDED.name,date=EXCLUDED.date,time=EXCLUDED.time,
          notes=EXCLUDED.notes,rating=EXCLUDED.rating,photos=EXCLUDED.photos,lat=EXCLUDED.lat,lon=EXCLUDED.lon,
          created_at=EXCLUDED.created_at,updated_at=EXCLUDED.updated_at
        WHERE EXCLUDED.updated_at >= places.updated_at
      `,[p.id,p.tripId,p.name,p.date||null,p.time||null,p.notes||null,p.rating||null,JSON.stringify(p.photos||[]),
         p.lat||null,p.lon||null,p.createdAt,p.updatedAt||Date.now()]);
    }

    for (const e of expenses) {
      await c.query(`
        INSERT INTO expenses(id,trip_id,category,description,amount,date,liters,unit_price,notes,receipt,created_at,updated_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        ON CONFLICT(id) DO UPDATE SET
          trip_id=EXCLUDED.trip_id,category=EXCLUDED.category,description=EXCLUDED.description,
          amount=EXCLUDED.amount,date=EXCLUDED.date,liters=EXCLUDED.liters,unit_price=EXCLUDED.unit_price,
          notes=EXCLUDED.notes,receipt=EXCLUDED.receipt,created_at=EXCLUDED.created_at,updated_at=EXCLUDED.updated_at
        WHERE EXCLUDED.updated_at >= expenses.updated_at
      `,[e.id,e.tripId,e.category,e.description||null,e.amount||0,e.date||null,e.liters||null,e.unitPrice||null,
         e.notes||null,e.receipt||null,e.createdAt,e.updatedAt||Date.now()]);
    }

    for (const g of gps) {
      await c.query(`
        INSERT INTO gps_points(id,trip_id,lat,lon,accuracy,ts,updated_at)
        VALUES($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT(id) DO UPDATE SET
          trip_id=EXCLUDED.trip_id,lat=EXCLUDED.lat,lon=EXCLUDED.lon,accuracy=EXCLUDED.accuracy,
          ts=EXCLUDED.ts,updated_at=EXCLUDED.updated_at
        WHERE EXCLUDED.updated_at >= gps_points.updated_at
      `,[g.id,g.tripId,g.lat,g.lon,g.accuracy||null,g.ts,g.updatedAt||Date.now()]);
    }

    for (const d of deletes) {
      const table = ({trip:"trips",place:"places",expense:"expenses",gps:"gps_points"})[d.entity];
      if (table && d.entityId) await c.query(`DELETE FROM ${table} WHERE id=$1`,[d.entityId]);
    }

    await c.query("COMMIT");
    res.json(await readState(c));
  } catch(e) {
    await c.query("ROLLBACK");
    res.status(500).json({ error:e.message });
  } finally {
    c.release();
  }
});

app.get("*", (req,res) => res.sendFile(path.join(__dirname,"public","index.html")));

initDb()
  .then(() => app.listen(PORT, () => console.log(`Diário de Bordo V2 rodando na porta ${PORT}`)))
  .catch(err => {
    console.error("Falha ao inicializar banco:", err);
    process.exit(1);
  });
