/**
 * seed.ts — insert the StudyBuddy demo team and run the classifier.
 *
 * Run with: npm run seed
 *
 * Inserts:
 *   - Team "StudyBuddy"
 *   - Members: Rio, Sam, Priya, Jordan
 *   - 6 Issues with due dates
 *   - 25+ realistic commits distributed across members
 *     - Sam is overloaded with backend work
 *     - Issue #12 "Auth flow" has had no activity for 6+ days, due within 8 days
 *     - Jordan has only a few test commits
 *     - Priya has 3 manual log entries
 *   - Then runs the AI classifier on all contributions
 *
 * Safe to re-run: skips if the "StudyBuddy" team already exists.
 */

import dotenv from 'dotenv';
import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runMigration } from './migrate.js';
import { classifyTeam } from '../ai/classifier.js';
import { runReasoner } from '../ai/reasoner.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Load .env from the repo root — works from both src/ (tsx dev) and dist/ (compiled)
dotenv.config({ path: join(__dirname, '..', '..', '..', '.env') });

// ── Database setup ────────────────────────────────────────────────────────────

const dbPath = process.env.DB_PATH ?? join(__dirname, '..', '..', '..', 'dev.db');
runMigration(dbPath);
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Date helpers ──────────────────────────────────────────────────────────────

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function daysFromNow(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD for due_date
}

// ── Idempotency guard ─────────────────────────────────────────────────────────

const existing = db
  .prepare("SELECT id FROM teams WHERE name = 'StudyBuddy'")
  .get() as { id: number } | undefined;

if (existing) {
  console.log(`StudyBuddy team already exists (id=${existing.id}). Skipping seed.`);
  process.exit(0);
}

// ── Insert team ───────────────────────────────────────────────────────────────

const teamId = db
  .prepare("INSERT INTO teams (name, repo_owner, repo_name, is_demo) VALUES ('StudyBuddy', 'studybuddy-org', 'studybuddy-app', 1)")
  .run().lastInsertRowid as number;

console.log(`Created team StudyBuddy (id=${teamId})`);

// ── Insert members ────────────────────────────────────────────────────────────

function insertMember(login: string, email: string, name: string): number {
  return db
    .prepare(
      `INSERT INTO members (team_id, github_login, email, display_name)
       VALUES (?, ?, ?, ?)`,
    )
    .run(teamId, login, email, name).lastInsertRowid as number;
}

const rioId    = insertMember('rio-dev',    'rio@studybuddy.dev',    'Rio Chen');
const samId    = insertMember('sam-builds', 'sam@studybuddy.dev',    'Sam Rivera');
const priyaId  = insertMember('priya-code', 'priya@studybuddy.dev',  'Priya Nair');
const jordanId = insertMember('jordan-qa',  'jordan@studybuddy.dev', 'Jordan Lee');

console.log(`Inserted 4 members: Rio(${rioId}), Sam(${samId}), Priya(${priyaId}), Jordan(${jordanId})`);

// ── Insert tasks (Issues) ─────────────────────────────────────────────────────

function insertTask(issueNum: number, title: string, dueDate: string, assignee: string | null): number {
  return db
    .prepare(
      `INSERT INTO tasks (team_id, github_issue_number, title, status, due_date, assignee_login, synced_at)
       VALUES (?, ?, ?, 'open', ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`,
    )
    .run(teamId, issueNum, title, dueDate, assignee).lastInsertRowid as number;
}

// Issue #12 "Auth flow" — no activity for 6+ days, due within 8 days
const task12Id = insertTask(12, 'Auth flow',               daysFromNow(7),  'rio-dev');
const task13Id = insertTask(13, 'User dashboard UI',       daysFromNow(14), 'priya-code');
const task14Id = insertTask(14, 'Backend API endpoints',   daysFromNow(10), 'sam-builds');
const task15Id = insertTask(15, 'Database schema design',  daysFromNow(20), 'sam-builds');
// task16 is unassigned — Jordan has 0 open tasks, enabling overload detection
const task16Id = insertTask(16, 'End-to-end test suite',   daysFromNow(18), null);
const task17Id = insertTask(17, 'Documentation and README', daysFromNow(25), 'priya-code');

