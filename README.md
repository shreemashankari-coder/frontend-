# Huddle: video meetings for up to 100 people

Sign in, create a meeting ID, share the link, and meet with camera, mic, screen share, chat, subtitles and an active-speaker indicator. Built with React (Vite) and LiveKit, with a small Node/Express backend.

## 1. Folder layout (exact names matter)

    huddle/
    ├── package.json
    ├── vite.config.js
    ├── index.html
    ├── .env.example        (copy to .env)
    ├── .gitignore
    ├── server/
    │   └── index.js
    └── src/
        ├── main.jsx
        ├── App.jsx
        ├── api.js
        ├── auth.jsx
        ├── theme.css
        ├── VideoCall.jsx
        └── pages/
            ├── Login.jsx
            ├── Home.jsx
            └── Meeting.jsx

File formats: `.jsx` = React code, `.js` = JavaScript, `.css` = styles, `.json` = settings, `.html` = page shell, `.env` = secrets (plain text, no other extension). Save everything as plain text, UTF-8. Easiest editor: Visual Studio Code (File > Save, or Ctrl+S / Cmd+S).

## 2. One-time setup

1. Install Node.js 20 or newer from nodejs.org. Check with `node --version`.
2. Create a free LiveKit Cloud project at cloud.livekit.io. Under Settings > Keys, create a key. Note the WebSocket URL (starts with `wss://`), API key and API secret.
3. Copy `.env.example` to `.env` and fill in the values. Generate `JWT_SECRET` with:
       node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

## 3. Run it

    cd huddle
    npm install
    npm run dev

Open http://localhost:5173. Create an account, click "Create meeting ID", then open the invite link in a second browser (or a private window with another account) to test.

Camera and microphone only work on `http://localhost` or on HTTPS sites.

## 4. How it works

| Step | What happens |
|---|---|
| Sign in / register | `server/index.js` stores the user (password hashed with bcrypt) in `server/data/users.json` and returns a 7-day login token. |
| Create meeting | The server makes an ID like `abc-defg-hij`, saved in `server/data/meetings.json`. The creator is the host. |
| Join | Anyone signed in can open `/m/abc-defg-hij`. The lobby shows a camera preview and mic/camera choices. |
| In the call | The browser asks the server for a LiveKit token for that room, then connects to LiveKit. |
| Chat | Sent over LiveKit's data channel (topic `chat`). Not stored: late joiners don't see earlier messages. |
| Subtitles | Each browser turns its own mic into text (Web Speech API) and sends it on topic `captions`. Chrome and Edge work best. |
| Active speaker | A sand-coloured ring on whoever is talking, and the large stage follows the loudest remote speaker. |

## 5. Built for 100 people

- Only 12 video tiles are drawn per page. Hidden video is paused (adaptive stream) and unused video layers stop (dynacast).
- Everyone is sent at two resolutions (180p and 360p), so weak connections get the smaller one.
- The "Turn sound off" button mutes all incoming audio for you only.

## 6. Go live

    npm run build
    npm start

`npm start` serves the website and the API together on `PORT`. Deploy to any Node host (Render, Railway, Fly.io, a VPS) behind HTTPS and set the four `.env` values as environment variables there.

## 7. Before real use

- Replace the JSON files with a database (Postgres, MongoDB). Data in `server/data` is lost on hosts with temporary disks.
- Add rate limiting to `/api/auth/*` (for example `express-rate-limit`) and lock the API to your own domain.
- Load-test with about 100 browsers. LiveKit server capacity is the limit, not this UI.
- For webinar-style meetings, set `canPublish: false` for non-hosts in `server/index.js`, and let the host promote speakers.
- Browser subtitles are uneven in noisy rooms. For consistent quality, add server-side speech-to-text with LiveKit Agents and send the same `{ text, final }` message on the `captions` topic.
- Same account in two tabs: the newer tab replaces the older one (identity is the user ID).

## 8. Troubleshooting

- "Missing settings" on start: `.env` is missing or a value is blank.
- "Can't join": check `LIVEKIT_URL` begins with `wss://` and the key/secret match the project.
- No camera prompt: the page must be on localhost or HTTPS.
- Package-version errors: run `npm install` again, and check the installed `@livekit/components-react` version if a hook name is reported missing.
