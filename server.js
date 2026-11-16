/**
 * SJBU Voting System - Backend (Turso/libSQL)
 * Uses Turso (libSQL) for persistence. SSE for live updates.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---- load .env ----
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

const { createClient } = require('@libsql/client');

const PORT = process.env.PORT || 3005;
const API_PREFIX = '/api/app';
if (!process.env.TURSO_DATABASE_URL) {
  console.error('');
  console.error('FATAL: TURSO_DATABASE_URL is not set.');
  console.error('The backend reads its Turso credentials from environment variables —');
  console.error('from a .env file when running locally, or from your hosting platform\'s');
  console.error('environment variable settings when deployed (a .env file is never committed).');
  console.error('');
  console.error('Set these variables and restart the app:');
  console.error('  TURSO_DATABASE_URL=libsql://your-database-youruser.aws-eu-central-1.turso.io');
  console.error('  TURSO_AUTH_TOKEN=your-turso-auth-token');
  process.exit(1);
}
const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// ============================================================
// DB helpers
// ============================================================
async function run(sql, args = []) {
  return db.execute({ sql, args });
}
async function all(sql, args = []) {
  const r = await db.execute({ sql, args });
  return r.rows;
}
async function get(sql, args = []) {
  const r = await db.execute({ sql, args });
  return r.rows[0];
}

// ============================================================
// Schema + seed
// ============================================================
async function initDb() {
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS election_schedule (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      election_key TEXT NOT NULL,
      start_date TEXT,
      end_date TEXT,
      results_announcement TEXT,
      updated_at TEXT,
      updated_by INTEGER
    );
    CREATE TABLE IF NOT EXISTS positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS candidates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      position_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      image_url TEXT,
      manifesto TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS voters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      voucher_code TEXT NOT NULL UNIQUE,
      is_used INTEGER NOT NULL DEFAULT 0,
      voted_positions TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      voucher_code TEXT NOT NULL,
      position_id INTEGER NOT NULL,
      candidate_id INTEGER NOT NULL,
      verification_code TEXT NOT NULL,
      created_at TEXT NOT NULL,
      round INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      last_login TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_username TEXT NOT NULL,
      action TEXT NOT NULL,
      details TEXT,
      ip_address TEXT,
      timestamp TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS runoffs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      position_id INTEGER NOT NULL,
      candidate_ids TEXT NOT NULL,
      start_date TEXT,
      end_date TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS admin_sessions (
      token TEXT PRIMARY KEY,
      admin_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
  `);

  // Migration for existing DBs: add round column to votes (idempotent).
  try { await run('ALTER TABLE votes ADD COLUMN round INTEGER NOT NULL DEFAULT 0'); } catch (e) { /* column already exists */ }

  // NOTE: no election schedule is seeded — the election is scheduled by an
  // admin through the Settings page (demo flow: log in → schedule → vote).

  // seed positions
  const pc = (await get('SELECT COUNT(*) AS c FROM positions')).c;
  if (!pc) {
    const names = ['President','Vice President','General Secretary','Speaker','Finance Director','Sports Director','Entertainment Director'];
    const now = new Date().toISOString();
    for (const n of names) await run('INSERT INTO positions (name,created_at) VALUES (?,?)', [n, now]);
  }

  // seed candidates
  const cc = (await get('SELECT COUNT(*) AS c FROM candidates')).c;
  if (!cc) {
    const cands = [
      {p:1,n:'Alice Reyes',m:'Committed to student welfare.'},
      {p:1,n:'Bob Lim',m:'Fighting for affordable tuition.'},
      {p:1,n:'Carla Dela Cruz',m:'Focus on mental health.'},
      {p:2,n:'Diego Santos',m:'Student voice advocate.'},
      {p:2,n:'Elena Gomez',m:'Improving student organizations.'},
      {p:2,n:'Felix Rivera',m:'Green campus initiatives.'},
      {p:3,n:'Grace Mwangi',m:'Transparent record keeping and communication.'},
      {p:3,n:'Henry Osei',m:'Efficient documentation and reporting.'},
      {p:3,n:'Irene Kato',m:'Modernizing administrative processes.'},
      {p:4,n:'Jack Njoroge',m:'Fair and orderly house proceedings.'},
      {p:4,n:'Karen Muchiri',m:'Upholding parliamentary rules.'},
      {p:4,n:'Larry Otieno',m:'Impartial leadership of the house.'},
      {p:5,n:'Mary Wanjiku',m:'Responsible budget management.'},
      {p:5,n:'Nathan Kipruto',m:'Financial accountability and audits.'},
      {p:5,n:'Olivia Akinyi',m:'Sustainable funding for student events.'},
      {p:6,n:'Peter Kamau',m:'Upgrade sports facilities.'},
      {p:6,n:'Quinter Adhiambo',m:'More inter-school tournaments.'},
      {p:6,n:'Robert Mburu',m:'Fitness and wellness programs.'},
      {p:7,n:'Sarah Chelimo',m:'Vibrant student events calendar.'},
      {p:7,n:'Thomas Githinji',m:'More cultural festivals and shows.'},
      {p:7,n:'Upendo Mwende',m:'Fun and inclusive entertainment.'},
    ];
    const now = new Date().toISOString();
    for (const c of cands) await run('INSERT INTO candidates (position_id,name,image_url,manifesto,created_at) VALUES (?,?,?,?,?)', [c.p, c.n, 'https://via.placeholder.com/150', c.m, now]);
  }

  // seed voters (demo vouchers — unused, ready to vote)
  const vc = (await get('SELECT COUNT(*) AS c FROM voters')).c;
  if (!vc) {
    const now = new Date().toISOString();
    for (let i = 1; i <= 10; i++) await run('INSERT INTO voters (voucher_code,is_used,voted_positions,created_at) VALUES (?,?,?,?)', ['DEMO-' + String(i).padStart(3, '0'), 0, '[]', now]);
  }

  // seed admin users (idempotent per account — demo credentials)
  const h = hashPassword('admin123');
  const now = new Date().toISOString();
  const demoAdmins = [
    ['superadmin', 'superadmin@sjbu.edu', 'super_admin'],
    ['admin1', 'admin1@sjbu.edu', 'admin'],
    ['moderator1', 'mod1@sjbu.edu', 'moderator'],
  ];
  for (const [username, email, role] of demoAdmins) {
    const existing = await get('SELECT id FROM admin_users WHERE username=? OR email=?', [username, email]);
    if (!existing) {
      await run('INSERT INTO admin_users (username,email,password_hash,role,is_active,last_login,created_at) VALUES (?,?,?,?,1,null,?)', [username, email, h, role, now]);
    } else {
      // Ensure the demo account is active with the demo password.
      await run('UPDATE admin_users SET is_active=1, password_hash=? WHERE id=?', [h, existing.id]);
    }
  }

  // seed audit log
  const alc = (await get('SELECT COUNT(*) AS c FROM audit_logs')).c;
  if (!alc) {
    await run('INSERT INTO audit_logs (admin_username,action,details,ip_address,timestamp) VALUES (?,?,?,?,?)', ['system','SYSTEM_INIT','Database seeded','127.0.0.1',new Date().toISOString()]);
  }
  console.log('[DB] Turso ready');
}

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function generateUuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
function generateVerificationCode() {
  return 'VOTE-' + generateUuid().substring(0, 8).toUpperCase();
}

