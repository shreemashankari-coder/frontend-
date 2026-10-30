import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  LiveKitRoom,
  RoomAudioRenderer,
  VideoTrack,
  useTracks,
  useParticipants,
  useDataChannel,
  useIsSpeaking,
  useIsMuted,
  useRoomContext,
  useTrackToggle,
  isTrackReference,
} from '@livekit/components-react';
import { Track, RoomEvent, VideoPresets } from 'livekit-client';
import { api } from './api.js';

const PAGE_SIZE = 12;        // video tiles shown at once; keeps 100-person rooms light
const CAPTION_TTL_MS = 4500; // how long a subtitle line stays after its last update
const enc = (o) => new TextEncoder().encode(JSON.stringify(o));
const dec = (b) => JSON.parse(new TextDecoder().decode(b));
const initials = (n = '?') => n.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

/* ---------- Entry: get a join token, then connect ---------- */
export default function VideoCall({ meetingId, title, initialMic, initialCam, onLeave }) {
  const [conn, setConn] = useState(null); // { token, url }
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [ended, setEnded] = useState(null); // set when LiveKit disconnects on its own
  const lastError = useRef('');
  const leaving = useRef(false);
  const leave = () => { leaving.current = true; onLeave?.(); };

  useEffect(() => {
    api.getJoinToken(meetingId).then(setConn).catch((e) => setError(e.message));
  }, [meetingId]);

  // Settings that make large rooms workable: simulcast, adaptive stream, dynacast.
  const roomOptions = useMemo(() => ({
    adaptiveStream: true,
    dynacast: true,
    videoCaptureDefaults: { resolution: VideoPresets.h360 },
    publishDefaults: { simulcast: true, videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360] },
  }), []);

  if (error) return <div className="page-status" role="alert">Can’t join: {error}</div>;
  if (!conn) return <div className="page-status">Joining…</div>;
  if (ended) {
    return (
      <div className="page-status" role="alert">
        <h1>Couldn’t stay connected</h1>
        <p>{ended.detail || 'The connection to LiveKit closed. Check LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET in .env, restart the app, and try again.'}</p>
        <div className="row">
          <button className="btn-primary" onClick={() => window.location.reload()}>Try again</button>
          <button className="btn-secondary" onClick={onLeave}>Back to home</button>
        </div>
      </div>
    );
  }

  return (
    <LiveKitRoom
      token={conn.token}
      serverUrl={conn.url}
      connect
      audio={initialMic}
      video={initialCam}
      options={roomOptions}
      onDisconnected={() => { if (!leaving.current) setEnded({ detail: lastError.current }); }}
      onError={(e) => { lastError.current = `Connection problem: ${e.message}`; setNotice(lastError.current); }}
      onMediaDeviceFailure={() => setNotice('Camera or microphone is blocked. Allow access in your browser, then try again.')}
      className="call"
    >
      {notice && <div className="notice" role="alert">{notice}</div>}
      <CallLayout meetingId={meetingId} title={title} onLeave={leave} />
    </LiveKitRoom>
  );
}