// Suppress unused variable warnings — IDs only matter to verify insert succeeded
void task13Id; void task14Id; void task15Id; void task16Id; void task17Id;

console.log(`Inserted 6 tasks`);

// ── Insert contributions ──────────────────────────────────────────────────────

type ContribArgs = {
  memberId: number;
  sha: string;
  title: string;
  diff: string;
  filesChanged: number;
  additions: number;
  deletions: number;
  daysAgoN: number;
  url?: string;
  paths?: string[];
};

function insertCommit({ memberId, sha, title, diff, filesChanged, additions, deletions, daysAgoN, url, paths }: ContribArgs): number {
  return db
    .prepare(
      `INSERT INTO contributions
         (team_id, member_id, source, github_sha, title, diff_summary,
          files_changed, additions, deletions, url, paths, authored_at)
       VALUES (?, ?, 'commit', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      teamId, memberId, sha, title, diff,
      filesChanged, additions, deletions,
      url ?? `https://github.com/studybuddy-org/studybuddy-app/commit/${sha}`,
      paths ? JSON.stringify(paths) : null,
      daysAgo(daysAgoN),
    ).lastInsertRowid as number;
}

// ── Sam — overloaded with backend work (11 commits, all under server/) ───────

insertCommit({ memberId: samId, sha: 'sam0001aaaa', title: 'Add REST API endpoint for user registration', diff: `+++ b/server/routes/users.ts\n+router.post('/register', async (req, res) => {\n+  const { email, password } = req.body;\n+  const user = await User.create({ email, password });\n+  res.json({ user });\n+});\n`.repeat(10), filesChanged: 2, additions: 65, deletions: 0, daysAgoN: 30, paths: ['server/routes/users.ts', 'server/routes/index.ts'] });
insertCommit({ memberId: samId, sha: 'sam0002bbbb', title: 'Implement JWT authentication middleware', diff: `+++ b/server/middleware/auth.ts\n+export function authMiddleware(req, res, next) {\n+  const token = req.headers.authorization?.split(' ')[1];\n+  if (!token) return res.status(401).json({ error: 'Unauthorized' });\n+  next();\n+}\n`.repeat(12), filesChanged: 2, additions: 78, deletions: 3, daysAgoN: 28, paths: ['server/middleware/auth.ts', 'server/index.ts'] });
insertCommit({ memberId: samId, sha: 'sam0003cccc', title: 'Build database connection pool for PostgreSQL', diff: `+++ b/server/db/pool.ts\n+import { Pool } from 'pg';\n+const pool = new Pool({ connectionString: process.env.DATABASE_URL });\n+export default pool;\n`.repeat(15), filesChanged: 3, additions: 95, deletions: 10, daysAgoN: 26, paths: ['server/db/pool.ts', 'server/db/client.ts', 'server/db/migrate.ts'] });
insertCommit({ memberId: samId, sha: 'sam0004dddd', title: 'Add session management endpoints', diff: `+++ b/server/routes/sessions.ts\n+router.post('/login', sessionController.login);\n+router.delete('/logout', sessionController.logout);\n`.repeat(8), filesChanged: 2, additions: 48, deletions: 2, daysAgoN: 24, paths: ['server/routes/sessions.ts', 'server/controllers/sessionController.ts'] });
insertCommit({ memberId: samId, sha: 'sam0005eeee', title: 'Implement backend API endpoint for flashcard CRUD', diff: `+++ b/server/routes/flashcards.ts\n+router.get('/', flashcardController.list);\n+router.post('/', flashcardController.create);\n+router.put('/:id', flashcardController.update);\n+router.delete('/:id', flashcardController.delete);\n`.repeat(14), filesChanged: 4, additions: 112, deletions: 5, daysAgoN: 22, paths: ['server/routes/flashcards.ts', 'server/controllers/flashcardController.ts', 'server/models/flashcard.ts', 'server/validators/flashcard.ts'] });
insertCommit({ memberId: samId, sha: 'sam0006ffff', title: 'Add rate limiting middleware to API routes', diff: `+++ b/server/middleware/rateLimit.ts\n+import rateLimit from 'express-rate-limit';\n+export const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });\n`.repeat(6), filesChanged: 3, additions: 32, deletions: 1, daysAgoN: 20, paths: ['server/middleware/rateLimit.ts', 'server/middleware/index.ts', 'server/index.ts'] });
insertCommit({ memberId: samId, sha: 'sam0007gggg', title: 'Implement backend search API for study sessions', diff: `+++ b/server/routes/search.ts\n+router.get('/', async (req, res) => {\n+  const { q } = req.query;\n+  const results = await SearchService.query(q);\n+  res.json({ results });\n+});\n`.repeat(11), filesChanged: 3, additions: 72, deletions: 4, daysAgoN: 18, paths: ['server/routes/search.ts', 'server/services/SearchService.ts', 'server/routes/index.ts'] });
insertCommit({ memberId: samId, sha: 'sam0008hhhh', title: 'Add database migrations for user preferences table', diff: `+++ b/server/db/migrations/004_user_preferences.sql\n+CREATE TABLE user_preferences (\n+  user_id INTEGER PRIMARY KEY,\n+  theme TEXT DEFAULT 'light',\n+  notifications BOOLEAN DEFAULT true\n+);\n`.repeat(9), filesChanged: 2, additions: 55, deletions: 0, daysAgoN: 16, paths: ['server/db/migrations/004_user_preferences.sql', 'server/db/migrate.ts'] });
insertCommit({ memberId: samId, sha: 'sam0009iiii', title: 'Build caching layer for API responses using Redis', diff: `+++ b/server/cache/redis.ts\n+import Redis from 'ioredis';\n+const client = new Redis(process.env.REDIS_URL);\n+export async function getCached(key: string) { return client.get(key); }\n`.repeat(13), filesChanged: 3, additions: 85, deletions: 6, daysAgoN: 14, paths: ['server/cache/redis.ts', 'server/cache/index.ts', 'server/middleware/cache.ts'] });
insertCommit({ memberId: samId, sha: 'sam0010jjjj', title: 'Implement backend API for quiz generation', diff: `+++ b/server/routes/quizzes.ts\n+router.post('/generate', async (req, res) => {\n+  const { deckId, count } = req.body;\n+  const quiz = await QuizService.generate(deckId, count);\n+  res.json({ quiz });\n+});\n`.repeat(16), filesChanged: 4, additions: 128, deletions: 8, daysAgoN: 12, paths: ['server/routes/quizzes.ts', 'server/services/QuizService.ts', 'server/models/quiz.ts', 'server/validators/quiz.ts'] });
insertCommit({ memberId: samId, sha: 'sam0011kkkk', title: 'Fix backend error handling for database schema queries', diff: `+++ b/server/db/schema.ts\n+try {\n+  const result = await db.query(sql);\n+  return result.rows;\n+} catch (err) {\n+  logger.error('DB query failed', err);\n+  throw err;\n+}\n`.repeat(7), filesChanged: 2, additions: 42, deletions: 8, daysAgoN: 10, paths: ['server/db/schema.ts', 'server/db/client.ts'] });

