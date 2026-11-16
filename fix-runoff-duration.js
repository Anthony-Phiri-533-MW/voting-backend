const fs = require('fs');
for (const l of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
const { createClient } = require('@libsql/client');
(async () => {
  const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  // Set end = start + 4 hours for all live runoffs (proper ISO-8601 UTC format)
  const r = await db.execute(`UPDATE runoffs
    SET end_date = strftime('%Y-%m-%dT%H:%M:%S.000Z', start_date, '+4 hours')
    WHERE status = 'live'`);
  console.log('updated rows:', r.rowsAffected);
  const c = await db.execute('SELECT id, position_id, start_date, end_date, status FROM runoffs ORDER BY id');
  for (const row of c.rows) console.log(JSON.stringify(row));
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