// ============================================================
// HTTP helpers
// ============================================================
let currentOrigin = '*';
function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': currentOrigin || '*',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

let reqUrl = '';
let reqPath = '';
let currentAdmin = null; // authenticated admin for the current request (set by the auth gate)
function match(p) { return reqPath === p || reqPath === p + '/'; }
function matchId(p) { const m = reqPath.match(new RegExp('^' + p + '/([^/]+)/?$')); return m ? m[1] : null; }

// ============================================================
// Admin sessions (token auth)
// Login issues a random bearer token stored in admin_sessions;
// the frontend sends it as Authorization: Bearer <token>.
// ============================================================
const ADMIN_SESSION_HOURS = 12;

async function createAdminSession(adminId) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  await run('INSERT INTO admin_sessions (token,admin_id,created_at,expires_at) VALUES (?,?,?,?)',
    [token, adminId, new Date(now).toISOString(), new Date(now + ADMIN_SESSION_HOURS * 3600 * 1000).toISOString()]);
  return token;
}

function bearerToken(req) {
  const h = req.headers['authorization'] || '';
  const m = h.match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : null;
}

async function authenticateAdmin(req) {
  const token = bearerToken(req);
  if (!token) return null;
  const s = await get('SELECT * FROM admin_sessions WHERE token=?', [token]);
  if (!s) return null;
  if (new Date(s.expires_at).getTime() < Date.now()) {
    await run('DELETE FROM admin_sessions WHERE token=?', [token]);
    return null;
  }
  const admin = await get('SELECT * FROM admin_users WHERE id=? AND is_active=1', [s.admin_id]);
  return admin || null;
}

async function destroyAdminSession(req) {
  const token = bearerToken(req);
  if (token) await run('DELETE FROM admin_sessions WHERE token=?', [token]);
}

function requireSuperAdmin(res) {
  if (!currentAdmin || currentAdmin.role !== 'super_admin') {
    sendJson(res, 403, { error: 'Only a Super Admin can perform this action.' });
    return false;
  }
  return true;
}

// ============================================================
// Rate limiting (in-memory, per process)
// Protects voucher login, vote submission and admin login
// against brute-force guessing.
// ============================================================
const attemptBuckets = new Map();   // key -> { count, windowStart, lockedUntil }
const RL_WINDOW_MS = 15 * 60 * 1000; // failures counted within this window
const RL_MAX_FAILURES = 5;           // failures allowed before lockout
const RL_LOCK_MS = 15 * 60 * 1000;   // lockout duration

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}
function rateLimitStatus(key) {
  const b = attemptBuckets.get(key);
  if (!b) return { locked: false, retryAfterMs: 0 };
  if (b.lockedUntil && b.lockedUntil > Date.now()) return { locked: true, retryAfterMs: b.lockedUntil - Date.now() };
  return { locked: false, retryAfterMs: 0 };
}
function rateLimitFailure(key) {
  const now = Date.now();
  let b = attemptBuckets.get(key);
  if (!b || now - b.windowStart > RL_WINDOW_MS) b = { count: 0, windowStart: now, lockedUntil: 0 };
  b.count += 1;
  if (b.count >= RL_MAX_FAILURES) b.lockedUntil = now + RL_LOCK_MS;
  attemptBuckets.set(key, b);
}
function rateLimitSuccess(key) { attemptBuckets.delete(key); }
function tooMany(res, retryAfterMs) {
  const mins = Math.max(1, Math.ceil(retryAfterMs / 60000));
  return sendJson(res, 429, { error: 'Too many attempts. Please try again in ' + mins + ' minute' + (mins === 1 ? '' : 's') + '.' });
}
function pruneRateLimits() {
  const now = Date.now();
  for (const [k, b] of attemptBuckets) {
    if ((!b.lockedUntil || b.lockedUntil <= now) && now - b.windowStart > RL_WINDOW_MS) attemptBuckets.delete(k);
  }
}

// ============================================================
// SSE
// ============================================================
const sseClients = new Set();

// ------------------------------------------------------------
// Runoff lifecycle.
// finalizeExpiredRunoffs(): flips runoffs whose end date has
//   passed from 'live' to 'completed'. Returns number closed.
// ensureRunoffsForTiedPositions(): only runs AFTER results are
//   publicly released (30 min after election end). Opens a
//   4-hour runoff for every tied position that has none, and —
//   if a completed runoff ALSO ended in a tie (or nobody voted)
//   — opens a fresh runoff between the newly tied leaders.
//   Returns number created.
// ------------------------------------------------------------
let runoffEnsureInFlight = false;
async function finalizeExpiredRunoffs() {
  let closed = 0;
  try {
    const ros = await all("SELECT id, position_id, end_date FROM runoffs WHERE status='live'");
    const nowMs = Date.now();
    for (const ro of ros) {
      if (ro.end_date && nowMs >= new Date(ro.end_date).getTime()) {
        await run("UPDATE runoffs SET status='completed' WHERE id=? AND status='live'", [ro.id]);
        closed += 1;
        console.log('[RUNOFF] runoff #' + ro.id + ' (position ' + ro.position_id + ') closed.');
      }
    }
  } catch (e) {
    console.error('[RUNOFF] finalize failed:', e.message);
  }
  return closed;
}

