/**
 * ExpensaReview backend. Paste this into a Google Apps Script project bound to your own Google Sheet.
 * Your data stays in that Sheet; secrets (password, bank key, Claude key) stay in this script's properties.
 * Nothing here is shared with anyone: the app on GitHub holds no data and no keys.
 *
 * First time: choose the function `setup` in the toolbar and press Run. The execution log shows your password.
 */
const VERSION = 3;
const EB = 'https://api.enablebanking.com';

/* ---------- entry points ---------- */
function doGet(e) { return handle_(e.parameter || {}); }
function doPost(e) {
  let p = {};
  try { p = JSON.parse(e.postData.contents); } catch (err) { return out_({ ok: false, error: 'Bad request' }); }
  return handle_(p);
}
function handle_(p) {
  try {
    const token = props_().getProperty('TOKEN');
    if (!token) return out_({ ok: false, error: 'Run setup once in the script editor first.' });
    if (p.token !== token) return out_({ ok: false, error: 'Wrong password' });
    const fn = ACTIONS[p.action];
    if (!fn) return out_({ ok: false, error: 'Unknown action ' + p.action });
    return out_(Object.assign({ ok: true }, fn(p) || {}));
  } catch (err) {
    return out_({ ok: false, error: String(err && err.message || err) });
  }
}
const out_ = o => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
const props_ = () => PropertiesService.getScriptProperties();
const ss_ = () => SpreadsheetApp.getActiveSpreadsheet();

/* ---------- sheets ---------- */
const OPS_H = ['id', 'src', 'ac', 'd', 'td', 'a', 'short', 'desc', 'cat0', 'file', 'added'];
const BAL_H = ['ac', 'date', 'bal', 'src', 'file', 'kind'];
function sheet_(name, header) {
  let sh = ss_().getSheetByName(name);
  if (!sh) { sh = ss_().insertSheet(name); sh.appendRow(header); sh.setFrozenRows(1); }
  else if (sh.getLastColumn() < header.length) sh.getRange(1, 1, 1, header.length).setValues([header]);
  return sh;
}
function rows_(name, header) {
  const sh = sheet_(name, header), n = sh.getLastRow();
  if (n < 2) return [];
  const v = sh.getRange(2, 1, n - 1, header.length).getValues();
  return v.map(r => { const o = {}; header.forEach((h, i) => o[h] = r[i] instanceof Date ? Utilities.formatDate(r[i], 'UTC', 'yyyy-MM-dd') : r[i]); return o; });
}
function settings_() {
  const sh = sheet_('Settings', ['key', 'value']), n = sh.getLastRow(), o = {};
  if (n >= 2) sh.getRange(2, 1, n - 1, 2).getValues().forEach(r => { try { o[r[0]] = JSON.parse(r[1]); } catch (e) { o[r[0]] = r[1]; } });
  return o;
}
function saveSettings_(patch) {
  const sh = sheet_('Settings', ['key', 'value']), n = sh.getLastRow();
  const keys = n >= 2 ? sh.getRange(2, 1, n - 1, 1).getValues().map(r => r[0]) : [];
  Object.keys(patch).forEach(k => {
    const v = JSON.stringify(patch[k]), i = keys.indexOf(k);
    if (v.length > 49000) throw new Error('Setting ' + k + ' is too large to save.');
    if (i >= 0) sh.getRange(i + 2, 2).setValue(v); else { sh.appendRow([k, v]); keys.push(k); }
  });
}
function putOps_(ops, file) {
  const sh = sheet_('Ops', OPS_H), n = sh.getLastRow();
  const have = new Set(n >= 2 ? sh.getRange(2, 1, n - 1, 1).getValues().map(r => r[0]) : []);
  const now = new Date().toISOString(), add = [];
  ops.forEach(o => { if (!o.id || have.has(o.id)) return; have.add(o.id); add.push([o.id, o.src, o.ac, o.d, o.td || o.d, o.a, o.short || '', o.desc || '', o.cat0 || '', file || o.file || '', now]); });
  if (add.length) {
    const r0 = sh.getLastRow() + 1;
    sh.getRange(r0, 1, add.length, 5).setNumberFormat('@');
    sh.getRange(r0, 7, add.length, 5).setNumberFormat('@');
    sh.getRange(r0, 1, add.length, OPS_H.length).setValues(add);
  }
  return { added: add.length, skipped: ops.length - add.length };
}
function putBalances_(bal, file) {
  const sh = sheet_('Balances', BAL_H);
  /* a statement read again replaces its own balances; untagged statement balances from the first version are cleared */
  if (file && bal.some(b => b.src === 'pdf')) {
    const n = sh.getLastRow();
    if (n >= 2) { const v = sh.getRange(2, 1, n - 1, BAL_H.length).getValues();
      for (let i = v.length - 1; i >= 0; i--) if (v[i][3] === 'pdf' && (v[i][4] === file || !v[i][5])) sh.deleteRow(i + 2); }
  }
  const cur = rows_('Balances', BAL_H);
  const key = b => b.ac + '|' + String(b.date).slice(0, 10) + '|' + b.src, have = new Set(cur.map(key)), add = [];
  bal.forEach(b => { if (!have.has(key(b))) { have.add(key(b)); add.push([b.ac, b.date, b.bal, b.src, b.file || file || '', b.kind || '']); } });
  if (add.length) { const r0 = sh.getLastRow() + 1; sh.getRange(r0, 2, add.length, 1).setNumberFormat('@'); sh.getRange(r0, 1, add.length, BAL_H.length).setValues(add); }
  return add.length;
}

