/* ─────────────────────────────────────────────────────────────
   Paycheck Planner — all state is local, nothing leaves the device.
   ───────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var KEY = 'paycheck-planner.v1';
  var DAY = 86400000;

  /* ── defaults ──────────────────────────────────────────── */

  function defaults() {
    return {
      version: 1,
      pay: { perCheck: 1000, anchor: '2026-09-24', period: 14 },
      bills: [
        { id: 'b1', name: 'Rent',            amount: 150.99, dueDay: 1,  color: 'accent' },
        { id: 'b2', name: 'Car insurance',   amount: 124.99, dueDay: 5,  color: 'blue'   },
        { id: 'b3', name: 'AT&T',            amount: 146.99, dueDay: 8,  color: 'violet' },
        { id: 'b4', name: 'Planet Fitness',  amount:  27.11, dueDay: 17, color: 'cerise'  }
      ],
      weekly: [
        { id: 'w1', name: 'Gas', amount: 40 }
      ],
      split: { bills: 320, savings: 220, buffer: 60 },
      savings: { balance: 0, goal: 4300, log: [] },
      ui: { theme: 'dark' }
    };
  }

  var S = load();

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return defaults();
      var o = JSON.parse(raw);
      var d = defaults();
      // shallow-merge so a partial/older blob still boots
      return {
        version: 1,
        pay:     Object.assign(d.pay, o.pay || {}),
        bills:   Array.isArray(o.bills)  ? o.bills  : d.bills,
        weekly:  Array.isArray(o.weekly) ? o.weekly : d.weekly,
        split:   Object.assign(d.split, o.split || {}),
        savings: Object.assign(d.savings, o.savings || {}),
        ui:      Object.assign(d.ui, o.ui || {})
      };
    } catch (e) {
      return defaults();
    }
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); }
    catch (e) { toast('Could not save — storage is full'); }
  }

  /* ── small helpers ─────────────────────────────────────── */

  var $  = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };

  function uid() { return 'x' + Math.random().toString(36).slice(2, 9); }

  function num(v, fallback) {
    var n = parseFloat(v);
    return isFinite(n) ? n : (fallback || 0);
  }

  function money(n, cents) {
    var neg = n < 0;
    n = Math.abs(n);
    var s = cents ? n.toFixed(2) : String(Math.round(n));
    var parts = s.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-$' : '$') + parts.join('.');
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ── dates (DST-safe day arithmetic) ───────────────────── */

  function dayNum(d) {
    return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY);
  }
  function fromDay(n) {
    var u = new Date(n * DAY);
    return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate());
  }
  function parseISO(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    if (!m) return new Date();
    return new Date(+m[1], +m[2] - 1, +m[3]);
  }
  function toISO(d) {
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function today() { return dayNum(new Date()); }

  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function fmtDay(n, withYear) {
    var d = fromDay(n);
    var s = MON[d.getMonth()] + ' ' + d.getDate();
    if (withYear || d.getFullYear() !== new Date().getFullYear()) s += ', ' + d.getFullYear();
    return s;
  }

  function daysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }

  /* ── payday engine ─────────────────────────────────────── */

  // Returns `count` payday day-numbers, starting with the most recent one
  // that is on or before `from`.
  function paydays(from, count) {
    var out = [];
    var p = S.pay.period;

    if (p === 15) {                       // twice a month: 1st & 15th
      var d = fromDay(from);
      var y = d.getFullYear(), m = d.getMonth();
      // step back one month so we reliably catch the "most recent"
      var probe = [];
      for (var k = -1; k < count + 2; k++) {
        var mm = m + k, yy = y + Math.floor(mm / 12);
        mm = ((mm % 12) + 12) % 12;
        probe.push(dayNum(new Date(yy, mm, 1)));
        probe.push(dayNum(new Date(yy, mm, 15)));
      }
      probe.sort(function (a, b) { return a - b; });
      var start = 0;
      for (var i = 0; i < probe.length; i++) { if (probe[i] <= from) start = i; }
      return probe.slice(start, start + count);
    }

    var a = dayNum(parseISO(S.pay.anchor));
    var kk = Math.floor((from - a) / p);
    for (var j = 0; j < count; j++) out.push(a + (kk + j) * p);
    return out;
  }

  // Monthly-bill occurrences in the window (afterDay, throughDay].
  function billsInWindow(afterDay, throughDay) {
    var hits = [];
    var startD = fromDay(afterDay), endD = fromDay(throughDay);
    var y = startD.getFullYear(), m = startD.getMonth();
    var months = (endD.getFullYear() - y) * 12 + (endD.getMonth() - m) + 1;

    for (var k = 0; k <= months; k++) {
      var mm = m + k, yy = y + Math.floor(mm / 12);
      mm = ((mm % 12) + 12) % 12;
      for (var i = 0; i < S.bills.length; i++) {
        var b = S.bills[i];
        var day = Math.min(Math.max(1, num(b.dueDay, 1)), daysInMonth(yy, mm));
        var dn = dayNum(new Date(yy, mm, day));
        if (dn > afterDay && dn <= throughDay) hits.push({ bill: b, day: dn });
      }
    }
    hits.sort(function (x, z) { return x.day - z.day; });
    return hits;
  }

  function weeklyPerWeek() {
    return S.weekly.reduce(function (t, w) { return t + num(w.amount); }, 0);
  }
  function monthlyFixed() {
    return S.bills.reduce(function (t, b) { return t + num(b.amount); }, 0);
  }
  function checksPerMonth() {
    return S.pay.period === 15 ? 2 : (365.25 / S.pay.period) / 12;
  }
  function weeklyPerCheck() {
    // semi-monthly checks cover half an average month, not a fixed day count
    return S.pay.period === 15
      ? weeklyPerWeek() * (365.25 / 12 / 7) / 2
      : weeklyPerWeek() * (S.pay.period / 7);
  }
  // What the bills bucket genuinely needs each check.
  function autoBills() {
    return Math.ceil((monthlyFixed() / 2 + weeklyPerCheck()) / 10) * 10;
  }

  /* ── the plan for one paycheck ─────────────────────────── */

  function planFor(payDay, nextDay) {
    var span = nextDay - payDay;
    var hits = billsInWindow(payDay, nextDay);
    var fixedDue = hits.reduce(function (t, h) { return t + num(h.bill.amount); }, 0);
    var gasDue = weeklyPerWeek() * (span / 7);
    var totalDue = fixedDue + gasDue;
    var bonus = hits.length === 0;

    var setAside = bonus ? Math.ceil(gasDue / 10) * 10 : num(S.split.bills);
    var savings = num(S.split.savings) + (bonus ? Math.max(0, num(S.split.bills) - setAside) : 0);
    var buffer = num(S.split.buffer);
    var spend = num(S.pay.perCheck) - setAside - savings - buffer;

    return {
      payDay: payDay, nextDay: nextDay, span: span,
      hits: hits, fixedDue: fixedDue, gasDue: gasDue, totalDue: totalDue,
      bonus: bonus, setAside: setAside, savings: savings,
      buffer: buffer, spend: spend,
      short: totalDue - setAside
    };
  }

  /* ── rendering ─────────────────────────────────────────── */

  var COLORS = { accent: 'var(--accent)', blue: 'var(--blue)', violet: 'var(--violet)',
                 cerise: 'var(--cerise)', teal: 'var(--teal)', red: 'var(--red)' };
  function colorOf(c) { return COLORS[c] || 'var(--teal)'; }

  function renderAll() {
    document.documentElement.setAttribute('data-theme', S.ui.theme);
    $('#themeBtn').textContent = S.ui.theme === 'dark' ? 'Light mode' : 'Dark mode';
    renderCheck();
    renderBills();
    renderSchedule();
    renderSavings();
    renderSettings();
  }

  /* — This check — */

  function renderCheck() {
    var t = today();
    var ps = paydays(t, 3);
    var p = planFor(ps[0], ps[1]);
    var untilNext = ps[1] - t;

    $('#checkSub').textContent =
      'Paid ' + fmtDay(ps[0]) + ' · covers you through ' + fmtDay(ps[1]);

    $('#countdown').innerHTML = untilNext <= 0
      ? '<b>Payday today</b>'
      : '<b>' + untilNext + '</b> day' + (untilNext === 1 ? '' : 's') + ' until the next check';

    $('#heroSpend').textContent = money(p.spend);
    $('#heroNote').textContent =
      money(p.spend / (p.span / 7)) + ' a week for the next ' + p.span + ' days'
      + (p.bonus ? ' — and this is a bonus check, so the extra went to savings.' : '');

    // stacked allocation bar
    var total = num(S.pay.perCheck) || 1;
    var segs = [
      { k: 'Bills',   v: p.setAside, c: 'var(--blue)'   },
      { k: 'Savings', v: p.savings,  c: 'var(--accent)' },
      { k: 'Buffer',  v: p.buffer,   c: 'var(--violet)' },
      { k: 'Spend',   v: p.spend,    c: 'var(--cerise)'  }
    ];
    $('#heroBar').innerHTML = segs.map(function (s) {
      return '<span style="width:' + Math.max(0, (s.v / total) * 100) + '%;background:' + s.c + '"></span>';
    }).join('');
    $('#heroLegend').innerHTML = segs.map(function (s) {
      return '<span><i style="background:' + s.c + '"></i>' + s.k + ' <b>' + money(s.v) + '</b></span>';
    }).join('');

    // bucket cards
    var need = autoBills();
    $('#buckets').innerHTML = [
      card('Bills', money(p.setAside), 'covers ' + money(p.totalDue, true) + ' due this window', 'var(--blue)'),
      card('Savings', money(p.savings), p.bonus ? 'bonus check boost' : 'straight to the fund', 'var(--accent)'),
      card('Buffer', money(p.buffer), 'car, repairs, gifts', 'var(--violet)'),
      card('Spend', money(p.spend), money(p.spend / (p.span / 7)) + ' a week', 'var(--cerise)')
    ].join('');

    // what's due
    var rows = p.hits.map(function (h) {
      var onPayday = h.day === p.nextDay;
      return '<div class="li">'
        + '<span class="dot" style="background:' + colorOf(h.bill.color) + '"></span>'
        + '<span class="nm">' + esc(h.bill.name) + (onPayday ? ' <span class="warn">· lands on payday</span>' : '') + '</span>'
        + '<span class="dt">' + fmtDay(h.day) + '</span>'
        + '<span class="am">' + money(h.bill.amount, true) + '</span>'
        + '</div>';
    });
    if (weeklyPerWeek() > 0) {
      rows.push('<div class="li">'
        + '<span class="dot" style="background:var(--teal)"></span>'
        + '<span class="nm">' + esc(S.weekly.map(function (w) { return w.name; }).join(' + ')) + '</span>'
        + '<span class="dt">' + (p.span / 7).toFixed(p.span % 7 ? 1 : 0) + ' weeks</span>'
        + '<span class="am">' + money(p.gasDue, true) + '</span>'
        + '</div>');
    }
    $('#dueList').innerHTML = rows.length ? rows.join('') : '<div class="empty">Nothing due before your next check.</div>';
    $('#dueTotal').textContent = money(p.totalDue, true);

    var v;
    if (p.short > 0.5) {
      v = '<span class="bad">Short by ' + money(p.short, true) + '.</span> '
        + 'Put ' + money(Math.ceil((p.totalDue) / 10) * 10) + ' aside from this check instead of '
        + money(p.setAside) + ', and take it out of spending this once.';
    } else if (p.short > -20) {
      v = '<span class="warn">Just barely covered</span> — ' + money(-p.short, true) + ' to spare.';
    } else {
      v = '<span class="good">Covered</span>, with ' + money(-p.short, true) + ' left over to build a cushion.';
    }
    if (need > num(S.split.bills)) {
      v += '<br>Your bills average ' + money(need) + ' a check but you\'re setting aside '
         + money(S.split.bills) + '. Consider raising it in Setup.';
    }
    $('#dueVerdict').innerHTML = v;

    // pace
    $('#pace').innerHTML =
        paceRow('Every week', money(p.spend / (p.span / 7)))
      + '<hr>' + paceRow('Every day', money(p.spend / p.span, true))
      + '<hr>' + paceRow('Groceries (suggested)', money(Math.min(110, p.spend / (p.span / 7) * 0.45)) + '/wk')
      + '<hr>' + paceRow('Left for everything else', money(Math.max(0, p.spend / (p.span / 7) - Math.min(110, p.spend / (p.span / 7) * 0.45))) + '/wk');
  }

  function card(k, v, d, c) {
    return '<div class="card stat"><span class="tag" style="background:' + c + '"></span>'
      + '<div class="k">' + k + '</div><div class="v">' + v + '</div><div class="d">' + d + '</div></div>';
  }
  function paceRow(l, r) {
    return '<div class="pace-row"><span class="l">' + l + '</span><span class="r">' + r + '</span></div>';
  }

  /* — Bills — */

  function renderBills() {
    var mf = monthlyFixed();
    var wm = weeklyPerWeek() * 52 / 12;
    var tot = mf + wm;

    $('#billStats').innerHTML = [
      card('Fixed monthly', money(mf, true), S.bills.length + ' bills', 'var(--blue)'),
      card('Weekly, monthly', money(wm), money(weeklyPerWeek()) + ' a week', 'var(--teal)'),
      card('Total a month', money(tot), 'everything that must go out', 'var(--violet)'),
      card('Needs per check', money(autoBills()), 'you set aside ' + money(S.split.bills), 'var(--cerise)')
    ].join('');

    $('#billCount').textContent = S.bills.length + ' bills · ' + money(mf, true) + '/mo';

    $('#billBody').innerHTML = S.bills.length ? S.bills.slice().sort(function (a, b) {
      return num(a.dueDay) - num(b.dueDay);
    }).map(function (b) {
      return '<tr>'
        + '<td><div class="name-cell"><span class="dot" style="background:' + colorOf(b.color) + '"></span>' + esc(b.name) + '</div></td>'
        + '<td class="num">' + money(b.amount, true) + '</td>'
        + '<td class="num">' + ordinal(num(b.dueDay, 1)) + '</td>'
        + '<td class="num">' + money(num(b.amount) / 2, true) + '</td>'
        + '<td class="act"><button class="rowbtn" data-edit-bill="' + b.id + '">✎</button></td>'
        + '</tr>';
    }).join('') : '<tr><td colspan="5"><div class="empty">No bills yet.</div></td></tr>';

    $('#weeklyBody').innerHTML = S.weekly.length ? S.weekly.map(function (w) {
      return '<tr>'
        + '<td><div class="name-cell"><span class="dot" style="background:var(--teal)"></span>' + esc(w.name) + '</div></td>'
        + '<td class="num">' + money(w.amount, true) + '</td>'
        + '<td class="num">' + money(num(w.amount) * 52 / 12) + '</td>'
        + '<td class="num">' + money(num(w.amount) * S.pay.period / 7) + '</td>'
        + '<td class="act"><button class="rowbtn" data-edit-weekly="' + w.id + '">✎</button></td>'
        + '</tr>';
    }).join('') : '<tr><td colspan="5"><div class="empty">Nothing weekly.</div></td></tr>';
  }

  function ordinal(n) {
    var s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  /* — Schedule — */

  function renderSchedule() {
    var ps = paydays(today(), 15);
    var rows = [], bonuses = [];

    for (var i = 0; i < ps.length - 1; i++) {
      var p = planFor(ps[i], ps[i + 1]);
      if (p.bonus) bonuses.push(fmtDay(ps[i], true));
      var cls = p.short > 0.5 ? 'tight' : 'ok';
      rows.push('<tr' + (p.bonus ? ' class="bonus"' : '') + '>'
        + '<td>' + fmtDay(ps[i], true) + (p.bonus ? ' <span class="pill">bonus</span>' : '') + '</td>'
        + '<td>' + fmtDay(p.nextDay) + '</td>'
        + '<td class="num ' + cls + '">' + money(p.totalDue, true) + '</td>'
        + '<td class="num">' + money(p.setAside) + '</td>'
        + '<td class="num' + (p.bonus ? ' ok' : '') + '">' + money(p.savings) + '</td>'
        + '<td class="num">' + money(p.spend) + '</td>'
        + '</tr>');
    }
    $('#schedBody').innerHTML = rows.join('');

    $('#bonusNote').innerHTML = bonuses.length
      ? '<b>Bonus checks coming up:</b> ' + bonuses.join(', ')
        + '. Nothing is due between those and the next payday, so the bills set-aside rolls into savings.'
      : 'Every upcoming check has bills landing before the next one. No free checks in this stretch.';
  }

  /* — Savings — */

  function renderSavings() {
    var bal = num(S.savings.balance), goal = num(S.savings.goal) || 1;
    var pct = Math.max(0, Math.min(100, (bal / goal) * 100));

    $('#goalNow').textContent = money(bal, true);
    $('#goalTarget').textContent = money(goal);
    $('#goalFill').style.width = pct + '%';
    $('#goalMeta').innerHTML = bal >= goal
      ? '<span class="good">Funded.</span> Time to point this at the next thing.'
      : money(goal - bal, true) + ' to go · ' + pct.toFixed(0) + '% there';

    // walk forward until the goal is met
    var ps = paydays(today(), 80);
    var run = bal, hit = null, perYear = 0, n = 0;
    for (var i = 0; i < ps.length - 1; i++) {
      var p = planFor(ps[i], ps[i + 1]);
      run += p.savings;
      n++;
      if (i < Math.round(365.25 / S.pay.period)) perYear += p.savings;
      if (hit === null && run >= goal) hit = { day: ps[i], checks: n };
    }

    $('#projection').innerHTML =
        projRow('Saved per normal check', money(S.split.savings))
      + projRow('Saved in a year', money(perYear))
      + projRow('Buffer built in a year', money(num(S.split.buffer) * Math.round(365.25 / S.pay.period)))
      + (hit
          ? projRow('Goal reached', fmtDay(hit.day, true) + ' · ' + hit.checks + ' checks')
          : projRow('Goal reached', 'not within 3 years'));

    var log = (S.savings.log || []).slice().reverse();
    $('#depCount').textContent = log.length + ' entries';
    $('#depList').innerHTML = log.length ? log.map(function (e, i) {
      return '<div class="li">'
        + '<span class="dot" style="background:var(--accent)"></span>'
        + '<span class="nm">' + esc(e.note || 'Deposit') + '</span>'
        + '<span class="dt">' + fmtDay(dayNum(parseISO(e.date)), true) + '</span>'
        + '<span class="am">' + money(e.amount, true) + '</span>'
        + '<button class="rowbtn" data-del-dep="' + (log.length - 1 - i) + '">×</button>'
        + '</div>';
    }).join('') : '<div class="empty">No deposits logged yet.</div>';
  }

  function projRow(l, r) {
    return '<div class="pr"><span>' + l + '</span><b>' + r + '</b></div>';
  }

  /* — Setup — */

  function renderSettings() {
    $('#setIncome').value  = S.pay.perCheck;
    $('#setAnchor').value  = S.pay.anchor;
    $('#setPeriod').value  = String(S.pay.period);
    $('#setBills').value   = S.split.bills;
    $('#setSavings').value = S.split.savings;
    $('#setBuffer').value  = S.split.buffer;
    $('#setGoal').value    = S.savings.goal;
    $('#backup').value     = JSON.stringify(S, null, 1);
  }

  /* ── editor sheet ──────────────────────────────────────── */

  var sheetSave = null;

  function openSheet(title, fields, onSave) {
    $('#sheetTitle').textContent = title;
    $('#sheetFields').innerHTML = fields.map(function (f) {
      if (f.type === 'select') {
        return '<label class="fld"><span>' + esc(f.label) + '</span><select data-f="' + f.key + '">'
          + f.options.map(function (o) {
              return '<option value="' + esc(o.v) + '"' + (String(o.v) === String(f.value) ? ' selected' : '') + '>' + esc(o.l) + '</option>';
            }).join('')
          + '</select></label>';
      }
      return '<label class="fld"><span>' + esc(f.label) + '</span>'
        + '<input type="' + (f.type || 'text') + '"'
        + (f.type === 'number' ? ' inputmode="decimal" step="' + (f.step || '0.01') + '"' : '')
        + ' data-f="' + f.key + '" value="' + esc(f.value == null ? '' : f.value) + '"></label>';
    }).join('');
    sheetSave = onSave;
    $('#scrim').hidden = false;
  }

  function closeSheet() { $('#scrim').hidden = true; sheetSave = null; }

  function sheetValues() {
    var o = {};
    $$('#sheetFields [data-f]').forEach(function (el) { o[el.getAttribute('data-f')] = el.value; });
    return o;
  }

  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(t._t);
    t._t = setTimeout(function () { t.hidden = true; }, 2200);
  }

  /* ── wiring ────────────────────────────────────────────── */

  $$('.nav-item').forEach(function (b) {
    b.addEventListener('click', function () {
      $$('.nav-item').forEach(function (x) { x.classList.remove('is-active'); });
      b.classList.add('is-active');
      var v = b.getAttribute('data-view');
      $$('.view').forEach(function (s) { s.classList.toggle('is-active', s.getAttribute('data-view') === v); });
      $('#main').scrollTop = 0;
    });
  });

  $('#themeBtn').addEventListener('click', function () {
    S.ui.theme = S.ui.theme === 'dark' ? 'light' : 'dark';
    save(); renderAll();
  });

  // bills
  $('#addBill').addEventListener('click', function () {
    openSheet('Add a bill', [
      { key: 'name', label: 'Name', value: '' },
      { key: 'amount', label: 'Amount', type: 'number', value: '' },
      { key: 'dueDay', label: 'Day of the month it is due', type: 'number', step: '1', value: '1' }
    ], function (v) {
      if (!v.name.trim()) return toast('Give it a name');
      var palette = ['accent', 'blue', 'violet', 'cerise', 'teal', 'red'];
      S.bills.push({
        id: uid(), name: v.name.trim(), amount: num(v.amount),
        dueDay: Math.min(31, Math.max(1, Math.round(num(v.dueDay, 1)))),
        color: palette[S.bills.length % palette.length]
      });
      save(); renderAll(); toast('Bill added');
    });
  });

  $('#addWeekly').addEventListener('click', function () {
    openSheet('Add a weekly cost', [
      { key: 'name', label: 'Name', value: '' },
      { key: 'amount', label: 'Per week', type: 'number', value: '' }
    ], function (v) {
      if (!v.name.trim()) return toast('Give it a name');
      S.weekly.push({ id: uid(), name: v.name.trim(), amount: num(v.amount) });
      save(); renderAll(); toast('Added');
    });
  });

  document.addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('[data-edit-bill],[data-edit-weekly],[data-del-dep]') : null;
    if (!el) return;

    var bid = el.getAttribute('data-edit-bill');
    if (bid) {
      var b = S.bills.filter(function (x) { return x.id === bid; })[0];
      if (!b) return;
      openSheet('Edit ' + b.name, [
        { key: 'name', label: 'Name', value: b.name },
        { key: 'amount', label: 'Amount', type: 'number', value: b.amount },
        { key: 'dueDay', label: 'Day of the month it is due', type: 'number', step: '1', value: b.dueDay },
        { key: 'del', label: 'Type DELETE to remove this bill', value: '' }
      ], function (v) {
        if (v.del.trim().toUpperCase() === 'DELETE') {
          S.bills = S.bills.filter(function (x) { return x.id !== bid; });
          save(); renderAll(); return toast('Bill removed');
        }
        b.name = v.name.trim() || b.name;
        b.amount = num(v.amount, b.amount);
        b.dueDay = Math.min(31, Math.max(1, Math.round(num(v.dueDay, b.dueDay))));
        save(); renderAll(); toast('Saved');
      });
      return;
    }

    var wid = el.getAttribute('data-edit-weekly');
    if (wid) {
      var w = S.weekly.filter(function (x) { return x.id === wid; })[0];
      if (!w) return;
      openSheet('Edit ' + w.name, [
        { key: 'name', label: 'Name', value: w.name },
        { key: 'amount', label: 'Per week', type: 'number', value: w.amount },
        { key: 'del', label: 'Type DELETE to remove', value: '' }
      ], function (v) {
        if (v.del.trim().toUpperCase() === 'DELETE') {
          S.weekly = S.weekly.filter(function (x) { return x.id !== wid; });
          save(); renderAll(); return toast('Removed');
        }
        w.name = v.name.trim() || w.name;
        w.amount = num(v.amount, w.amount);
        save(); renderAll(); toast('Saved');
      });
      return;
    }

    var di = el.getAttribute('data-del-dep');
    if (di !== null) {
      var idx = parseInt(di, 10);
      var e2 = S.savings.log[idx];
      if (e2) {
        S.savings.balance = num(S.savings.balance) - num(e2.amount);
        S.savings.log.splice(idx, 1);
        save(); renderAll(); toast('Entry removed');
      }
    }
  });

  // savings
  $('#addDeposit').addEventListener('click', function () {
    openSheet('Log a deposit', [
      { key: 'amount', label: 'Amount', type: 'number', value: S.split.savings },
      { key: 'date', label: 'Date', type: 'date', value: toISO(new Date()) },
      { key: 'note', label: 'Note (optional)', value: '' }
    ], function (v) {
      var a = num(v.amount);
      if (!a) return toast('Enter an amount');
      S.savings.log.push({ amount: a, date: v.date || toISO(new Date()), note: v.note.trim() });
      S.savings.balance = num(S.savings.balance) + a;
      save(); renderAll(); toast('Logged ' + money(a, true));
    });
  });

  // setup
  function bindNum(sel, apply) {
    $(sel).addEventListener('change', function () { apply(num(this.value)); save(); renderAll(); });
  }
  bindNum('#setIncome',  function (v) { S.pay.perCheck = v; });
  bindNum('#setBills',   function (v) { S.split.bills = v; });
  bindNum('#setSavings', function (v) { S.split.savings = v; });
  bindNum('#setBuffer',  function (v) { S.split.buffer = v; });
  bindNum('#setGoal',    function (v) { S.savings.goal = v; });

  $('#setAnchor').addEventListener('change', function () {
    if (this.value) { S.pay.anchor = this.value; save(); renderAll(); }
  });
  $('#setPeriod').addEventListener('change', function () {
    S.pay.period = parseInt(this.value, 10) || 14; save(); renderAll();
  });
  $('#autoBills').addEventListener('click', function (e) {
    e.preventDefault();
    S.split.bills = autoBills(); save(); renderAll();
    toast('Bills set to ' + money(S.split.bills));
  });

  // backup
  $('#copyBackup').addEventListener('click', function () {
    var ta = $('#backup');
    ta.focus(); ta.select();
    try { document.execCommand('copy'); toast('Copied to clipboard'); }
    catch (e) { toast('Select the text and copy it'); }
  });
  $('#restoreBackup').addEventListener('click', function () {
    try {
      var o = JSON.parse($('#backup').value);
      if (!o || typeof o !== 'object') throw new Error('bad');
      localStorage.setItem(KEY, JSON.stringify(o));
      S = load(); save(); renderAll(); toast('Restored');
    } catch (e) { toast('That is not valid backup text'); }
  });
  $('#resetAll').addEventListener('click', function () {
    openSheet('Reset everything?', [
      { key: 'c', label: 'Type RESET to wipe all your data', value: '' }
    ], function (v) {
      if (v.c.trim().toUpperCase() !== 'RESET') return toast('Not reset');
      S = defaults(); save(); renderAll(); toast('Back to defaults');
    });
  });

  // sheet
  $('#sheetCancel').addEventListener('click', closeSheet);
  $('#sheetSave').addEventListener('click', function () {
    var fn = sheetSave;
    if (fn) { var v = sheetValues(); closeSheet(); fn(v); }
  });
  $('#scrim').addEventListener('click', function (e) { if (e.target === this) closeSheet(); });

  // keep "days until payday" honest if the tablet sits open overnight
  var lastDay = today();
  setInterval(function () {
    var t = today();
    if (t !== lastDay) { lastDay = t; renderAll(); }
  }, 60000);

  renderAll();
})();
