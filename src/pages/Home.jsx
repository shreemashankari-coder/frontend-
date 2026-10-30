import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { api } from '../api.js';

// Accepts "abc-defg-hij" or a full link ending in it.
const parseMeetingId = (text) => text.trim().match(/([a-z]{3}-[a-z]{4}-[a-z]{3})\s*$/i)?.[1].toLowerCase();

export default function Home() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const [title, setTitle] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setError(''); setBusy(true);
    try { const m = await api.createMeeting(title); nav(`/m/${m.id}`); }
    catch (e) { setError(e.message); setBusy(false); }
  };

  const join = (e) => {
    e.preventDefault();
    const id = parseMeetingId(code);
    if (!id) return setError('Meeting IDs look like abc-defg-hij. Check the ID or paste the full link.');
    nav(`/m/${id}`);
  };

  return (
    <div className="home">
      <header className="home-top">
        <span className="brand">Huddle</span>
        <span className="who">{user.name}</span>
        <button className="link" onClick={logout}>Sign out</button>
      </header>

      <main className="home-main">
        <h1>Hello, {user.name.split(' ')[0]}</h1>

        <section className="card">
          <h2>Start a new meeting</h2>
          <label>Meeting name (optional)
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder="Weekly all-hands" />
          </label>
          <button className="btn-primary" onClick={create} disabled={busy}>{busy ? 'Creating…' : 'Create meeting ID'}</button>
        </section>

        <section className="card">
          <h2>Join with a meeting ID</h2>
          <form onSubmit={join}>
            <label>Meeting ID or link
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="abc-defg-hij" />
            </label>
            <button className="btn-secondary">Join meeting</button>
          </form>
        </section>

        {error && <p className="form-error" role="alert">{error}</p>}
      </main>
    </div>
  );
}