async function ensureRunoffsForTiedPositions() {
  let created = 0;
  try {
    const sched = await get('SELECT * FROM election_schedule ORDER BY id DESC LIMIT 1');
    if (!sched || !sched.end_date) return 0;
    const endMs = new Date(sched.end_date).getTime();
    const releaseMs = sched.results_announcement
      ? new Date(sched.results_announcement).getTime()
      : endMs + 30 * 60 * 1000;
    if (Date.now() < releaseMs) return 0; // results not out yet — no runoff creation

    if (runoffEnsureInFlight) return 0;
    runoffEnsureInFlight = true;
    try {
      const positions = await all('SELECT id,name FROM positions');
      for (const p of positions) {
        const live = await get("SELECT id FROM runoffs WHERE position_id=? AND status='live'", [p.id]);
        if (live) continue;

        const latest = await get('SELECT * FROM runoffs WHERE position_id=? ORDER BY id DESC LIMIT 1', [p.id]);
        let candidateIds = null;
        if (!latest) {
          // First runoff for this position: tie-break the main election.
          const counts = await all(
            'SELECT candidate_id, COUNT(*) AS c FROM votes WHERE round=0 AND position_id=? GROUP BY candidate_id ORDER BY c DESC',
            [p.id]
          );
          if (counts.length < 2) continue;              // fewer than two candidates received votes
          const top = counts[0].c;
          const leaders = counts.filter(r => r.c === top);
          if (leaders.length < 2) continue;             // clear winner — no tie
          candidateIds = leaders.map(l => l.candidate_id);
        } else if (latest.status === 'completed') {
          // Only re-runoff if the completed runoff ALSO ended in a tie (or nobody voted).
          const counts = await all('SELECT candidate_id, COUNT(*) AS c FROM votes WHERE round=? GROUP BY candidate_id ORDER BY c DESC', [latest.id]);
          let prevIds = [];
          try { prevIds = JSON.parse(latest.candidate_ids || '[]'); } catch (e) { prevIds = []; }
          if (counts.length === 0 || counts[0].c === 0) {
            candidateIds = prevIds;                     // nobody voted — retry the same candidates
          } else {
            const top = counts[0].c;
            const leaders = counts.filter(r => r.c === top);
            if (leaders.length < 2) continue;           // decisive runoff — winner stands
            candidateIds = leaders.map(l => l.candidate_id);
          }
        } else {
          continue; // pending or other status — leave untouched
        }

        const now = new Date();
        const end = new Date(now.getTime() + 4 * 3600 * 1000).toISOString(); // 4-hour window
        await run('INSERT INTO runoffs (position_id,candidate_ids,start_date,end_date,status,created_at) VALUES (?,?,?,?,?,?)',
          [p.id, JSON.stringify(candidateIds), now.toISOString(), end, 'live', now.toISOString()]);
        created += 1;
        console.log('[RUNOFF] Tie detected for position "' + p.name + '" — opened 4h runoff between candidates: ' + candidateIds.join(', '));
        broadcastSSE({ type: 'runoff_created', positionId: p.id, positionName: p.name });
      }
    } finally {
      runoffEnsureInFlight = false;
    }
  } catch (e) {
    console.error('[RUNOFF] auto-creation check failed:', e.message);
  }
  return created;
}

