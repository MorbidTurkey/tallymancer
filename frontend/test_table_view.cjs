/**
 * test_table_view.js — Visual test for Step 5: table view rotation mode.
 *
 * Tests:
 *  1. Create a 2-player MTG session
 *  2. "⊞ Table" button appears in header
 *  3. Click "⊞ Table" → table view overlay covers the screen
 *  4. Two player cells visible, no header
 *  5. Exit button visible in center
 *  6. Score +1 in table view → score updates
 *  7. Click exit → back to normal list view
 *
 * Run from frontend/ with: node test_table_view.js
 */

const { chromium } = require('playwright')

const BASE = 'http://localhost:5173'
const SEP = '-'.repeat(60)

;(async () => {
  let passed = 0
  let failed = 0

  function pass(label) { console.log(`  PASS  ${label}`); passed++ }
  function fail(label, reason) { console.log(`  FAIL  ${label}: ${reason}`); failed++ }

  const browser = await chromium.launch({ headless: false, slowMo: 400 })
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await context.newPage()

  try {
    // ── Step 1: Create 2-player session ────────────────────────────────
    console.log(SEP)
    console.log('STEP 1: Create session')
    await page.goto(BASE)
    await page.waitForSelector('.preset-card')

    // Select MTG preset
    await page.click('.preset-card:first-child')

    // Set two player names (class is name-input, there are 2 slots by default)
    const inputs = await page.$$('.name-row .name-input')
    await inputs[0].fill('Alice')
    await inputs[1].fill('Bob')

    // Submit
    await page.click('button[type="submit"]')
    await page.waitForSelector('.player-card')

    pass('Session created with 2 players')

    // ── Step 2: Table button visible ───────────────────────────────────
    console.log(SEP)
    console.log('STEP 2: Check Table button')
    const tableBtn = await page.waitForSelector('button:has-text("Table")')
    if (tableBtn) {
      pass('Table button visible in header')
    } else {
      fail('Table button', 'not found')
    }

    // ── Step 3: Enter table view ────────────────────────────────────────
    console.log(SEP)
    console.log('STEP 3: Enter table view')
    await page.click('button:has-text("Table")')
    await page.waitForSelector('.table-view')
    pass('Table view overlay appeared')

    // ── Step 4: Check layout ────────────────────────────────────────────
    console.log(SEP)
    console.log('STEP 4: Check cell layout')
    const cells = await page.$$('.table-cell')
    if (cells.length === 2) {
      pass(`2 table cells rendered (one per player)`)
    } else {
      fail('Table cells', `expected 2 got ${cells.length}`)
    }

    // Check that PlayerCard is inside each cell
    const cardsInCells = await page.$$('.table-cell .player-card')
    if (cardsInCells.length === 2) {
      pass('Player cards present inside table cells')
    } else {
      fail('Player cards in cells', `expected 2 got ${cardsInCells.length}`)
    }

    // Verify the second cell has rotation applied (CSS var --rotation)
    const secondCell = await page.$('.table-cell:nth-child(2) .table-cell__inner')
    const rotation = await secondCell.evaluate(el => el.style.getPropertyValue('--rotation'))
    if (rotation === '180deg') {
      pass('Second cell has --rotation: 180deg (top player flipped)')
    } else {
      fail('Second cell rotation', `expected 180deg got "${rotation}"`)
    }

    // ── Step 5: Exit button visible ─────────────────────────────────────
    console.log(SEP)
    console.log('STEP 5: Exit button')
    const exitBtn = await page.$('.table-exit-btn')
    if (exitBtn) {
      const text = await exitBtn.textContent()
      pass(`Exit button visible: "${text.trim()}"`)
    } else {
      fail('Exit button', 'not found')
    }

    // ── Step 6: Score update works in table view ─────────────────────────
    console.log(SEP)
    console.log('STEP 6: Score change in table view')

    // Get Alice's score before
    const scoresBefore = await page.$$eval('.table-cell .player-card__score', els => els.map(e => parseInt(e.textContent)))
    console.log('  Scores before:', scoresBefore)

    // Click +1 in first cell
    const plusBtn = await page.$('.table-cell:first-child .step-btn--plus')
    if (plusBtn) {
      await plusBtn.click()
      await page.waitForTimeout(800) // wait for WS broadcast
      const scoresAfter = await page.$$eval('.table-cell .player-card__score', els => els.map(e => parseInt(e.textContent)))
      console.log('  Scores after:', scoresAfter)
      if (scoresAfter[0] === scoresBefore[0] + 1) {
        pass('Score incremented by 1 in table view')
      } else {
        fail('Score update', `expected ${scoresBefore[0]+1} got ${scoresAfter[0]}`)
      }
    } else {
      fail('Plus button in table cell', 'not found')
    }

    // ── Step 7: Exit table view ──────────────────────────────────────────
    console.log(SEP)
    console.log('STEP 7: Exit table view')
    await page.click('.table-exit-btn')
    await page.waitForSelector('.player-grid')
    const tableGone = await page.$('.table-view')
    if (!tableGone) {
      pass('Table view overlay removed after exit')
    } else {
      fail('Exit table view', 'overlay still present')
    }

    // Normal list view should show player cards
    const normalCards = await page.$$('.player-grid .player-card')
    if (normalCards.length === 2) {
      pass('Normal player grid restored with 2 cards')
    } else {
      fail('Normal player grid', `expected 2 got ${normalCards.length}`)
    }

    // Screenshot after exit
    await page.screenshot({ path: 'test-step5-after-exit.png' })
    console.log('  [screenshot saved: test-step5-after-exit.png]')

    // ── Step 8: Screenshot of table view (go back in) ───────────────────
    console.log(SEP)
    console.log('STEP 8: Screenshot table view')
    await page.click('button:has-text("Table")')
    await page.waitForSelector('.table-view')
    await page.screenshot({ path: 'test-step5-table-view.png' })
    console.log('  [screenshot saved: test-step5-table-view.png]')
    pass('Table view screenshot captured')

  } catch (err) {
    console.error('Test error:', err.message)
    failed++
  } finally {
    console.log(SEP)
    console.log(`Results: ${passed} passed, ${failed} failed`)
    await browser.close()
  }
})()
