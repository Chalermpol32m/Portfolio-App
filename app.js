/* พอร์ตของฉัน — ตรรกะฝั่งหน้าจอ
   คุยกับ Apps Script ผ่าน POST แบบ text/plain (เลี่ยง preflight ของ CORS) */

'use strict';

const LS = {
  api: 'pf.apiUrl',
  token: 'pf.token',
  user: 'pf.user',
  dash: 'pf.cache.dashboard',
  lastTab: 'pf.tab'
};

const state = {
  apiUrl: localStorage.getItem(LS.api) || '',
  token: localStorage.getItem(LS.token) || '',
  user: JSON.parse(localStorage.getItem(LS.user) || 'null'),
  dashboard: null,
  tab: localStorage.getItem(LS.lastTab) || 'dashboard',
  busy: false,
  installPrompt: null
};

const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
const el = (id) => document.getElementById(id);

// ---------- รูปแบบตัวเลข ----------

const nf = (d) => new Intl.NumberFormat('th-TH', { minimumFractionDigits: d, maximumFractionDigits: d });

function fmt(n, d) { return nf(d === undefined ? 2 : d).format(Number(n) || 0); }

function fmtTHB(n, d) { return fmt(n, d === undefined ? 0 : d) + ' บาท'; }

function signed(n, d) {
  const v = Number(n) || 0;
  return (v > 0 ? '+' : v < 0 ? '−' : '') + fmt(Math.abs(v), d === undefined ? 2 : d);
}

function plClass(n) { return Number(n) > 0 ? 'up-text' : Number(n) < 0 ? 'down-text' : 'muted'; }

function esc(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------- เรียก API ----------

async function api(action, payload, opts) {
  if (!state.apiUrl) throw new Error('ยังไม่ได้ตั้งที่อยู่เซิร์ฟเวอร์');

  const body = JSON.stringify({
    action,
    token: state.token,
    payload: payload || {},
    userAgent: navigator.userAgent
  });

  let res;
  try {
    res = await fetch(state.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body,
      redirect: 'follow'
    });
  } catch (e) {
    throw new Error('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสอบอินเทอร์เน็ตหรือที่อยู่เซิร์ฟเวอร์');
  }

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new Error('เซิร์ฟเวอร์ตอบกลับไม่ถูกรูปแบบ — ตรวจว่า Deploy เป็น Web App และให้สิทธิ์ Anyone แล้ว');
  }

  if (!json.ok) {
    if (json.error === 'UNAUTHORIZED') {
      signOut(true);
      throw new Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
    }
    throw new Error(json.error || 'คำสั่งไม่สำเร็จ');
  }
  return json.data;
}

// ---------- แจ้งผลและสถานะ ----------

let toastTimer;
function toast(msg, bad) {
  const t = el('toast');
  t.textContent = msg;
  t.className = 'toast' + (bad ? ' is-bad' : '');
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, bad ? 4200 : 2400);
}

function banner(msg) {
  const b = el('banner');
  if (!msg) { b.hidden = true; return; }
  b.textContent = msg;
  b.hidden = false;
}

function setBusy(on) {
  state.busy = on;
  el('btn-refresh').classList.toggle('is-busy', on);
}

// ---------- เข้าสู่ระบบ ----------

function showGate() {
  el('gate').hidden = false;
  el('app').hidden = true;
  el('g-api').value = state.apiUrl;
}

function showApp() {
  el('gate').hidden = true;
  el('app').hidden = false;
  switchTab(state.tab);
}

function signOut(silent) {
  state.token = '';
  state.user = null;
  state.dashboard = null;
  localStorage.removeItem(LS.token);
  localStorage.removeItem(LS.user);
  localStorage.removeItem(LS.dash);
  showGate();
  if (!silent) toast('ออกจากระบบแล้ว');
}