async function computeOverallStats() {
  // Runoff lifecycle: close expired runoffs, then open runoffs where needed.
  await finalizeExpiredRunoffs();
  await ensureRunoffsForTiedPositions();

  const tv = (await get('SELECT COUNT(*) AS c FROM voters')).c;                  // registered vouchers
  const vc = (await get('SELECT COUNT(*) AS c FROM votes')).c;                   // total vote rows (all rounds)
  const ballots = (await get('SELECT COUNT(DISTINCT voucher_code) AS c FROM votes WHERE round=0')).c; // main-election ballots
  const usedVouchers = (await get('SELECT COUNT(*) AS c FROM voters WHERE is_used=1')).c;
  const tp = (await get('SELECT COUNT(*) AS c FROM positions')).c;
  const tc = (await get('SELECT COUNT(*) AS c FROM candidates')).c;
  const positions = await all('SELECT id,name FROM positions');
  const candidates = await all('SELECT id,position_id,name,manifesto FROM candidates');
  const votes = await all('SELECT voucher_code,candidate_id,round FROM votes');
  const runoffs = await all('SELECT * FROM runoffs ORDER BY id ASC');

  const mainVotes = votes.filter(v => !v.round);       // round 0 = main election
  const runoffVotes = votes.filter(v => v.round > 0);  // round N = runoff N

  const votesByCandidate = {};
  const votesByPosition = {};
  const ballotsByPosition = {};   // distinct vouchers per position (main election)
  for (const v of mainVotes) {
    votesByCandidate[v.candidate_id] = (votesByCandidate[v.candidate_id] || 0) + 1;
  }
  const candById = {};
  for (const c of candidates) candById[c.id] = c;
  for (const v of mainVotes) {
    const c = candById[v.candidate_id];
    if (c) {
      votesByPosition[c.position_id] = (votesByPosition[c.position_id] || 0) + 1;
      if (!ballotsByPosition[c.position_id]) ballotsByPosition[c.position_id] = new Set();
      ballotsByPosition[c.position_id].add(v.voucher_code);
    }
  }

  // Pre-compute runoff info per position.
  const nowMs = Date.now();
  const runoffByPosition = {};
  for (const ro of runoffs) {
    let cIds = [];
    try { cIds = JSON.parse(ro.candidate_ids || '[]'); } catch (e) { cIds = []; }
    const startOk = !ro.start_date || nowMs >= new Date(ro.start_date).getTime();
    const endOk = ro.end_date ? nowMs < new Date(ro.end_date).getTime() : true;
    const completed = ro.end_date ? nowMs >= new Date(ro.end_date).getTime() : false;
    const roPosVotes = runoffVotes.filter(v => v.round === ro.id);
    const tally = cIds.map(cid => {
      const c = candById[cid];
      return { candidateId: cid, candidateName: c ? c.name : 'Unknown', voteCount: roPosVotes.filter(v => v.candidate_id === cid).length };
    }).sort((a, b) => b.voteCount - a.voteCount);
    const info = {
      id: ro.id,
      status: ro.status,
      candidateIds: cIds,
      startDate: ro.start_date,
      endDate: ro.end_date,
      isActive: ro.status === 'live' && startOk && endOk,
      completed,
      ballotsCast: new Set(roPosVotes.map(v => v.voucher_code)).size,
      tally,
    };
    // A completed runoff resolves the tie only if it has a unique leader with votes.
    if (completed && tally.length > 0) {
      const maxV = tally[0].voteCount;
      const stillTied = tally.filter(t => t.voteCount === maxV);
      if (maxV > 0 && stillTied.length === 1) {
        info.winnerCandidateId = tally[0].candidateId;
      }
    }
    runoffByPosition[ro.position_id] = info;
  }

  const pws = [];
  for (const p of positions) {
    const cs = candidates.filter(c => c.position_id === p.id);
    const tot = votesByPosition[p.id] || 0;
    const posBallots = ballotsByPosition[p.id] ? ballotsByPosition[p.id].size : 0;
    const cands = cs.map(c => {
      const vcount = votesByCandidate[c.id] || 0;
      // votePercentage is a NUMBER so clients can format safely.
      return { candidateId: c.id, candidateName: c.name, manifesto: c.manifesto, voteCount: vcount, votePercentage: tot > 0 ? Number(((vcount / tot) * 100).toFixed(2)) : 0 };
    }).sort((a, b) => b.voteCount - a.voteCount);

    // Tie detection: two or more candidates share the highest vote count.
    const maxCount = cands.length > 0 ? cands[0].voteCount : 0;
    const tied = maxCount > 0 ? cands.filter(c => c.voteCount === maxCount) : [];
    const isTie = tied.length > 1;
    const runoff = runoffByPosition[p.id] || null;
    const finalWinnerCandidateId = runoff && runoff.winnerCandidateId ? runoff.winnerCandidateId : null;

    // Per-position turnout = distinct voters who voted in this position / registered vouchers
    pws.push({
      positionId: p.id,
      positionName: p.name,
      totalCandidates: cs.length,
      totalVotes: tot,
      ballotsCast: posBallots,
      voterTurnout: tv > 0 ? (posBallots / tv) * 100 : 0,
      candidates: cands,
      isTie,
      tiedCandidates: isTie ? tied.map(c => ({ candidateId: c.candidateId, candidateName: c.candidateName, voteCount: c.voteCount })) : [],
      runoff,
      finalWinnerCandidateId,
    });
  }
  let mv = null, lv = null;
  if (pws.length > 0) { const s = [...pws].sort((a, b) => b.totalVotes - a.totalVotes); mv = s[0].positionName; lv = s[s.length - 1].positionName; }

  // The runoff voters can participate in right now (live status + within window).
  const activeRunoffEntry = runoffs.find(ro => {
    if (ro.status !== 'live') return false;
    const startOk = !ro.start_date || nowMs >= new Date(ro.start_date).getTime();
    const endOk = ro.end_date ? nowMs < new Date(ro.end_date).getTime() : true;
    return startOk && endOk;
  });
  const activeRunoff = activeRunoffEntry ? {
    id: activeRunoffEntry.id,
    positionId: activeRunoffEntry.position_id,
    positionName: (positions.find(p => p.id === activeRunoffEntry.position_id) || {}).name || 'Unknown',
    candidateIds: (() => { try { return JSON.parse(activeRunoffEntry.candidate_ids || '[]'); } catch (e) { return []; } })(),
    startDate: activeRunoffEntry.start_date,
    endDate: activeRunoffEntry.end_date,
  } : null;

  return {
    totalVoters: tv,                 // registered vouchers (denominator)
    ballotsCast: ballots,            // distinct vouchers that cast a main-election ballot (numerator)
    usedVouchers,                    // vouchers marked is_used=1 (cross-check)
    totalVotesCast: vc,              // raw vote rows across all rounds (one per position per voter)
    voterTurnout: tv > 0 ? (ballots / tv) * 100 : 0,  // ballots cast / registered vouchers
    activeRunoff,                    // runoff currently open for voting (or null)
    positionsWithStats: pws,
    overallStats: { totalPositions: tp, totalCandidates: tc, averageVotesPerPosition: tp > 0 ? vc / tp : 0, mostVotedPosition: mv, leastVotedPosition: lv }
  };
}
async function computeTrends() {
  const rows = await all('SELECT created_at FROM votes');
  const t = {};
  rows.forEach(v => { const h = new Date(v.created_at).getHours(); t[h] = (t[h] || 0) + 1; });
  return { hourlyPattern: Object.entries(t).sort(([a],[b]) => a - b).map(([h, c]) => ({ hour: parseInt(h), votes_count: c })) };
}
function broadcastSSE(payload) {
  const msg = 'data: ' + JSON.stringify(payload) + '\n\n';
  for (const client of sseClients) {
    try { client.write(msg); } catch (e) { sseClients.delete(client); }
  }
}

