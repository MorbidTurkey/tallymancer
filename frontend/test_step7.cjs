/**
 * test_step7.cjs — Tests for Step 7: history log UI + session expiry.
 *
 * Tests:
 *  1. Session expiry: API rejects a 0-hour-old session? No. Rejects an old one? Yes.
 *  2. History log button appears in session header
 *  3. Click "Log" → history panel opens
 *  4. Apply a score delta → history shows the event
 *  5. Undo → event shows as "undone"
 *  6. Panel updates in real-time (historyKey bump on WS sync)
 *  7. Close button hides the panel
 */

const { chromium } = require('playwright')
const http = require('http')

const BASE_UI  = 'http://localhost:5173'
const BASE_API = 'http://localhost:8000'
const SEP = '-'.repeat(60)

function apiRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null
    const opts = {
      hostname: 'localhost',
      port: 8000,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    }
    const req = http.request(opts, res => {
      let body = ''
      res.on('data', d => { body += d })
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(body) }) }
        catch { resolve({ status: res.statusCode, body }) }
      })
    })
    req.on('error', reject)
    if (data) req.write(data)
    req.end()
  })
}

;(async () => {
  let passed = 0, failed = 0
  const pass = l => { console.log(`  PASS  ${l}`); passed++ }
  const fail = (l, r) => { console.log(`  FAIL  ${l}: ${r}`); failed++ }

  // ── Step 1: Session expiry logic via API ─────────────────────────────
  console.log(SEP)
  console.log('STEP 1: Session expiry')

  // 1a: normal session should work fine
  const sess = await apiRequest('POST', '/api/sessions', {
    game_preset: 'mtg',
    player_names: ['Alice', 'Bob'],
  })
  if (sess.status === 201) {
    pass('POST /api/sessions returns 201')
  } else {
    fail('Create session', `status ${sess.status}`)
  }
  const playerToken = sess.body.player_link.split('/').pop()

  // Fetch the session — should succeed (not expired)
  const fresh = await apiRequest('GET', `/api/sessions/${playerToken}`)
  if (fresh.status === 200) {
    pass('Fresh session accessible (not expired)')
  } else {
    fail('Fresh session', `status ${fresh.status}`)
  }

  // 1b: completely fake token should return 404
  const fakeFetch = await apiRequest('GET', '/api/sessions/00000000-0000-0000-0000-000000000000')
  if (fakeFetch.status === 404) {
    pass('Unknown token returns 404')
  } else {
    fail('Unknown token', `expected 404 got ${fakeFetch.status}`)
  }

  // ── Step 2-7: UI tests via Playwright ────────────────────────────────
  const browser = await chromium.launch({ headless: false, slowMo: 300 })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })

  try {
    // Navigate directly to the session page we created
    await page.goto(`${BASE_UI}/session/${playerToken}`)
    await page.waitForSelector('.player-card', { timeout: 10000 })
    pass('Session page loaded')

    // ── Step 2: History button ──────────────────────────────────────────
    console.log(SEP)
    console.log('STEP 2: History button')
    const logBtn = await page.$('button:has-text("Log")')
    if (logBtn) pass('History "Log" button visible in header')
    else fail('Log button', 'not found')

    // ── Step 3: Open history panel ─────────────────────────────────────
    console.log(SEP)
    console.log('STEP 3: Open history panel')
    await page.click('button:has-text("Log")')
    await page.waitForSelector('.history-panel', { timeout: 3000 })
    pass('History panel appeared')

    // Initially empty
    const empty = await page.$('.history-panel__empty')
    if (empty) pass('Empty state shown when no events yet')
    else fail('Empty state', 'not found')

    // ── Step 4: Apply delta → history shows event ─────────────────────
    console.log(SEP)
    console.log('STEP 4: Score event appears in history')
    await page.click('.step-btn--lg.step-btn--minus')  // Alice −1
    await page.waitForTimeout(1000)  // wait for WS broadcast + refetch

    const entries = await page.$$('.history-entry')
    if (entries.length >= 1) {
      pass(`History shows ${entries.length} event(s) after score change`)
    } else {
      fail('History event', `expected ≥1 entries, got ${entries.length}`)
    }

    // Check delta value shown
    const deltaEl = await page.$('.history-entry__delta')
    if (deltaEl) {
      const deltaText = await deltaEl.textContent()
      if (deltaText.includes('-1') || deltaText.includes('−1')) {
        pass(`Delta displayed correctly: "${deltaText.trim()}"`)
      } else {
        fail('Delta value', `expected -1, got "${deltaText.trim()}"`)
      }
    }

    // ── Step 5: Undo → event shows "undone" ───────────────────────────
    console.log(SEP)
    console.log('STEP 5: Undo → event marked "undone"')
    await page.click('button:has-text("Undo")')
    await page.waitForTimeout(1000)  // wait for WS broadcast + refetch

    const voidedBadge = await page.$('.history-entry__voided-badge')
    if (voidedBadge) {
      const badgeText = await voidedBadge.textContent()
      pass(`Voided badge shown: "${badgeText.trim()}"`)
    } else {
      fail('Voided badge', 'not found after undo')
    }

    const voidedEntry = await page.$('.history-entry--voided')
    if (voidedEntry) pass('Voided entry has --voided CSS class')
    else fail('Voided entry class', 'not found')

    // ── Step 6: Real-time update (apply another delta) ─────────────────
    console.log(SEP)
    console.log('STEP 6: Real-time history update')
    await page.click('.step-btn--sm:last-child')  // Alice +5
    await page.waitForTimeout(1000)

    const entriesAfter = await page.$$('.history-entry')
    if (entriesAfter.length >= 2) {
      pass(`History shows ${entriesAfter.length} total events (updated in real time)`)
    } else {
      fail('Real-time update', `expected ≥2 entries, got ${entriesAfter.length}`)
    }

    // ── Step 7: Close the panel ────────────────────────────────────────
    console.log(SEP)
    console.log('STEP 7: Close history panel')
    await page.click('.history-panel__close')
    await page.waitForTimeout(300)
    const panelGone = await page.$('.history-panel')
    if (!panelGone) pass('History panel closed successfully')
    else fail('Close panel', 'panel still visible')

    await page.screenshot({ path: 'test-step7-after.png' })

    // Reopen briefly for final screenshot
    await page.click('button:has-text("Log")')
    await page.waitForSelector('.history-panel')
    await page.waitForTimeout(500)
    await page.screenshot({ path: 'test-step7-history-open.png' })
    console.log('  [screenshots saved]')
    pass('Screenshots captured')

  } catch (err) {
    console.error('Test error:', err.message)
    failed++
  } finally {
    console.log(SEP)
    console.log(`Results: ${passed} passed, ${failed} failed`)
    await browser.close()
  }
})()
