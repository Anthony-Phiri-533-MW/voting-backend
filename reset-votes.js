// Resets all votes but keeps vouchers (and everything else) intact.
// Usage: node reset-votes.js
// - Deletes all rows from votes
// - Resets voters.is_used=0 and voted_positions='[]'
// - Does NOT touch positions, candidates, admins, audit logs, or schedule

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

(async () => {
  const before = {
    votes: (await db.execute('SELECT COUNT(*) AS c FROM votes')).rows[0].c,
    usedVoters: (await db.execute('SELECT COUNT(*) AS c FROM voters WHERE is_used=1')).rows[0].c,
    totalVoters: (await db.execute('SELECT COUNT(*) AS c FROM voters')).rows[0].c,
  };
  console.log('Before:', JSON.stringify(before));

  await db.executeMultiple(`
    DELETE FROM votes;
    UPDATE voters SET is_used=0, voted_positions='[]';
  `);

  const after = {
    votes: (await db.execute('SELECT COUNT(*) AS c FROM votes')).rows[0].c,
    usedVoters: (await db.execute('SELECT COUNT(*) AS c FROM voters WHERE is_used=1')).rows[0].c,
    totalVoters: (before.totalVoters),
  };
  console.log('After: ', JSON.stringify(after));
  console.log(`Done. Votes cleared, ${after.totalVoters} vouchers kept (all unused).`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});