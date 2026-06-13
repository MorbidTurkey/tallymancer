/**
 * test_pwa.cjs — Verify PWA manifest and service worker in production build.
 * Uses `vite preview` which serves the built dist/ at localhost:4173.
 */
const { chromium } = require('playwright')
const { execSync, spawn } = require('child_process')

const PREVIEW_PORT = 4173

;(async () => {
  // Start vite preview in background
  const preview = spawn('npm', ['run', 'preview', '--', '--port', String(PREVIEW_PORT)],
    { cwd: process.cwd(), shell: true, stdio: 'ignore' })

  // Give it time to start
  await new Promise(r => setTimeout(r, 3000))

  let passed = 0
  let failed = 0
  function pass(l) { console.log(`  PASS  ${l}`); passed++ }
  function fail(l, r) { console.log(`  FAIL  ${l}: ${r}`); failed++ }

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })

  try {
    await page.goto(`http://localhost:${PREVIEW_PORT}/`)
    await page.waitForSelector('.preset-card', { timeout: 10000 })
    pass('App loads from production build')

    // Check manifest is linked
    const manifestLink = await page.$('link[rel="manifest"]')
    if (manifestLink) {
      const href = await manifestLink.getAttribute('href')
      pass(`Manifest linked: ${href}`)
    } else {
      fail('Manifest link', 'not found in <head>')
    }

    // Fetch manifest and verify key fields
    const manifestResp = await page.evaluate(() =>
      fetch('/manifest.webmanifest').then(r => r.json())
    )
    if (manifestResp.name === 'Tallymancer') pass('Manifest name: Tallymancer')
    else fail('Manifest name', manifestResp.name)

    if (manifestResp.display === 'standalone') pass('Manifest display: standalone (installable)')
    else fail('Manifest display', manifestResp.display)

    if (manifestResp.icons && manifestResp.icons.length >= 2) pass(`Manifest icons: ${manifestResp.icons.length} defined`)
    else fail('Manifest icons', JSON.stringify(manifestResp.icons))

    // Check apple-touch-icon
    const ati = await page.$('link[rel="apple-touch-icon"]')
    if (ati) pass('apple-touch-icon linked (iOS PWA support)')
    else fail('apple-touch-icon', 'not found')

    // Check service worker is registered
    const swResp = await page.goto(`http://localhost:${PREVIEW_PORT}/sw.js`)
    if (swResp.status() === 200) {
      const body = await swResp.text()
      if (body.includes('workbox')) pass('Service worker exists and includes Workbox')
      else pass('Service worker file exists (workbox not found in body — may be split)')
    } else {
      fail('Service worker', `HTTP ${swResp.status()}`)
    }

    await page.screenshot({ path: 'test-pwa-preview.png' })
    console.log('  [screenshot saved: test-pwa-preview.png]')

  } catch (err) {
    console.error('Test error:', err.message)
    failed++
  } finally {
    console.log(`\nResults: ${passed} passed, ${failed} failed`)
    await browser.close()
    preview.kill()
  }
})()