/* ---------- actions ---------- */
const ACTIONS = {
  ping: () => ({ version: VERSION, sheet: ss_().getName(), bank: bankStatus_(), claude: !!props_().getProperty('CLAUDE_KEY') }),
  load: () => ({ ops: rows_('Ops', OPS_H), balances: rows_('Balances', BAL_H), settings: settings_(), bank: bankStatus_(), claude: !!props_().getProperty('CLAUDE_KEY') }),
  saveSettings: p => { withLock_(() => saveSettings_(p.patch || {})); return {}; },
  putOps: p => withLock_(() => { const r = putOps_(p.ops || [], p.file); r.balances = putBalances_(p.balances || [], p.file); return r; }),
  deleteFile: p => withLock_(() => {
    const sh = sheet_('Ops', OPS_H), n = sh.getLastRow(); if (n < 2) return { deleted: 0 };
    const v = sh.getRange(2, 10, n - 1, 1).getValues(); let del = 0;
    for (let i = v.length - 1; i >= 0; i--) if (v[i][0] === p.file) { sh.deleteRow(i + 2); del++; }
    const bs = sheet_('Balances', BAL_H), bn = bs.getLastRow();
    if (bn >= 2) { const bv = bs.getRange(2, 5, bn - 1, 1).getValues(); for (let i = bv.length - 1; i >= 0; i--) if (bv[i][0] === p.file) bs.deleteRow(i + 2); }
    return { deleted: del };
  }),
  quote: () => quote_(),
  vestPrices: p => ({ prices: (p.dates || []).map(d => ({ date: d, price: closeOn_(p.symbol || 'AMZN', d) })) }),
  bankConfig: p => {
    if (p.appId) props_().setProperty('EB_APP_ID', String(p.appId).trim());
    if (p.key) props_().setProperty('EB_KEY', pem_(p.key));
    return { bank: bankStatus_() };
  },
  bankBanks: p => ({ banks: (eb_('get', '/aspsps?country=' + (p.country || 'FR')).aspsps || []).map(a => a.name) }),
  bankStart: p => {
    const state = Utilities.getUuid(), days = 180;
    const until = new Date(Date.now() + days * 864e5).toISOString();
    const r = eb_('post', '/auth', { access: { valid_until: until }, aspsp: { name: p.bank, country: p.country || 'FR' }, state: state, redirect_url: p.redirect, psu_type: 'personal' });
    props_().setProperty('EB_STATE', JSON.stringify({ state: state, bank: p.bank, code: p.code }));
    return { url: r.url };
  },
  bankFinish: p => {
    const st = JSON.parse(props_().getProperty('EB_STATE') || '{}');
    if (!st.state || st.state !== p.state) throw new Error('This bank link was started elsewhere. Start it again from Setup.');
    const s = eb_('post', '/sessions', { code: p.code });
    const sessions = JSON.parse(props_().getProperty('EB_SESSIONS') || '[]').filter(x => x.bank !== st.bank);
    sessions.push({ id: s.session_id, bank: st.bank, code: st.code, until: s.access && s.access.valid_until, accounts: (s.accounts || []).map(a => ({ uid: a.uid, iban: (a.account_id && a.account_id.iban) || '', name: a.name || a.product || '', cur: a.currency || 'EUR' })) });
    props_().setProperty('EB_SESSIONS', JSON.stringify(sessions));
    props_().deleteProperty('EB_STATE');
    return { bank: bankStatus_() };
  },
  bankSync: p => sync_(p.days),
  bankForget: p => { const s = JSON.parse(props_().getProperty('EB_SESSIONS') || '[]').filter(x => x.bank !== p.bank); props_().setProperty('EB_SESSIONS', JSON.stringify(s)); return { bank: bankStatus_() }; },
  claudeConfig: p => { if (p.key) props_().setProperty('CLAUDE_KEY', String(p.key).trim()); else props_().deleteProperty('CLAUDE_KEY'); return { claude: !!p.key }; },
  categorize: p => categorize_(p.items || [], p.categories || []),
  ledger: p => {
    const id = String(p.sheet || '').match(/[-\w]{25,}/);
    if (!id) throw new Error('Paste the link of your savings ledger Sheet.');
    const ss = SpreadsheetApp.openById(id[0]), sh = ss.getSheetByName(p.tab || 'Raw data') || ss.getSheets()[0];
    const v = sh.getDataRange().getValues();
    return { name: ss.getName(), header: v[0].map(String), rows: v.slice(1).map(r => r.map(x => x instanceof Date ? Utilities.formatDate(x, 'UTC', 'yyyy-MM-dd') : x)) };
  }
};
function withLock_(fn) { const l = LockService.getScriptLock(); l.waitLock(20000); try { return fn(); } finally { l.releaseLock(); } }

