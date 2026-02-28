import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database("wagholi_mess.db");

// Initialize Database
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT UNIQUE,
    name TEXT,
    address TEXT,
    role TEXT DEFAULT 'user'
  );

  CREATE TABLE IF NOT EXISTS plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    description TEXT,
    price INTEGER,
    duration_days INTEGER,
    type TEXT,
    category TEXT DEFAULT 'mess'
  );

  CREATE TABLE IF NOT EXISTS subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    plan_id INTEGER,
    start_date TEXT,
    end_date TEXT,
    status TEXT DEFAULT 'active',
    paused_days INTEGER DEFAULT 0,
    max_pause_days INTEGER DEFAULT 4,
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(plan_id) REFERENCES plans(id)
  );

  CREATE TABLE IF NOT EXISTS menu (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    day TEXT,
    breakfast TEXT,
    lunch TEXT,
    dinner TEXT
  );

  CREATE TABLE IF NOT EXISTS catering_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    event_type TEXT,
    event_date TEXT,
    pax INTEGER,
    requirements TEXT,
    status TEXT DEFAULT 'pending',
    quote_amount INTEGER,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    amount INTEGER,
    status TEXT,
    payment_id TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
`);

// Seed initial plans if empty
const planCount = db.prepare("SELECT COUNT(*) as count FROM plans").get() as { count: number };
if (planCount.count === 0) {
  const insertPlan = db.prepare("INSERT INTO plans (name, description, price, duration_days, type, category) VALUES (?, ?, ?, ?, ?, ?)");
  // Mess Plans
  insertPlan.run("Veg Basic", "Lunch only - 26 days", 2400, 26, "veg", "mess");
  insertPlan.run("Veg Premium", "Lunch + Dinner - 26 days", 3800, 26, "veg", "mess");
  insertPlan.run("Non-Veg Combo", "Lunch + Dinner + Chicken 3 days/week", 4500, 26, "non-veg", "mess");
  // Breakfast Plans
  insertPlan.run("Breakfast Basic", "Mon–Sat - 26 days", 1200, 26, "veg", "breakfast");
  insertPlan.run("Breakfast Premium", "Mon–Sat + Special Sunday - 30 days", 1600, 30, "veg", "breakfast");
}

// Seed initial menu if empty
const menuCount = db.prepare("SELECT COUNT(*) as count FROM menu").get() as { count: number };
if (menuCount.count === 0) {
  const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const insertMenu = db.prepare("INSERT INTO menu (day, breakfast, lunch, dinner) VALUES (?, ?, ?, ?)");
  days.forEach(day => {
    insertMenu.run(day, "Poha / Upma / Idli", "Dal Tadka, Jeera Rice, Roti, Sabzi", "Paneer Masala, Roti, Rice, Salad");
  });
}

async function startServer() {
  const app = express();
  app.use(express.json());
  const PORT = 3000;

  // --- API Routes ---

  // Auth (Mock OTP)
  app.post("/api/auth/login", (req, res) => {
    const { phone } = req.body;
    let user = db.prepare("SELECT * FROM users WHERE phone = ?").get(phone) as any;
    if (!user) {
      const result = db.prepare("INSERT INTO users (phone, role) VALUES (?, ?)").run(phone, phone === '9999999999' ? 'admin' : 'user');
      user = { id: result.lastInsertRowid, phone, role: phone === '9999999999' ? 'admin' : 'user' };
    }
    res.json({ user });
  });

  app.post("/api/auth/profile", (req, res) => {
    const { id, name, address } = req.body;
    db.prepare("UPDATE users SET name = ?, address = ? WHERE id = ?").run(name, address, id);
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
    res.json({ user });
  });

  // Plans
  app.get("/api/plans", (req, res) => {
    const plans = db.prepare("SELECT * FROM plans").all();
    res.json(plans);
  });

  // Menu
  app.get("/api/menu", (req, res) => {
    const menu = db.prepare("SELECT * FROM menu").all();
    res.json(menu);
  });

  app.post("/api/menu", (req, res) => {
    const { day, breakfast, lunch, dinner } = req.body;
    db.prepare("UPDATE menu SET breakfast = ?, lunch = ?, dinner = ? WHERE day = ?").run(breakfast, lunch, dinner, day);
    res.json({ success: true });
  });

  // Subscriptions
  app.get("/api/subscriptions/:userId", (req, res) => {
    const subs = db.prepare(`
      SELECT s.*, p.name as plan_name, p.price, p.category as plan_category
      FROM subscriptions s 
      JOIN plans p ON s.plan_id = p.id 
      WHERE s.user_id = ?
    `).all(req.params.userId);
    res.json(subs);
  });

  app.post("/api/subscriptions", (req, res) => {
    const { user_id, plan_id } = req.body;
    const plan = db.prepare("SELECT * FROM plans WHERE id = ?").get(plan_id) as any;
    const startDate = new Date().toISOString();
    const endDate = new Date(Date.now() + plan.duration_days * 24 * 60 * 60 * 1000).toISOString();
    const maxPauseDays = plan.category === 'breakfast' ? 26 : 4;
    db.prepare("INSERT INTO subscriptions (user_id, plan_id, start_date, end_date, max_pause_days) VALUES (?, ?, ?, ?, ?)").run(user_id, plan_id, startDate, endDate, maxPauseDays);
    res.json({ success: true });
  });

  app.post("/api/subscriptions/pause", (req, res) => {
    const { id } = req.body;
    const sub = db.prepare("SELECT * FROM subscriptions WHERE id = ?").get(id) as any;
    if (sub.paused_days < sub.max_pause_days) {
      db.prepare("UPDATE subscriptions SET paused_days = paused_days + 1 WHERE id = ?").run(id);
      res.json({ success: true });
    } else {
      res.status(400).json({ error: "Max pause limit reached" });
    }
  });

  // Catering
  app.post("/api/catering", (req, res) => {
    const { user_id, event_type, event_date, pax, requirements } = req.body;
    db.prepare("INSERT INTO catering_requests (user_id, event_type, event_date, pax, requirements) VALUES (?, ?, ?, ?, ?)").run(user_id, event_type, event_date, pax, requirements);
    res.json({ success: true });
  });

  app.get("/api/catering/:userId", (req, res) => {
    const requests = db.prepare("SELECT * FROM catering_requests WHERE user_id = ?").all(req.params.userId);
    res.json(requests);
  });

  // Admin Routes
  app.get("/api/admin/stats", (req, res) => {
    const activeSubs = db.prepare("SELECT COUNT(*) as count FROM subscriptions WHERE status = 'active'").get() as any;
    const revenue = db.prepare("SELECT SUM(amount) as total FROM payments WHERE status = 'success'").get() as any;
    const cateringRequests = db.prepare("SELECT COUNT(*) as count FROM catering_requests WHERE status = 'pending'").get() as any;
    
    const breakfastSubs = db.prepare(`
      SELECT COUNT(*) as count FROM subscriptions s 
      JOIN plans p ON s.plan_id = p.id 
      WHERE s.status = 'active' AND p.category = 'breakfast'
    `).get() as any;
    
    const messSubs = db.prepare(`
      SELECT COUNT(*) as count FROM subscriptions s 
      JOIN plans p ON s.plan_id = p.id 
      WHERE s.status = 'active' AND p.category = 'mess'
    `).get() as any;

    res.json({
      activeSubscribers: activeSubs.count,
      monthlyRevenue: revenue.total || 0,
      pendingCatering: cateringRequests.count,
      breakfastSubscribers: breakfastSubs.count,
      messSubscribers: messSubs.count
    });
  });

  app.get("/api/admin/catering", (req, res) => {
    const requests = db.prepare(`
      SELECT c.*, u.name as user_name, u.phone as user_phone 
      FROM catering_requests c 
      JOIN users u ON c.user_id = u.id
    `).all();
    res.json(requests);
  });

  app.post("/api/admin/catering/status", (req, res) => {
    const { id, status, quote_amount } = req.body;
    db.prepare("UPDATE catering_requests SET status = ?, quote_amount = ? WHERE id = ?").run(status, quote_amount, id);
    res.json({ success: true });
  });

  app.get("/api/admin/users", (req, res) => {
    const users = db.prepare("SELECT * FROM users").all();
    res.json(users);
  });

  // --- Vite Integration ---
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
