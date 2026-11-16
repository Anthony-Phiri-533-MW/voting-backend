// Usage: node add-vouchers.js [count] [prefix]
// Example: node add-vouchers.js 10 TEST-
// Inserts new unused voter vouchers into Turso.

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

const count = parseInt(process.argv[2] || '5', 10);
const prefix = process.argv[3] || 'TEST-';

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const csvPath = path.join(__dirname, 'vouchers.csv');

function readExistingCodes() {
  const set = new Set();
  if (!fs.existsSync(csvPath)) return set;
  const lines = fs.readFileSync(csvPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const code = line.split(',')[0]?.trim();
    if (code && code.toLowerCase() !== 'voucher_code') set.add(code);
  }
  return set;
}

(async () => {
  const now = new Date().toISOString();
  const existing = readExistingCodes();
  const newCodes = [];
  let created = 0;
  for (let i = 1; i <= count; i++) {
    const code = `${prefix}${String(i).padStart(3, '0')}`;
    try {
      await db.execute({
        sql: 'INSERT INTO voters (voucher_code,is_used,voted_positions,created_at) VALUES (?,?,?,?)',
        args: [code, 0, '[]', now],
      });
      created++;
      console.log('Created:', code);
      if (!existing.has(code)) newCodes.push(code);
    } catch (e) {
      console.log('Skipped (exists?):', code, '-', e.message);
    }
  }

  // Append newly created codes to the local CSV (gitignored).
  if (newCodes.length > 0) {
    const needsHeader = !fs.existsSync(csvPath);
    const rows = [];
    if (needsHeader) rows.push('voucher_code,status');
    for (const code of newCodes) rows.push(`${code},unused`);
    fs.appendFileSync(csvPath, rows.join('\n') + '\n');
    console.log(`Saved ${newCodes.length} new code(s) to ${csvPath}`);
  }

  console.log(`Done. Created ${created} of ${count} vouchers.`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});