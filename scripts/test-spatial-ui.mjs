/**
 * The new interface, in a real browser.
 *
 * Drives the rebuilt editor the way a person would: sign in, open a plan, move
 * through the left rail, build something, read the cost, run the check, and
 * search for a feature by name. Every assertion is about what is on screen,
 * because the API suite already covers what the server does.
 *
 * Console errors are collected throughout and asserted at the end — a panel
 * that renders but throws on every frame is broken, and nothing else here
 * would catch it.
 *
 * Run with the dev servers up:  node scripts/test-spatial-ui.mjs
 */
import { chromium } from 'playwright';

const WEB = process.env.WEB_BASE ?? 'http://localhost:5174';
const EMAIL = process.env.DEMO_EMAIL ?? 'planner@novira.test';
const PASSWORD = process.env.DEMO_PASSWORD ?? 'novira123';
const API = process.env.API_BASE ?? 'http://localhost:4100/api';

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1680, height: 1000 } });
  const page = await context.newPage();

  /*
   * Errors are collected rather than failing immediately: a single benign
   * warning should not stop the run, but a panel that throws must be reported.
   * WebGL messages are filtered because the headless browser has no GPU and
   * says so loudly, which is expected here and not a fault in the product.
   */
  const errors = [];
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (/WebGL|GPU stall|THREE.WebGLRenderer|Failed to load resource/i.test(text)) return;
    errors.push(text);
  });
  page.on('pageerror', (error) => errors.push(String(error)));

  try {
    /* ── Sign in ───────────────────────────────────────────────────── */
    console.log('\nNovira — interface end-to-end\n');
    console.log('Signing in');
    await page.goto(`${WEB}/login`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#email', { timeout: 20_000 });
    await page.fill('input[type="email"]', EMAIL);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL(/dashboard/, { timeout: 20_000 });
    // The header paints a beat after the route resolves; asserting before that
    // tests the loading state rather than the navigation.
    await page.waitForSelector('nav[aria-label="Primary"]', { timeout: 20_000 });
    check('signs in and lands on the dashboard', page.url().includes('dashboard'));

    /* ── Navigation ────────────────────────────────────────────────── */
    console.log('\nNavigation');
    check('the header offers Venues', (await page.locator('a[href="/venues"]').count()) > 0);
    check('the header offers a Business menu', (await page.getByRole('button', { name: /Business/ }).count()) > 0);

    await page.getByRole('button', { name: /Business/ }).first().click();
    await page.waitForTimeout(200);
    check('the Business menu lists Rates', (await page.locator('a[href="/rate-cards"]').count()) > 0);
    check('the Business menu lists Insights', (await page.locator('a[href="/insights"]').count()) > 0);
    check('the Business menu lists the Marketplace', (await page.locator('a[href="/marketplace"]').count()) > 0);
    check('the Business menu lists Specialists', (await page.locator('a[href="/specialists"]').count()) > 0);
    await page.keyboard.press('Escape');
    await page.mouse.click(10, 400);

    /* ── Command palette ───────────────────────────────────────────── */
    console.log('\nCommand palette');
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(300);
    check('opens on Ctrl+K', (await page.getByRole('dialog', { name: 'Command palette' }).count()) > 0);

    /*
     * Searched from the dashboard, so the commands that need an open plan are
     * correctly absent — the estimator is checked inside the editor below.
     */
    await page.keyboard.type('venue');
    await page.waitForTimeout(400);
    const venueOption = page.locator('[role="option"]').first();
    check('typing a plain word finds the feature', (await venueOption.textContent())?.toLowerCase().includes('venue'));

    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    check('closes on Escape', (await page.getByRole('dialog', { name: 'Command palette' }).count()) === 0);

    /* ── The new pages ─────────────────────────────────────────────── */
    console.log('\nThe new pages');
    for (const [path, heading] of [
      ['/venues', 'Venues'],
      ['/rate-cards', 'Your rates'],
      ['/insights', 'Insights'],
      ['/marketplace', 'Marketplace'],
      ['/specialists', 'Specialists'],
      ['/help', 'How Novira works'],
    ]) {
      await page.goto(`${WEB}${path}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(400);
      check(`${path} renders`, (await page.getByRole('heading', { name: heading, level: 1 }).count()) > 0);
    }

    /* ── ROI calculator ────────────────────────────────────────────── */
    console.log('\nROI calculator');
    await page.goto(`${WEB}/insights`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('tab', { name: /ROI calculator/ }).click();
    await page.waitForTimeout(400);
    check('the calculator renders', (await page.getByText(/Break-even needs/).count()) > 0);
    check('it states its assumptions', (await page.getByText(/These are your figures, not benchmarks/).count()) > 0);

    /* ── Help and accessibility ────────────────────────────────────── */
    console.log('\nHelp and accessibility');
    await page.goto(`${WEB}/help`, { waitUntil: 'domcontentloaded' });
    check('help explains how to move around', (await page.getByText(/How do I look around/).count()) > 0);
    check('help lists keyboard shortcuts', (await page.locator('#shortcuts').count()) > 0);
    check('help offers text-size settings', (await page.getByText('Text size').count()) > 0);

    await page.getByRole('radio', { name: 'Large', exact: true }).click();
    await page.waitForTimeout(200);
    check('text size applies to the document', (await page.getAttribute('html', 'data-text-size')) === 'large');

    await page.getByRole('switch', { name: /High contrast/ }).click();
    await page.waitForTimeout(200);
    check('high contrast applies to the document', (await page.getAttribute('html', 'data-contrast')) === 'high');

    // Put it back, so the editor screenshots below are at the normal size.
    await page.getByRole('radio', { name: 'Normal', exact: true }).click();
    await page.getByRole('switch', { name: /High contrast/ }).click();

    /* ── A plan ────────────────────────────────────────────────────── */
    console.log('\nThe editor');

    /*
     * The project and plan are created through the API rather than the UI.
     * Creating them by clicking is already covered by the existing suites, and
     * doing it again here would make this run fail for reasons that have
     * nothing to do with the interface it exists to test.
     */
    const session = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    }).then((r) => r.json());

    const authed = (path, body, method = 'POST') =>
      fetch(`${API}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }).then((r) => r.json());

    const project = await authed('/projects', { title: `UI check ${Date.now()}` });
    const plan = await authed('/plans', { projectId: project.id, title: 'Interface check' });

    await page.goto(`${WEB}/editor/${plan.id}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('nav[aria-label="Editor sections"]', { timeout: 30_000 });
    await page.waitForTimeout(3000);
    check('the editor opens', page.url().includes('/editor/'));

    // The guided tour appears on a first run. Wait for it rather than sampling
    // once — it is deliberately delayed so the editor has painted first.
    const skipTour = page.getByRole('button', { name: 'Skip the tour' });
    let tourAppeared = false;
    try {
      await skipTour.waitFor({ timeout: 8000 });
      tourAppeared = true;
      await skipTour.click();
      await page.waitForTimeout(400);
    } catch {
      tourAppeared = false;
    }
    check('the guided tour appears for a new user', tourAppeared);

    /* ── The rail ──────────────────────────────────────────────────── */
    console.log('\nThe left rail');
    const rail = page.getByRole('navigation', { name: 'Editor sections' });
    check('the rail is present', (await rail.count()) > 0);
    for (const label of ['Create', 'Build', 'Finish', 'Site', 'Light', 'Cost', 'Check', 'Present', 'Review']) {
      check(`the rail offers ${label}`, (await rail.getByRole('button', { name: new RegExp(`^${label}`) }).count()) > 0);
    }

    /*
     * Properties are no longer a rail section — they live in the right-hand
     * dock, permanently, beside the object being edited. The assistant is no
     * longer one either; it floats over the plan.
     */
    check(
      'the properties dock is present',
      (await page.locator('aside[aria-label="Properties and simulation"]').count()) > 0
    );
    check(
      'the assistant is reachable from the plan',
      (await page.getByRole('button', { name: /Open the design assistant/ }).count()) > 0
    );
    /*
     * The starting-point drawer is opened from the bottom toolbar rather than
     * living open across the bottom — it used to cost 170 px of plan for
     * something most people open twice in a project.
     */
    await page.getByRole('button', { name: /Start from/ }).click();
    await page.waitForTimeout(700);
    check(
      'the templates drawer opens from the bottom bar',
      (await page.locator('section[aria-label="Templates and starting points"]').count()) > 0
    );
    check(
      'the view controls are on the bottom bar',
      (await page.getByRole('button', { name: /^Plan$/ }).count()) > 0 &&
        (await page.getByRole('button', { name: /^Environment$/ }).count()) > 0
    );

    /* ── Build a truss ─────────────────────────────────────────────── */
    console.log('\nBuilding');
    await rail.getByRole('button', { name: /^Build/ }).click();
    await page.waitForTimeout(600);
    check('the build panel explains itself', (await page.getByText(/What are you building/).count()) > 0);

    await page.getByRole('radio', { name: /Truss/ }).first().click();
    await page.waitForTimeout(500);
    check('the truss builder offers shapes', (await page.getByText('Goalpost').count()) > 0);

    await page.getByRole('button', { name: /Goalpost/ }).first().click();
    await page.waitForTimeout(1200);
    check('placing a truss shows its derived length', (await page.getByText('Total length').count()) > 0);
    check('it reports the longest span', (await page.getByText('Longest span').count()) > 0);
    check('it reports the load per support', (await page.getByText('Per support').count()) > 0);
    check('it confirms the section is within limits', (await page.getByText(/Within the section/).count()) > 0);

    /* ── Add a screen ──────────────────────────────────────────────── */
    await page.getByRole('radio', { name: /^LED/ }).first().click();
    await page.waitForTimeout(500);
    check('the LED builder offers real presets', (await page.getByText('Summit main screen').count()) > 0);
    await page.getByRole('button', { name: /Summit main screen/ }).first().click();
    await page.waitForTimeout(1200);
    check('the screen reports what was actually built', (await page.getByText(/Built as/).count()) > 0);
    check('it reports the resolution', (await page.getByText('Resolution').count()) > 0);
    check('it reports the peak power', (await page.getByText('Peak power').count()) > 0);
    check('it reports the closest viewer distance', (await page.getByText('Closest viewer').count()) > 0);

    /* ── Light it ──────────────────────────────────────────────────── */
    console.log('\nLighting');
    await rail.getByRole('button', { name: /^Light/ }).click();
    await page.waitForTimeout(600);
    check('the looks are offered', (await page.getByText('Corporate summit').count()) > 0);
    check('Auto Light Scene is the primary control', (await page.getByRole('button', { name: /Light this scene/ }).count()) > 0);

    await page.getByRole('button', { name: /Light this scene/ }).click();
    await page.waitForTimeout(2000);
    check('lighting the scene rigs fixtures', (await page.getByText(/Fixtures \(/).count()) > 0);
    check('it reports the power load', (await page.getByText('Total load').count()) > 0);
    check('it reports the circuits needed', (await page.getByText('Circuits').count()) > 0);

    /* ── Cost ──────────────────────────────────────────────────────── */
    console.log('\nCost');
    await rail.getByRole('button', { name: /^Cost/ }).click();
    await page.getByText('The headline figures').waitFor({ timeout: 20_000 }).catch(() => {});
    check('the headline quantities are shown', (await page.getByText('The headline figures').count()) > 0);
    check('LED area is measured', (await page.getByText(/^LED$/).count()) > 0);
    check('truss length is measured', (await page.getByText(/^Truss$/).count()) > 0);
    check('labour is derived', (await page.getByText(/^Labour$/).count()) > 0);
    check('the default rates are labelled as a starting point', (await page.getByText(/default rates/).count()) > 0);

    /* ── Check ─────────────────────────────────────────────────────── */
    console.log('\nDesign check');
    await rail.getByRole('button', { name: /^Check/ }).click();
    /*
     * Waited for rather than slept on. The review endpoint runs the layout
     * checks server-side, and a fixed delay is a guess that is sometimes wrong
     * — which produces a failing assertion about working code.
     */
    await page.getByText('Design score').waitFor({ timeout: 20_000 }).catch(() => {});
    check('a design score is shown', (await page.getByText('Design score').count()) > 0);
    check('site constraints are summarised', (await page.getByText('Site constraints').count()) > 0);
    check('the local rules are named', (await page.getByText('Local rules').count()) > 0);

    /* ── The assistant ─────────────────────────────────────────────── */
    console.log('\nAI');
    await page.getByRole('button', { name: /Open the design assistant/ }).click();
    await page.waitForTimeout(700);
    check('the assistant opens', (await page.getByRole('dialog', { name: 'Design assistant' }).count()) > 0);
    check(
      'it offers openers to start from',
      (await page.getByText(/What is in my plan/).count()) > 0
    );

    await page.getByRole('button', { name: /^Layout$/ }).click();
    await page.waitForTimeout(500);
    check('the deterministic layout engine is offered', (await page.getByText(/A gala dinner for 220/).count()) > 0);

    await page.getByRole('button', { name: /^Brief$/ }).click();
    await page.waitForTimeout(700);
    check('the concept generator is offered', (await page.getByText('Describe the event').count()) > 0);

    await page.locator('textarea').first().fill('Gala dinner for 300 with round tables, a dance floor and a small stage');
    await page.waitForTimeout(900);
    check('a free preview appears as you type', (await page.getByText('What it understood').count()) > 0);
    check('it reads the attendance', (await page.getByText('300 people').count()) > 0);
    check('every element explains itself', (await page.getByText(/What will be placed/).count()) > 0);

    /* ── Present ───────────────────────────────────────────────────── */
    console.log('\nPresent');
    await rail.getByRole('button', { name: /^Present/ }).click();
    await page.waitForTimeout(800);
    check('images, video and documents are offered', (await page.getByRole('radio', { name: /Documents/ }).count()) > 0);
    check('the fast render is free and explained', (await page.getByText('Fast render').count()) > 0);
    check('pro render states what it actually is', (await page.getByText(/not a physically accurate/).count()) > 0);

    await page.getByRole('radio', { name: /Video/ }).click();
    await page.waitForTimeout(600);
    check('walkthrough styles are offered', (await page.getByText('Cinematic').count()) > 0);

    await page.getByRole('button', { name: /Generate the shots/ }).click();
    await page.waitForTimeout(1500);
    check('generating produces a shot list', (await page.getByText(/Shots \(/).count()) > 0);
    check('playback controls appear', (await page.getByRole('button', { name: /^Play/ }).count()) > 0);

    await page.getByRole('radio', { name: /Documents/ }).click();
    await page.getByRole('img', { name: 'Plan drawing' }).waitFor({ timeout: 20_000 }).catch(() => {});
    check('the plan drawing is previewed', (await page.getByRole('img', { name: 'Plan drawing' }).count()) > 0);
    check('CAD export is offered', (await page.getByText(/CAD drawing/).count()) > 0);
    check('the material breakdown is shown', (await page.getByText('Material breakdown').count()) > 0);

    /* ── Review ────────────────────────────────────────────────────── */
    console.log('\nReview');
    await rail.getByRole('button', { name: /^Review/ }).click();
    await page.waitForTimeout(800);
    check('comments, versions and compare are all here', (await page.getByRole('tab', { name: /Versions/ }).count()) > 0);
    check('the internal/client distinction is offered', (await page.getByText(/Who sees this/).count()) > 0);

    await page.getByRole('tab', { name: /Versions/ }).click();
    await page.waitForTimeout(400);
    check('saving a version is explained', (await page.getByText(/Save this version/).count()) > 0);

    /* ── Site ──────────────────────────────────────────────────────── */
    console.log('\nSite');
    await rail.getByRole('button', { name: /^Site/ }).click();
    await page.getByText('Draw a constraint').waitFor({ timeout: 20_000 }).catch(() => {});
    check('the venue library is offered first', (await page.getByText('The venue').count()) > 0);
    check('constraints can be drawn', (await page.getByText('Draw a constraint').count()) > 0);
    check('rigging points are offered', (await page.getByText('Rigging point').count()) > 0);
    check('fire exits are offered', (await page.getByText('Fire exit').count()) > 0);
    check('the market can be changed', (await page.getByText(/This plan is built in/).count()) > 0);

    /* ── The palette, inside a plan ────────────────────────────────── */
    console.log('\nCommand palette, in a plan');
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(400);
    await page.keyboard.type('how much does this cost');
    await page.waitForTimeout(400);
    const costOption = page.locator('[role="option"]').first();
    check(
      'a plain-English question finds the estimator',
      ((await costOption.textContent()) ?? '').toLowerCase().includes('cost')
    );
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    /* ── Keyboard ──────────────────────────────────────────────────── */
    console.log('\nKeyboard');
    /*
     * The digits follow the order down the rail, so they move when the rail
     * does. Present now sits under Light as the head of the delivery group,
     * which makes it 6 and pushes Cost to 7 and Check to 8.
     */
    await page.locator('canvas').first().click({ position: { x: 500, y: 400 } });
    await page.keyboard.press('6');
    await page.getByText('Present & deliver').waitFor({ timeout: 20_000 }).catch(() => {});
    check('number keys move between rail sections', (await page.getByText('Present & deliver').count()) > 0);
    await page.keyboard.press('7');
    await page.getByText('The headline figures').waitFor({ timeout: 20_000 }).catch(() => {});
    check('and again', (await page.getByText('The headline figures').count()) > 0);
    await page.keyboard.press('8');
    await page.getByText('Design score').waitFor({ timeout: 20_000 }).catch(() => {});
    check('and the digit after that', (await page.getByText('Design score').count()) > 0);

    /* ── Screenshots ───────────────────────────────────────────────── */
    await page.screenshot({ path: 'storage/ui-editor.png' });

    // Each page loads its data after the route resolves, so screenshotting
    // immediately captures the skeleton rather than the page.
    await page.goto(`${WEB}/venues`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: 'storage/ui-venues.png' });

    await page.goto(`${WEB}/insights`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: 'storage/ui-insights.png' });

    await page.goto(`${WEB}/help`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    await page.screenshot({ path: 'storage/ui-help.png', fullPage: false });

    /* ── Errors ────────────────────────────────────────────────────── */
    console.log('\nConsole');
    check('no unhandled errors while driving the whole product', errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (error) {
    failed += 1;
    failures.push(`the run itself threw — ${String(error).slice(0, 300)}`);
    console.log(`  ✗ the run itself threw — ${String(error).slice(0, 300)}`);
    await page.screenshot({ path: 'storage/ui-failure.png' }).catch(() => {});
  } finally {
    await browser.close();
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failures.length) {
    console.log('Failures:');
    for (const failure of failures) console.log(`  · ${failure}`);
    console.log('');
  }
  process.exit(failed === 0 ? 0 : 1);
}

main();
