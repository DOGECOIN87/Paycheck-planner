/* Runs the real app.js against a minimal DOM shim and asserts the money math.
   node tools/smoke.js   ->  exits non-zero on the first failed check. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const FIXED_TODAY = new Date(2026, 8, 21); // 2026-09-21, matches the note
const KEY = 'paycheck-planner.v1';
const SRC = fs.readFileSync(path.join(__dirname, '..', 'app', 'assets', 'app.js'), 'utf8');

function makeEl(sel) {
  const el = {
    _sel: sel, textContent: '', innerHTML: '', value: '', hidden: false,
    style: {}, dataset: {}, _attrs: {}, _classes: new Set(),
    addEventListener() {}, removeEventListener() {}, focus() {}, select() {},
    setAttribute(k, v) { this._attrs[k] = v; },
    getAttribute(k) { return k in this._attrs ? this._attrs[k] : null; },
    closest() { return null; },
    classList: {
      add: (c) => el._classes.add(c),
      remove: (c) => el._classes.delete(c),
      toggle: (c, on) => (on ? el._classes.add(c) : el._classes.delete(c)),
      contains: (c) => el._classes.has(c),
    },
  };
  return el;
}

/** Boot app.js with an optional pre-seeded state blob. Returns the element map. */
function boot(seed) {
  const els = new Map();
  const get = (sel) => {
    if (!els.has(sel)) els.set(sel, makeEl(sel));
    return els.get(sel);
  };
  const store = new Map();
  if (seed) store.set(KEY, JSON.stringify(seed));

  const sandbox = {
    console,
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    document: {
      documentElement: makeEl(':root'),
      querySelector: get,
      querySelectorAll: (sel) =>
        (sel === '.nav-item' || sel === '.view' ? [makeEl(sel), makeEl(sel)] : []),
      addEventListener() {},
      execCommand: () => true,
    },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { return a.length ? new RealDate(...a) : new RealDate(FIXED_TODAY); }
    static now() { return FIXED_TODAY.getTime(); }
  }
  FakeDate.UTC = RealDate.UTC;
  FakeDate.parse = RealDate.parse;
  sandbox.Date = FakeDate;

  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: 'app.js' });
  return { get, store };
}

let failures = 0;
function check(name, actual, expected) {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}` +
    (ok ? `  [${actual}]` : `\n        got  ${JSON.stringify(String(actual))}` +
                            `\n        want ${JSON.stringify(String(expected))}`));
}
function contains(name, hay, needle) {
  const ok = String(hay).includes(needle);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}` +
    (ok ? '' : `\n        ${JSON.stringify(String(hay).slice(0, 420))}\n        missing ${JSON.stringify(needle)}`));
}

/* ── 1. defaults ─────────────────────────────────────────────────────
   Today is Sep 21; the anchor payday is Sep 24, so the live window is
   Sep 10 -> Sep 24 and only Planet Fitness + two weeks of gas fall in it. */

console.log('\n— defaults —');
let app;
try {
  app = boot(null);
  console.log('PASS  app.js ran without throwing');
} catch (e) {
  console.log('FAIL  app.js threw: ' + e.stack);
  process.exit(1);
}
let g = app.get;

check('safe to spend = 1000 - 320 bills - 22% - 6%', g('#heroSpend').textContent, '$400');
check('savings is 22% of the check',   g('#buckets').innerHTML.match(/\$220/) ? '$220' : 'missing', '$220');
contains('sub line names the live window', g('#checkSub').textContent, 'Sep 10');
contains('countdown to the next check',    g('#countdown').innerHTML, '<b>3</b> day');
check('bills due this window',             g('#dueTotal').textContent, '$107.11');
contains('verdict says covered',           g('#dueVerdict').innerHTML, 'Covered');
contains('falls back to the usual amount', g('#paidState').innerHTML, 'Using your usual');
check('button invites a log',              g('#paidBtn').textContent, 'I got paid');
contains('empty paycheck log prompts',     g('#payLog').innerHTML, 'Nothing logged yet');
contains('bill count + monthly fixed',     g('#billCount').textContent, '4 bills · $450.08/mo');
contains('schedule flags the heavy Sep 24 check', g('#schedBody').innerHTML, '$502.97');
contains('schedule marks a bonus check',   g('#schedBody').innerHTML, 'bonus');
contains('bonus note names Dec 17',        g('#bonusNote').innerHTML, 'Dec 17, 2026');
check('ring starts empty',                 g('#ringPct').textContent, '0%');
check('light theme by default',            g('#themeBtn').textContent, 'Dark mode');

/* ── 2. a bigger paycheck scales everything ──────────────────────────
   $1,200 landed on Sep 10. Bills are an obligation so they hold at $320;
   savings and buffer take their 22% / 6% of the larger check; spend gets
   the rest: 1200 - 320 - 264 - 72 = 544. */

console.log('\n— logged paycheck of $1,200 —');
const seed = {
  version: 2,
  pay: { perCheck: 1000, anchor: '2026-09-24', period: 14 },
  split: { mode: 'scaled', bills: 320, savings: 220, buffer: 60, savingsPct: 22, bufferPct: 6 },
  paychecks: [{ id: 'p1', amount: 1200, date: '2026-09-10', note: '' }],
};
g = boot(seed).get;

check('spend absorbs the upside', g('#heroSpend').textContent, '$544');
contains('savings scaled to 22% of 1200', g('#buckets').innerHTML, '$264');
contains('buffer scaled to 6% of 1200',   g('#buckets').innerHTML, '$72');
contains('bills held at the obligation',  g('#buckets').innerHTML, '$320');
contains('shows what was logged',         g('#paidState').innerHTML, '$1,200.00');
contains('flags the difference vs usual', g('#paidState').innerHTML, '+$200.00');
check('button switches to edit',          g('#paidBtn').textContent, 'Edit this paycheck');
contains('log lists the paycheck',        g('#payLog').innerHTML, '$1,200.00');

/* ── 3. a short paycheck must not over-promise ───────────────────────
   Only $400 landed. Bills alone want $320, so savings + buffer get
   squeezed into the $80 that is left and spend must never go negative. */

console.log('\n— short paycheck of $400 —');
const short = JSON.parse(JSON.stringify(seed));
short.paychecks = [{ id: 'p2', amount: 400, date: '2026-09-10', note: '' }];
g = boot(short).get;

const spendShort = parseFloat(g('#heroSpend').textContent.replace(/[$,]/g, ''));
check('spend never goes negative', spendShort >= 0, true);
contains('bills still fully funded', g('#buckets').innerHTML, '$320');
contains('warns the difference vs usual', g('#paidState').innerHTML, '-$600.00');

console.log('\n' + (failures ? failures + ' FAILURE(S)' : 'all checks passed'));
process.exit(failures ? 1 : 0);
