const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const http = require('http');

const WEBSITE = process.env.WEBSITE || 'https://dash.drexhost.in/afk';
const PROFILE = process.env.BROWSER_PROFILE || '/data/browser-profile';
const STORAGE_STATE = process.env.STORAGE_STATE_FILE || '/data/storage-state.json';
const PORT = Number(process.env.PORT || 8080);
const MOVE_DELAY = Number(process.env.MOVE_DELAY || 2500);
const BOT_WAIT = Number(process.env.BOT_WAIT || 1800);

let currentStatus = 'starting';
let lastError = null;
let pageRef = null;

function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

function startHealthServer() {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      status: currentStatus,
      website: WEBSITE,
      lastError,
      uptime: Math.floor(process.uptime())
    }));
  });
  server.listen(PORT, '0.0.0.0', () => log(`Health server listening on :${PORT}`));
}

async function clickIfVisible(page, name) {
  const button = page.getByRole('button', { name, exact: true });
  if (await button.count() && await button.first().isVisible().catch(() => false)) {
    await button.first().click();
    return true;
  }
  return false;
}

async function startAfk(page) {
  currentStatus = 'starting-afk';
  log('Checking AFK state...');

  if (await clickIfVisible(page, 'Stop AFK')) {
    log('AFK is already running.');
    return true;
  }

  if (await clickIfVisible(page, 'Start AFK')) {
    log('Start AFK clicked.');
    await page.waitForTimeout(1000);
    return true;
  }

  await page.screenshot({ path: '/tmp/afk-error.png', fullPage: true }).catch(() => {});
  throw new Error('Start AFK / Stop AFK button was not found. Check login/session and website UI.');
}

async function waitForTurn(page) {
  const turn = page.getByText('Your turn (X)', { exact: true });
  try {
    await turn.waitFor({ state: 'visible', timeout: 60000 });
    return true;
  } catch {
    return false;
  }
}

async function clickRandomAvailableCell(page) {
  const indexes = Array.from({ length: 9 }, (_, i) => i + 1)
    .sort(() => Math.random() - 0.5);

  for (const i of indexes) {
    const cell = page.getByRole('button', { name: `Cell ${i}`, exact: true });
    if (!await cell.count()) continue;
    if (!await cell.isVisible().catch(() => false)) continue;
    if (!await cell.isEnabled().catch(() => false)) continue;

    await cell.click();
    log(`Clicked Cell ${i}.`);
    return true;
  }
  return false;
}

async function restartIfFinished(page) {
  for (let i = 0; i < 8; i++) {
    if (await clickIfVisible(page, 'Restart')) {
      log('Restart clicked.');
      await page.waitForTimeout(1000);
      return true;
    }
    await page.waitForTimeout(500);
  }
  return false;
}

async function runBot() {
  fs.mkdirSync(path.dirname(PROFILE), { recursive: true });
  currentStatus = 'launching-browser';

  const contextOptions = {
    headless: true,
    viewport: { width: 1280, height: 900 },
    args: [
      '--disable-dev-shm-usage',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu'
    ]
  };

  // Railway starts from a clean container. Seed the saved auth state from a
  // Railway environment variable on the first boot, then keep refreshing it
  // on the persistent /data volume.
  if (!fs.existsSync(STORAGE_STATE) && process.env.AUTH_STATE_B64) {
    try {
      const json = Buffer.from(process.env.AUTH_STATE_B64, 'base64').toString('utf8');
      JSON.parse(json); // validate before writing
      fs.writeFileSync(STORAGE_STATE, json, 'utf8');
      log('Authentication state initialized from AUTH_STATE_B64.');
    } catch (e) {
      throw new Error(`AUTH_STATE_B64 is invalid: ${e.message}`);
    }
  }

  let context;
  if (fs.existsSync(STORAGE_STATE)) {
    log(`Using saved authentication state: ${STORAGE_STATE}`);
    context = await chromium.launch(contextOptions).then(browser =>
      browser.newContext({ storageState: STORAGE_STATE, viewport: contextOptions.viewport })
    );
  } else {
    throw new Error('No authentication state found. Run `node login.js` locally, then set AUTH_STATE_B64 on Railway.');
  }

  context.on('page', p => { pageRef = p; });
  const pages = context.pages();
  const page = pages[0] || await context.newPage();
  pageRef = page;

  setInterval(async () => {
    try {
      await context.storageState({ path: STORAGE_STATE });
      log('Authentication state refreshed.');
    } catch (e) {
      log(`Could not refresh authentication state: ${e.message}`);
    }
  }, 5 * 60 * 1000);

  page.on('pageerror', err => log(`PAGE ERROR: ${err.message}`));

  while (true) {
    try {
      currentStatus = 'opening-website';
      log(`Opening ${WEBSITE}`);
      await page.goto(WEBSITE, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(2500);

      await startAfk(page);
      currentStatus = 'afk-running';

      let round = 0;
      while (true) {
        round++;
        log(`Round ${round}: waiting for your turn...`);

        const turnFound = await waitForTurn(page);
        if (!turnFound) {
          if (await clickIfVisible(page, 'Start AFK')) {
            log('AFK stopped; Start AFK clicked again.');
            continue;
          }
          if (await clickIfVisible(page, 'Restart')) {
            log('Restart found while waiting.');
            continue;
          }
          // Check whether session/login expired.
          const bodyText = await page.locator('body').innerText().catch(() => '');
          if (/login|sign in|discord/i.test(bodyText) && !/your turn/i.test(bodyText)) {
            throw new Error('Login/session appears to have expired on the AFK page.');
          }
          continue;
        }

        await page.waitForTimeout(MOVE_DELAY);
        const clicked = await clickRandomAvailableCell(page);
        if (!clicked) {
          await page.waitForTimeout(700);
          continue;
        }

        await page.waitForTimeout(BOT_WAIT);
        if (await restartIfFinished(page)) {
          log('New game started.');
        }
      }
    } catch (error) {
      lastError = error.message;
      currentStatus = 'recovering';
      log(`BOT ERROR: ${error.message}`);
      await page.screenshot({ path: '/tmp/afk-error.png', fullPage: true }).catch(() => {});
      await new Promise(r => setTimeout(r, 5000));
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}

startHealthServer();
runBot().catch(error => {
  lastError = error.message;
  currentStatus = 'fatal-error';
  console.error(error);
  process.exit(1);
});