async function gateSubmit(mode) {
  const apiUrl = el('g-api').value.trim().replace(/\/+$/, '');
  const userId = el('g-user').value.trim().toLowerCase();
  const pin = el('g-pin').value;

  if (!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(apiUrl)) {
    el('g-api-hint').textContent = 'ลิงก์ต้องเป็นรูปแบบ https://script.google.com/macros/s/.../exec';
    el('g-api-hint').classList.add('is-bad');
    return;
  }
  el('g-api-hint').classList.remove('is-bad');
  if (!userId || !pin) { toast('กรอกชื่อผู้ใช้และ PIN ให้ครบ', true); return; }

  state.apiUrl = apiUrl;
  localStorage.setItem(LS.api, apiUrl);

  const btn = mode === 'register' ? el('g-register') : el('g-login');
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = mode === 'register' ? 'กำลังสร้างบัญชี…' : 'กำลังเข้าสู่ระบบ…';

  try {
    const data = await api(mode === 'register' ? 'auth.register' : 'auth.login', { userId, pin });
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem(LS.token, data.token);
    localStorage.setItem(LS.user, JSON.stringify(data.user));
    el('g-pin').value = '';
    showApp();
    await refresh(true);
  } catch (e) {
    toast(e.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

// ---------- แท็บ ----------

function switchTab(tab) {
  state.tab = tab;
  localStorage.setItem(LS.lastTab, tab);
  $$('.tab').forEach(b => b.classList.toggle('is-active', b.dataset.tab === tab));
  $$('.view').forEach(v => { v.hidden = v.dataset.view !== tab; });
  el('top-title').textContent = {
    dashboard: 'พอร์ต', transactions: 'รายการ', alerts: 'เตือนราคา',
    watchlist: 'ติดตาม', settings: 'ตั้งค่า'
  }[tab];
  renderTab(tab);
}

function view(tab) { return $(`.view[data-view="${tab}"]`); }

function skeleton(n) {
  return Array.from({ length: n || 4 }, () => '<div class="skeleton"></div>').join('');
}

async function renderTab(tab) {
  if (tab === 'dashboard') return renderDashboard();
  if (tab === 'transactions') return renderTransactions();
  if (tab === 'alerts') return renderAlerts();
  if (tab === 'watchlist') return renderWatchlist();
  if (tab === 'settings') return renderSettings();
}

// ---------- หน้าพอร์ต ----------

async function refresh(force) {
  setBusy(true);
  try {
    const d = await api('portfolio.dashboard', { force: !!force });
    state.dashboard = d;
    localStorage.setItem(LS.dash, JSON.stringify({ at: Date.now(), data: d }));
    banner(d.stalePrice ? 'ราคาบางตัวดึงไม่สำเร็จ กำลังแสดงราคาล่าสุดที่มี' : '');
    renderMarketPills(d.markets);
    if (state.tab === 'dashboard') renderDashboard();
  } catch (e) {
    const cached = JSON.parse(localStorage.getItem(LS.dash) || 'null');
    if (cached) {
      state.dashboard = cached.data;
      banner('ออฟไลน์ — แสดงข้อมูลเมื่อ ' + new Date(cached.at).toLocaleString('th-TH'));
      if (state.tab === 'dashboard') renderDashboard();
    } else {
      toast(e.message, true);
    }
  } finally {
    setBusy(false);
  }
}

function renderMarketPills(markets) {
  el('market-pills').innerHTML = (markets || []).map(m =>
    `<span class="pill ${m.isOpen ? 'is-open' : ''}">${esc(m.market)} ${m.isOpen ? 'เปิด' : 'ปิด'}</span>`
  ).join('');
}

const ALLOC_COLORS = ['#6E8BD6', '#4FC08D', '#F2B544', '#B67FD0', '#5FB6C4', '#E08A5B', '#8D96B2'];

function renderDashboard() {
  const v = view('dashboard');
  const d = state.dashboard;
  if (!d) { v.innerHTML = skeleton(6); return; }

  const s = d.summary;
  const dayCls = plClass(s.dayChangeTHB);
  const alloc = d.allocation.slice(0, 6);
  const other = d.allocation.slice(6).reduce((a, x) => a + x.valueTHB, 0);
  if (other > 0) alloc.push({ label: 'อื่น ๆ', valueTHB: other, pct: d.summary.totalTHB ? other / d.summary.totalTHB * 100 : 0 });

  const positions = d.positions.map((p, i) => `
    <article class="pos" data-pos="${i}">
      <div>
        <div class="pos-sym">${esc(p.symbol)}<span class="mkt">${esc(p.market)}</span></div>
        <div class="pos-sub">${fmt(p.quantity, p.quantity % 1 ? 4 : 0)} หุ้น · ทุน ${fmt(p.avgCostLocal, 2)} ${esc(p.currency)}</div>
      </div>
      <div>
        <div class="pos-val">${fmt(p.marketValueTHB, 0)}</div>
        <div class="pos-chg ${plClass(p.unrealTotalTHB)}">${signed(p.unrealTotalTHB, 0)} (${signed(p.unrealPctLocal, 1)}%)</div>
      </div>
      <div class="pos-detail" hidden>
        <div class="kv"><span class="k">ราคาล่าสุด</span><span class="v">${fmt(p.price, 2)} ${esc(p.currency)} <span class="${plClass(p.changePct)}">${signed(p.changePct, 2)}%</span></span></div>
        <div class="kv"><span class="k">มูลค่าตลาด</span><span class="v">${fmt(p.marketValueLocal, 2)} ${esc(p.currency)}</span></div>
        <div class="kv"><span class="k">ต้นทุนรวม</span><span class="v">${fmt(p.costTHB, 0)} บาท</span></div>
        <div class="kv"><span class="k">กำไรจากตัวหุ้น</span><span class="v ${plClass(p.unrealStockTHB)}">${signed(p.unrealStockTHB, 0)} บาท</span></div>
        <div class="kv"><span class="k">กำไรจากค่าเงิน</span><span class="v ${plClass(p.unrealFxTHB)}">${signed(p.unrealFxTHB, 0)} บาท</span></div>
        <div class="kv"><span class="k">เปลี่ยนแปลงวันนี้</span><span class="v ${plClass(p.dayChangeTHB)}">${signed(p.dayChangeTHB, 0)} บาท</span></div>
        <div class="kv"><span class="k">ที่มาราคา</span><span class="v muted">${esc(p.source)}${p.stale ? ' · ค้าง' : ''} ${esc(p.quoteTime)}</span></div>
        <div style="margin-top:10px;display:flex;gap:8px">
          <button class="btn-sm" data-quick-alert="${esc(p.symbol)}|${esc(p.market)}|${esc(p.currency)}|${p.price}">ตั้งเตือนราคา</button>
          <button class="btn-sm" data-quick-tx="${esc(p.symbol)}|${esc(p.market)}|${esc(p.currency)}|${p.price}">บันทึกซื้อ/ขาย</button>
        </div>
      </div>
    </article>`).join('');

  v.innerHTML = `
    <div class="hero">
      <div class="hero-label">มูลค่าพอร์ตรวม</div>
      <div class="hero-value">${fmt(s.totalTHB, 0)}<span class="sat">บาท</span></div>
      <div class="hero-delta">
        <span class="chip ${dayCls === 'up-text' ? 'up' : dayCls === 'down-text' ? 'down' : ''}">
          วันนี้ ${signed(s.dayChangeTHB, 0)} (${signed(s.dayChangePct, 2)}%)
        </span>
        <span class="chip">USD/THB ${fmt(d.usdthb, 2)}</span>
      </div>
      ${alloc.length ? `
      <div class="alloc">${alloc.map((a, i) =>
        `<span style="width:${Math.max(a.pct, 0)}%;background:${ALLOC_COLORS[i % ALLOC_COLORS.length]}"></span>`).join('')}</div>
      <div class="alloc-legend">${alloc.map((a, i) =>
        `<span><i style="background:${ALLOC_COLORS[i % ALLOC_COLORS.length]}"></i>${esc(a.label)} ${fmt(a.pct, 1)}%</span>`).join('')}</div>` : ''}
    </div>

    <div class="split">
      <div class="card">
        <div class="kv"><span class="k">กำไรยังไม่รับรู้</span></div>
        <div class="hero-label ${plClass(s.unrealTotalTHB)}" style="font-size:20px;font-weight:400">${signed(s.unrealTotalTHB, 0)}</div>
        <div class="kv"><span class="k">จากตัวหุ้น</span><span class="v ${plClass(s.unrealStockTHB)}">${signed(s.unrealStockTHB, 0)}</span></div>
        <div class="kv"><span class="k">จากค่าเงิน</span><span class="v ${plClass(s.unrealFxTHB)}">${signed(s.unrealFxTHB, 0)}</span></div>
      </div>
      <div class="card">
        <div class="kv"><span class="k">กำไรที่รับรู้แล้ว</span></div>
        <div class="hero-label ${plClass(s.realizedTotalTHB)}" style="font-size:20px;font-weight:400">${signed(s.realizedTotalTHB, 0)}</div>
        <div class="kv"><span class="k">จากตัวหุ้น</span><span class="v ${plClass(s.realizedStockTHB)}">${signed(s.realizedStockTHB, 0)}</span></div>
        <div class="kv"><span class="k">จากค่าเงิน</span><span class="v ${plClass(s.realizedFxTHB)}">${signed(s.realizedFxTHB, 0)}</span></div>
      </div>
    </div>

    <div class="section-head"><h2>หุ้นที่ถืออยู่</h2>
      <button class="btn-sm" data-open="tx">บันทึกรายการ</button></div>
    ${d.positions.length ? positions : `
      <div class="empty"><strong>ยังไม่มีหุ้นในพอร์ต</strong>
      เริ่มจากบันทึกเงินฝากเข้าพอร์ต แล้วบันทึกรายการซื้อหุ้นตัวแรก</div>`}

    <div class="section-head"><h2>เงินสด</h2></div>
    <div class="card">
      ${d.cash.length ? d.cash.map(c => `
        <div class="kv">
          <span class="k">${esc(c.currency)}${c.currency !== 'THB' ? ` · ทุนเฉลี่ย ${fmt(c.avgFxRate, 2)}` : ''}</span>
          <span class="v">${fmt(c.balance, 2)}${c.currency !== 'THB' ? ` <span class="muted">(${fmt(c.valueTHB, 0)} บาท)</span>` : ''}</span>
        </div>
        ${c.currency !== 'THB' ? `<div class="kv"><span class="k">กำไรค่าเงินบนเงินสด</span><span class="v ${plClass(c.unrealFxTHB)}">${signed(c.unrealFxTHB, 0)}</span></div>` : ''}
      `).join('') : '<div class="muted">ยังไม่มีเงินสดในพอร์ต</div>'}
    </div>

    <p class="hint">อัปเดตเมื่อ ${esc(d.asOf)}</p>
  `;

  $$('.pos', v).forEach(node => {
    node.addEventListener('click', (ev) => {
      if (ev.target.closest('button')) return;
      const det = $('.pos-detail', node);
      det.hidden = !det.hidden;
    });
  });
}

// ---------- หน้ารายการธุรกรรม ----------

const TX_LABEL = {
  BUY: 'ซื้อ', SELL: 'ขาย', DEPOSIT: 'ฝากเงิน', WITHDRAW: 'ถอนเงิน',
  FX_CONVERT: 'แลกเงิน', DIVIDEND: 'เงินปันผล', FEE: 'ค่าธรรมเนียม', ADJUST: 'ปรับปรุง'
};

async function renderTransactions() {
  const v = view('transactions');
  v.innerHTML = skeleton(5);
  try {
    const rows = await api('tx.list', { limit: 200 });
    v.innerHTML = `
      <div class="section-head"><h2>ธุรกรรมทั้งหมด</h2>
        <button class="btn-sm" data-open="tx">บันทึกรายการ</button></div>
      ${rows.length ? `<div class="card">${rows.map(t => `
        <div class="list-row">
          <div>
            <div><span class="tag ${t.type === 'BUY' ? 'buy' : t.type === 'SELL' ? 'sell' : 'cash'}">${TX_LABEL[t.type] || t.type}</span>
              <strong>${esc(t.symbol || t.currency)}</strong></div>
            <div class="pos-sub">${esc(t.date)}${t.quantity ? ` · ${fmt(t.quantity, t.quantity % 1 ? 4 : 0)} @ ${fmt(t.price, 2)}` : ''}${t.currency !== 'THB' ? ` · FX ${fmt(t.fxRate, 2)}` : ''}</div>
            ${t.note ? `<div class="pos-sub">${esc(t.note)}</div>` : ''}
          </div>
          <div style="text-align:right">
            <div>${fmt(t.amountLocal, 2)} <span class="muted">${esc(t.currency)}</span></div>
            <button class="link-btn danger" data-del-tx="${esc(t.txId)}">ลบ</button>
          </div>
        </div>`).join('')}</div>` : `
        <div class="empty"><strong>ยังไม่มีธุรกรรม</strong>
        บันทึกเงินฝากเข้าพอร์ตเป็นรายการแรก เพื่อให้ยอดเงินสดตรงกับความจริง</div>`}
    `;
  } catch (e) {
    v.innerHTML = `<div class="empty"><strong>โหลดรายการไม่สำเร็จ</strong>${esc(e.message)}</div>`;
  }
}

// ---------- หน้าเตือนราคา ----------

const COND_LABEL = {
  PRICE_ABOVE: 'ราคาขึ้นถึง', PRICE_BELOW: 'ราคาลงถึง',
  CHANGE_UP: 'บวกเกิน', CHANGE_DOWN: 'ลบเกิน',
  POSITION_PL_BELOW: 'ขาดทุนเกิน', FX_ABOVE: 'USD/THB ขึ้นถึง', FX_BELOW: 'USD/THB ลงถึง',
  PORTFOLIO_ABOVE: 'พอร์ตถึง', PORTFOLIO_BELOW: 'พอร์ตต่ำกว่า'
};
const PCT_CONDS = ['CHANGE_UP', 'CHANGE_DOWN', 'POSITION_PL_BELOW'];

async function renderAlerts() {
  const v = view('alerts');
  v.innerHTML = skeleton(5);
  try {
    const [alerts, log] = await Promise.all([api('alerts.list'), api('alerts.log', { limit: 30 })]);
    el('alert-dot').hidden = !alerts.some(a => a.status === 'triggered');

    v.innerHTML = `
      <div class="section-head"><h2>เงื่อนไขที่ตั้งไว้</h2>
        <button class="btn-sm" data-open="alert">ตั้งเตือนใหม่</button></div>
      ${alerts.length ? `<div class="card">${alerts.map(a => `
        <div class="list-row">
          <div>
            <div><strong>${esc(a.symbol || (a.condition.indexOf('FX') === 0 ? 'ค่าเงิน' : 'พอร์ตรวม'))}</strong>
              ${a.status === 'triggered' ? '<span class="tag alert">เตือนแล้ว</span>' : ''}</div>
            <div class="pos-sub">${COND_LABEL[a.condition] || a.condition} ${fmt(a.targetValue, 2)}${PCT_CONDS.includes(a.condition) ? '%' : ''}
              · ส่งทาง ${esc(a.channel)}${a.repeat ? ' · เตือนซ้ำได้' : ' · ครั้งเดียว'}</div>
            ${a.lastFiredAt ? `<div class="pos-sub">เตือนล่าสุด ${esc(a.lastFiredAt)}</div>` : ''}
          </div>
          <div style="text-align:right;display:flex;flex-direction:column;gap:6px">
            <button class="link-btn" data-toggle-alert="${esc(a.alertId)}|${a.status}">${a.status === 'active' ? 'พัก' : 'เปิดใหม่'}</button>
            <button class="link-btn danger" data-del-alert="${esc(a.alertId)}">ลบ</button>
          </div>
        </div>`).join('')}</div>` : `
        <div class="empty"><strong>ยังไม่มีการเตือน</strong>
        ตั้งราคาเป้าหมายไว้ แล้วระบบจะตรวจให้ทุก 15 นาทีและส่งแจ้งเตือนให้</div>`}

      <div class="section-head"><h2>ประวัติการเตือน</h2></div>
      ${log.length ? `<div class="card">${log.map(l => `
        <div class="list-row">
          <div><div><strong>${esc(l.symbol)}</strong> <span class="muted">${COND_LABEL[l.condition] || l.condition} ${fmt(l.targetValue, 2)}</span></div>
            <div class="pos-sub">${esc(l.firedAt)} · ส่งทาง ${esc(l.result)}</div></div>
          <div style="text-align:right">${fmt(l.priceAtFire, 2)}</div>
        </div>`).join('')}</div>`
        : '<div class="empty">ยังไม่มีการเตือนเกิดขึ้น</div>'}
    `;
  } catch (e) {
    v.innerHTML = `<div class="empty"><strong>โหลดการเตือนไม่สำเร็จ</strong>${esc(e.message)}</div>`;
  }
}

// ---------- หน้าติดตาม ----------

async function renderWatchlist() {
  const v = view('watchlist');
  v.innerHTML = skeleton(4);
  try {
    const rows = await api('watchlist.list', {});
    v.innerHTML = `
      <div class="section-head"><h2>หุ้นที่จับตาดู</h2>
        <button class="btn-sm" data-open="watch">เพิ่มหุ้น</button></div>
      ${rows.length ? rows.map(w => `
        <article class="pos">
          <div>
            <div class="pos-sym">${esc(w.symbol)}<span class="mkt">${esc(w.market)}</span></div>
            <div class="pos-sub">${w.targetPrice ? `เป้า ${fmt(w.targetPrice, 2)} ${esc(w.currency)}` : 'ยังไม่ตั้งเป้า'}${w.note ? ' · ' + esc(w.note) : ''}</div>
          </div>
          <div>
            <div class="pos-val">${fmt(w.price, 2)} <span class="muted">${esc(w.currency)}</span></div>
            <div class="pos-chg ${plClass(w.changePct)}">${signed(w.changePct, 2)}%</div>
          </div>
          <div class="pos-detail" hidden>
            <button class="btn-sm" data-quick-alert="${esc(w.symbol)}|${esc(w.market)}|${esc(w.currency)}|${w.price}">ตั้งเตือนราคา</button>
            <button class="btn-sm" data-del-watch="${esc(w.watchId)}">ลบออก</button>
          </div>
        </article>`).join('') : `
        <div class="empty"><strong>ยังไม่มีหุ้นที่ติดตาม</strong>
        เพิ่มหุ้นที่สนใจไว้ดูราคา โดยยังไม่ต้องบันทึกเป็นธุรกรรม</div>`}
    `;
    $$('.pos', v).forEach(node => node.addEventListener('click', (ev) => {
      if (ev.target.closest('button')) return;
      const det = $('.pos-detail', node);
      det.hidden = !det.hidden;
    }));
  } catch (e) {
    v.innerHTML = `<div class="empty"><strong>โหลดรายการไม่สำเร็จ</strong>${esc(e.message)}</div>`;
  }
}

// ---------- หน้าตั้งค่า ----------

async function renderSettings() {
  const v = view('settings');
  v.innerHTML = skeleton(5);
  try {
    const st = await api('system.status');
    v.innerHTML = `
      <div class="section-head"><h2>บัญชี</h2></div>
      <div class="card">
        <div class="kv"><span class="k">ผู้ใช้</span><span class="v">${esc(state.user ? state.user.displayName : '')}</span></div>
        <div class="kv"><span class="k">สกุลเงินฐาน</span><span class="v">บาท (THB)</span></div>
        <div class="kv"><span class="k">USD/THB ล่าสุด</span><span class="v">${fmt(st.usdthb, 4)}</span></div>
      </div>

      <div class="section-head"><h2>ระบบ</h2></div>
      <div class="card">
        <div class="kv"><span class="k">เวอร์ชัน</span><span class="v">${esc(st.version)} · Phase ${st.phase}</span></div>
        <div class="kv"><span class="k">เวลาเซิร์ฟเวอร์</span><span class="v">${esc(st.serverTime)}</span></div>
        <div class="kv"><span class="k">อายุแคชราคา</span><span class="v">${st.priceCacheMinutes} นาที</span></div>
        <div class="kv"><span class="k">ช่องทางเตือน</span><span class="v">${esc(st.alertChannel)}${st.telegramLinked ? ' · ผูก Telegram แล้ว' : ''}</span></div>
        <div class="kv"><span class="k">สำรองข้อมูลล่าสุด</span><span class="v">${st.backup.latestAt ? esc(st.backup.latestAt) : 'ยังไม่มี'}</span></div>
        <div class="kv"><span class="k">ไฟล์สำรองที่เก็บไว้</span><span class="v">${st.backup.fileCount} ไฟล์ (เก็บ ${st.backup.keepDays} วัน)</span></div>
      </div>

      <div class="section-head"><h2>การจัดการ</h2></div>
      <button class="btn btn-ghost" id="s-test-alert">ทดสอบส่งแจ้งเตือน</button>
      <button class="btn btn-ghost" id="s-backup">สำรองข้อมูลตอนนี้</button>
      <button class="btn btn-ghost" id="s-rebuild">คำนวณพอร์ตใหม่จากธุรกรรม</button>
      <button class="btn btn-ghost" id="s-install" ${state.installPrompt ? '' : 'hidden'}>ติดตั้งลงหน้าจอหลัก</button>
      <button class="btn btn-danger" id="s-logout">ออกจากระบบ</button>

      ${st.recentErrors.length ? `
        <div class="section-head"><h2>ข้อผิดพลาดล่าสุด</h2></div>
        <div class="card">${st.recentErrors.map(e2 => `
          <div class="list-row"><div>
            <div class="pos-sub">${esc(e2.ts)} · ${esc(e2.where)}</div>
            <div>${esc(e2.message)}</div>
          </div></div>`).join('')}</div>` : ''}

      <p class="hint">เซิร์ฟเวอร์: ${esc(state.apiUrl)}</p>
    `;

    el('s-logout').onclick = () => signOut();
    el('s-test-alert').onclick = () => run('ส่งทดสอบแล้ว', () => api('alerts.test'));
    el('s-backup').onclick = () => run('สำรองข้อมูลแล้ว', () => api('backup.run'));
    el('s-rebuild').onclick = () => run('คำนวณพอร์ตใหม่แล้ว', async () => {
      await api('portfolio.rebuild');
      await refresh(true);
    });
    const inst = el('s-install');
    if (inst) inst.onclick = async () => {
      if (!state.installPrompt) return;
      state.installPrompt.prompt();
      state.installPrompt = null;
      inst.hidden = true;
    };
  } catch (e) {
    v.innerHTML = `<div class="empty"><strong>โหลดสถานะไม่สำเร็จ</strong>${esc(e.message)}</div>`;
  }
}

async function run(okMsg, fn) {
  setBusy(true);
  try { await fn(); toast(okMsg); }
  catch (e) { toast(e.message, true); }
  finally { setBusy(false); }
}

// ---------- แผงฟอร์ม ----------

function openSheet(title, html, onReady) {
  el('sheet-title').textContent = title;
  el('sheet-body').innerHTML = html;
  el('sheet').hidden = false;
  if (onReady) onReady(el('sheet-body'));
}

function closeSheet() {
  el('sheet').hidden = true;
  el('sheet-body').innerHTML = '';
}

function sheetTx(prefill) {
  const p = prefill || {};
  openSheet('บันทึกรายการ', `
    <div class="seg" id="tx-type">
      ${['BUY', 'SELL', 'DEPOSIT', 'WITHDRAW'].map((t, i) =>
        `<button data-type="${t}" class="${i === 0 ? 'is-on' : ''}">${TX_LABEL[t]}</button>`).join('')}
    </div>
    <div class="seg" id="tx-type2">
      ${['DIVIDEND', 'FX_CONVERT', 'FEE'].map(t =>
        `<button data-type="${t}">${TX_LABEL[t]}</button>`).join('')}
    </div>

    <div class="field"><label for="f-date">วันที่</label>
      <input id="f-date" type="date" value="${new Date().toISOString().slice(0, 10)}"></div>

    <div id="tx-symbol">
      <div class="field-row">
        <div class="field"><label for="f-symbol">ชื่อหุ้น</label>
          <input id="f-symbol" type="text" autocapitalize="characters" spellcheck="false"
                 placeholder="เช่น PTT หรือ AAPL" value="${esc(p.symbol || '')}"></div>
        <div class="field"><label for="f-market">ตลาด</label>
          <select id="f-market">
            <option value="SET" ${p.market === 'US' ? '' : 'selected'}>SET (ไทย)</option>
            <option value="US" ${p.market === 'US' ? 'selected' : ''}>US (NYSE/NASDAQ)</option>
          </select></div>
      </div>
    </div>

    <div id="tx-trade">
      <div class="field-row">
        <div class="field"><label for="f-qty">จำนวนหุ้น</label>
          <input id="f-qty" type="number" inputmode="decimal" step="any" placeholder="0"></div>
        <div class="field"><label for="f-price">ราคาต่อหุ้น</label>
          <input id="f-price" type="number" inputmode="decimal" step="any" placeholder="0" value="${p.price || ''}"></div>
      </div>
      <div class="field-row">
        <div class="field"><label for="f-fee">ค่าธรรมเนียม</label>
          <input id="f-fee" type="number" inputmode="decimal" step="any" placeholder="0"></div>
        <div class="field"><label for="f-tax">ภาษี/VAT</label>
          <input id="f-tax" type="number" inputmode="decimal" step="any" placeholder="0"></div>
      </div>
    </div>

    <div id="tx-cash" hidden>
      <div class="field-row">
        <div class="field"><label for="f-amount">จำนวนเงิน</label>
          <input id="f-amount" type="number" inputmode="decimal" step="any" placeholder="0"></div>
        <div class="field"><label for="f-currency">สกุลเงิน</label>
          <select id="f-currency"><option value="THB">THB</option><option value="USD">USD</option></select></div>
      </div>
    </div>

    <div id="tx-fx" hidden>
      <div class="field"><label for="f-direction">ทิศทางการแลก</label>
        <select id="f-direction">
          <option value="THB>USD">บาท → ดอลลาร์</option>
          <option value="USD>THB">ดอลลาร์ → บาท</option>
        </select></div>
      <div class="field"><label for="f-fxamount">จำนวนดอลลาร์</label>
        <input id="f-fxamount" type="number" inputmode="decimal" step="any" placeholder="0"></div>
    </div>

    <div class="field" id="tx-fxrate-wrap" hidden>
      <label for="f-fxrate">อัตราแลกเปลี่ยน (บาทต่อ 1 ดอลลาร์)</label>
      <input id="f-fxrate" type="number" inputmode="decimal" step="any"
             placeholder="ปล่อยว่างเพื่อใช้เรตล่าสุด">
    </div>

    <div class="field"><label for="f-note">บันทึกช่วยจำ</label>
      <input id="f-note" type="text" placeholder="เหตุผลที่ซื้อ/ขาย (ไม่บังคับ)"></div>

    <button class="btn btn-primary" id="f-save">บันทึกรายการ</button>
  `, (root) => {
    let type = p.type || 'BUY';

    const sync = () => {
      const isTrade = type === 'BUY' || type === 'SELL';
      const isFx = type === 'FX_CONVERT';
      const needsSymbol = isTrade || type === 'DIVIDEND';

      $('#tx-symbol', root).hidden = !needsSymbol;
      $('#tx-trade', root).hidden = !isTrade;
      $('#tx-cash', root).hidden = isTrade || isFx;
      $('#tx-fx', root).hidden = !isFx;

      const market = $('#f-market', root).value;
      const cur = $('#f-currency', root).value;
      const needFx = isFx || (isTrade && market === 'US') || (!isTrade && cur === 'USD');
      $('#tx-fxrate-wrap', root).hidden = !needFx;
    };

    $$('#tx-type button, #tx-type2 button', root).forEach(b => {
      if (b.dataset.type === type) b.classList.add('is-on');
      b.addEventListener('click', () => {
        type = b.dataset.type;
        $$('#tx-type button, #tx-type2 button', root).forEach(x => x.classList.remove('is-on'));
        b.classList.add('is-on');
        sync();
      });
    });
    $('#f-market', root).addEventListener('change', sync);
    $('#f-currency', root).addEventListener('change', sync);
    sync();

    $('#f-save', root).addEventListener('click', async () => {
      const market = $('#f-market', root).value;
      const body = {
        type,
        date: $('#f-date', root).value,
        note: $('#f-note', root).value,
        fxRate: Number($('#f-fxrate', root).value) || 0
      };

      if (type === 'BUY' || type === 'SELL') {
        body.symbol = $('#f-symbol', root).value.trim().toUpperCase();
        body.market = market;
        body.currency = market === 'US' ? 'USD' : 'THB';
        body.quantity = Number($('#f-qty', root).value);
        body.price = Number($('#f-price', root).value);
        body.fee = Number($('#f-fee', root).value) || 0;
        body.tax = Number($('#f-tax', root).value) || 0;
      } else if (type === 'FX_CONVERT') {
        body.symbol = $('#f-direction', root).value;
        body.market = 'FX';
        body.currency = 'USD';
        body.quantity = Number($('#f-fxamount', root).value);
      } else if (type === 'DIVIDEND') {
        body.symbol = $('#f-symbol', root).value.trim().toUpperCase();
        body.market = market;
        body.currency = $('#f-currency', root).value;
        body.amount = Number($('#f-amount', root).value);
      } else {
        body.market = 'CASH';
        body.currency = $('#f-currency', root).value;
        body.amount = Number($('#f-amount', root).value);
      }

      const btn = $('#f-save', root);
      btn.disabled = true;
      try {
        const r = await api('tx.add', body);
        closeSheet();
        toast('บันทึกแล้ว');
        (r.warnings || []).forEach(w => toast(w, true));
        await refresh(false);
        if (state.tab === 'transactions') renderTransactions();
      } catch (e) {
        toast(e.message, true);
        btn.disabled = false;
      }
    });
  });
}

function sheetAlert(prefill) {
  const p = prefill || {};
  openSheet('ตั้งเตือนราคา', `
    <div class="field"><label for="a-cond">เงื่อนไข</label>
      <select id="a-cond">
        ${Object.keys(COND_LABEL).map(c =>
          `<option value="${c}" ${c === (p.condition || 'PRICE_BELOW') ? 'selected' : ''}>${COND_LABEL[c]}</option>`).join('')}
      </select></div>

    <div id="a-symwrap">
      <div class="field-row">
        <div class="field"><label for="a-symbol">ชื่อหุ้น</label>
          <input id="a-symbol" type="text" autocapitalize="characters" spellcheck="false"
                 value="${esc(p.symbol || '')}" placeholder="เช่น PTT"></div>
        <div class="field"><label for="a-market">ตลาด</label>
          <select id="a-market">
            <option value="SET" ${p.market === 'US' ? '' : 'selected'}>SET</option>
            <option value="US" ${p.market === 'US' ? 'selected' : ''}>US</option>
          </select></div>
      </div>
    </div>

    <div class="field"><label for="a-target" id="a-target-label">ราคาเป้าหมาย</label>
      <input id="a-target" type="number" inputmode="decimal" step="any"
             value="${p.price ? Number(p.price).toFixed(2) : ''}" placeholder="0"></div>

    <div class="field"><label for="a-channel">ส่งแจ้งเตือนทาง</label>
      <select id="a-channel">
        <option value="email">อีเมล</option>
        <option value="telegram">Telegram</option>
        <option value="all">ทั้งสองช่องทาง</option>
        <option value="inapp">เก็บไว้ในแอปเท่านั้น</option>
      </select></div>

    <div class="field">
      <label><input id="a-repeat" type="checkbox" style="width:auto;margin-right:8px">
        เตือนซ้ำได้เมื่อเข้าเงื่อนไขอีก (เว้นอย่างน้อย 1 ชั่วโมง)</label>
    </div>

    <div class="field"><label for="a-note">บันทึกช่วยจำ</label>
      <input id="a-note" type="text" placeholder="เช่น ถึงราคานี้แล้วทยอยซื้อ"></div>

    <button class="btn btn-primary" id="a-save">ตั้งเตือน</button>
  `, (root) => {
    const sync = () => {
      const c = $('#a-cond', root).value;
      const needsSymbol = ['PRICE_ABOVE', 'PRICE_BELOW', 'CHANGE_UP', 'CHANGE_DOWN', 'POSITION_PL_BELOW'].includes(c);
      $('#a-symwrap', root).hidden = !needsSymbol;
      $('#a-target-label', root).textContent =
        PCT_CONDS.includes(c) ? 'เปอร์เซ็นต์ที่ต้องการให้เตือน' :
        c.indexOf('PORTFOLIO') === 0 ? 'มูลค่าพอร์ต (บาท)' :
        c.indexOf('FX') === 0 ? 'อัตรา USD/THB' : 'ราคาเป้าหมาย';
    };
    $('#a-cond', root).addEventListener('change', sync);
    sync();

    $('#a-save', root).addEventListener('click', async () => {
      const market = $('#a-market', root).value;
      const body = {
        condition: $('#a-cond', root).value,
        symbol: $('#a-symbol', root).value.trim().toUpperCase(),
        market,
        currency: market === 'US' ? 'USD' : 'THB',
        targetValue: Number($('#a-target', root).value),
        channel: $('#a-channel', root).value,
        repeat: $('#a-repeat', root).checked,
        note: $('#a-note', root).value
      };
      const btn = $('#a-save', root);
      btn.disabled = true;
      try {
        await api('alerts.add', body);
        closeSheet();
        toast('ตั้งเตือนแล้ว');
        if (state.tab === 'alerts') renderAlerts();
      } catch (e) {
        toast(e.message, true);
        btn.disabled = false;
      }
    });
  });
}

function sheetWatch() {
  openSheet('เพิ่มหุ้นที่ติดตาม', `
    <div class="field-row">
      <div class="field"><label for="w-symbol">ชื่อหุ้น</label>
        <input id="w-symbol" type="text" autocapitalize="characters" spellcheck="false" placeholder="เช่น AOT"></div>
      <div class="field"><label for="w-market">ตลาด</label>
        <select id="w-market"><option value="SET">SET</option><option value="US">US</option></select></div>
    </div>
    <div class="field"><label for="w-target">ราคาที่สนใจ</label>
      <input id="w-target" type="number" inputmode="decimal" step="any" placeholder="ไม่บังคับ"></div>
    <div class="field"><label for="w-note">บันทึกช่วยจำ</label>
      <input id="w-note" type="text" placeholder="เหตุผลที่สนใจ"></div>
    <button class="btn btn-primary" id="w-save">เพิ่มเข้ารายการ</button>
  `, (root) => {
    $('#w-save', root).addEventListener('click', async () => {
      const market = $('#w-market', root).value;
      const btn = $('#w-save', root);
      btn.disabled = true;
      try {
        await api('watchlist.add', {
          symbol: $('#w-symbol', root).value.trim().toUpperCase(),
          market,
          currency: market === 'US' ? 'USD' : 'THB',
          targetPrice: Number($('#w-target', root).value) || 0,
          note: $('#w-note', root).value
        });
        closeSheet();
        toast('เพิ่มแล้ว');
        renderWatchlist();
      } catch (e) {
        toast(e.message, true);
        btn.disabled = false;
      }
    });
  });
}

// ---------- ผูกเหตุการณ์ ----------

document.addEventListener('click', async (ev) => {
  const t = ev.target;

  if (t.closest('[data-close]')) return closeSheet();

  const tab = t.closest('.tab');
  if (tab) return switchTab(tab.dataset.tab);

  const open = t.closest('[data-open]');
  if (open) {
    const kind = open.dataset.open;
    if (kind === 'tx') return sheetTx();
    if (kind === 'alert') return sheetAlert();
    if (kind === 'watch') return sheetWatch();
  }

  const qa = t.closest('[data-quick-alert]');
  if (qa) {
    const [symbol, market, currency, price] = qa.dataset.quickAlert.split('|');
    return sheetAlert({ symbol, market, currency, price, condition: 'PRICE_BELOW' });
  }

  const qt = t.closest('[data-quick-tx]');
  if (qt) {
    const [symbol, market, currency, price] = qt.dataset.quickTx.split('|');
    return sheetTx({ symbol, market, currency, price });
  }

  const delTx = t.closest('[data-del-tx]');
  if (delTx) {
    if (!confirm('ลบธุรกรรมนี้และคำนวณพอร์ตใหม่?')) return;
    return run('ลบแล้ว', async () => {
      await api('tx.delete', { txId: delTx.dataset.delTx });
      await renderTransactions();
      await refresh(false);
    });
  }

  const delAlert = t.closest('[data-del-alert]');
  if (delAlert) {
    return run('ลบแล้ว', async () => {
      await api('alerts.delete', { alertId: delAlert.dataset.delAlert });
      await renderAlerts();
    });
  }

  const tg = t.closest('[data-toggle-alert]');
  if (tg) {
    const [alertId, status] = tg.dataset.toggleAlert.split('|');
    return run('อัปเดตแล้ว', async () => {
      await api('alerts.update', { alertId, status: status === 'active' ? 'paused' : 'active' });
      await renderAlerts();
    });
  }

  const delWatch = t.closest('[data-del-watch]');
  if (delWatch) {
    return run('ลบแล้ว', async () => {
      await api('watchlist.remove', { watchId: delWatch.dataset.delWatch });
      await renderWatchlist();
    });
  }
});

el('btn-refresh').addEventListener('click', async () => {
  if (state.busy) return;
  await refresh(true);
  if (state.tab !== 'dashboard') renderTab(state.tab);
});

el('g-login').addEventListener('click', () => gateSubmit('login'));
el('g-register').addEventListener('click', () => gateSubmit('register'));
el('g-pin').addEventListener('keydown', (e) => { if (e.key === 'Enter') gateSubmit('login'); });

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

window.addEventListener('online', () => { banner(''); refresh(false); });
window.addEventListener('offline', () => banner('ออฟไลน์ — แสดงข้อมูลที่บันทึกไว้ล่าสุด'));

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  state.installPrompt = e;
  const b = el('s-install');
  if (b) b.hidden = false;
});

// ---------- เริ่มทำงาน ----------

(function init() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  const cached = JSON.parse(localStorage.getItem(LS.dash) || 'null');
  if (cached) state.dashboard = cached.data;

  // ทางลัดจากไอคอนบนหน้าจอหลัก เช่น ?tab=alerts
  const wanted = new URLSearchParams(location.search).get('tab');
  if (wanted && ['dashboard', 'transactions', 'alerts', 'watchlist', 'settings'].includes(wanted)) {
    state.tab = wanted;
  }

  if (state.token && state.apiUrl) {
    showApp();
    refresh(false);
  } else {
    showGate();
  }

  // อัปเดตราคาอัตโนมัติเมื่อกลับมาที่แอป
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.token && state.tab === 'dashboard') refresh(false);
  });
})();