/* ---------- prices: Amazon (USD), USD to EUR, gold ---------- */
function getJSON_(url) { const r = UrlFetchApp.fetch(url, { muteHttpExceptions: true, headers: { 'User-Agent': 'Mozilla/5.0' } }); if (r.getResponseCode() >= 300) throw new Error(url + ' ' + r.getResponseCode()); return JSON.parse(r.getContentText()); }
function quote_() {
  const c = CacheService.getScriptCache(), hit = c.get('quote');
  if (hit) return JSON.parse(hit);
  const q = { at: new Date().toISOString() };
  try { const j = getJSON_('https://query1.finance.yahoo.com/v8/finance/chart/AMZN?range=1d&interval=1d'); q.price = j.chart.result[0].meta.regularMarketPrice; q.priceSrc = 'Yahoo Finance'; }
  catch (e) { try { const t = UrlFetchApp.fetch('https://stooq.com/q/l/?s=amzn.us&f=sd2t2c&h&e=csv').getContentText().split('\n')[1].split(','); q.price = +t[3]; q.priceSrc = 'Stooq'; } catch (e2) { q.priceErr = String(e2); } }
  try { const j = getJSON_('https://api.frankfurter.dev/v1/latest?base=USD&symbols=EUR'); q.fx = j.rates.EUR; q.fxSrc = 'ECB via Frankfurter, ' + j.date; }
  catch (e) { try { const j = getJSON_('https://api.frankfurter.app/latest?from=USD&to=EUR'); q.fx = j.rates.EUR; q.fxSrc = 'ECB via Frankfurter, ' + j.date; } catch (e2) { q.fxErr = String(e2); } }
  try { const j = getJSON_('https://api.gold-api.com/price/XAU'); q.goldOz = j.price; q.goldSrc = 'gold-api.com'; } catch (e) { q.goldErr = String(e); }
  c.put('quote', JSON.stringify(q), 900);
  return q;
}
function closeOn_(sym, d) {
  const t = Math.floor(new Date(d + 'T00:00:00Z').getTime() / 1000);
  const j = getJSON_('https://query1.finance.yahoo.com/v8/finance/chart/' + sym + '?interval=1d&period1=' + (t - 6 * 86400) + '&period2=' + (t + 86400));
  const r = j.chart.result[0], cl = r.indicators.quote[0].close; let v = null;
  r.timestamp.forEach((ts, i) => { if (ts <= t + 86400 && cl[i] != null) v = cl[i]; });
  return v;
}

