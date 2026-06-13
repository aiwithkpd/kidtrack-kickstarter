import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
});

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'GET') {
    try {
      const { rows: phases } = await pool.query(
        'SELECT * FROM phases ORDER BY order_num'
      );
      const { rows: tasks } = await pool.query(
        'SELECT * FROM tasks ORDER BY phase_id, parent_id NULLS FIRST, order_num'
      );

      // Compute per-phase stats
      const phaseStats = {};
      phases.forEach(p => {
        phaseStats[p.id] = { todo: 0, in_progress: 0, review: 0, completed: 0, blocked: 0, total: 0 };
      });
      tasks.forEach(t => {
        const s = phaseStats[t.phase_id];
        if (s) {
          s.total++;
          s[t.status] = (s[t.status] || 0) + 1;
        }
      });
      phases.forEach(p => { p.stats = phaseStats[p.id]; });

      return res.status(200).json({ phases, tasks });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'DB query failed' });
    }
  }

  if (req.method === 'PATCH') {
    const { id, status, progress } = req.body;
    if (!id) return res.status(400).json({ error: 'id required' });

    const VALID_STATUS = ['todo', 'in_progress', 'review', 'completed', 'blocked'];
    if (status && !VALID_STATUS.includes(status)) {
      return res.status(400).json({ error: 'invalid status' });
    }
    if (progress !== undefined && (progress < 0 || progress > 100)) {
      return res.status(400).json({ error: 'progress must be 0-100' });
    }

    try {
      const setClauses = [];
      const values = [];
      if (status !== undefined) { setClauses.push(`status = $${values.length + 1}`); values.push(status); }
      if (progress !== undefined) { setClauses.push(`progress = $${values.length + 1}`); values.push(progress); }
      if (setClauses.length === 0) return res.status(400).json({ error: 'nothing to update' });

      values.push(id);
      const { rows } = await pool.query(
        `UPDATE tasks SET ${setClauses.join(', ')} WHERE id = $${values.length} RETURNING *`,
        values
      );
      if (rows.length === 0) return res.status(404).json({ error: 'task not found' });
      return res.status(200).json(rows[0]);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Update failed' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