/* ---------- Layout ---------- */
function CallLayout({ meetingId, title, onLeave }) {
  const room = useRoomContext();
  const participants = useParticipants();
  const [deafened, setDeafened] = useState(false);     // mutes all incoming audio
  const [showCaptions, setShowCaptions] = useState(true);
  const [panel, setPanel] = useState(null);            // null | 'chat' | 'people'
  const [page, setPage] = useState(0);
  const [copied, setCopied] = useState(false);

  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true }, // everyone gets a tile
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false }
  );
  const activeId = useActiveSpeaker();
  const captions = useCaptions();
  const chat = useChat(panel === 'chat');

  const screenShare = tracks.find((t) => t.source === Track.Source.ScreenShare);
  const cameras = tracks.filter((t) => t.source === Track.Source.Camera);
  const featured =
    screenShare ??
    cameras.find((t) => t.participant.identity === activeId) ??
    cameras.find((t) => !t.participant.isLocal) ??
    cameras[0];

  const gridTracks = cameras.filter(
    (t) => !(featured?.source === Track.Source.Camera && t.participant.identity === featured.participant.identity)
  );
  const pageCount = Math.max(1, Math.ceil(gridTracks.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visible = gridTracks.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  useEffect(() => { if (page !== safePage) setPage(safePage); }, [page, safePage]);

  const copyInvite = async () => {
    await navigator.clipboard?.writeText(`${window.location.origin}/m/${meetingId}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="call-shell">
      <header className="call-header">
        <h1>{title}</h1>
        <span className="call-id">{meetingId}</span>
        <button className="chip" onClick={copyInvite}>{copied ? 'Link copied' : 'Copy invite link'}</button>
        <span className="call-count">{participants.length} in call</span>
      </header>

      <div className="call-body">
        <main className="call-main">
          {featured && (
            <section className="stage" aria-label="Speaker stage">
              <Tile trackRef={featured} large />
              {showCaptions && <Captions lines={captions.lines} />}
            </section>
          )}
          <section className="grid" aria-label="Participants">
            {visible.map((t) => <Tile key={t.participant.identity + t.source} trackRef={t} />)}
          </section>
          {pageCount > 1 && (
            <nav className="pager" aria-label="Participant pages">
              <button className="chip" onClick={() => setPage(safePage - 1)} disabled={safePage === 0}>Previous</button>
              <span>Page {safePage + 1} of {pageCount}</span>
              <button className="chip" onClick={() => setPage(safePage + 1)} disabled={safePage >= pageCount - 1}>Next</button>
            </nav>
          )}
        </main>

        {panel && (
          <aside className="panel" aria-label={panel === 'chat' ? 'Chat' : 'People'}>
            <div className="panel-head">
              <h2>{panel === 'chat' ? 'Chat' : `People (${participants.length})`}</h2>
              <button className="chip" onClick={() => setPanel(null)}>Close</button>
            </div>
            {panel === 'chat' ? <ChatPanel chat={chat} /> : <PeoplePanel participants={participants} />}
          </aside>
        )}
      </div>

      <ControlBar
        deafened={deafened}
        onToggleSound={() => setDeafened((v) => !v)}
        showCaptions={showCaptions}
        onToggleCaptions={() => setShowCaptions((v) => !v)}
        captionsSupported={captions.supported}
        panel={panel}
        setPanel={setPanel}
        unread={chat.unread}
        onLeave={() => { onLeave?.(); room.disconnect(); }}
      />

      {/* Plays every remote mic; `muted` is the “sound off” switch. */}
      <RoomAudioRenderer muted={deafened} />
    </div>
  );
}

/* ---------- Tile + active-speaker ring ---------- */
function Tile({ trackRef, large = false }) {
  const p = trackRef.participant;
  const speaking = useIsSpeaking(p);
  const micMuted = useIsMuted({ participant: p, source: Track.Source.Microphone });
  const isScreen = trackRef.source === Track.Source.ScreenShare;
  const hasVideo = isTrackReference(trackRef) && !trackRef.publication.isMuted;
  const name = p.name || p.identity;

  return (
    <figure
      className={`tile${large ? ' large' : ''}${speaking ? ' speaking' : ''}`}
      aria-label={`${name}${p.isLocal ? ' (you)' : ''}${speaking ? ', speaking' : ''}${micMuted ? ', muted' : ''}`}
    >
      {hasVideo
        ? <VideoTrack trackRef={trackRef} className={isScreen ? 'contain' : ''} />
        : <div className="tile-avatar" aria-hidden="true">{initials(name)}</div>}
      <figcaption>
        <span className={`tile-mic${micMuted ? ' off' : ''}`}>{micMuted ? 'Muted' : 'Live'}</span>
        <span className="tile-name">{name}{p.isLocal ? ' (you)' : ''}{isScreen ? ' · screen' : ''}</span>
      </figcaption>
    </figure>
  );
}

/* ---------- Controls ---------- */
function ControlBar({ deafened, onToggleSound, showCaptions, onToggleCaptions, captionsSupported, panel, setPanel, unread, onLeave }) {
  const mic = useTrackToggle({ source: Track.Source.Microphone });
  const cam = useTrackToggle({ source: Track.Source.Camera });
  const share = useTrackToggle({ source: Track.Source.ScreenShare });
  const toggle = (name) => setPanel(panel === name ? null : name);

  return (
    <footer className="controls" role="toolbar" aria-label="Call controls">
      <button className={mic.enabled ? 'ctl on' : 'ctl off'} aria-pressed={mic.enabled} disabled={mic.pending} onClick={() => mic.toggle()}>
        {mic.enabled ? 'Mute mic' : 'Unmute mic'}
      </button>
      <button className={cam.enabled ? 'ctl on' : 'ctl off'} aria-pressed={cam.enabled} disabled={cam.pending} onClick={() => cam.toggle()}>
        {cam.enabled ? 'Stop camera' : 'Start camera'}
      </button>
      <button className={share.enabled ? 'ctl on' : 'ctl'} aria-pressed={share.enabled} disabled={share.pending} onClick={() => share.toggle()}>
        {share.enabled ? 'Stop sharing' : 'Share screen'}
      </button>
      <button className={deafened ? 'ctl off' : 'ctl on'} aria-pressed={!deafened} onClick={onToggleSound}>
        {deafened ? 'Turn sound on' : 'Turn sound off'}
      </button>
      <button className={showCaptions ? 'ctl on' : 'ctl'} aria-pressed={showCaptions} onClick={onToggleCaptions}>
        {showCaptions ? 'Hide subtitles' : 'Show subtitles'}
      </button>
      <button className={panel === 'chat' ? 'ctl on' : 'ctl'} aria-pressed={panel === 'chat'} onClick={() => toggle('chat')}>
        Chat{unread > 0 && <span className="badge">{unread}</span>}
      </button>
      <button className={panel === 'people' ? 'ctl on' : 'ctl'} aria-pressed={panel === 'people'} onClick={() => toggle('people')}>
        People
      </button>
      <button className="ctl leave" onClick={onLeave}>Leave</button>
      {!captionsSupported && (
        <small className="hint">Your browser can’t turn your voice into subtitles. You will still see everyone else’s.</small>
      )}
    </footer>
  );
}

/* ---------- Chat (LiveKit data channel, topic "chat") ----------
   Messages are not stored: people who join later don't see earlier messages. */
function useChat(isOpen) {
  const [messages, setMessages] = useState([]);
  const [unread, setUnread] = useState(0);
  const openRef = useRef(isOpen);
  openRef.current = isOpen;

  const { send } = useDataChannel('chat', (msg) => {
    try {
      const d = dec(msg.payload);
      setMessages((m) => [...m, { id: `${d.ts}-${msg.from?.identity}`, from: msg.from?.name || 'Guest', mine: false, text: d.text, ts: d.ts }]);
      if (!openRef.current) setUnread((u) => u + 1);
    } catch { /* ignore malformed */ }
  });

  const post = useCallback((text) => {
    const ts = Date.now();
    send(enc({ text, ts }), { reliable: true });
    setMessages((m) => [...m, { id: `${ts}-me`, from: 'You', mine: true, text, ts }]); // senders don't get an echo
  }, [send]);

  useEffect(() => { if (isOpen) setUnread(0); }, [isOpen]);
  return { messages, unread, post };
}

function ChatPanel({ chat }) {
  const [text, setText] = useState('');
  const endRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [chat.messages.length]);

  const submit = (e) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    chat.post(t.slice(0, 1000));
    setText('');
  };

  return (
    <>
      <ul className="chat-list" aria-live="polite">
        {chat.messages.length === 0 && <li className="chat-empty">No messages yet. Say hello to everyone in the meeting.</li>}
        {chat.messages.map((m) => (
          <li key={m.id} className={m.mine ? 'msg mine' : 'msg'}>
            <b>{m.from}</b>
            <span className="msg-time">{new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            <p>{m.text}</p>
          </li>
        ))}
        <li ref={endRef} />
      </ul>
      <form className="chat-form" onSubmit={submit}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Message everyone" maxLength={1000} aria-label="Message" />
        <button className="btn-primary small">Send</button>
      </form>
    </>
  );
}

/* ---------- People ---------- */
function PeoplePanel({ participants }) {
  return (
    <ul className="people">
      {participants.map((p) => <PersonRow key={p.identity} p={p} />)}
    </ul>
  );
}
function PersonRow({ p }) {
  const muted = useIsMuted({ participant: p, source: Track.Source.Microphone });
  const speaking = useIsSpeaking(p);
  return (
    <li className={speaking ? 'person speaking' : 'person'}>
      <span className="person-avatar">{initials(p.name || p.identity)}</span>
      <span className="person-name">{p.name || p.identity}{p.isLocal ? ' (you)' : ''}</span>
      <span className={muted ? 'tile-mic off' : 'tile-mic'}>{muted ? 'Muted' : 'Live'}</span>
    </li>
  );
}

/* ---------- Active speaker (debounced so the stage doesn't flicker) ---------- */
function useActiveSpeaker() {
  const room = useRoomContext();
  const [id, setId] = useState(null);
  const timer = useRef();
  useEffect(() => {
    const onChange = (speakers) => {
      const next = speakers.find((s) => !s.isLocal) ?? speakers[0]; // loudest first
      if (!next) return; // keep the last speaker during silence
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setId(next.identity), 500);
    };
    room.on(RoomEvent.ActiveSpeakersChanged, onChange);
    return () => { room.off(RoomEvent.ActiveSpeakersChanged, onChange); clearTimeout(timer.current); };
  }, [room]);
  return id;
}

/* ---------- Subtitles ----------
   Each browser transcribes its OWN mic (Web Speech API) and broadcasts the text on topic "captions".
   Cost scales with speakers, not with the 100 listeners. */
function useCaptions() {
  const room = useRoomContext();
  const mic = useTrackToggle({ source: Track.Source.Microphone });
  const [lines, setLines] = useState({}); // identity -> { name, text, final, ts }
  const SR = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);

  const upsert = (identity, name, text, final) =>
    setLines((prev) => ({ ...prev, [identity]: { name, text, final, ts: Date.now() } }));

  const { send } = useDataChannel('captions', (msg) => {
    try {
      const d = dec(msg.payload);
      upsert(msg.from.identity, msg.from.name || msg.from.identity, d.text, d.final);
    } catch { /* ignore malformed */ }
  });

  useEffect(() => {
    if (!SR || !mic.enabled) return;
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || 'en-US';
    let alive = true;
    let lastSent = 0;
    const me = room.localParticipant;

    rec.onresult = (e) => {
      const r = e.results[e.results.length - 1];
      const text = r[0].transcript.trim();
      if (!text) return;
      upsert(me.identity, me.name || me.identity, text, r.isFinal);
      const now = Date.now();
      if (r.isFinal || now - lastSent > 300) { // throttle interim updates
        lastSent = now;
        send(enc({ text, final: r.isFinal }), { reliable: r.isFinal });
      }
    };
    rec.onend = () => { if (alive) try { rec.start(); } catch { /* already running */ } }; // Chrome stops on silence
    try { rec.start(); } catch { /* ignore */ }
    return () => { alive = false; rec.onend = null; rec.stop(); };
  }, [SR, mic.enabled, room, send]);

  useEffect(() => {
    const t = setInterval(() => {
      setLines((prev) => {
        const cutoff = Date.now() - CAPTION_TTL_MS;
        const next = Object.fromEntries(Object.entries(prev).filter(([, v]) => v.ts > cutoff));
        return Object.keys(next).length === Object.keys(prev).length ? prev : next;
      });
    }, 500);
    return () => clearInterval(t);
  }, []);

  return { lines: Object.entries(lines).sort((a, b) => a[1].ts - b[1].ts).slice(-3), supported: !!SR };
}

function Captions({ lines }) {
  return (
    <div className="captions" aria-live="polite">
      {lines.map(([id, l]) => (
        <p key={id} className={l.final ? '' : 'interim'}><b>{l.name}</b> {l.text}</p>
      ))}
    </div>
  );
}