/* ---------- bank link through Enable Banking ---------- */
function pem_(k) {
  k = String(k).trim();
  const m = k.match(/-----BEGIN ([A-Z ]+)-----([\s\S]*?)-----END \1-----/);
  if (!m) throw new Error('That does not look like a private key file (.pem).');
  if (m[1] !== 'PRIVATE KEY') throw new Error('The key is in ' + m[1] + ' format. Google needs "PRIVATE KEY" (PKCS#8); see the README for the one-line conversion.');
  const body = m[2].replace(/\s+/g, '');
  return '-----BEGIN PRIVATE KEY-----\n' + body.match(/.{1,64}/g).join('\n') + '\n-----END PRIVATE KEY-----\n';
}
function jwt_() {
  const id = props_().getProperty('EB_APP_ID'), key = props_().getProperty('EB_KEY');
  if (!id || !key) throw new Error('Bank link not configured yet: add the application ID and key in Setup.');
  const now = Math.floor(Date.now() / 1000);
  const enc = o => Utilities.base64EncodeWebSafe(JSON.stringify(o)).replace(/=+$/, '');
  const data = enc({ typ: 'JWT', alg: 'RS256', kid: id }) + '.' + enc({ iss: 'enablebanking.com', aud: 'api.enablebanking.com', iat: now, exp: now + 3600 });
  return data + '.' + Utilities.base64EncodeWebSafe(Utilities.computeRsaSha256Signature(data, key)).replace(/=+$/, '');
}
function eb_(method, path, body) {
  const o = { method: method, muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + jwt_() } };
  if (body) { o.contentType = 'application/json'; o.payload = JSON.stringify(body); }
  const r = UrlFetchApp.fetch(EB + path, o), t = r.getContentText();
  if (r.getResponseCode() >= 300) throw new Error('Bank service said ' + r.getResponseCode() + ': ' + t.slice(0, 300));
  return t ? JSON.parse(t) : {};
}
function bankStatus_() {
  const p = props_();
  return { configured: !!(p.getProperty('EB_APP_ID') && p.getProperty('EB_KEY')), lastSync: p.getProperty('LAST_SYNC') || '', lastResult: p.getProperty('LAST_SYNC_RESULT') || '',
    links: JSON.parse(p.getProperty('EB_SESSIONS') || '[]').map(s => ({ bank: s.bank, code: s.code, until: s.until, accounts: s.accounts.map(a => ({ uid: a.uid, name: a.name, end: (a.iban || '').slice(-4), cur: a.cur })) })) };
}
function sync_(days) {
  const sessions = JSON.parse(props_().getProperty('EB_SESSIONS') || '[]'), set = settings_(), accts = set.accounts || {}, map = set.bankMap || {};
  const since = Utilities.formatDate(new Date(Date.now() - (days || 30) * 864e5), 'UTC', 'yyyy-MM-dd');
  const ops = [], bals = [], today = Utilities.formatDate(new Date(), 'UTC', 'yyyy-MM-dd'), notes = [];
  sessions.forEach(s => s.accounts.forEach(a => {
    const end = (a.iban || '').replace(/\s/g, '');
    let ac = map[a.uid] || null;
    if (!ac) { if (a.cur && a.cur !== 'EUR' && a.cur !== 'XXX') return;
      if (s.code === 'REV') ac = 'REV';
      else if (accts.sg && end.endsWith(String(accts.sg))) ac = 'SG';
      else if (accts.liv && end.endsWith(String(accts.liv))) ac = 'LIV'; }
    if (ac === 'skip') return;
    if (!ac) { notes.push(s.bank + ' account ' + (a.name || '') + (end ? ' ending ' + end.slice(-4) : '') + ': choose what it is in Setup, step 5'); return; }
    try {
      const b = eb_('get', '/accounts/' + a.uid + '/balances').balances || [];
      const pick = b.find(x => /CLBD|closingBooked/i.test(x.balance_type)) || b.find(x => /ITBD|interimBooked/i.test(x.balance_type)) || b[0];
      if (pick) bals.push({ ac: ac, date: pick.reference_date || today, bal: +pick.balance_amount.amount, src: 'bank' });
      let ck = '', n = 0;
      do {
        const r = eb_('get', '/accounts/' + a.uid + '/transactions?date_from=' + since + (ck ? '&continuation_key=' + encodeURIComponent(ck) : ''));
        (r.transactions || []).forEach(t => {
          if (t.status && t.status !== 'BOOK') return;
          const amt = +t.transaction_amount.amount * (t.credit_debit_indicator === 'DBIT' ? -1 : 1);
          const lines = (t.remittance_information || []).concat([t.creditor && t.creditor.name, t.debtor && t.debtor.name].filter(Boolean));
          const d = t.booking_date || t.value_date || t.transaction_date;
          const ref = t.entry_reference || t.transaction_id || Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, d + amt + lines.join('|'))).slice(0, 16);
          ops.push({ id: 'bank:' + ac + ':' + ref, src: 'bank', ac: ac, d: d, td: t.value_date || d, a: Math.round(amt * 100) / 100, short: lines[0] || '', desc: lines.join(' '), cat0: t.bank_transaction_code && t.bank_transaction_code.description || '' });
        });
        ck = r.continuation_key || ''; n++;
      } while (ck && n < 30);
    } catch (e) { notes.push(s.bank + ': ' + e.message); }
  }));
  const r = withLock_(() => { const x = putOps_(ops, 'bank'); x.balances = putBalances_(bals); return x; });
  const msg = r.added + ' new lines' + (notes.length ? '; ' + notes.join('; ') : '');
  props_().setProperty('LAST_SYNC', new Date().toISOString()); props_().setProperty('LAST_SYNC_RESULT', msg);
  return { added: r.added, notes: notes };
}
function dailySync() { if (JSON.parse(props_().getProperty('EB_SESSIONS') || '[]').length) sync_(10); }

