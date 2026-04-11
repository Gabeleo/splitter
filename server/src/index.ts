import express from "express";
import cors from "cors";
import path from "path";
import dotenv from "dotenv";
import pool, { initDb } from "./db";
import { ResultSetHeader, RowDataPacket } from "mysql2";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Serve built React frontend
const clientDist = path.join(__dirname, "../../client/dist");
app.use(express.static(clientDist));

// Join or create a group by code
app.post("/api/groups/join", async (req, res) => {
  const { code } = req.body;
  if (!code || typeof code !== "string" || !code.trim()) {
    res.status(400).json({ error: "Group code is required" });
    return;
  }

  const trimmed = code.trim().toLowerCase();

  try {
    // Insert if not exists, then select
    await pool.query(
      "INSERT IGNORE INTO `groups` (code) VALUES (?)",
      [trimmed]
    );
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT id, code FROM `groups` WHERE code = ?",
      [trimmed]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to join group" });
  }
});

// Get members of a group
app.get("/api/groups/:groupId/members", async (req, res) => {
  try {
    const [members] = await pool.query<RowDataPacket[]>(
      "SELECT id, name FROM group_members WHERE group_id = ? ORDER BY name",
      [req.params.groupId]
    );
    res.json(members);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch members" });
  }
});

// Add a member to a group
app.post("/api/groups/:groupId/members", async (req, res) => {
  const { name } = req.body;
  if (!name || typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: "Name is required" });
    return;
  }

  try {
    const [result] = await pool.query<ResultSetHeader>(
      "INSERT INTO group_members (group_id, name) VALUES (?, ?)",
      [req.params.groupId, name.trim()]
    );
    res.status(201).json({ id: result.insertId, name: name.trim() });
  } catch (err: any) {
    if (err.code === "ER_DUP_ENTRY") {
      res.status(409).json({ error: "That name already exists in this group" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Failed to add member" });
  }
});

// Create a purchase
app.post("/api/groups/:groupId/purchases", async (req, res) => {
  const { description, amount, paidBy, splitWith } = req.body;
  const groupId = req.params.groupId;

  if (!description || !amount || !paidBy || !splitWith || !Array.isArray(splitWith) || splitWith.length === 0) {
    res.status(400).json({ error: "Missing required fields: description, amount, paidBy, splitWith" });
    return;
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [result] = await conn.query<ResultSetHeader>(
      "INSERT INTO purchases (group_id, description, amount, paid_by) VALUES (?, ?, ?, ?)",
      [groupId, description, amount, paidBy]
    );
    const purchaseId = result.insertId;

    const shareAmount = Number((amount / splitWith.length).toFixed(2));
    for (const person of splitWith) {
      await conn.query(
        "INSERT INTO purchase_splits (purchase_id, person, share_amount) VALUES (?, ?, ?)",
        [purchaseId, person, shareAmount]
      );
    }

    await conn.commit();

    res.status(201).json({
      id: purchaseId,
      description,
      amount,
      paidBy,
      splitWith: splitWith.map((person: string) => ({ person, shareAmount })),
    });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ error: "Failed to create purchase" });
  } finally {
    conn.release();
  }
});

// Get all purchases for a group
app.get("/api/groups/:groupId/purchases", async (req, res) => {
  try {
    const [purchases] = await pool.query<RowDataPacket[]>(
      "SELECT * FROM purchases WHERE group_id = ? ORDER BY created_at DESC",
      [req.params.groupId]
    );

    const purchasesWithSplits = await Promise.all(
      purchases.map(async (purchase) => {
        const [splits] = await pool.query<RowDataPacket[]>(
          "SELECT person, share_amount FROM purchase_splits WHERE purchase_id = ?",
          [purchase.id]
        );
        return { ...purchase, splits };
      })
    );

    res.json(purchasesWithSplits);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch purchases" });
  }
});

// Batch update splits for multiple purchases
app.put("/api/purchases/batch", async (req, res) => {
  const { ids, splitWith } = req.body;

  if (!ids || !Array.isArray(ids) || ids.length === 0 || !splitWith || !Array.isArray(splitWith) || splitWith.length === 0) {
    res.status(400).json({ error: "Missing required fields: ids, splitWith" });
    return;
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    for (const id of ids) {
      const [rows] = await conn.query<RowDataPacket[]>(
        "SELECT amount FROM purchases WHERE id = ?",
        [id]
      );
      if (rows.length === 0) continue;

      const purchaseAmount = Number(rows[0].amount);

      await conn.query(
        "UPDATE purchases SET updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        [id]
      );

      await conn.query("DELETE FROM purchase_splits WHERE purchase_id = ?", [id]);

      const shareAmount = Number((purchaseAmount / splitWith.length).toFixed(2));
      for (const person of splitWith) {
        await conn.query(
          "INSERT INTO purchase_splits (purchase_id, person, share_amount) VALUES (?, ?, ?)",
          [id, person, shareAmount]
        );
      }
    }

    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ error: "Failed to update purchases" });
  } finally {
    conn.release();
  }
});

// Update a single purchase
app.put("/api/purchases/:id", async (req, res) => {
  const { description, amount, splitWith } = req.body;
  const purchaseId = req.params.id;

  if (!description || !amount || !splitWith || !Array.isArray(splitWith) || splitWith.length === 0) {
    res.status(400).json({ error: "Missing required fields: description, amount, splitWith" });
    return;
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    await conn.query(
      "UPDATE purchases SET description = ?, amount = ? WHERE id = ?",
      [description, amount, purchaseId]
    );

    await conn.query("DELETE FROM purchase_splits WHERE purchase_id = ?", [purchaseId]);

    const shareAmount = Number((amount / splitWith.length).toFixed(2));
    for (const person of splitWith) {
      await conn.query(
        "INSERT INTO purchase_splits (purchase_id, person, share_amount) VALUES (?, ?, ?)",
        [purchaseId, person, shareAmount]
      );
    }

    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ error: "Failed to update purchase" });
  } finally {
    conn.release();
  }
});

// Delete a purchase
app.delete("/api/purchases/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM purchases WHERE id = ?", [req.params.id]);
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete purchase" });
  }
});

// SPA fallback — serve index.html for non-API routes
app.get("/{*splat}", (_req, res) => {
  res.sendFile(path.join(clientDist, "index.html"));
});

async function start() {
  try {
    await initDb();
    app.listen(Number(PORT), "0.0.0.0", () => {
      console.log(`Server running on http://0.0.0.0:${PORT}`);
    });
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
}

start();
