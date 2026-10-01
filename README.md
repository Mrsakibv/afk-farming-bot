# Butterfly AFK Bot — Railway 24/7

## 1. Create the Discord login state locally
Run on your own Windows PC:

```powershell
npm install
npx playwright install chromium
node login.js
```

A Chromium window opens. Log in with Discord, make sure the AFK page is logged in, then press ENTER in the terminal. This creates `storage-state.json`.

## 2. Convert the state to Base64
PowerShell:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("storage-state.json")) | Set-Clipboard
```

The result is now in your clipboard. Keep it private: it contains authenticated session data.

## 3. Railway
Create a Railway service from this project. It uses the included Dockerfile.

Set these variables:

- `WEBSITE=https://dash.drexhost.in/afk`
- `AUTH_STATE_B64=<the Base64 value from step 2>`
- `BROWSER_PROFILE=/data/browser-profile`
- `STORAGE_STATE_FILE=/data/storage-state.json`
- `MOVE_DELAY=2500`
- `BOT_WAIT=1800`

Attach a persistent Railway Volume mounted at `/data` so refreshed session state survives restarts.

## 4. Start
The service runs:

```text
npm start
```

The bot runs Chromium headless, waits for `Your turn (X)`, waits 2.5 seconds, chooses a random available cell, waits for the bot move, and clicks Restart when a game finishes. It continuously recovers from page errors/reloads.

## Security
Never commit `storage-state.json`, cookies, Discord tokens, or Base64 auth state to GitHub. Treat `AUTH_STATE_B64` as a secret.

## If Discord session expires
Run `node login.js` locally again, create a fresh Base64 value, and replace the Railway `AUTH_STATE_B64` variable.