// ============================================================
// HTTP Server
// ============================================================
const server = http.createServer(async (req, res) => {
  reqUrl = req.url;
  reqPath = req.url.split('?')[0]; // strip query string so /audit/logs?limit=.. matches the route
  currentOrigin = req.headers.origin || '*';

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': currentOrigin, 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
    res.end();
    return;
  }
  console.log('[API] ' + req.method + ' ' + reqUrl);

  try {
    // health
    if (match(API_PREFIX + '/health') && req.method === 'GET') return sendJson(res, 200, { status: 'ok', database: 'turso' });

    // ---- Admin authentication gate ----
    // Everything under /admin/* (except /admin/login), the audit log, and
    // schedule WRITES require a valid admin session token
    // (Authorization: Bearer <token>, issued by /admin/login).
    const isAdminArea =
      (reqPath.startsWith(API_PREFIX + '/admin/') && reqPath !== API_PREFIX + '/admin/login') ||
      reqPath === API_PREFIX + '/audit/logs' ||
      (reqPath === API_PREFIX + '/election/schedule' && req.method === 'POST');
    if (isAdminArea) {
      currentAdmin = await authenticateAdmin(req);
      if (!currentAdmin) return sendJson(res, 401, { error: 'Admin authentication required. Please log in again.' });
    } else {
      currentAdmin = null;
    }

    // election schedule
    if (match(API_PREFIX + '/election/schedule') && req.method === 'GET') {
      const s = await get('SELECT * FROM election_schedule ORDER BY id DESC LIMIT 1');
      if (!s) return sendJson(res, 404, { error: 'No election schedule found' });
      // RULE: results are released exactly 30 minutes after the election ends.
      // If no explicit announcement time is stored, derive it from end_date.
      const autoResults = s.end_date
        ? new Date(new Date(s.end_date).getTime() + 30 * 60 * 1000).toISOString()
        : null;
      return sendJson(res, 200, {
        electionKey: s.election_key,
        startDate: s.start_date,
        endDate: s.end_date,
        resultsAnnouncement: s.results_announcement || autoResults,
        resultsAnnouncementIsAuto: !s.results_announcement,
        updatedAt: s.updated_at,
        updatedBy: s.updated_by,
      });
    }
    if (match(API_PREFIX + '/election/schedule') && req.method === 'POST') {
      if (!requireSuperAdmin(res)) return;
      const b = await readBody(req);
      const now = new Date().toISOString();
      // RULE: results default to 30 minutes after the election ends unless set explicitly.
      const resultsAnnouncement = b.resultsAnnouncement
        || (b.endDate ? new Date(new Date(b.endDate).getTime() + 30 * 60 * 1000).toISOString() : null);
      await run('INSERT INTO election_schedule (election_key,start_date,end_date,results_announcement,updated_at,updated_by) VALUES (?,?,?,?,?,?)',
        ['sjbu-2025', b.startDate, b.endDate, resultsAnnouncement, now, 1]);
      const s = await get('SELECT * FROM election_schedule ORDER BY id DESC LIMIT 1');
      return sendJson(res, 200, s);
    }

    // positions public
    if (match(API_PREFIX + '/election/positions') && req.method === 'GET') {
      const positions = await all('SELECT id,name FROM positions');
      const result = [];
      for (const p of positions) {
        const cands = await all('SELECT id,name,position_id,manifesto,image_url FROM candidates WHERE position_id=?', [p.id]);
        result.push({ id: p.id, name: p.name, candidates: cands.map(c => ({ id: c.id, name: c.name, positionId: c.position_id, manifesto: c.manifesto || '', imageUrl: c.image_url || '' })) });
      }
      return sendJson(res, 200, { positions: result });
    }

    // login
    if (match(API_PREFIX + '/login') && req.method === 'POST') {
      const ipKey = 'voter-ip:' + clientIp(req);
      const rl = rateLimitStatus(ipKey);
      if (rl.locked) return tooMany(res, rl.retryAfterMs);
      const b = await readBody(req);
      if (!b.voucher) return sendJson(res, 400, { error: 'Voucher code required' });
      const v = await get('SELECT * FROM voters WHERE voucher_code=?', [b.voucher]);
      if (!v) {
        rateLimitFailure(ipKey);
        return sendJson(res, 401, { error: 'Invalid voucher code' });
      }
      rateLimitSuccess(ipKey);
      return sendJson(res, 200, { success: true, voucher: b.voucher });
    }
    if (match(API_PREFIX + '/logout') && req.method === 'POST') return sendJson(res, 200, { success: true, message: 'Logged out' });

    // vote
    if (match(API_PREFIX + '/vote') && req.method === 'POST') {
      const voteIpKey = 'vote:' + clientIp(req);
      const voteRl = rateLimitStatus(voteIpKey);
      if (voteRl.locked) return tooMany(res, voteRl.retryAfterMs);
      const b = await readBody(req);
      if (!b.voucher || !b.selections) return sendJson(res, 400, { error: 'Voucher and selections required' });
      const v = await get('SELECT * FROM voters WHERE voucher_code=?', [b.voucher]);
      if (!v) {
        rateLimitFailure(voteIpKey);
        return sendJson(res, 401, { error: 'Invalid voucher code' });
      }
      rateLimitSuccess(voteIpKey);

      const round = parseInt(b.round) || 0;
      const selections = b.selections;
      const positionIds = Object.keys(selections).map(Number);
      const posById = {};

      if (round > 0) {
        // ---- RUNOFF VOTE ----
        const ro = await get('SELECT * FROM runoffs WHERE id=?', [round]);
        if (!ro || ro.status !== 'live') return sendJson(res, 400, { error: 'This runoff is not active.' });
        const nowMs = Date.now();
        if (ro.start_date && nowMs < new Date(ro.start_date).getTime()) return sendJson(res, 400, { error: 'The runoff has not started yet.' });
        if (ro.end_date && nowMs >= new Date(ro.end_date).getTime()) return sendJson(res, 400, { error: 'The runoff has ended.' });
        if (positionIds.length !== 1 || positionIds[0] !== ro.position_id) {
          return sendJson(res, 400, { error: 'This runoff covers a single position only.' });
        }
        let tiedIds = [];
        try { tiedIds = JSON.parse(ro.candidate_ids || '[]'); } catch (e) { tiedIds = []; }
        const candId = parseInt(selections[ro.position_id]);
        if (!tiedIds.includes(candId)) return sendJson(res, 400, { error: 'Selected candidate is not part of this runoff.' });
        // One vote per voucher per runoff round (used vouchers are allowed to vote again here).
        const already = await get('SELECT id FROM votes WHERE voucher_code=? AND round=?', [b.voucher, round]);
        if (already) return sendJson(res, 409, { error: 'This voucher has already voted in this runoff.' });
        const position = await get('SELECT id,name FROM positions WHERE id=?', [ro.position_id]);
        if (!position) return sendJson(res, 400, { error: 'Invalid position.' });
        posById[ro.position_id] = position;
      } else {
        // ---- MAIN ELECTION VOTE ----
        const voted = v.voted_positions ? JSON.parse(v.voted_positions) : [];
        if (v.is_used && voted.length > 0) return sendJson(res, 409, { error: 'Voucher already used for voting' });

        // Validate positions/candidates in parallel instead of sequentially.
        const validationResults = await Promise.all(positionIds.map(async (posId) => {
          const position = await get('SELECT id,name FROM positions WHERE id=?', [posId]);
          if (!position) return { posId, error: 'Invalid position: ' + posId };
          const candidate = await get('SELECT id FROM candidates WHERE id=? AND position_id=?', [selections[posId], posId]);
          if (!candidate) return { posId, error: 'Invalid candidate for position: ' + posId };
          return { posId, position };
        }));
        const invalid = validationResults.find((r) => r.error);
        if (invalid) return sendJson(res, 400, { error: invalid.error });

        for (const r of validationResults) posById[r.posId] = r.position;
      }

      const code = generateVerificationCode();
      const now = new Date().toISOString();

      // Insert votes in parallel (with round marker).
      await Promise.all(positionIds.map((posId) =>
        run('INSERT INTO votes (voucher_code,position_id,candidate_id,verification_code,created_at,round) VALUES (?,?,?,?,?,?)',
          [b.voucher, posId, parseInt(selections[posId]), code, now, round])
      ));
      if (round === 0) {
        await run('UPDATE voters SET is_used=1, voted_positions=? WHERE voucher_code=?', [JSON.stringify(positionIds), b.voucher]);
      }

      // Let the DB auto-generate the audit log id (no extra MAX(id) query).
      await run('INSERT INTO audit_logs (admin_username,action,details,ip_address,timestamp) VALUES (?,?,?,?,?)',
        ['system', round > 0 ? 'RUNOFF_VOTE_CAST' : 'VOTE_CAST', 'Voucher ' + b.voucher + ' cast ' + (round > 0 ? 'runoff ' : '') + 'vote for positions: ' + positionIds.join(', '), '127.0.0.1', now]);

      // Compute overall stats + trends once and reuse for both the response and SSE broadcast.
      const [overallStats, trends] = await Promise.all([computeOverallStats(), computeTrends()]);

      const positionStats = positionIds.map((posId) => {
        const ps = overallStats.positionsWithStats.find((p) => p.positionId === posId);
        return {
          positionId: posId,
          positionName: ps ? ps.positionName : (posById[posId] ? posById[posId].name : 'Unknown'),
          totalVotes: ps ? ps.totalVotes : 0,
          ballotsCast: ps ? ps.ballotsCast : 0,
          candidates: ps ? ps.candidates.map((c) => ({ candidateId: c.candidateId, candidateName: c.candidateName, voteCount: c.voteCount })) : [],
        };
      });

      const voteResults = {};
      for (const posId of positionIds) {
        const position = posById[posId];
        voteResults[position.name.toLowerCase().replace(/\s+/g, '_')] = { verification_code: code, candidate_id: parseInt(selections[posId]) };
      }

      broadcastSSE({ type: 'update', stats: overallStats, trends });

      return sendJson(res, 200, {
        data: { verificationCode: code, message: (round > 0 ? 'Runoff vote' : 'All votes') + ' recorded successfully', votes: voteResults, positionStats },
      });
    }

    // runoffs (public list)
    if (match(API_PREFIX + '/runoffs') && req.method === 'GET') {
      const ros = await all('SELECT r.*, p.name AS position_name FROM runoffs r LEFT JOIN positions p ON r.position_id=p.id ORDER BY r.id DESC');
      return sendJson(res, 200, {
        runoffs: ros.map(ro => {
          let cIds = [];
          try { cIds = JSON.parse(ro.candidate_ids || '[]'); } catch (e) { cIds = []; }
          return {
            id: ro.id,
            positionId: ro.position_id,
            positionName: ro.position_name || 'Unknown',
            candidateIds: cIds,
            startDate: ro.start_date,
            endDate: ro.end_date,
            status: ro.status,
          };
        }),
      });
    }

    // create a runoff (admin)
    if (match(API_PREFIX + '/admin/runoff') && req.method === 'POST') {
      const b = await readBody(req);
      if (!b.positionId || !Array.isArray(b.candidateIds) || b.candidateIds.length < 2) {
        return sendJson(res, 400, { error: 'positionId and at least two candidateIds are required' });
      }
      const position = await get('SELECT id,name FROM positions WHERE id=?', [b.positionId]);
      if (!position) return sendJson(res, 404, { error: 'Position not found' });
      for (const cid of b.candidateIds) {
        const c = await get('SELECT id FROM candidates WHERE id=? AND position_id=?', [cid, b.positionId]);
        if (!c) return sendJson(res, 400, { error: 'Candidate ' + cid + ' does not belong to this position' });
      }
      const now = new Date().toISOString();
      const start = b.startDate || now;
      const end = b.endDate || new Date(Date.now() + 4 * 3600 * 1000).toISOString(); // default 4h window
      const r = await run('INSERT INTO runoffs (position_id,candidate_ids,start_date,end_date,status,created_at) VALUES (?,?,?,?,?,?)',
        [b.positionId, JSON.stringify(b.candidateIds), start, end, 'live', now]);
      broadcastSSE({ type: 'runoff_created', runoffId: r.lastInsertRowid, positionId: b.positionId });
      return sendJson(res, 201, {
        runoff: { id: r.lastInsertRowid, positionId: b.positionId, candidateIds: b.candidateIds, startDate: start, endDate: end, status: 'live' },
      });
    }

    // verify
    if (match(API_PREFIX + '/verify') && req.method === 'POST') {
      const verifyIpKey = 'verify:' + clientIp(req);
      const verifyRl = rateLimitStatus(verifyIpKey);
      if (verifyRl.locked) return tooMany(res, verifyRl.retryAfterMs);
      const b = await readBody(req);
      let results = [];
      if (b.verification_code) results = await all('SELECT * FROM votes WHERE verification_code=?', [b.verification_code]);
      else if (b.voucher) results = await all('SELECT * FROM votes WHERE voucher_code=?', [b.voucher]);
      else return sendJson(res, 400, { status: 'error', error: 'Verification code or voucher required' });
      if (results.length === 0) {
        rateLimitFailure(verifyIpKey);
        return sendJson(res, 404, { status: 'not_found', error: 'No matching vote found' });
      }
      rateLimitSuccess(verifyIpKey);

      // Minimal response: confirm the vote exists without exposing internal DB identifiers.
      const first = results[0];
      return sendJson(res, 200, {
        status: 'found',
        found: true,
        ballotsCount: 1, // one ballot per voucher / verification code
        positionsRecorded: results.length,
        castAt: first.created_at,
        verificationCode: first.verification_code,
      });
    }

    // admin sign-upload
    if (match(API_PREFIX + '/admin/sign-upload') && req.method === 'POST') return sendJson(res, 200, { signature: 'mock', timestamp: Math.floor(Date.now() / 1000), cloudName: 'sjbu', apiKey: 'mock', folder: 'sjbu' });

    // admin login
    if (match(API_PREFIX + '/admin/login') && req.method === 'POST') {
      const ipKey = 'admin-ip:' + clientIp(req);
      const rl = rateLimitStatus(ipKey);
      if (rl.locked) return tooMany(res, rl.retryAfterMs);
      const b = await readBody(req);
      if (!b.email || !b.password) return sendJson(res, 400, { error: 'Email and password required' });
      const userKey = 'admin-user:' + String(b.email).toLowerCase();
      const rlUser = rateLimitStatus(userKey);
      if (rlUser.locked) return tooMany(res, rlUser.retryAfterMs);
      const a = await get('SELECT * FROM admin_users WHERE email=? OR username=?', [b.email, b.email]);
      if (!a || !a.is_active || hashPassword(b.password) !== a.password_hash) {
        rateLimitFailure(ipKey);
        rateLimitFailure(userKey);
        return sendJson(res, 401, { error: 'Invalid username or password' });
      }
      rateLimitSuccess(ipKey);
      rateLimitSuccess(userKey);
      const now = new Date().toISOString();
      await run('UPDATE admin_users SET last_login=? WHERE id=?', [now, a.id]);
      const token = await createAdminSession(a.id);
      return sendJson(res, 200, { token, admin: { id: a.id, username: a.username, role: a.role, email: a.email, isActive: a.is_active, lastLogin: now, createdAt: a.created_at } });
    }

    // admin users CRUD
    if (match(API_PREFIX + '/admin/create') && req.method === 'POST') {
      if (!requireSuperAdmin(res)) return;
      const b = await readBody(req);
      if (!b.username || !b.email || !b.password) return sendJson(res, 400, { error: 'Username, email and password required' });
      const exists = await get('SELECT id FROM admin_users WHERE username=? OR email=?', [b.username, b.email]);
      if (exists) return sendJson(res, 409, { error: 'User already exists' });
      const now = new Date().toISOString();
      const r = await run('INSERT INTO admin_users (username,email,password_hash,role,is_active,last_login,created_at) VALUES (?,?,?,?,?,?,?)',
        [b.username, b.email, hashPassword(b.password), b.role || 'moderator', 1, null, now]);
      const id = r.lastInsertRowid;
      return sendJson(res, 201, { admin: { id, username: b.username, role: b.role || 'moderator', email: b.email, isActive: true, lastLogin: null, createdAt: now } });
    }
    if (matchId(API_PREFIX + '/admin/users') && req.method === 'PUT') {
      if (!requireSuperAdmin(res)) return;
      const id = parseInt(matchId(API_PREFIX + '/admin/users'));
      const b = await readBody(req);
      const u = await get('SELECT * FROM admin_users WHERE id=?', [id]);
      if (!u) return sendJson(res, 404, { error: 'Admin user not found' });
      if (b.role !== undefined) await run('UPDATE admin_users SET role=? WHERE id=?', [b.role, id]);
      if (b.password) await run('UPDATE admin_users SET password_hash=? WHERE id=?', [hashPassword(b.password), id]);
      const u2 = await get('SELECT * FROM admin_users WHERE id=?', [id]);
      return sendJson(res, 200, { admin: { id: u2.id, username: u2.username, role: u2.role, email: u2.email, isActive: u2.is_active, lastLogin: u2.last_login, createdAt: u2.created_at } });
    }
    if (matchId(API_PREFIX + '/admin/users') && req.method === 'DELETE') {
      if (!requireSuperAdmin(res)) return;
      const id = parseInt(matchId(API_PREFIX + '/admin/users'));
      const u = await get('SELECT id FROM admin_users WHERE id=?', [id]);
      if (!u) return sendJson(res, 404, { error: 'Admin user not found' });
      await run('UPDATE admin_users SET is_active=0 WHERE id=?', [id]);
      return sendJson(res, 200, { success: true, message: 'Admin user deactivated' });
    }
    if (match(API_PREFIX + '/admin/logout') && req.method === 'POST') {
      await destroyAdminSession(req);
      return sendJson(res, 200, { success: true, message: 'Admin logged out' });
    }

    // admin positions
    if (match(API_PREFIX + '/admin/positions') && req.method === 'GET') {
      const positions = await all('SELECT id,name,created_at FROM positions');
      const result = [];
      for (const p of positions) {
        const cc = (await get('SELECT COUNT(*) AS c FROM candidates WHERE position_id=?', [p.id])).c;
        result.push({ id: p.id, name: p.name, created_at: p.created_at, candidate_count: cc });
      }
      return sendJson(res, 200, { positions: result });
    }
    if (match(API_PREFIX + '/admin/positions') && req.method === 'POST') {
      const b = await readBody(req);
      if (!b.name) return sendJson(res, 400, { error: 'Position name required' });
      const now = new Date().toISOString();
      const r = await run('INSERT INTO positions (name,created_at) VALUES (?,?)', [b.name, now]);
      const p = await get('SELECT * FROM positions WHERE id=?', [r.lastInsertRowid]);
      return sendJson(res, 201, { position: p });
    }
    if (matchId(API_PREFIX + '/admin/positions') && req.method === 'PUT') {
      const id = parseInt(matchId(API_PREFIX + '/admin/positions'));
      const b = await readBody(req);
      const p = await get('SELECT id FROM positions WHERE id=?', [id]);
      if (!p) return sendJson(res, 404, { error: 'Position not found' });
      if (b.name !== undefined) await run('UPDATE positions SET name=? WHERE id=?', [b.name, id]);
      const p2 = await get('SELECT * FROM positions WHERE id=?', [id]);
      return sendJson(res, 200, { position: p2 });
    }
    if (matchId(API_PREFIX + '/admin/positions') && req.method === 'DELETE') {
      const id = parseInt(matchId(API_PREFIX + '/admin/positions'));
      const p = await get('SELECT id FROM positions WHERE id=?', [id]);
      if (!p) return sendJson(res, 404, { error: 'Position not found' });
      await run('DELETE FROM positions WHERE id=?', [id]);
      await run('DELETE FROM candidates WHERE position_id=?', [id]);
      return sendJson(res, 200, { success: true, message: 'Position and its candidates deleted' });
    }

    // admin candidates
    if (match(API_PREFIX + '/admin/candidates') && req.method === 'GET') {
      const cands = await all('SELECT c.id,c.position_id,c.name,c.image_url,c.manifesto,c.created_at,p.name AS position_name FROM candidates c LEFT JOIN positions p ON c.position_id=p.id');
      const result = cands.map(c => ({ id: c.id, position_id: c.position_id, position_name: c.position_name || 'Unknown', name: c.name, image_url: c.image_url, manifesto: c.manifesto || '', created_at: c.created_at }));
      return sendJson(res, 200, { candidates: result });
    }
    if (match(API_PREFIX + '/admin/candidate') && req.method === 'POST') {
      const b = await readBody(req);
      if (!b.name || !b.positionId) return sendJson(res, 400, { error: 'Name and positionId required' });
      const now = new Date().toISOString();
      const r = await run('INSERT INTO candidates (position_id,name,image_url,manifesto,created_at) VALUES (?,?,?,?,?)', [parseInt(b.positionId), b.name, b.imageUrl || '', b.manifesto || '', now]);
      const c = await get('SELECT * FROM candidates WHERE id=?', [r.lastInsertRowid]);
      return sendJson(res, 201, { candidate: c });
    }
    if (matchId(API_PREFIX + '/admin/candidate') && req.method === 'PUT') {
      const id = parseInt(matchId(API_PREFIX + '/admin/candidate'));
      const b = await readBody(req);
      const c = await get('SELECT id FROM candidates WHERE id=?', [id]);
      if (!c) return sendJson(res, 404, { error: 'Candidate not found' });
      if (b.name !== undefined) await run('UPDATE candidates SET name=? WHERE id=?', [b.name, id]);
      if (b.positionId !== undefined) await run('UPDATE candidates SET position_id=? WHERE id=?', [parseInt(b.positionId), id]);
      if (b.imageUrl !== undefined) await run('UPDATE candidates SET image_url=? WHERE id=?', [b.imageUrl, id]);
      if (b.manifesto !== undefined) await run('UPDATE candidates SET manifesto=? WHERE id=?', [b.manifesto, id]);
      const c2 = await get('SELECT * FROM candidates WHERE id=?', [id]);
      return sendJson(res, 200, { candidate: c2 });
    }
    if (matchId(API_PREFIX + '/admin/candidate') && req.method === 'DELETE') {
      const id = parseInt(matchId(API_PREFIX + '/admin/candidate'));
      const c = await get('SELECT id FROM candidates WHERE id=?', [id]);
      if (!c) return sendJson(res, 404, { error: 'Candidate not found' });
      await run('DELETE FROM candidates WHERE id=?', [id]);
      return sendJson(res, 200, { success: true, message: 'Candidate deleted' });
    }

    // candidate gallery
    if (match(API_PREFIX + '/admin/candidate-gallery') && req.method === 'GET') {
      const positions = await all('SELECT id,name FROM positions');
      const gallery = [];
      for (const p of positions) {
        const cands = await all('SELECT id,name,image_url,manifesto FROM candidates WHERE position_id=?', [p.id]);
        const candidates = [];
        for (const c of cands) {
          const vc = (await get('SELECT COUNT(*) AS c FROM votes WHERE candidate_id=?', [c.id])).c;
          candidates.push({ id: c.id, name: c.name, image_url: c.image_url || '', manifesto: c.manifesto || '', vote_count: vc });
        }
        gallery.push({ position_id: p.id, position_name: p.name, candidates });
      }
      return sendJson(res, 200, { gallery });
    }

    // admin all
    if (match(API_PREFIX + '/admin/all') && req.method === 'GET') {
      const admins = await all('SELECT id,username,role,email,is_active,last_login,created_at FROM admin_users');
      return sendJson(res, 200, { admins: admins.map(u => ({ id: u.id, username: u.username, role: u.role, email: u.email, isActive: u.is_active, lastLogin: u.last_login, createdAt: u.created_at })) });
    }

    // audit logs
    if (match(API_PREFIX + '/audit/logs') && req.method === 'GET') {
      const q = new URL(req.url, 'http://localhost').searchParams;
      const limit = Math.min(parseInt(q.get('limit')) || 50, 200);
      const offset = Math.max(parseInt(q.get('offset')) || 0, 0);
      const logs = await all('SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT ? OFFSET ?', [limit, offset]);
      return sendJson(res, 200, { success: true, data: { logs: logs.map(l => ({ id: l.id, adminUsername: l.admin_username, action: l.action, details: l.details, ipAddress: l.ip_address, timestamp: l.timestamp })) } });
    }

    // stats
    if (match(API_PREFIX + '/stats/overall') && req.method === 'GET') {
      return sendJson(res, 200, { data: await computeOverallStats() });
    }
    if (match(API_PREFIX + '/stats/trends') && req.method === 'GET') {
      return sendJson(res, 200, { data: await computeTrends() });
    }

    // SSE
    if (match(API_PREFIX + '/events') && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
        'Access-Control-Allow-Origin': currentOrigin || '*',
        'Access-Control-Allow-Credentials': 'true',
      });
      res.write(': connected\n\n');
      const initPayload = { type: 'init', stats: await computeOverallStats(), trends: await computeTrends() };
      res.write('data: ' + JSON.stringify(initPayload) + '\n\n');
      sseClients.add(res);
      req.on('close', () => { sseClients.delete(res); });
      return;
    }

    return sendJson(res, 404, { error: 'Not found: ' + reqUrl });
  } catch (e) {
    console.error(e);
    sendJson(res, 500, { error: e.message });
  }
});

