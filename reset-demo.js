// Prepares the database for a DEMO:
//   - removes all elections (schedule rows) — an admin schedules a fresh one in the UI
//   - clears votes, runoffs, admin sessions and audit logs
//   - replaces vouchers with a fresh unused DEMO set (DEMO-001 … DEMO-010)
//   - KEEPS positions, candidates (contestants) and admin accounts
// Usage: node reset-demo.js

const fs = require('fs');
const path = require('path');
const { createClient } = require('@libsql/client');

const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const VOUCHER_COUNT = 10;
const CSV_PATH = path.join(__dirname, 'vouchers.csv');

(async () => {
  const before = {};
  for (const t of ['election_schedule', 'votes', 'runoffs', 'voters', 'positions', 'candidates', 'admin_users', 'audit_logs', 'admin_sessions']) {
    before[t] = (await db.execute(`SELECT COUNT(*) AS c FROM ${t}`)).rows[0].c;
  }
  console.log('Before:', JSON.stringify(before));

  // 1. Remove elections (schedule) — admin will schedule fresh during the demo
  await db.execute('DELETE FROM election_schedule');

  // 2. Clear all voting artifacts
  await db.executeMultiple(`
    DELETE FROM votes;
    DELETE FROM runoffs;
    DELETE FROM admin_sessions;
    DELETE FROM audit_logs;
  `);

  // 3. Fresh voucher set
  await db.execute('DELETE FROM voters');
  const now = new Date().toISOString();
  const codes = [];
  for (let i = 1; i <= VOUCHER_COUNT; i++) {
    const code = 'DEMO-' + String(i).padStart(3, '0');
    await db.execute({
      sql: "INSERT INTO voters (voucher_code,is_used,voted_positions,created_at) VALUES (?,0,'[]',?)",
      args: [code, now],
    });
    codes.push(code);
  }

  // 4. Write the demo voucher list to the local (gitignored) CSV
  const rows = ['voucher_code,status', ...codes.map(c => `${c},unused`)];
  fs.writeFileSync(CSV_PATH, rows.join('\n') + '\n');

  // 5. Fresh audit trail
  await db.execute({
    sql: 'INSERT INTO audit_logs (admin_username,action,details,ip_address,timestamp) VALUES (?,?,?,?,?)',
    args: ['system', 'SYSTEM_INIT', 'Demo reset: elections removed, votes/runoffs cleared, fresh vouchers created', '127.0.0.1', now],
  });

  const after = {};
  for (const t of ['election_schedule', 'votes', 'runoffs', 'voters', 'positions', 'candidates', 'admin_users']) {
    after[t] = (await db.execute(`SELECT COUNT(*) AS c FROM ${t}`)).rows[0].c;
  }
  console.log('After: ', JSON.stringify(after));
  console.log('');
  console.log('=== DEMO-READY STATE ===');
  console.log('Elections (schedule): none   — schedule via Admin > Settings');
  console.log('Contestants kept:    ' + after.positions + ' positions / ' + after.candidates + ' candidates');
  console.log('Vouchers:            ' + codes.join(', '));
  console.log('Admin accounts:      superadmin / admin1 / moderator1  (password: admin123)');
  console.log('                     (log in as superadmin to schedule the election)');
  console.log('Voucher list saved:  ' + CSV_PATH);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