/* ---------- smart categories with Claude ---------- */
function categorize_(items, cats) {
  const key = props_().getProperty('CLAUDE_KEY');
  if (!key) throw new Error('Add a Claude API key in Setup first.');
  const model = props_().getProperty('CLAUDE_MODEL') || 'claude-haiku-5-5';
  const prompt = 'You categorise card and bank transactions for a person living in Paris. Allowed categories: ' + cats.join(', ') +
    '.\nFor each merchant below, answer with the single best category from the list. Reply with JSON only, an object mapping each merchant exactly as written to its category.\n\n' +
    items.slice(0, 150).map(i => '- ' + i.m + (i.desc ? ' (' + String(i.desc).slice(0, 80) + ')' : '')).join('\n');
  const r = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', { method: 'post', muteHttpExceptions: true, contentType: 'application/json',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, payload: JSON.stringify({ model: model, max_tokens: 4000, messages: [{ role: 'user', content: prompt }] }) });
  if (r.getResponseCode() >= 300) throw new Error('Claude said ' + r.getResponseCode() + ': ' + r.getContentText().slice(0, 200));
  const text = JSON.parse(r.getContentText()).content.map(c => c.text || '').join('');
  const m = text.match(/\{[\s\S]*\}/); if (!m) throw new Error('Claude did not return categories.');
  const map = JSON.parse(m[0]), clean = {};
  Object.keys(map).forEach(k => { if (cats.indexOf(map[k]) >= 0) clean[k] = map[k]; });
  return { map: clean };
}

/* ---------- one-time setup ---------- */
function setup() {
  sheet_('Ops', OPS_H); sheet_('Balances', BAL_H); sheet_('Settings', ['key', 'value']);
  let t = props_().getProperty('TOKEN');
  if (!t) { t = Utilities.getUuid().replace(/-/g, '').slice(0, 20); props_().setProperty('TOKEN', t); }
  ScriptApp.getProjectTriggers().filter(x => x.getHandlerFunction() === 'dailySync').forEach(x => ScriptApp.deleteTrigger(x));
  ScriptApp.newTrigger('dailySync').timeBased().everyDays(1).atHour(6).create();
  Logger.log('Your ExpensaReview password: ' + t);
}