// ── Rio — feature work on auth (8 commits, but no recent auth commits matching issue 12) ──

insertCommit({ memberId: rioId, sha: 'rio0001aaaa', title: 'Scaffold React app with Vite and TypeScript', diff: `+++ b/client/src/main.tsx\n+import React from 'react';\n+import ReactDOM from 'react-dom/client';\n+import App from './App';\n+ReactDOM.createRoot(document.getElementById('root')!).render(<App />);\n`.repeat(8), filesChanged: 7, additions: 95, deletions: 0, daysAgoN: 35 });
insertCommit({ memberId: rioId, sha: 'rio0002bbbb', title: 'Add React Router for client-side navigation', diff: `+++ b/client/src/App.tsx\n+import { BrowserRouter, Routes, Route } from 'react-router-dom';\n+export default function App() {\n+  return <BrowserRouter><Routes><Route path="/" element={<Home />} /></Routes></BrowserRouter>;\n+}\n`.repeat(6), filesChanged: 2, additions: 38, deletions: 5, daysAgoN: 32 });
insertCommit({ memberId: rioId, sha: 'rio0003cccc', title: 'Build login form component with validation', diff: `+++ b/client/src/pages/Login.tsx\n+export function LoginPage() {\n+  const [email, setEmail] = useState('');\n+  const [password, setPassword] = useState('');\n+  return <form onSubmit={handleSubmit}>...</form>;\n+}\n`.repeat(10), filesChanged: 3, additions: 82, deletions: 2, daysAgoN: 29 });
insertCommit({ memberId: rioId, sha: 'rio0004dddd', title: 'Implement auth flow token storage in localStorage', diff: `+++ b/client/src/hooks/useAuth.ts\n+export function useAuth() {\n+  const [token, setToken] = useState(() => localStorage.getItem('token'));\n+  function login(t: string) { setToken(t); localStorage.setItem('token', t); }\n+  return { token, login };\n+}\n`.repeat(9), filesChanged: 2, additions: 58, deletions: 10, daysAgoN: 20 });
insertCommit({ memberId: rioId, sha: 'rio0005eeee', title: 'Add dashboard landing page component', diff: `+++ b/client/src/pages/Dashboard.tsx\n+export function Dashboard() {\n+  return <main><h1>Welcome back!</h1><FlashcardList /></main>;\n+}\n`.repeat(7), filesChanged: 2, additions: 45, deletions: 0, daysAgoN: 17 });
insertCommit({ memberId: rioId, sha: 'rio0006ffff', title: 'Create user profile settings page', diff: `+++ b/client/src/pages/Profile.tsx\n+export function ProfilePage() {\n+  return <section><h2>Profile</h2><ProfileForm /></section>;\n+}\n`.repeat(6), filesChanged: 2, additions: 40, deletions: 0, daysAgoN: 13 });
insertCommit({ memberId: rioId, sha: 'rio0007gggg', title: 'Refactor auth context to use React Context API', diff: `+++ b/client/src/context/AuthContext.tsx\n+const AuthContext = createContext<AuthState | null>(null);\n+export function AuthProvider({ children }) {\n+  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;\n+}\n`.repeat(8), filesChanged: 4, additions: 60, deletions: 35, daysAgoN: 8 });
// Last auth-flow commit is 7 days ago, so Issue #12 (auth flow) has had no activity for ~6+ days
insertCommit({ memberId: rioId, sha: 'rio0008hhhh', title: 'Implement redirect after auth flow completes', diff: `+++ b/client/src/hooks/useAuthRedirect.ts\n+export function useAuthRedirect() {\n+  const navigate = useNavigate();\n+  useEffect(() => { if (token) navigate('/dashboard'); }, [token]);\n+}\n`.repeat(5), filesChanged: 1, additions: 22, deletions: 3, daysAgoN: 7 });