// ============================================================
// Background sweep (every 60 seconds, no external timer needed):
//  - close runoffs whose window has ended
//  - open 4h runoffs for tied positions once results are released
//  - prune expired admin sessions and stale rate-limit buckets
// Broadcasts fresh stats over SSE when the runoff state changes.
// ============================================================
const SWEEP_INTERVAL_MS = 60 * 1000;
setInterval(async () => {
  try {
    const closed = await finalizeExpiredRunoffs();
    const created = await ensureRunoffsForTiedPositions();
    await run('DELETE FROM admin_sessions WHERE expires_at < ?', [new Date().toISOString()]);
    pruneRateLimits();
    if (closed > 0 || created > 0) {
      const [stats, trends] = await Promise.all([computeOverallStats(), computeTrends()]);
      broadcastSSE({ type: 'update', stats, trends });
    }
  } catch (e) {
    console.error('[SWEEP] failed:', e.message);
  }
}, SWEEP_INTERVAL_MS);

initDb().then(() => {
  server.listen(PORT, () => {
    console.log('');
    console.log('===========================================');
    console.log(' SJBU Voting System - BACKEND RUNNING (Turso)');
    console.log('===========================================');
    console.log(' Server:   http://localhost:' + PORT);
    console.log(' API base: http://localhost:' + PORT + API_PREFIX);
    console.log(' DB:       ' + process.env.TURSO_DATABASE_URL);
    console.log('===========================================');
    console.log('');
  });
}).catch(err => {
  console.error('Failed to init DB:', err);
  process.exit(1);
});

module.exports = server;