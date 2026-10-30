import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { api } from '../api.js';
import VideoCall from '../VideoCall.jsx';

export default function Meeting() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const [meeting, setMeeting] = useState(null);
  const [error, setError] = useState('');
  const [joined, setJoined] = useState(null); // { mic, cam }

  useEffect(() => {
    api.getMeeting(id).then(setMeeting).catch((e) => setError(e.message));
  }, [id]);

  if (error) {
    return (
      <div className="page-status">
        <p role="alert">{error}</p>
        <button className="btn-secondary" onClick={() => nav('/')}>Back to home</button>
      </div>
    );
  }
  if (!meeting) return <div className="page-status">Finding your meeting…</div>;

  if (joined) {
    return <VideoCall meetingId={id} title={meeting.title} initialMic={joined.mic} initialCam={joined.cam} onLeave={() => nav('/')} />;
  }
  return <Lobby meeting={meeting} user={user} onJoin={setJoined} />;
}

/* Lobby: check your camera and choose how you enter. */
function Lobby({ meeting, user, onJoin }) {
  const [mic, setMic] = useState(false);
  const [cam, setCam] = useState(false);
  const [camError, setCamError] = useState('');
  const videoRef = useRef(null);

  useEffect(() => {
    if (!cam) return;
    let stream;
    let cancelled = false;
    navigator.mediaDevices.getUserMedia({ video: true })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        videoRef.current.srcObject = s;
        setCamError('');
      })
      .catch(() => { setCamError('Huddle can’t use your camera. Allow camera access in your browser, then try again.'); setCam(false); });
    return () => { cancelled = true; stream?.getTracks().forEach((t) => t.stop()); };
  }, [cam]);

  const copy = () => navigator.clipboard?.writeText(`${window.location.origin}/m/${meeting.id}`);

  return (
    <div className="lobby">
      <div className="lobby-preview">
        <video ref={videoRef} autoPlay muted playsInline style={{ display: cam ? 'block' : 'none' }} />
        {!cam && <div className="avatar-big">{user.name.slice(0, 1).toUpperCase()}</div>}
      </div>

      <div className="lobby-side">
        <h1>{meeting.title}</h1>
        <p className="meeting-id">Meeting ID <strong>{meeting.id}</strong>
          <button className="link" onClick={copy}>Copy invite link</button>
        </p>

        <div className="toggles">
          <button aria-pressed={mic} className={mic ? 'chip on' : 'chip'} onClick={() => setMic(!mic)}>{mic ? 'Mic on' : 'Mic off'}</button>
          <button aria-pressed={cam} className={cam ? 'chip on' : 'chip'} onClick={() => setCam(!cam)}>{cam ? 'Camera on' : 'Camera off'}</button>
        </div>
        {camError && <p className="form-error" role="alert">{camError}</p>}

        <button className="btn-primary" onClick={() => onJoin({ mic, cam })}>Join as {user.name}</button>
      </div>
    </div>
  );
}