// ── Jordan — only a few test commits (3 commits) ────────────────────────────

insertCommit({ memberId: jordanId, sha: 'jor0001aaaa', title: 'Add Vitest unit tests for user model validation', diff: `+++ b/server/tests/user.test.ts\n+describe('User model', () => {\n+  it('validates email format', () => {\n+    expect(validateEmail('bad')).toBe(false);\n+    expect(validateEmail('ok@test.com')).toBe(true);\n+  });\n+});\n`.repeat(6), filesChanged: 1, additions: 38, deletions: 0, daysAgoN: 25 });
insertCommit({ memberId: jordanId, sha: 'jor0002bbbb', title: 'Write integration tests for API endpoint coverage', diff: `+++ b/server/tests/api.test.ts\n+describe('POST /api/register', () => {\n+  it('returns 201 on success', async () => {\n+    const res = await request(app).post('/api/register').send(validUser);\n+    expect(res.status).toBe(201);\n+  });\n+});\n`.repeat(8), filesChanged: 2, additions: 62, deletions: 0, daysAgoN: 15 });
insertCommit({ memberId: jordanId, sha: 'jor0003cccc', title: 'Add test coverage for flashcard CRUD operations', diff: `+++ b/server/tests/flashcard.test.ts\n+describe('FlashcardService', () => {\n+  it('creates a flashcard', async () => {\n+    const card = await FlashcardService.create({ front: 'Q', back: 'A', deckId: 1 });\n+    expect(card.id).toBeDefined();\n+  });\n+});\n`.repeat(7), filesChanged: 1, additions: 55, deletions: 0, daysAgoN: 5 });

