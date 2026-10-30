// Backend: accounts, meeting IDs, and LiveKit join tokens.
// Data is stored in server/data/*.json (fine for development; use a real database in production).
import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { AccessToken } from 'livekit-server-sdk';

const { JWT_SECRET, LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, PORT = 3001 } = process.env;
if (!JWT_SECRET || !LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
  console.error('Missing settings. Copy .env.example to .env and fill in every value.');
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const load = (file, fallback) => {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8')); } catch { return fallback; }
};
const save = (file, data) => fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2));

const users = load('users.json', []);       // [{ id, name, email, passwordHash }]
const meetings = load('meetings.json', {}); // { "abc-defg-hij": { id, title, hostId, createdAt } }

const app = express();
app.use(express.json());

const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email });
const signIn = (u) => jwt.sign({ sub: u.id }, JWT_SECRET, { expiresIn: '7d' });

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  try {
    const { sub } = jwt.verify(token, JWT_SECRET);
    const user = users.find((u) => u.id === sub);
    if (!user) throw new Error('unknown user');
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: 'Please sign in again.' });
  }
}

/* ---------- Accounts ---------- */
app.post('/api/auth/register', async (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!name || name.length > 60) return res.status(400).json({ error: 'Enter your name (up to 60 characters).' });
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (password.length < 8) return res.status(400).json({ error: 'Use a password with at least 8 characters.' });
  if (users.some((u) => u.email === email)) return res.status(409).json({ error: 'An account with this email already exists. Sign in instead.' });

  const user = { id: crypto.randomUUID(), name, email, passwordHash: await bcrypt.hash(password, 10) };
  users.push(user);
  save('users.json', users);
  res.status(201).json({ token: signIn(user), user: publicUser(user) });
});

app.post('/api/auth/login', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const user = users.find((u) => u.email === email);
  const ok = user && (await bcrypt.compare(String(req.body.password || ''), user.passwordHash));
  if (!ok) return res.status(401).json({ error: 'Email or password is incorrect.' });
  res.json({ token: signIn(user), user: publicUser(user) });
});

app.get('/api/auth/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

/* ---------- Meetings ---------- */
const LETTERS = 'abcdefghijkmnopqrstuvwxyz';
const chunk = (n) => Array.from({ length: n }, () => LETTERS[crypto.randomInt(LETTERS.length)]).join('');
const newMeetingId = () => {
  let id;
  do { id = `${chunk(3)}-${chunk(4)}-${chunk(3)}`; } while (meetings[id]);
  return id;
};

app.post('/api/meetings', requireAuth, (req, res) => {
  const id = newMeetingId();
  const title = String(req.body.title || '').trim().slice(0, 80) || `${req.user.name}’s meeting`;
  meetings[id] = { id, title, hostId: req.user.id, createdAt: new Date().toISOString() };
  save('meetings.json', meetings);
  res.status(201).json(meetings[id]);
});

app.get('/api/meetings/:id', requireAuth, (req, res) => {
  const m = meetings[req.params.id];
  if (!m) return res.status(404).json({ error: 'No meeting found with this ID. Check it and try again.' });
  res.json({ id: m.id, title: m.title, isHost: m.hostId === req.user.id });
});

// Issues the LiveKit token the browser needs to join this meeting's room.
app.post('/api/meetings/:id/token', requireAuth, async (req, res) => {
  const m = meetings[req.params.id];
  if (!m) return res.status(404).json({ error: 'No meeting found with this ID.' });
  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity: req.user.id,
    name: req.user.name,
    ttl: '4h',
  });
  at.addGrant({
    roomJoin: true,
    room: m.id,
    canSubscribe: true,
    canPublish: true,      // set false for attendees in webinar-style meetings
    canPublishData: true,  // needed for chat and subtitles
    roomAdmin: m.hostId === req.user.id,
  });
  res.json({ token: await at.toJwt(), url: LIVEKIT_URL });
});

/* ---------- Production: serve the built website ---------- */
const dist = path.join(__dirname, '..', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.listen(PORT, () => console.log(`Huddle API on http://localhost:${PORT}`));
