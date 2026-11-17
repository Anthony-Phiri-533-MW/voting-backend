# SJBU Voting System - Seed Details

## Admin Accounts

All demo admin accounts use password `admin123`.

| Username | Email | Role |
|----------|-------|------|
| `superadmin` | superadmin@sjbu.edu | super_admin |
| `admin1` | admin1@sjbu.edu | admin |
| `moderator1` | mod1@sjbu.edu | moderator |

## Sample Vouchers (Voters)

| Voucher Code |
|--------------|
| `DEMO-001` |
| `DEMO-002` |
| `DEMO-003` |
| `DEMO-004` |
| `DEMO-005` |
| `DEMO-006` |
| `DEMO-007` |
| `DEMO-008` |
| `DEMO-009` |
| `DEMO-010` |

All vouchers are unused and ready to vote.

## Positions & Candidates (Seeded)

### 1. President
- Alice Reyes — "Committed to student welfare."
- Bob Lim — "Fighting for affordable tuition."
- Carla Dela Cruz — "Focus on mental health."

### 2. Vice President
- Diego Santos — "Student voice advocate."
- Elena Gomez — "Improving student organizations."
- Felix Rivera — "Green campus initiatives."

### 3. General Secretary
- Grace Mwangi — "Transparent record keeping and communication."
- Henry Osei — "Efficient documentation and reporting."
- Irene Kato — "Modernizing administrative processes."

### 4. Speaker
- Jack Njoroge — "Fair and orderly house proceedings."
- Karen Muchiri — "Upholding parliamentary rules."
- Larry Otieno — "Impartial leadership of the house."

### 5. Finance Director
- Mary Wanjiku — "Responsible budget management."
- Nathan Kipruto — "Financial accountability and audits."
- Olivia Akinyi — "Sustainable funding for student events."

### 6. Sports Director
- Peter Kamau — "Upgrade sports facilities."
- Quinter Adhiambo — "More inter-school tournaments."
- Robert Mburu — "Fitness and wellness programs."

### 7. Entertainment Director
- Sarah Chelimo — "Vibrant student events calendar."
- Thomas Githinji — "More cultural festivals and shows."
- Upendo Mwende — "Fun and inclusive entertainment."

## Notes

- Seeding runs automatically when the backend starts (`backend/server.js`, `seedDatabase()`).
- Seeding is idempotent: it only inserts if tables are empty.
- The election schedule is **not** seeded automatically — an admin must log in and schedule the election via the Settings page before voting can begin.
- Admin password hash algorithm: SHA-256 (`server.js` line 211-212).

## Files

- `backend/server.js` — seed logic (lines 140-207)
- `backend/database.sql` — PostgreSQL seed data (lines 97-157)