// ── Priya — docs and UI work (6 commits) ────────────────────────────────────

insertCommit({ memberId: priyaId, sha: 'pri0001aaaa', title: 'Design user dashboard UI wireframes and component plan', diff: `+++ b/docs/ui-design.md\n+## Dashboard Layout\n+The main dashboard shows the user's active decks, recent activity, and progress stats.\n`.repeat(5), filesChanged: 2, additions: 28, deletions: 0, daysAgoN: 33 });
insertCommit({ memberId: priyaId, sha: 'pri0002bbbb', title: 'Implement flashcard component with flip animation', diff: `+++ b/client/src/components/Flashcard.tsx\n+export function Flashcard({ front, back }: FlashcardProps) {\n+  const [flipped, setFlipped] = useState(false);\n+  return <div className={flipped ? 'flipped' : ''} onClick={() => setFlipped(!flipped)}>{flipped ? back : front}</div>;\n+}\n`.repeat(9), filesChanged: 3, additions: 75, deletions: 2, daysAgoN: 27 });
insertCommit({ memberId: priyaId, sha: 'pri0003cccc', title: 'Add Sass variables for brand colors and typography', diff: `+++ b/client/src/styles/_variables.scss\n+$color-primary: #4a6cf7;\n+$color-secondary: #6c757d;\n+$font-heading: 'Inter', sans-serif;\n`.repeat(4), filesChanged: 1, additions: 18, deletions: 0, daysAgoN: 23 });
insertCommit({ memberId: priyaId, sha: 'pri0004dddd', title: 'Build deck browser with search and filter support', diff: `+++ b/client/src/pages/Decks.tsx\n+export function DecksPage() {\n+  const [query, setQuery] = useState('');\n+  const filtered = decks.filter(d => d.title.includes(query));\n+  return <main><SearchBar value={query} onChange={setQuery} /><DeckGrid decks={filtered} /></main>;\n+}\n`.repeat(10), filesChanged: 3, additions: 88, deletions: 5, daysAgoN: 19 });
insertCommit({ memberId: priyaId, sha: 'pri0005eeee', title: 'Write README and project documentation', diff: `+++ b/README.md\n+# StudyBuddy\n+A collaborative flashcard and study session management app.\n+## Setup\n+1. Clone the repo\n+2. Run \`npm install\`\n+3. Configure \`.env\`\n`.repeat(6), filesChanged: 2, additions: 42, deletions: 3, daysAgoN: 11 });
insertCommit({ memberId: priyaId, sha: 'pri0006ffff', title: 'Refactor dashboard layout to use CSS Grid', diff: `+++ b/client/src/pages/Dashboard.tsx\n+.dashboard-grid {\n+  display: grid;\n+  grid-template-columns: 1fr 3fr;\n+  gap: 1.5rem;\n+}\n`.repeat(5), filesChanged: 2, additions: 30, deletions: 15, daysAgoN: 3 });

// ── Priya — 3 manual log entries ─────────────────────────────────────────────

function insertManual(memberId: number, title: string, body: string, kind: string, daysAgoN: number): void {
  db.prepare(
    `INSERT INTO contributions
       (team_id, member_id, source, title, body, kind, authored_at)
     VALUES (?, ?, 'manual', ?, ?, ?, ?)`,
  ).run(teamId, memberId, title, body, kind, daysAgo(daysAgoN));
}

insertManual(priyaId, 'UI design review meeting', 'Reviewed wireframes with team, agreed on color palette and layout for dashboard. Action items documented in Notion.', 'meeting', 21);
insertManual(priyaId, 'User research on study app UX patterns', 'Analysed 5 competitor study apps (Anki, Quizlet, Brainscape, Duolingo, Memrise). Wrote up findings in shared doc.', 'research', 31);
insertManual(priyaId, 'Accessibility audit of flashcard component', 'Ran axe-core scan and manual keyboard/screen reader test. Filed 3 issues for fixes.', 'design', 9);

