/* Runs the real app.js against a minimal DOM shim and asserts the money math.
   node tools/smoke.js   ->  exits non-zero on the first failed check. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const FIXED_TODAY = new Date(2026, 8, 21); // 2026-09-21, matches the note

function makeEl(sel) {
  const el = {
    _sel: sel, textContent: '', innerHTML: '', value: '', hidden: false,
    style: {}, dataset: {},
    _attrs: {}, _classes: new Set(),
    addEventListener() {}, removeEventListener() {}, focus() {}, select() {},
    setAttribute(k, v) { this._attrs[k] = v; }, getAttribute(k) { return this._attrs[k] ?? null; },
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

const els = new Map();
const get = (sel) => {
  if (!els.has(sel)) els.set(sel, makeEl(sel));
  return els.get(sel);
};

const store = new Map();
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
    querySelectorAll: (sel) => (sel === '.nav-item' || sel === '.view' ? [makeEl(sel), makeEl(sel)] : []),
    addEventListener() {},
    execCommand: () => true,
  },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;

// Pin "today" so the assertions are stable.
const RealDate = Date;
class FakeDate extends RealDate {
  constructor(...a) { return a.length ? new RealDate(...a) : new RealDate(FIXED_TODAY); }
  static now() { return FIXED_TODAY.getTime(); }
}
FakeDate.UTC = RealDate.UTC;
FakeDate.parse = RealDate.parse;
sandbox.Date = FakeDate;

const src = fs.readFileSync(path.join(__dirname, '..', 'app', 'assets', 'app.js'), 'utf8');

let failures = 0;
function check(name, actual, expected) {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}\n        got ${JSON.stringify(String(actual))}` +
              (ok ? '' : `\n        want ${JSON.stringify(String(expected))}`));
}
function contains(name, hay, needle) {
  const ok = String(hay).includes(needle);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}` + (ok ? '' : `\n        ${JSON.stringify(String(hay).slice(0, 400))}\n        missing ${JSON.stringify(needle)}`));
}

try {
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'app.js' });
  console.log('PASS  app.js ran without throwing\n');
} catch (e) {
  console.log('FAIL  app.js threw: ' + e.stack);
  process.exit(1);
}

// ── current check: Sep 10 -> Sep 24 (anchor Sep 24, today Sep 21) ──
check('safe-to-spend  = 1000 - 320 - 220 - 60', get('#heroSpend').textContent, '$400');
contains('sub line names the current pay window', get('#checkSub').textContent, 'Sep 10');
contains('sub line names the next payday',        get('#checkSub').textContent, 'Sep 24');
contains('countdown to next check',               get('#countdown').innerHTML, '<b>3</b> day');
// window (Sep 10, Sep 24]: Planet Fitness 27.11 + 2wk gas 80 = 107.11
check('bills due this window',                    get('#dueTotal').textContent, '$107.11');
contains('verdict says covered',                  get('#dueVerdict').innerHTML, 'Covered');

// ── bills page totals ──
contains('bill count + monthly fixed', get('#billCount').textContent, '4 bills · $450.08/mo');

// ── schedule: the Sep 24 check is the heavy one (rent+ins+AT&T+gas = 502.97) ──
contains('schedule flags the heavy Sep 24 check', get('#schedBody').innerHTML, '$502.97');
contains('schedule marks a bonus check',          get('#schedBody').innerHTML, 'bonus');
contains('bonus note names Dec 17',               get('#bonusNote').innerHTML, 'Dec 17, 2026');

// ── savings projection ──
contains('goal target rendered', get('#goalTarget').textContent, '$4,300');

console.log('\n' + (failures ? failures + ' FAILURE(S)' : 'all checks passed'));
process.exit(failures ? 1 : 0);