console.log(`Inserted contributions and manual entries`);

// ── Override: set no-recent-activity on task #12 ─────────────────────────────
// The last commit touching auth (rio0008hhhh) is 7 days ago — issue #12 stays open
// No further action needed; the data already reflects this.

// ── Run classifier ────────────────────────────────────────────────────────────

// We need to override the db singleton that classifier.ts imports from client.ts
// Instead, we set DB_PATH before the import so both resolve to the same file.
// Since the classifier imports db from client.ts (a singleton), and we're
// running seed.ts with tsx (the same process), it will use the same DB_PATH.
// Just call classifyTeam with the teamId.

// Dynamic import to avoid top-level circular dependency during seed run
console.log('Running classifier...');
const { classified, failed } = await classifyTeam(teamId);
console.log(`Classified ${classified} contributions${failed > 0 ? `, ${failed} failed` : ''}`);

console.log('Running risk reasoner...');
await runReasoner(teamId);

const riskRows = db
  .prepare(`SELECT level, description, evidence FROM risks WHERE team_id = ? AND dismissed = 0 ORDER BY CASE level WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, generated_at DESC`)
  .all(teamId) as Array<{ level: string; description: string; evidence: string }>;

const suggRows = db
  .prepare(`
    SELECT s.id, m1.github_login AS from_login, m2.github_login AS to_login,
           t.github_issue_number, t.title AS task_title,
           s.rationale, s.checkin_message
    FROM suggestions s
    JOIN members m1 ON m1.id = s.from_member_id
    JOIN members m2 ON m2.id = s.to_member_id
    JOIN tasks t ON t.id = s.task_id
    WHERE s.team_id = ? AND s.status = 'pending'
  `)
  .all(teamId) as Array<{
    id: number;
    from_login: string;
    to_login: string;
    github_issue_number: number | null;
    task_title: string;
    rationale: string;
    checkin_message: string;
  }>;

console.log('\n── Risks ──────────────────────────────────────────');
if (riskRows.length === 0) {
  console.log('  (none)');
} else {
  for (const r of riskRows) {
    console.log(`  [${r.level.toUpperCase()}] ${r.description}`);
    const ev = JSON.parse(r.evidence) as Array<{ type: string; id: number }>;
    console.log(`         evidence: ${ev.map(e => `${e.type}#${e.id}`).join(', ')}`);
  }
}

console.log('\n── Suggestions ────────────────────────────────────');
if (suggRows.length === 0) {
  console.log('  (none)');
} else {
  for (const s of suggRows) {
    const rationale = JSON.parse(s.rationale) as string[];
    console.log(`  Swap: issue #${s.github_issue_number} "${s.task_title}"`);
    console.log(`        from: ${s.from_login} → to: ${s.to_login}`);
    console.log(`        rationale:`);
    for (const r of rationale) console.log(`          • ${r}`);
    console.log(`        check-in: "${s.checkin_message}"`);
  }
}

console.log('\n✅ StudyBuddy seed complete.');
console.log(`   Team id: ${teamId}`);
console.log(`   Members: Rio(${rioId}), Sam(${samId}), Priya(${priyaId}), Jordan(${jordanId})`);

const contribCount = (db.prepare('SELECT COUNT(*) AS n FROM contributions WHERE team_id = ?').get(teamId) as { n: number }).n;
const classCount   = (db.prepare('SELECT COUNT(*) AS n FROM classifications cl JOIN contributions c ON c.id = cl.contribution_id WHERE c.team_id = ?').get(teamId) as { n: number }).n;
const matchCount   = (db.prepare('SELECT COUNT(*) AS n FROM task_matches tm JOIN contributions c ON c.id = tm.contribution_id WHERE c.team_id = ?').get(teamId) as { n: number }).n;

console.log(`   Contributions: ${contribCount} (commits + manual)`);
console.log(`   Classifications: ${classCount}`);
console.log(`   Task matches: ${matchCount}`);

db.close();
