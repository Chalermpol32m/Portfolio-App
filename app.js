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
  subTab: 'tx',
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

  // คำสั่งที่เปลี่ยนพอร์ต ทำให้ผลวิเคราะห์ที่จำไว้ในแอปเก่าไป
  if (/^(tx\.(add|delete)|dividends\.(add|confirm|delete)|portfolio\.rebuild)$/.test(action)) {
    state.perf = null;
    state.risk = null;
    state.pfDiv = null;
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
  loadAccounts();
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
  // หน้า Portfolio เปิดจาก Dashboard จึงให้แท็บ "พอร์ต" ยังสว่างอยู่
  $$('.tab').forEach(b => b.classList.toggle('is-active', b.dataset.tab === (tab === 'portfolio' ? 'dashboard' : tab)));
  $$('.view').forEach(v => { v.hidden = v.dataset.view !== tab; });
  el('top-title').textContent = {
    dashboard: 'พอร์ต', transactions: 'รายการ', alerts: 'เตือนราคา',
    watchlist: 'ติดตาม', settings: 'ตั้งค่า', portfolio: 'พอร์ตการลงทุน'
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
  if (tab === 'portfolio') return renderPortfolio();
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
    backgroundWebullSync();
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

/**
 * ซิงก์ Webull เบื้องหลังทุกครั้งที่เปิดแอป/รีเฟรช ไม่บังหน้าจอ ถ้ามีรายการใหม่ค่อยโหลดพอร์ตใหม่
 * เว้นอย่างน้อย 60 วินาทีต่อครั้งฝั่งแอป (หลังบ้านกันซ้ำอีกชั้น)
 */
async function backgroundWebullSync() {
  const now = Date.now();
  if (state.wbSyncing || now - (state.wbLastSync || 0) < 60000) return;
  state.wbSyncing = true;
  state.wbLastSync = now;
  try {
    const r = await api('webull.autoSync');
    if (r && r.created > 0) {
      toast(`ดึงรายการใหม่จาก Webull ${r.created} รายการ`);
      const d = await api('portfolio.dashboard', { force: false });
      state.dashboard = d;
      localStorage.setItem(LS.dash, JSON.stringify({ at: Date.now(), data: d }));
      if (state.tab === 'dashboard') renderDashboard();
    }
  } catch (e) {
    /* ซิงก์เบื้องหลังล้มเหลวไม่ต้องรบกวนผู้ใช้ ทริกเกอร์จะลองใหม่เอง */
  } finally {
    state.wbSyncing = false;
  }
}

function renderMarketPills(markets) {
  el('market-pills').innerHTML = (markets || []).map(m =>
    `<span class="pill ${m.isOpen ? 'is-open' : ''}">${esc(m.market)} ${m.isOpen ? 'เปิด' : 'ปิด'}</span>`
  ).join('');
}

const ACT_ICON = { BUY: '🟢', SELL: '🔴', DIVIDEND: '💰', DEPOSIT: '💵', WITHDRAW: '💸',
                   FX_CONVERT: '💱', TRANSFER: '🔁', FEE: '🧾', ADJUST: '➕' };

function activityRow(t) {
  const acc = t.type === 'TRANSFER' ? `${esc(t.account)} → ${esc(t.toAccount)}` : esc(t.account || '');
  const what = t.type === 'BUY' || t.type === 'SELL'
    ? `${esc(t.symbol)} ${fmt(t.quantity, t.quantity % 1 ? 4 : 0)} @ ${fmt(t.price, 2)}`
    : t.type === 'FX_CONVERT' ? esc(t.symbol) : esc(t.symbol || '');
  return `
    <div class="list-row">
      <div><div>${ACT_ICON[t.type] || '•'} <strong>${TX_LABEL[t.type] || t.type}</strong> ${what}</div>
        <div class="pos-sub">${esc(t.date)}${acc ? ' · ' + acc : ''}</div></div>
      <div style="text-align:right">${fmt(t.amount, 2)} <span class="muted">${esc(t.currency)}</span></div>
    </div>`;
}

const ALLOC_COLORS = ['#6E8BD6', '#4FC08D', '#F2B544', '#B67FD0', '#5FB6C4', '#E08A5B', '#8D96B2'];

/** กราฟวงกลมสัดส่วนการลงทุน — SVG ล้วน ไม่ต้องใช้ไลบรารี */
function donutChart(alloc) {
  const size = 104, stroke = 15, r = (size - stroke) / 2, c = 2 * Math.PI * r;
  let offset = 0;
  const arcs = alloc.map((a, i) => {
    const frac = Math.max(a.pct, 0) / 100;
    const seg = `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none"
        stroke="${ALLOC_COLORS[i % ALLOC_COLORS.length]}" stroke-width="${stroke}"
        stroke-dasharray="${(frac * c).toFixed(2)} ${c.toFixed(2)}"
        stroke-dashoffset="${(-offset * c).toFixed(2)}" stroke-linecap="butt"/>`;
    offset += frac;
    return seg;
  }).join('');
  return `
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="transform:rotate(-90deg)">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="${stroke}"/>
      ${arcs}
    </svg>`;
}

/** เลขนับวิ่งขึ้น ใช้กับยอดรวมพอร์ตตอนโหลดข้อมูลใหม่ ทำงานไม่ถึง 500ms ตามหลัก micro-interaction */
function animateCount(el2, to, decimals) {
  const from = Number(el2.dataset.val) || 0;
  el2.dataset.val = to;
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches && Math.abs(to - from) > 0.5) {
    const dur = 820, t0 = performance.now();
    const step = (t) => {
      const p = Math.min(1, (t - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      el2.textContent = fmt(from + (to - from) * eased, decimals || 0);
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  } else {
    el2.textContent = fmt(to, decimals || 0);
  }
}

/**
 * การ์ดกำไรขาดทุนจากค่าเงินของดอลลาร์ที่ถืออยู่ — ใช้ข้อมูลที่หลังบ้านคำนวณอยู่แล้ว (ทุนเฉลี่ยของเงินสดดอลลาร์)
 * แอปแลกเงินเองไม่ได้ (Webull API ไม่มีคำสั่งแลกเงิน และแอปเราอ่านอย่างเดียว)
 * จึงให้ตั้งเตือนเมื่อค่าเงินถึงเป้า แล้วไปแลกในแอป Webull และบันทึกกลับด้วยภาพ
 */
function fxCard(c, rate, spread, brokerFx, brokerFxAt) {
  // มีเรตของ Webull จากการซิงก์ → ใช้ตรงๆ ไม่มี → ใช้ส่วนต่างที่ตั้งไว้ใน Settings
  const hasBroker = Number(brokerFx) > 0;
  const sp = hasBroker ? rate - Number(brokerFx)
    : (Number(spread) >= 0 && spread !== undefined && spread !== null ? Number(spread) : 0.03);
  const cost = c.balance * c.avgFxRate;
  const pct = cost > 0 ? c.unrealFxTHB / cost * 100 : 0;
  const cls = plClass(c.unrealFxTHB);
  // ถ้าแลกกลับตอนนี้จริง: Webull รับซื้อที่ เรตตลาด − ส่วนต่าง
  const sellRate = hasBroker ? Number(brokerFx) : rate - sp;
  const netNow = c.balance * (sellRate - c.avgFxRate);
  const breakEven = c.avgFxRate + sp;                              // เรตตลาดที่ต้องถึงก่อนจะเริ่มกำไรจริง
  // เป้าเริ่มต้น: กำไรสุทธิ 2% — มีเรต Webull เตือนด้วยเรตนั้นตรงๆ ไม่มีค่อยใช้เรตตลาด + ส่วนต่าง
  const alertCond = hasBroker ? 'WBFX_ABOVE' : 'FX_ABOVE';
  const target = Math.ceil((c.avgFxRate * 1.02 + (hasBroker ? 0 : sp)) * 100) / 100;
  return `
    <div class="section-head"><h2>ค่าเงินดอลลาร์ที่ถืออยู่</h2></div>
    <div class="card card-secondary">
      <div class="kv"><span class="k">ถืออยู่</span><span class="v">${fmt(c.balance, 2)} USD</span></div>
      <div class="kv"><span class="k">ทุนเฉลี่ย → เรตตลาดตอนนี้</span>
        <span class="v">${fmt(c.avgFxRate, 3)} → ${fmt(rate, 3)}</span></div>
      <div class="kv" style="margin-top:4px"><span class="k">กำไรค่าเงินตามเรตตลาด</span>
        <span class="v ${cls}">${signed(c.unrealFxTHB, 0)} บาท <span style="font-size:12px">(${signed(pct, 2)}%)</span></span></div>
      <div class="kv"><span class="k">ถ้าแลกกลับตอนนี้ (เรต ${fmt(sellRate, 3)})</span>
        <span class="v ${plClass(netNow)}" style="font-size:17px">${signed(netNow, 0)} บาท</span></div>
      ${Math.abs(c.realizedFxTHB) >= 0.5 ? `<div class="kv"><span class="k">แลกกลับแล้ว (กำไรที่รับรู้จริง)</span>
        <span class="v ${plClass(c.realizedFxTHB)}">${signed(c.realizedFxTHB, 0)} บาท</span></div>` : ''}
      <p class="hint">${hasBroker
        ? `เรตของ Webull ตอนนี้ ${fmt(sellRate, 3)} ต่ำกว่าตลาด ${fmt(sp, 3)} บาท (อัปเดต ${esc(String(brokerFxAt).slice(11, 16))} ทุกรอบซิงก์)`
        : `ยังไม่มีเรตจาก Webull ใช้ส่วนต่างโดยประมาณ ${fmt(sp, 2)} บาทจาก Settings`}
        · จะเริ่มกำไรจริงเมื่อเรตตลาดเกิน ${fmt(breakEven, 3)}</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        <button class="btn-sm" data-fx-alert="${alertCond}|${target}">${hasBroker ? 'เตือนเมื่อเรต Webull ถึงเป้า' : 'เตือนเมื่อ USD/THB ถึงเป้า'}</button>
        <button class="btn-sm" data-fx-record="1">แลกกลับแล้ว → บันทึกจากภาพ</button>
      </div>
    </div>`;
}

function greetingLine() {
  const h = new Date().getHours();
  const word = h < 11 ? 'อรุณสวัสดิ์' : h < 17 ? 'สวัสดี' : 'สวัสดีตอนเย็น';
  const name = state.user ? state.user.displayName : '';
  const today = new Date().toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' });
  return `
    <div class="dash-greet">
      <div><div class="dash-greet-hi">${word}${name ? ', ' + esc(name) : ''} 👋</div>
        <div class="dash-greet-date">${today}</div></div>
    </div>`;
}

/** การ์ดหุ้นหนึ่งตัว — weightTotal (ไม่บังคับ) = มูลค่าหุ้นรวม ใช้แสดงสัดส่วนในหน้า Portfolio */
function posCard(p, i, weightTotal) {
  return `
    <article class="pos" data-pos="${i}">
      <div>
        <div class="pos-sym">${esc(p.symbol)}<span class="mkt">${esc(p.market)}</span></div>
        <div class="pos-sub">${fmt(p.quantity, p.quantity % 1 ? 4 : 0)} หุ้น · ทุน ${fmt(p.avgCostLocal, 2)} ${esc(p.currency)}${
          weightTotal ? ` · ${fmt(p.marketValueTHB / weightTotal * 100, 1)}% ของพอร์ต` : ''}</div>
      </div>
      <div>
        <div class="pos-val">${fmt(p.marketValueTHB, 0)}</div>
        <div class="pos-chg ${plClass(p.unrealTotalTHB)}">${signed(p.unrealTotalTHB, 0)} (${signed(p.unrealPctLocal, 1)}%)</div>
      </div>
      <div class="pos-detail" hidden>
        <div class="kv"><span class="k">ราคาล่าสุด</span><span class="v">${fmt(p.price, 2)} ${esc(p.currency)} <span class="${plClass(p.changePct)}">${signed(p.changePct, 2)}%</span></span></div>
        <div class="kv"><span class="k">มูลค่าตลาด</span><span class="v">${fmt(p.marketValueLocal, 2)} ${esc(p.currency)}</span></div>
        <div class="kv"><span class="k">ทุนต่อหุ้น (รวมค่าธรรมเนียม)</span><span class="v">${fmt(p.avgCostLocal, 4)} ${esc(p.currency)}</span></div>
        ${p.avgCostExFeeLocal ? `<div class="kv"><span class="k">ทุนต่อหุ้น (ไม่รวมค่าธรรมเนียม)</span><span class="v muted">${fmt(p.avgCostExFeeLocal, 4)} ${esc(p.currency)}</span></div>` : ''}
        <div class="kv"><span class="k">ต้นทุนรวม</span><span class="v">${fmt(p.costTHB, 0)} บาท</span></div>
        ${(p.accounts || []).length ? `<div class="kv"><span class="k">ถืออยู่ที่</span><span class="v">${p.accounts.map(a =>
          esc(a.account) + ' ' + fmt(a.quantity, a.quantity % 1 ? 4 : 0)).join(' · ')}</span></div>` : ''}
        <div class="kv"><span class="k">กำไรจากตัวหุ้น</span><span class="v ${plClass(p.unrealStockTHB)}">${signed(p.unrealStockTHB, 0)} บาท</span></div>
        <div class="kv"><span class="k">กำไรจากค่าเงิน</span><span class="v ${plClass(p.unrealFxTHB)}">${signed(p.unrealFxTHB, 0)} บาท</span></div>
        <div class="kv"><span class="k">เปลี่ยนแปลงวันนี้</span><span class="v ${plClass(p.dayChangeTHB)}">${signed(p.dayChangeTHB, 0)} บาท</span></div>
        <div class="kv"><span class="k">ที่มาราคา</span><span class="v muted">${esc(p.source)}${p.stale ? ' · ค้าง' : ''} ${esc(p.quoteTime)}</span></div>
        <div style="margin-top:10px;display:flex;gap:8px">
          <button class="btn-sm" data-quick-alert="${esc(p.symbol)}|${esc(p.market)}|${esc(p.currency)}|${p.price}">ตั้งเตือนราคา</button>
          <button class="btn-sm" data-quick-tx="${esc(p.symbol)}|${esc(p.market)}|${esc(p.currency)}|${p.price}">บันทึกซื้อ/ขาย</button>
          <button class="btn-sm" data-quick-journal="${esc(p.symbol)}|${esc(p.market)}|${esc(p.currency)}|${p.price}">จดบันทึก</button>
        </div>
      </div>
    </article>`;
}

// ---------- หน้า Portfolio (แท็บ ภาพรวม / หุ้นที่ถือ / ผลตอบแทน / รายได้) ----------

const PF_TABS = [['overview', 'ภาพรวม'], ['holdings', 'หุ้นที่ถือ'], ['performance', 'ผลตอบแทน'], ['income', 'รายได้']];

function allocItems(d, mode) {
  const total = d.summary.totalTHB || 0;
  const pct = v => total ? v / total * 100 : 0;
  if (mode === 'symbol') {
    const stockTotal = d.positions.reduce((sum, p) => sum + Number(p.marketValueTHB || 0), 0);
    return d.positions.map(p => ({
      label: p.symbol,
      valueTHB: p.marketValueTHB,
      pct: stockTotal ? Number(p.marketValueTHB || 0) / stockTotal * 100 : 0
    })).sort((a, b) => b.valueTHB - a.valueTHB);
  }
  if (mode === 'market') {
    const m = {};
    d.positions.forEach(p => { const k = p.market === 'US' ? 'หุ้นสหรัฐ' : 'หุ้นไทย'; m[k] = (m[k] || 0) + p.marketValueTHB; });
    if (d.summary.cashTHB > 0) m['เงินสด'] = d.summary.cashTHB;
    return Object.keys(m).map(k => ({ label: k, valueTHB: m[k], pct: pct(m[k]) })).sort((a, b) => b.valueTHB - a.valueTHB);
  }
  if (mode === 'currency') {
    const m = {};
    d.positions.forEach(p => { const k = p.currency === 'USD' ? 'ดอลลาร์ (USD)' : 'บาท (THB)'; m[k] = (m[k] || 0) + p.marketValueTHB; });
    (d.cash || []).forEach(c => { const k = c.currency === 'USD' ? 'ดอลลาร์ (USD)' : 'บาท (THB)'; m[k] = (m[k] || 0) + c.valueTHB; });
    return Object.keys(m).filter(k => m[k] > 0.005)
      .map(k => ({ label: k, valueTHB: m[k], pct: pct(m[k]) })).sort((a, b) => b.valueTHB - a.valueTHB);
  }
  return [];
}

function pfOverview(d) {
  const s = d.summary;
  const stocks = s.totalTHB - s.cashTHB;
  const sp = s.totalTHB ? stocks / s.totalTHB * 100 : 0;
  const mode = state.pfAlloc || 'symbol';
  const items = allocItems(d, mode);
  const row = (k, v, cls) => `<div class="kv"><span class="k">${k}</span><span class="v ${cls || plClass(v)}">${signed(v, 0)}</span></div>`;
  return `
    <div class="card card-secondary">
      <div class="kv"><span class="k">มูลค่าหุ้น</span><span class="v">${fmt(stocks, 0)} บาท</span></div>
      <div class="kv"><span class="k">เงินสด</span><span class="v cash-text">${fmt(s.cashTHB, 0)} บาท</span></div>
      <div class="split-bar"><span style="width:${sp}%;background:var(--primary)"></span><span style="width:${100 - sp}%;background:var(--secondary)"></span></div>
      <div class="pos-sub">หุ้น ${fmt(sp, 1)}% · เงินสด ${fmt(100 - sp, 1)}%</div>
    </div>

    <div class="section-head"><h2>สัดส่วนการลงทุน</h2></div>
    <div class="card card-secondary">
      <div class="seg seg-mini" style="margin:0 0 14px">
        ${[['symbol', 'ตามหุ้น'], ['market', 'ตามตลาด'], ['currency', 'ตามสกุลเงิน']].map(([k, l]) =>
          `<button data-pf-alloc="${k}" class="${k === mode ? 'is-on' : ''}">${l}</button>`).join('')}
      </div>
      ${items.length ? `<div class="donut-wrap" style="margin-top:0">
        ${donutChart(items)}
        <div class="alloc-legend">${items.slice(0, 6).map((a, i) =>
          `<span class="row"><i style="background:${ALLOC_COLORS[i % ALLOC_COLORS.length]}"></i><span>${esc(a.label)}</span><b>${fmt(a.pct, 1)}%</b></span>`).join('')}</div>
      </div>` : '<div class="muted">ยังไม่มีข้อมูล</div>'}
    </div>

    <div class="section-head"><h2>กำไรขาดทุนแยกที่มา</h2></div>
    <div class="card card-secondary">
      <div class="pos-sub" style="margin-bottom:4px">ยังไม่ขาย</div>
      ${row('· จากราคาหุ้น', s.unrealStockTHB)}
      ${row('· จากค่าเงิน', s.unrealFxTHB)}
      <div class="pos-sub" style="margin:8px 0 4px">ขายแล้ว (รับรู้จริง)</div>
      ${row('· จากราคาหุ้น', s.realizedStockTHB)}
      ${row('· จากค่าเงิน', s.realizedFxTHB)}
      <div class="pos-sub" style="margin:8px 0 4px">รายได้</div>
      ${row('· เงินปันผล', s.dividendTHB || 0, 'div-text')}
      <div style="margin-top:8px;padding-top:8px;border-top:1px dashed var(--line)">
        <div class="kv"><span class="k">รวมทั้งหมด</span><span class="v ${plClass(s.totalPLTHB)}" style="font-size:17px">${signed(s.totalPLTHB, 0)} บาท</span></div>
        <div class="kv"><span class="k">เงินลงทุนสุทธิ (ฝาก − ถอน)</span><span class="v">${fmt(s.investedTHB, 0)} บาท</span></div>
      </div>
    </div>

    ${(d.accounts || []).length > 1 ? `
      <div class="section-head"><h2>แยกตามโบรกเกอร์</h2></div>
      <div class="card card-secondary">${d.accounts.map(a => `
        <div class="kv"><span class="k">${esc(a.account)}</span><span class="v">${fmt(a.totalTHB, 0)} บาท</span></div>`).join('')}</div>` : ''}`;
}

function pfHoldings(d) {
  const sort = state.pfSort || 'value';
  const key = { value: p => p.marketValueTHB, pl: p => p.unrealTotalTHB, pct: p => p.unrealPctLocal }[sort];
  const list = d.positions.slice().sort((a, b) => key(b) - key(a));
  const stockTotalTHB = list.reduce((total, p) => total + Number(p.marketValueTHB || 0), 0);
  const closed = d.closedPositions || [];
  const quoteSources = [...new Set(list.map(p => p.source).filter(Boolean))];
  const quoteTimes = [...new Set(list.map(p => p.quoteTime).filter(Boolean))];
  const hasStaleQuote = list.some(p => p.stale);
  const quoteNote = quoteSources.length
    ? `ราคาอ้างอิงจาก ${quoteSources.map(esc).join(', ')}${quoteTimes.length ? ' · อัปเดต ' + quoteTimes.map(esc).join(', ') : ''}${hasStaleQuote ? ' · มีราคาค้าง' : ''}<br>ราคาและเรต USD/THB อาจต่างจาก Dime ตามผู้ให้บริการและเวลาอัปเดต`
    : 'ราคาและเรต USD/THB อาจต่างจาก Dime ตามผู้ให้บริการและเวลาอัปเดต';
  return `
    <p class="hint" style="margin:0 0 12px">${quoteNote}</p>
    <div class="seg seg-mini" style="margin:0 0 12px">
      ${[['value', 'มูลค่า'], ['pl', 'กำไร (บาท)'], ['pct', 'กำไร (%)']].map(([k, l]) =>
        `<button data-pf-sort="${k}" class="${k === sort ? 'is-on' : ''}">เรียงตาม${l}</button>`).join('')}
    </div>
    ${list.length ? list.map((p, i) => posCard(p, i, stockTotalTHB)).join('')
      : '<div class="empty"><strong>ยังไม่มีหุ้นในพอร์ต</strong>ซื้อหุ้นใน Webull แล้วระบบจะดึงมาแสดงให้เอง</div>'}
    ${list.length ? '<p class="hint">กดที่หุ้นเพื่อดูรายละเอียดทุน ที่มาของราคา และปุ่มตั้งเตือน</p>' : ''}

    ${closed.length ? `
      <div class="section-head"><h2>ขายหมดแล้ว</h2></div>
      <div class="card card-secondary">${closed.map(c => `
        <div class="list-row">
          <div><strong>${esc(c.symbol)}</strong> <span class="pos-sub">${esc(c.market)}</span>
            <div class="pos-sub">หุ้น ${signed(c.realizedStockTHB, 0)} · ค่าเงิน ${signed(c.realizedFxTHB, 0)}${c.dividendTHB ? ' · ปันผล ' + signed(c.dividendTHB, 0) : ''}</div></div>
          <div class="${plClass(c.totalTHB)}" style="text-align:right;font-weight:600">${signed(c.totalTHB, 0)}<div class="pos-sub">บาท</div></div>
        </div>`).join('')}</div>` : ''}`;
}

function pfPerformance() {
  const p = state.perf;
  const r = state.risk;
  let table = '';
  if (p && !p.empty) {
    table = `
      <div class="section-head"><h2>ผลตอบแทนทุกช่วง</h2></div>
      <div class="card card-secondary" style="overflow-x:auto">
        <table class="pf-table">
          <tr><th></th><th>พอร์ต</th>${p.benchmarks.map(b => `<th>${esc(b.label)}</th>`).join('')}</tr>
          ${p.periods.map(x => `<tr><td>${esc(x.key === 'ALL' ? 'ทั้งหมด' : x.key)}</td>
            <td class="${plClass(x.portfolioPct)}">${signed(x.portfolioPct, 2)}%</td>
            ${p.benchmarks.map(b => `<td class="${plClass(x.bench[b.key])}">${x.bench[b.key] === null ? '—' : signed(x.bench[b.key], 2) + '%'}</td>`).join('')}</tr>`).join('')}
        </table>
        <p class="hint">Time-Weighted Return ตัดผลของการฝากถอนเงินออก</p>
      </div>`;
  }
  const m = r && !r.empty ? r.portfolio : null;
  const metric = (l, v, suf) => `<div class="metric-tile"><div class="lbl">${l}</div><div class="val">${v === null || v === undefined ? '—' : fmt(v, 2) + (suf || '')}</div></div>`;
  return `
    <div class="card">
      <div id="pf-perf">${p ? perfCard(p) : '<div class="skeleton" style="height:120px"></div>'}</div>
    </div>
    ${table}
    <div class="section-head"><h2>ความเสี่ยง (ถือแบบนี้ย้อนหลัง 1 ปี)</h2>
      <button class="btn-sm" data-risk-detail="1">ดูทั้งหมด</button></div>
    ${m ? `<div class="metric-grid">
        ${metric('ความผันผวนต่อปี', m.volPct, '%')}
        ${metric('Beta', m.beta)}
        ${metric('ร่วงหนักสุด', m.maxDrawdownPct, '%')}
        ${metric('Sharpe', m.sharpe)}
      </div>` : `<div class="card card-secondary"><div class="muted">${r && r.empty ? 'ยังไม่มีหุ้นให้วิเคราะห์' : 'กำลังคำนวณ…'}</div></div>`}`;
}

function pfIncome() {
  const s = state.pfDiv;
  if (!s) return '<div class="card"><div class="skeleton"></div><div class="skeleton"></div></div>';
  return `
    <div class="card card-secondary">
      <div class="hero-label">เงินปันผลรับ 12 เดือนล่าสุด</div>
      <div class="div-text" style="font-size:28px;font-weight:700;margin:4px 0 8px">${fmt(s.last12mTHB, 0)} บาท</div>
      <div class="kv"><span class="k">อัตราผลตอบแทนเทียบทุน</span><span class="v">${fmt(s.yieldOnCost, 2)}%</span></div>
      <div class="kv"><span class="k">อัตราผลตอบแทนเทียบราคาตลาด</span><span class="v">${fmt(s.yieldOnMarket, 2)}%</span></div>
      <div class="kv"><span class="k">ปันผลรับทั้งหมด (สุทธิ)</span><span class="v">${fmt(s.totalTHB, 0)} บาท</span></div>
      <div class="kv"><span class="k">ภาษีหัก ณ ที่จ่ายรวม</span><span class="v muted">${fmt(s.taxTHB, 0)} บาท</span></div>
      ${s.pendingCount ? `<div style="margin-top:10px"><button class="btn-sm" data-goto-divs="1">
        มี ${s.pendingCount} รายการรอยืนยัน (${fmt(s.pendingNetTHB, 0)} บาท) →</button></div>` : ''}
    </div>

    ${s.bySymbol.length ? `
      <div class="section-head"><h2>แยกรายหุ้น</h2></div>
      <div class="card card-secondary">${s.bySymbol.map(b => `
        <div class="list-row">
          <div><strong>${esc(b.symbol)}</strong>
            <div class="pos-sub">${b.count} ครั้ง${b.yieldOnCost !== null && b.yieldOnCost !== undefined ? ' · เทียบทุน ' + fmt(b.yieldOnCost, 2) + '%' : ''}</div></div>
          <div style="text-align:right"><div class="div-text">${fmt(b.netTHB, 0)}</div><div class="pos-sub">12 เดือน ${fmt(b.last12mTHB, 0)}</div></div>
        </div>`).join('')}</div>` : ''}

    ${s.byYear.length ? `
      <div class="section-head"><h2>รายปี</h2></div>
      <div class="card card-secondary">${s.byYear.map(y => `
        <div class="kv"><span class="k">${esc(y.year)}</span><span class="v div-text">${fmt(y.netTHB, 0)} บาท</span></div>`).join('')}</div>` : ''}

    ${!s.count ? '<div class="empty"><strong>ยังไม่มีเงินปันผล</strong>ปันผลที่ได้รับจะแสดงที่นี่ บันทึกได้จากปุ่ม + → เพิ่มปันผล</div>' : ''}`;
}

async function renderPortfolio() {
  const v = view('portfolio');
  const d = state.dashboard;
  if (!d) { v.innerHTML = skeleton(6); refresh(false); return; }
  const tab = state.pfTab || 'overview';
  const s = d.summary;
  const dayCls = plClass(s.dayChangeTHB);

  let body = '';
  if (tab === 'overview') body = pfOverview(d);
  if (tab === 'holdings') body = pfHoldings(d);
  if (tab === 'performance') body = pfPerformance();
  if (tab === 'income') body = pfIncome();

  v.innerHTML = `
    <button class="link-btn" data-goto-dashboard="1" style="margin:0 0 12px">← กลับหน้าหลัก</button>
    <div class="hero glass-hero" style="padding-bottom:18px">
      <div class="hero-label">มูลค่าทรัพย์สินรวม</div>
      <div class="hero-value" style="font-size:38px">${fmt(s.totalTHB, 0)}<span class="sat">บาท</span></div>
      <div class="hero-delta-sub">
        <span class="chip ${dayCls === 'up-text' ? 'up' : dayCls === 'down-text' ? 'down' : ''}">วันนี้ ${signed(s.dayChangePct, 2)}%</span>
        <span class="chip ${plClass(s.totalPLTHB) === 'up-text' ? 'up' : plClass(s.totalPLTHB) === 'down-text' ? 'down' : ''}">ตั้งแต่เริ่มลงทุน ${s.investedTHB > 0 ? signed(s.totalReturnPct, 2) + '%' : '—'}</span>
      </div>
    </div>
    <div class="seg pf-tabs">
      ${PF_TABS.map(([k, l]) => `<button data-pf-tab="${k}" class="${k === tab ? 'is-on' : ''}">${l}</button>`).join('')}
    </div>
    <div class="pf-body">${body}</div>
    <p class="hint">อัปเดตเมื่อ ${esc(d.asOf)}</p>`;

  $$('.pos', v).forEach(node => node.addEventListener('click', (ev) => {
    if (ev.target.closest('button')) return;
    const det = $('.pos-detail', node);
    det.hidden = !det.hidden;
  }));

  // โหลดข้อมูลที่ยังไม่มี แล้ววาดใหม่เฉพาะเมื่อยังอยู่แท็บเดิม
  if (tab === 'performance') {
    const need = [];
    if (!state.perf) need.push(api('performance', {}).then(r => { state.perf = r; }));
    if (!state.risk) need.push(api('risk.dashboard', {}).then(r => { state.risk = r; }));
    if (need.length) {
      try { await Promise.all(need); } catch (e) { toast(e.message, true); }
      if (state.tab === 'portfolio' && state.pfTab === 'performance') renderPortfolio();
    }
  }
  if (tab === 'income' && !state.pfDiv) {
    try { state.pfDiv = await api('dividends.summary'); } catch (e) { toast(e.message, true); state.pfDiv = null; return; }
    if (state.tab === 'portfolio' && state.pfTab === 'income') renderPortfolio();
  }
}

function renderDashboard() {
  const v = view('dashboard');
  const d = state.dashboard;
  if (!d) { v.innerHTML = greetingLine() + skeleton(6); return; }

  const s = d.summary;
  const dayCls = plClass(s.dayChangeTHB);
  const alloc = d.allocation.slice(0, 6);
  const other = d.allocation.slice(6).reduce((a, x) => a + x.valueTHB, 0);
  if (other > 0) alloc.push({ label: 'อื่น ๆ', valueTHB: other, pct: d.summary.totalTHB ? other / d.summary.totalTHB * 100 : 0 });

  // มีเงินดอลลาร์หรือหุ้นสหรัฐไหม — ใช้ตัดสินว่าจะแสดงคำอธิบายเรื่องเรตแลกเปลี่ยน
  const hasUsd = (d.cash || []).some(c => c.currency !== 'THB' && Math.abs(c.balance) > 0.005) ||
                 d.positions.some(p => p.currency !== 'THB');
  const usdCash = (d.cash || []).find(c => c.currency === 'USD' && c.balance > 0.005);
  const showAllHold = !!state.showAllHoldings;
  const posShown = showAllHold ? d.positions : d.positions.slice(0, 3);
  const positions = posShown.map((p, i) => posCard(p, i)).join('');

  v.innerHTML = `
    ${greetingLine()}

    <div class="hero glass-hero">
      <div style="display:flex;justify-content:space-between;align-items:center;position:relative">
        <div class="hero-label">มูลค่าทรัพย์สินรวม</div>
        <button class="link-btn" data-goto-portfolio="overview" style="font-size:12px">รายละเอียด →</button>
      </div>
      <div class="hero-value"><span id="hero-num">0</span><span class="sat">บาท</span></div>
      <div class="hero-delta-main ${dayCls}">${signed(s.dayChangeTHB, 0)} บาท</div>
      <div class="hero-delta-sub">
        <span class="chip ${dayCls === 'up-text' ? 'up' : dayCls === 'down-text' ? 'down' : ''}">วันนี้ ${signed(s.dayChangePct, 2)}%</span>
        <span class="hero-fx">USD/THB ${fmt(d.usdthb, 2)}</span>
      </div>

      <div id="perf-slot"></div>
    </div>

    <p class="hint" style="margin:-6px 0 10px">มูลค่าทรัพย์สินรวม = มูลค่าหุ้น + เงินสด</p>
    ${hasUsd ? `<p class="hint" style="margin:-4px 0 12px">เงินดอลลาร์คิดเป็นบาทที่เรตตลาด ${fmt(d.usdthb, 2)} ตัวเลขเงินบาทจึงอาจต่างจากแอปโบรกเกอร์เล็กน้อย
      เพราะโบรกเกอร์ใช้เรตรับซื้อดอลลาร์ของตัวเองซึ่งต่ำกว่าเรตตลาด — จำนวนดอลลาร์ตรงกันเสมอ</p>` : ''}
    <div class="metric-grid">
      <div class="metric-tile">
        <div class="lbl"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>มูลค่าหุ้น</div>
        <div class="val">${fmt(s.totalTHB - s.cashTHB, 0)}</div>
      </div>
      <div class="metric-tile">
        <div class="lbl"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.4"/></svg>เงินสด</div>
        <div class="val cash-text">${fmt(s.cashTHB, 0)}</div>
      </div>
    </div>

    <button class="uninvested-row" data-edit-uninvested="1">
      <span><span class="k">เงินยังไม่ได้ลงทุน (Dime! Save)</span>
        <span class="pos-sub">${d.uninvested && d.uninvested.asOf ? 'ณ ' + esc(String(d.uninvested.asOf).slice(0, 10)) + ' · ' : ''}ไม่รวมในมูลค่าพอร์ต · แตะเพื่ออัปเดต</span></span>
      <span class="v cash-text">${d.uninvested && d.uninvested.asOf ? fmt(d.uninvested.thb, 0) + ' บาท' : 'ใส่ยอด'}</span>
    </button>

    <div class="card card-secondary ${plClass(s.totalPLTHB) === 'up-text' ? 'glow-soft-up' : plClass(s.totalPLTHB) === 'down-text' ? 'glow-soft-down' : ''}">
      <div class="kv"><span class="k">ตั้งแต่เริ่มลงทุน</span>
        <span class="v ${plClass(s.totalPLTHB)}">${s.investedTHB > 0 ? signed(s.totalReturnPct, 2) + '%' : ''}</span></div>
      <div class="${plClass(s.totalPLTHB)}" style="font-size:22px;font-weight:700;margin-bottom:8px">${signed(s.totalPLTHB, 0)} บาท</div>
      <div class="kv"><span class="k">กำไรจากราคาหุ้น</span><span class="v ${plClass(s.capitalGainTHB)}">${signed(s.capitalGainTHB, 0)}</span></div>
      <div class="kv"><span class="k">เงินปันผล</span><span class="v div-text">${signed(s.dividendTHB || 0, 0)}</span></div>
      <span class="tag stub" style="margin-top:4px;display:inline-block">สองก้อนนี้ไม่ปนกัน</span>
    </div>

    ${usdCash ? fxCard(usdCash, d.usdthb, d.fxSpread, d.brokerFx, d.brokerFxAt) : ''}

    ${alloc.length ? `
    <div class="section-head"><h2>สัดส่วนการลงทุน</h2></div>
    <div class="card card-secondary">
      <div class="donut-wrap" style="margin-top:0">
        ${donutChart(alloc)}
        <div class="alloc-legend">${alloc.slice(0, 5).map((a, i) =>
          `<span class="row"><i style="background:${ALLOC_COLORS[i % ALLOC_COLORS.length]}"></i><span>${esc(a.label)}</span><b>${fmt(a.pct, 1)}%</b></span>`).join('')}</div>
      </div>
    </div>` : ''}

    <div class="section-head"><h2>หุ้นที่ถืออยู่</h2>
      ${d.positions.length ? '<button class="btn-sm" data-goto-portfolio="holdings">ดูทั้งหมด →</button>'
                           : '<button class="btn-sm" data-open="tx">บันทึกรายการ</button>'}</div>
    ${d.positions.length ? '<p class="hint" style="margin:-6px 0 10px">ราคาอ้างอิงจาก Yahoo Finance และเรตตลาด จึงอาจต่างจาก Dime ตามเวลาอัปเดต</p>' : ''}
    ${d.positions.length ? positions : `
      <div class="empty"><strong>ยังไม่มีหุ้นในพอร์ต</strong>
      เริ่มจากบันทึกเงินฝากเข้าพอร์ต แล้วบันทึกรายการซื้อหุ้นตัวแรก</div>`}
    ${d.positions.length > 3 ? `
      <button class="link-btn" data-goto-portfolio="holdings" style="margin:-4px 0 10px;display:block">
        ดูทั้งหมด (${d.positions.length} ตัว) →</button>` : ''}
    ${d.positions.length ? `<p class="hint">ทุนในแอปรวมค่าคอมมิชชัน ค่าธรรมเนียม และ VAT แล้ว จึงสูงกว่าที่แอปโบรกเกอร์แสดงเล็กน้อย
      กดที่หุ้นเพื่อดูรายละเอียดทุนแบบไม่รวมค่าธรรมเนียมและที่มาของราคา</p>` : ''}

    ${(d.openOrders || []).length ? `
      <div class="section-head"><h2>คำสั่งที่รอ Fill</h2></div>
      <div class="card card-secondary">${d.openOrders.map(o => `
        <div class="list-row">
          <div><div><span class="tag ${o.side === 'SELL' ? 'sell' : 'buy'}">${o.side === 'SELL' ? 'ขาย' : 'ซื้อ'}</span><strong>${esc(o.symbol)}</strong>
            ${fmt(o.totalQty, o.totalQty % 1 ? 4 : 0)} หุ้น</div>
            <div class="pos-sub">${o.limitPrice ? 'ตั้งราคา ' + fmt(o.limitPrice, 2) + ' USD' : esc(o.orderType)}
              · ${esc(o.placeTime.slice(0, 10))}${o.filledQty ? ' · Fill แล้ว ' + fmt(o.filledQty, 4) : ''}</div></div>
          <div class="pos-sub" style="text-align:right">${esc(o.status)}</div>
        </div>`).join('')}
        <p class="hint">ดึงจาก Webull ทุกรอบซิงก์ พอ Fill ระบบบันทึกลงพอร์ตและส่งแจ้งเตือนให้</p>
      </div>` : ''}

    <div id="health-slot"></div>

    ${(d.accounts || []).length > 1 ? `
      <div class="section-head"><h2>แยกตามโบรกเกอร์</h2></div>
      <div class="card card-secondary">${d.accounts.map(a => `
        <div class="kv"><span class="k">${esc(a.account)}</span><span class="v">${fmt(a.totalTHB, 0)} บาท</span></div>
        <div class="pos-sub" style="margin:-4px 0 6px">หุ้น ${fmt(a.stocksTHB, 0)} · เงินสด ${fmt(a.cashTHB, 0)}</div>`).join('')}
      </div>` : ''}

    ${(d.activity || []).length ? `
      <div class="section-head"><h2>ธุรกรรมล่าสุด</h2>
        <button class="btn-sm" data-goto-ledger="1">ดูทั้งหมด →</button></div>
      <div class="card card-secondary">${d.activity.slice(0, 3).map(activityRow).join('')}</div>` : ''}

    <p class="hint">อัปเดตเมื่อ ${esc(d.asOf)} · เงินสด ${fmt(d.cash && s.cashTHB, 0)} บาท · ดูยอดเงินสดทั้งหมดในแท็บ "รายการ"</p>
  `;

  animateCount(el('hero-num'), s.totalTHB, 0);

  $$('.pos', v).forEach(node => {
    node.addEventListener('click', (ev) => {
      if (ev.target.closest('button')) return;
      const det = $('.pos-detail', node);
      det.hidden = !det.hidden;
    });
  });

  if (d.positions.length) renderHealthSlot();
  renderPerfSlot();
}

// ---------- ผลตอบแทนเทียบตลาด ----------

const BENCH_COLORS = { SET50: '#6E8BD6', SP500: '#B67FD0', NASDAQ: '#5FB6C4', CUSTOM: '#E08A5B' };

async function renderPerfSlot(force) {
  const slot = el('perf-slot');
  if (!slot) return;

  if (state.perf && !force) { slot.innerHTML = perfCard(state.perf); return; }

  slot.innerHTML = `<div class="skeleton" style="margin-top:14px;height:80px"></div>
    <div class="skeleton" style="width:60%"></div>`;

  if (state.perfLoading) return;
  state.perfLoading = true;
  try {
    state.perf = await api('performance', { force: !!force });
    const s = el('perf-slot');
    if (s) s.innerHTML = perfCard(state.perf);
  } catch (e) {
    const s = el('perf-slot');
    if (s) s.innerHTML = `<p class="hint" style="margin-top:14px">คำนวณกราฟไม่สำเร็จ: ${esc(e.message)}</p>`;
  } finally {
    state.perfLoading = false;
  }
}

function perfCard(p) {
  if (p.empty) return '<p class="hint" style="margin-top:14px">ยังไม่มีข้อมูลพอให้วาดกราฟ</p>';
  const key = state.perfPeriod || '1M';
  const per = p.periods.find(x => x.key === key) || p.periods[0];
  const s = p.series;

  // ตัดเส้นกราฟเฉพาะช่วงที่เลือก แล้วตั้งฐานใหม่เป็น 100 ณ วันเริ่มช่วง
  let i0 = 0;
  for (let i = s.dates.length - 1; i >= 0; i--) { if (s.dates[i] <= per.from) { i0 = i; break; } }
  const rebase = (arr) => {
    const base = arr[i0];
    return arr.slice(i0).map(v => (v && base) ? v / base * 100 : null);
  };
  const lines = [{ label: 'พอร์ตของคุณ', color: '#27D9FF', width: 2.4, values: rebase(s.portfolio) }];
  p.benchmarks.forEach(b => lines.push({
    label: b.label, color: BENCH_COLORS[b.key] || '#8D96B2', width: 1.3, values: rebase(s.bench[b.key])
  }));

  const firstBench = p.benchmarks[0];
  const diff = firstBench && per.bench[firstBench.key] !== null
    ? per.portfolioPct - per.bench[firstBench.key] : null;

  return `
    <div class="hero-chart-head">
      <div>
        <span class="hero-chart-pct ${plClass(per.portfolioPct)}">${signed(per.portfolioPct, 2)}%</span>
        <span class="hero-chart-pnl ${plClass(per.pnlTHB)}">${signed(per.pnlTHB, 0)} บาท</span>
      </div>
      ${diff !== null ? `<span class="hero-chart-vs ${plClass(diff)}">${diff >= 0 ? '▲' : '▼'} ${fmt(Math.abs(diff), 1)} จุด vs ${esc(firstBench.label)}</span>` : ''}
    </div>

    ${lineChart(lines)}

    <div class="seg seg-mini">
      ${p.periods.map(x =>
        `<button data-perf-period="${x.key}" class="${x.key === key ? 'is-on' : ''}">${esc(x.key === 'ALL' ? 'ทั้งหมด' : x.key)}</button>`).join('')}
    </div>

    <div class="alloc-legend hero-chart-legend">${lines.map(l =>
      `<span class="row"><i style="background:${l.color}"></i><span>${esc(l.label)}</span></span>`).join('')}</div>

    ${per.partial ? `<p class="hint">พอร์ตเริ่มเมื่อ ${esc(p.startDate)} — ยังไม่ครบช่วงที่เลือก</p>` : ''}
  `;
}

/** กราฟเส้นแบบ SVG ล้วน ไม่ต้องโหลดไลบรารี — มี gradient fill ใต้เส้นพอร์ตหลักและ glow บาง ๆ */
function lineChart(lines) {
  const W = 320, H = 128, P = 6;
  const all = lines.flatMap(l => l.values.filter(v => v !== null && isFinite(v)));
  if (all.length < 2) {
    return '<div class="empty" style="padding:16px;margin:10px 0">ข้อมูลยังน้อยเกินไปสำหรับวาดกราฟ ลองดูอีกครั้งในอีกไม่กี่วัน</div>';
  }
  let min = Math.min(...all, 100), max = Math.max(...all, 100);
  if (max - min < 1) { max += 0.5; min -= 0.5; }
  const n = Math.max(...lines.map(l => l.values.length));
  const x = i => P + (n > 1 ? i / (n - 1) : 0) * (W - P * 2);
  const y = v => P + (1 - (v - min) / (max - min)) * (H - P * 2);

  const gid = 'hg' + Math.random().toString(36).slice(2, 8);
  const main = lines[0];
  let mainD = '', pen = false, lastX = P, lastY = y(100);
  main.values.forEach((v, i) => {
    if (v === null || !isFinite(v)) { pen = false; return; }
    mainD += (pen ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1) + ' ';
    pen = true; lastX = x(i); lastY = y(v);
  });
  const fillD = mainD ? `${mainD} L ${lastX.toFixed(1)} ${(H - P).toFixed(1)} L ${x(0).toFixed(1)} ${(H - P).toFixed(1)} Z` : '';

  const otherPaths = lines.slice(1).map(l => {
    let d = '', pen2 = false;
    l.values.forEach((v, i) => {
      if (v === null || !isFinite(v)) { pen2 = false; return; }
      d += (pen2 ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1) + ' ';
      pen2 = true;
    });
    return `<path class="chart-line-other" d="${d}" fill="none" stroke="${l.color}" stroke-width="${l.width}" stroke-linejoin="round" stroke-linecap="round" opacity=".75"/>`;
  }).join('');

  return `
    <svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block" role="img" aria-label="กราฟผลตอบแทนเทียบดัชนี" class="hero-chart-svg">
      <defs>
        <linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${main.color}" stop-opacity=".38"/>
          <stop offset="100%" stop-color="${main.color}" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <line x1="${P}" x2="${W - P}" y1="${y(100)}" y2="${y(100)}" stroke="rgba(255,255,255,.14)" stroke-dasharray="3 4"/>
      ${fillD ? `<path class="chart-fill" d="${fillD}" fill="url(#${gid})" stroke="none"/>` : ''}
      ${otherPaths}
      <path class="chart-main-path" d="${mainD}" fill="none" stroke="${main.color}" stroke-width="${main.width}"
            stroke-linejoin="round" stroke-linecap="round" style="filter:drop-shadow(0 0 6px ${main.color}aa)"/>
    </svg>`;
}

// ---------- สุขภาพพอร์ต ----------

function healthColor(score) {
  return score >= 80 ? 'var(--up)' : score >= 60 ? '#5FD9A8' : score >= 40 ? 'var(--amber)' : 'var(--down)';
}

async function renderHealthSlot(force) {
  const slot = el('health-slot');
  if (!slot) return;

  if (state.risk && !force) { slot.innerHTML = healthCard(state.risk); return; }

  slot.innerHTML = `
    <div class="section-head"><h2>สุขภาพพอร์ต</h2></div>
    <div class="card"><div class="skeleton"></div><div class="skeleton"></div>
      <p class="hint">กำลังดึงราคาย้อนหลัง 1 ปีมาคำนวณ ครั้งแรกอาจใช้เวลาครึ่งนาที</p></div>`;

  if (state.riskLoading) return;
  state.riskLoading = true;
  try {
    state.risk = await api('risk.dashboard', { force: !!force });
    const s = el('health-slot');
    if (s) s.innerHTML = healthCard(state.risk);
  } catch (e) {
    const s = el('health-slot');
    if (s) s.innerHTML = `<div class="section-head"><h2>สุขภาพพอร์ต</h2></div>
      <div class="empty"><strong>วิเคราะห์ไม่สำเร็จ</strong>${esc(e.message)}</div>`;
  } finally {
    state.riskLoading = false;
  }
}

/** วงแหวนคะแนนสุขภาพพอร์ต — SVG arc เดี่ยว */
function scoreRing(score, color) {
  const size = 84, stroke = 8, r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(100, score)) / 100;
  return `
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="transform:rotate(-90deg);filter:drop-shadow(0 0 8px ${color}66)">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="${stroke}"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}"
        stroke-linecap="round" stroke-dasharray="${(frac * c).toFixed(2)} ${c.toFixed(2)}"/>
    </svg>`;
}

function healthCard(r) {
  if (r.empty) return '';
  const h = r.health;
  const top3 = h.dimensions.slice(0, 3);
  const color = healthColor(h.score);
  return `
    <div class="section-head"><h2>สุขภาพพอร์ต</h2>
      <button class="btn-sm" data-risk-detail="1">ดูทั้งหมด</button></div>
    <div class="card">
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:14px">
        <div style="position:relative;flex:none">
          ${scoreRing(h.score, color)}
          <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center">
            <span style="font-size:22px;font-weight:700;color:${color}">${h.score}</span>
            <span style="font-size:9.5px;color:var(--muted)">/ 100</span>
          </div>
        </div>
        <div>
          <span class="chip" style="color:${color}">${esc(h.grade)}</span>
          <div class="pos-sub" style="margin-top:6px">3 ด้านหลักที่มีผลต่อคะแนน</div>
        </div>
      </div>
      ${top3.map(d => `
        <div style="margin-bottom:10px">
          <div class="kv" style="padding:0 0 4px"><span class="k">${esc(d.label)}</span>
            <span class="v">${d.score === null ? '<span class="muted">—</span>' : d.score}</span></div>
          <div class="meter"><span style="width:${d.score || 0}%;background:${healthColor(d.score || 0)}"></span></div>
        </div>`).join('')}
      <p class="hint">วิเคราะห์เมื่อ ${esc(r.asOf)}</p>
    </div>`;
}

function sheetRisk() {
  const r = state.risk;
  if (!r || r.empty) return;
  const p = r.portfolio, c = r.concentration;
  const pct = (v, d) => v === null || v === undefined ? '—' : fmt(v, d === undefined ? 1 : d) + '%';
  const num = (v) => v === null || v === undefined ? '—' : fmt(v, 2);

  openSheet('ความเสี่ยงของพอร์ต', `
    <div class="card">
      <div class="kv"><span class="k">ความผันผวนต่อปี</span><span class="v">${pct(p.volPct)}</span></div>
      <div class="kv"><span class="k">Beta เทียบตลาด</span><span class="v">${num(p.beta)}</span></div>
      <div class="kv"><span class="k">ร่วงหนักสุดในรอบปี</span><span class="v down-text">${pct(p.maxDrawdownPct)}</span></div>
      <div class="kv"><span class="k">ผลตอบแทน 1 ปี (ถ้าถือแบบนี้)</span><span class="v ${plClass(p.return1yPct)}">${pct(p.return1yPct)}</span></div>
      <div class="kv"><span class="k">Sharpe Ratio</span><span class="v">${num(p.sharpe)}</span></div>
      <p class="hint">Sharpe คิดจากอัตราผลตอบแทนไร้ความเสี่ยง ${fmt(p.riskFreePct, 2)}% ปรับได้ในชีท Settings ที่ risk.freeRate</p>
    </div>

    ${r.benchmarks.length ? `
      <div class="section-head"><h2>เทียบดัชนีตลาด</h2></div>
      <div class="card">${r.benchmarks.map(b => `
        <div style="margin-bottom:8px"><strong>${esc(b.label)}</strong>
          <div class="kv"><span class="k">ความผันผวน</span><span class="v">${pct(b.volPct)}</span></div>
          <div class="kv"><span class="k">ร่วงหนักสุด</span><span class="v">${pct(b.maxDrawdownPct)}</span></div>
          <div class="kv"><span class="k">ผลตอบแทน 1 ปี</span><span class="v ${plClass(b.return1yPct)}">${pct(b.return1yPct)}</span></div>
        </div>`).join('')}</div>` : ''}

    <div class="section-head"><h2>รายตัว</h2></div>
    <div class="card">${r.stocks.map(s => s.insufficient ? `
      <div class="list-row"><div><strong>${esc(s.symbol)}</strong>
        <div class="pos-sub">ข้อมูลราคาย้อนหลังไม่พอคำนวณ</div></div>
        <div>${pct(s.weightPct)}</div></div>` : `
      <div class="list-row">
        <div><strong>${esc(s.symbol)}</strong> <span class="muted">${pct(s.weightPct)} ของพอร์ต</span>
          <div class="pos-sub">ผันผวน ${pct(s.volPct)} · Beta ${num(s.beta)} · ร่วงหนักสุด ${pct(s.maxDrawdownPct)}</div></div>
        <div class="${plClass(s.return1yPct)}" style="text-align:right">${pct(s.return1yPct)}<div class="pos-sub">1 ปี</div></div>
      </div>`).join('')}</div>

    <div class="section-head"><h2>การกระจุกตัว</h2></div>
    <div class="card">
      <div class="kv"><span class="k">จำนวนหุ้น</span><span class="v">${c.holdings} ตัว</span></div>
      <div class="kv"><span class="k">เทียบเท่าถือเท่ากัน</span><span class="v">${fmt(c.effectiveN, 1)} ตัว</span></div>
      <div class="kv"><span class="k">ตัวใหญ่สุด</span><span class="v">${pct(c.maxWeightPct)}</span></div>
      <div class="kv"><span class="k">สามตัวแรกรวมกัน</span><span class="v">${pct(c.top3Pct)}</span></div>
      <div class="kv"><span class="k">เงินสด</span><span class="v">${pct(c.cashPct)}</span></div>
      ${c.byMarket.map(m => `<div class="kv"><span class="k">ตลาด ${esc(m.market)}</span><span class="v">${pct(m.pct)}</span></div>`).join('')}
    </div>

    <div class="section-head"><h2>ข้อสังเกตแต่ละด้าน</h2></div>
    <div class="card">${r.health.dimensions.map(d => `
      <div style="margin-bottom:10px"><strong>${esc(d.label)}</strong>
        <div class="pos-sub">${esc(d.note)}</div></div>`).join('')}</div>

    <p class="hint">${esc(r.caveat)}</p>
    <button class="btn btn-ghost" data-risk-refresh="1">คำนวณใหม่ด้วยราคาล่าสุด</button>
  `);
}

// ---------- หน้ารายการธุรกรรม ----------

const TX_LABEL = {
  BUY: 'ซื้อ', SELL: 'ขาย', DEPOSIT: 'ฝากเงิน', WITHDRAW: 'ถอนเงิน',
  FX_CONVERT: 'แลกเงิน', DIVIDEND: 'เงินปันผล', FEE: 'ค่าธรรมเนียม', ADJUST: 'ปรับปรุง',
  TRANSFER: 'โอนระหว่างบัญชี'
};

async function renderTransactions() {
  const v = view('transactions');
  const sub = state.subTab || 'tx';

  const nav = `
    <div class="seg" style="margin-bottom:16px">
      <button data-sub="tx" class="${sub === 'tx' ? 'is-on' : ''}">ธุรกรรม</button>
      <button data-sub="div" class="${sub === 'div' ? 'is-on' : ''}">เงินปันผล</button>
      <button data-sub="cash" class="${sub === 'cash' ? 'is-on' : ''}">เงินสด</button>
    </div>`;

  v.innerHTML = nav + skeleton(4);

  try {
    const body = sub === 'tx' ? await txSection() : sub === 'div' ? await divSection() : await cashSection();
    v.innerHTML = nav + body;
  } catch (e) {
    v.innerHTML = nav + `<div class="empty"><strong>โหลดข้อมูลไม่สำเร็จ</strong>${esc(e.message)}</div>`;
  }
}

async function txSection() {
  const rows = await api('tx.list', { limit: 200 });
  return `
    <div class="section-head"><h2>ธุรกรรมทั้งหมด</h2>
      <button class="btn-sm" data-open="tx">บันทึกรายการ</button></div>
    ${rows.length ? `<div class="card">${rows.map(t => `
      <div class="list-row">
        <div>
          <div><span class="tag ${t.type === 'BUY' ? 'buy' : t.type === 'SELL' ? 'sell' : 'cash'}">${TX_LABEL[t.type] || t.type}</span>
            <strong>${esc(t.symbol || t.currency)}</strong></div>
          <div class="pos-sub">${esc(t.date)}${t.quantity && t.type !== 'TRANSFER' ? ` · ${fmt(t.quantity, t.quantity % 1 ? 4 : 0)} @ ${fmt(t.price, 2)}` : ''}${t.currency !== 'THB' ? ` · FX ${fmt(t.fxRate, 2)}` : ''}${
            accountsList().length > 1 ? ` · ${esc(t.account)}${t.toAccount ? ' → ' + esc(t.toAccount) : ''}` : ''}</div>
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
}

async function divSection() {
  const [rows, sum] = await Promise.all([
    api('dividends.list', { limit: 100 }),
    api('dividends.summary')
  ]);

  const pending = rows.filter(d => d.status === 'pending');
  const done = rows.filter(d => d.status === 'confirmed');

  const card = (d, isPending) => `
    <div class="list-row">
      <div>
        <div><strong>${esc(d.symbol)}</strong>
          <span class="tag ${isPending ? 'alert' : 'cash'}">${isPending ? 'รอยืนยัน' : esc(d.payDate)}</span>
          ${d.source === 'yahoo' ? '<span class="pos-sub">ดึงอัตโนมัติ</span>' : ''}</div>
        <div class="pos-sub">${fmt(d.perShare, 4)}/หุ้น × ${fmt(d.shares, d.shares % 1 ? 2 : 0)} หุ้น
          · หัก ณ ที่จ่าย ${fmt(d.whtRate * 100, 0)}%${isPending ? ' · XD ' + esc(d.exDate) : ''}</div>
      </div>
      <div style="text-align:right">
        <div class="up-text">${fmt(d.netTHB, 0)} <span class="muted">บาท</span></div>
        ${isPending
          ? `<button class="link-btn" data-confirm-div="${esc(d.divId)}">ยืนยัน</button>
             <button class="link-btn danger" data-del-div="${esc(d.divId)}">ทิ้ง</button>`
          : `<button class="link-btn danger" data-del-div="${esc(d.divId)}">ลบ</button>`}
      </div>
    </div>`;

  return `
    <div class="card">
      <div class="hero-label">เงินปันผลรับ 12 เดือนล่าสุด</div>
      <div class="hero-value up-text" style="font-size:28px">${fmt(sum.last12mTHB, 0)}<span class="sat">บาท</span></div>
      <div class="kv"><span class="k">ผลตอบแทนจากมูลค่าปัจจุบัน</span><span class="v">${fmt(sum.yieldOnMarket, 2)}%</span></div>
      <div class="kv"><span class="k">ผลตอบแทนจากต้นทุน</span><span class="v">${fmt(sum.yieldOnCost, 2)}%</span></div>
      <div class="kv"><span class="k">รับสะสมทั้งหมด</span><span class="v">${fmt(sum.totalTHB, 0)} บาท จาก ${sum.count} งวด</span></div>
      <div class="kv"><span class="k">ภาษีหัก ณ ที่จ่ายสะสม</span><span class="v muted">${fmt(sum.taxTHB, 0)} บาท</span></div>
    </div>

    <div class="section-head"><h2>บันทึกปันผล</h2>
      <span><button class="btn-sm" data-discover="1">ค้นหาอัตโนมัติ</button>
      <button class="btn-sm" data-open="div">กรอกเอง</button></span></div>

    ${pending.length ? `
      <div class="card" style="border-color:rgba(242,181,68,.35)">
        <div class="kv"><span class="k">รอตรวจและยืนยัน ${pending.length} งวด</span>
          <span class="v stale">${fmt(sum.pendingNetTHB, 0)} บาท</span></div>
        ${pending.map(d => card(d, true)).join('')}
      </div>` : ''}

    <div class="section-head"><h2>ประวัติที่ยืนยันแล้ว</h2></div>
    ${done.length ? `<div class="card">${done.map(d => card(d, false)).join('')}</div>` : `
      <div class="empty"><strong>ยังไม่มีเงินปันผล</strong>
      กด "ค้นหาอัตโนมัติ" ให้ระบบไปกวาดประวัติปันผลของหุ้นที่คุณถือมาให้ตรวจ</div>`}

    ${sum.bySymbol.length ? `
      <div class="section-head"><h2>แยกรายตัว</h2></div>
      <div class="card">${sum.bySymbol.map(s => `
        <div class="kv"><span class="k">${esc(s.symbol)}${s.yieldOnCost !== null && s.yieldOnCost !== undefined
          ? ` <span class="muted">(${fmt(s.yieldOnCost, 2)}% ต่อต้นทุน)</span>` : ''}</span>
          <span class="v">${fmt(s.netTHB, 0)} บาท</span></div>`).join('')}</div>` : ''}
  `;
}

// ---------- หน้าเตือนราคา ----------

const COND_LABEL = {
  PRICE_ABOVE: 'ราคาขึ้นถึง', PRICE_BELOW: 'ราคาลงถึง',
  CHANGE_UP: 'บวกเกิน', CHANGE_DOWN: 'ลบเกิน',
  POSITION_PL_BELOW: 'ขาดทุนเกิน', FX_ABOVE: 'USD/THB ขึ้นถึง', FX_BELOW: 'USD/THB ลงถึง',
  WBFX_ABOVE: 'เรต Webull ขึ้นถึง', WBFX_BELOW: 'เรต Webull ลงถึง',
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
            <div><strong>${esc(a.symbol || (a.condition.indexOf('FX') >= 0 ? 'ค่าเงิน' : 'พอร์ตรวม'))}</strong>
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
  const sub = state.watchSub || 'watch';

  const nav = `
    <div class="seg" style="margin-bottom:16px">
      <button data-wsub="watch" class="${sub === 'watch' ? 'is-on' : ''}">หุ้นที่จับตา</button>
      <button data-wsub="journal" class="${sub === 'journal' ? 'is-on' : ''}">บันทึกการลงทุน</button>
    </div>`;

  v.innerHTML = nav + skeleton(4);

  try {
    if (sub === 'journal') {
      v.innerHTML = nav + await journalSection();
      return;
    }
    const rows = await api('watchlist.list', {});
    v.innerHTML = nav + `
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
            <button class="btn-sm" data-quick-journal="${esc(w.symbol)}|${esc(w.market)}|${esc(w.currency)}|${w.price}">จดบันทึก</button>
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
    v.innerHTML = nav + `<div class="empty"><strong>โหลดรายการไม่สำเร็จ</strong>${esc(e.message)}</div>`;
  }
}

const JN_LABEL = { THESIS: 'เหตุผลที่ซื้อ', REVIEW: 'ทบทวน', EXIT: 'เหตุผลที่ขาย', NOTE: 'บันทึก' };

async function journalSection() {
  const [rows, sum] = await Promise.all([
    api('journal.list', { limit: 100 }),
    api('journal.summary')
  ]);
  state.journalRows = rows;

  const entry = (j) => `
    <article class="card" ${j.dueForReview ? 'style="border-color:rgba(242,181,68,.4)"' : ''}>
      <div class="list-row" style="border:0;padding-top:0">
        <div>
          <div><strong>${esc(j.symbol || 'ภาพรวมตลาด')}</strong>
            <span class="tag">${JN_LABEL[j.type] || j.type}</span>
            ${j.dueForReview ? '<span class="tag alert">ถึงเวลาทบทวน</span>' : ''}
            ${j.status === 'closed' ? '<span class="tag cash">ปิดแล้ว</span>' : ''}</div>
          <div class="pos-sub">${esc(j.date)}${j.conviction ? ' · ความมั่นใจ ' + j.conviction + '/5' : ''}${j.horizon ? ' · ถือ ' + esc(j.horizon) : ''}</div>
        </div>
        ${j.changeSincePct !== null ? `
        <div style="text-align:right">
          <div class="${plClass(j.changeSincePct)}">${signed(j.changeSincePct, 2)}%</div>
          <div class="pos-sub">ตั้งแต่วันที่จด</div>
        </div>` : ''}
      </div>

      ${j.title ? `<div style="font-weight:500;margin-bottom:4px">${esc(j.title)}</div>` : ''}
      <div style="white-space:pre-wrap;font-size:14px">${esc(j.thesis)}</div>

      ${(j.priceAtEntry || j.targetPrice || j.stopPrice) ? `
        <div style="margin-top:10px;padding-top:10px;border-top:1px dashed var(--line)">
          ${j.priceAtEntry ? `<div class="kv"><span class="k">ราคาตอนจด</span><span class="v">${fmt(j.priceAtEntry, 2)} → ${fmt(j.price, 2)}</span></div>` : ''}
          ${j.targetPrice ? `<div class="kv"><span class="k">ราคาเป้า</span><span class="v">${fmt(j.targetPrice, 2)}${j.toTargetPct !== null ? ` <span class="muted">(อีก ${fmt(j.toTargetPct, 1)}%)</span>` : ''}</span></div>` : ''}
          ${j.stopPrice ? `<div class="kv"><span class="k">จุดตัดขาดทุน</span><span class="v">${fmt(j.stopPrice, 2)}${j.toStopPct !== null ? ` <span class="muted">(ห่าง ${fmt(j.toStopPct, 1)}%)</span>` : ''}</span></div>` : ''}
          ${j.alertCount ? `<div class="kv"><span class="k">ตั้งเตือนไว้</span><span class="v muted">${j.alertCount} เงื่อนไข</span></div>` : ''}
        </div>` : ''}

      ${j.outcome ? `<div class="pos-sub" style="margin-top:8px">ผลที่เกิดขึ้น: ${esc(j.outcome)}</div>` : ''}

      <div style="margin-top:10px;display:flex;gap:10px;flex-wrap:wrap">
        <button class="link-btn" data-edit-jn="${esc(j.entryId)}">แก้ไข</button>
        ${j.status === 'open'
          ? `<button class="link-btn" data-close-jn="${esc(j.entryId)}">ปิดบันทึก</button>
             <button class="link-btn" data-snooze-jn="${esc(j.entryId)}">เลื่อนทบทวน 1 เดือน</button>` : ''}
        <button class="link-btn danger" data-del-jn="${esc(j.entryId)}">ลบ</button>
      </div>
    </article>`;

  const due = rows.filter(j => j.dueForReview);
  const rest = rows.filter(j => !j.dueForReview);

  return `
    <div class="card">
      <div class="kv"><span class="k">บันทึกทั้งหมด</span><span class="v">${sum.total} รายการ · ครอบคลุม ${sum.symbolsCovered} หุ้น</span></div>
      <div class="kv"><span class="k">ยังเปิดอยู่</span><span class="v">${sum.open} รายการ</span></div>
      <div class="kv"><span class="k">ถึงกำหนดทบทวน</span><span class="v ${sum.dueForReview ? 'stale' : ''}">${sum.dueForReview} รายการ</span></div>
    </div>

    <div class="section-head"><h2>บันทึกการลงทุน</h2>
      <button class="btn-sm" data-open="journal">จดบันทึกใหม่</button></div>

    ${due.length ? `<div class="section-head"><h2 class="stale">ถึงเวลากลับมาอ่าน</h2></div>${due.map(entry).join('')}` : ''}

    ${rest.length ? rest.map(entry).join('') : (due.length ? '' : `
      <div class="empty"><strong>ยังไม่มีบันทึก</strong>
      จดไว้ว่าทำไมถึงซื้อและเงื่อนไขไหนที่จะขาย พออีกหกเดือนกลับมาอ่าน
      จะรู้ว่าตอนนั้นคิดถูกหรือแค่โชคดี</div>`)}
  `;
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

      <div id="webull-slot"></div>

      <div class="section-head"><h2>ภาษี</h2></div>
      <button class="btn btn-ghost" id="s-tax">สรุปภาษีรายปี</button>

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
    el('s-tax').onclick = () => sheetTax();
    renderWebullSlot();
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

async function renderWebullSlot() {
  const slot = el('webull-slot');
  if (!slot) return;
  let w;
  try { w = await api('webull.status'); } catch (e) { slot.innerHTML = ''; return; }
  const bad = (w.recon || []).filter(r => r.status !== 'ok');
  slot.innerHTML = `
    <div class="section-head"><h2>Webull</h2>
      ${w.syncOn ? '<button class="btn-sm" data-wb-sync="1">ซิงก์ตอนนี้</button>' : ''}</div>
    <div class="card">
      <div class="kv"><span class="k">สถานะ</span><span class="v ${w.syncOn ? 'up-text' : 'muted'}">${w.syncOn ? 'ดึงอัตโนมัติ ทุก 5 นาทีช่วงตลาดสหรัฐ · นอกเวลาชั่วโมงละครั้ง' : 'ยังไม่เปิดการซิงก์'}</span></div>
      <div class="kv"><span class="k">เซิร์ฟเวอร์</span><span class="v">${w.env === 'prod' ? 'ของจริง' : 'ทดสอบ'}${w.ownKey ? '' : ' · บัญชีทดสอบสาธารณะ'}</span></div>
      ${w.lastSyncAt ? `<div class="kv"><span class="k">ซิงก์ล่าสุด</span><span class="v">${esc(w.lastSyncAt)}</span></div>` : ''}
      ${(w.recon || []).length ? `
        <div style="margin-top:8px;padding-top:8px;border-top:1px dashed var(--line)">
          <div class="kv"><span class="k">เทียบยอดกับ Webull</span>
            <span class="v ${bad.length ? 'down-text' : 'up-text'}">${bad.length ? 'ไม่ตรง ' + bad.length + ' รายการ' : 'ตรงทั้งหมด'}</span></div>
          ${bad.map(r => `<div class="kv"><span class="k">${esc(r.item)}</span>
            <span class="v down-text">Webull ${fmt(r.broker, 4)} · แอป ${fmt(r.ours, 4)}</span></div>`).join('')}
          ${bad.length ? '<p class="hint">Webull ไม่ส่งรายการฝากเงิน แลกเงิน และปันผลผ่าน API ถ้ายอดเงินสดไม่ตรง ลองเช็กว่าบันทึกครบหรือยัง</p>' : ''}
        </div>` : ''}
    </div>`;
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

// ---------- บัญชีและ Cash Ledger ----------

function accountsList() { return state.accounts || []; }

function accountOptions(selected, excludeFirstMatch) {
  const list = accountsList();
  return list.map((a, i) => {
    const sel = selected ? a.accountId === selected : (excludeFirstMatch ? i === 1 : i === 0);
    return `<option value="${esc(a.accountId)}" ${sel ? 'selected' : ''}>${esc(a.name)}</option>`;
  }).join('');
}

async function loadAccounts() {
  try { state.accounts = await api('accounts.list'); }
  catch (e) { state.accounts = state.accounts || []; }
}

async function cashSection() {
  const f = state.ledgerFilter || {};
  const led = await api('cash.ledger', { accountId: f.accountId || '', currency: f.currency || '', limit: 200 });
  const accs = accountsList();

  const bal = led.balances.filter(b => Math.abs(b.balance) >= 0.005);
  return `
    <div class="card">
      ${bal.length ? bal.map(b => `
        <div class="kv"><span class="k">${esc(b.account)} · ${esc(b.currency)}</span>
          <span class="v ${b.balance < 0 ? 'down-text' : 'cash-text'}">${fmt(b.balance, 2)}</span></div>`).join('')
        : '<div class="muted">ยังไม่มีเงินสดในบัญชีใด</div>'}
    </div>

    <div class="section-head"><h2>ความเคลื่อนไหวเงินสด</h2></div>
    <div class="field-row">
      ${accs.length > 1 ? `<div class="field"><select id="lf-acc" data-ledger-filter="accountId">
        <option value="">ทุกบัญชี</option>
        ${accs.map(a => `<option value="${esc(a.accountId)}" ${f.accountId === a.accountId ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}
      </select></div>` : ''}
      <div class="field"><select id="lf-cur" data-ledger-filter="currency">
        <option value="">ทุกสกุลเงิน</option>
        <option value="THB" ${f.currency === 'THB' ? 'selected' : ''}>THB</option>
        <option value="USD" ${f.currency === 'USD' ? 'selected' : ''}>USD</option>
      </select></div>
    </div>
    ${led.lines.length ? `<div class="card">${led.lines.map(l => `
      <div class="list-row">
        <div><div>${ACT_ICON[l.type] || '•'} ${TX_LABEL[l.type] || l.type} ${esc(l.symbol || '')}</div>
          <div class="pos-sub">${esc(l.date)} · ${esc(l.account)} · ${esc(l.currency)}</div></div>
        <div style="text-align:right">
          <div class="${l.amount >= 0 ? 'up-text' : 'down-text'}">${signed(l.amount, 2)}</div>
          <div class="pos-sub">คงเหลือ ${fmt(l.balanceAfter, 2)}</div>
        </div>
      </div>`).join('')}</div>` : '<div class="empty">ไม่มีรายการ</div>'}
  `;
}

// ---------- สรุปภาษีรายปี ----------

async function sheetTax(year) {
  openSheet('สรุปภาษีรายปี', skeleton(5));
  let t;
  try {
    t = await api('tax.summary', year ? { year } : {});
  } catch (e) {
    el('sheet-body').innerHTML = `<div class="empty"><strong>โหลดไม่สำเร็จ</strong>${esc(e.message)}</div>`;
    return;
  }
  el('sheet-body').innerHTML = taxBody(t);

  $$('#tax-year button', el('sheet-body')).forEach(b =>
    b.addEventListener('click', () => sheetTax(b.dataset.year)));
}

function taxBody(t) {
  const th = t.dividendTH, us = t.dividendUS, cg = t.usCapitalGains;
  return `
    <div class="seg" id="tax-year">
      ${t.availableYears.map(y =>
        `<button data-year="${y}" class="${y === t.year ? 'is-on' : ''}">${y}</button>`).join('')}
    </div>

    <div class="card">
      <div class="kv"><span class="k">เงินปันผลสุทธิรับทั้งปี</span>
        <span class="v up-text">${fmt(t.dividendTotalTHB, 0)} บาท</span></div>
      <div class="kv"><span class="k">ภาษีหัก ณ ที่จ่ายรวม</span>
        <span class="v muted">${fmt(t.dividendTaxTotalTHB, 0)} บาท</span></div>
    </div>

    <div class="section-head"><h2>ปันผลหุ้นไทย</h2></div>
    <div class="card">
      <div class="kv"><span class="k">ก่อนหักภาษี</span><span class="v">${fmt(th.grossTHB, 2)} บาท</span></div>
      <div class="kv"><span class="k">ภาษีหัก ณ ที่จ่าย (${fmt(th.effectiveRatePct, 1)}%)</span><span class="v muted">${fmt(th.taxTHB, 2)} บาท</span></div>
      <div class="kv"><span class="k">ได้รับสุทธิ</span><span class="v up-text">${fmt(th.netTHB, 2)} บาท</span></div>
      <div class="kv"><span class="k">จำนวนครั้ง</span><span class="v">${th.count} ครั้ง</span></div>
      ${th.bySymbol.length ? `<div style="margin-top:8px;padding-top:8px;border-top:1px dashed var(--line)">
        ${th.bySymbol.map(s => `<div class="kv"><span class="k">${esc(s.symbol)}</span>
          <span class="v">${fmt(s.netTHB, 0)} บาท</span></div>`).join('')}</div>` : ''}
      <p class="hint">เลือกได้ว่าจะให้ภาษีหัก ณ ที่จ่ายเป็นตัวจบ หรือนำไปรวมยื่นกับเงินได้อื่นปลายปีถ้าคำนวณแล้วได้คืนมากกว่า</p>
    </div>

    <div class="section-head"><h2>ปันผลหุ้นสหรัฐ</h2></div>
    <div class="card">
      ${us.count ? `
        <div class="kv"><span class="k">ก่อนหักภาษี</span><span class="v">${fmt(us.grossUSD, 2)} USD <span class="muted">(${fmt(us.grossTHB, 0)} บาท)</span></span></div>
        <div class="kv"><span class="k">ภาษีสหรัฐหัก (${fmt(us.effectiveRatePct, 1)}%)</span><span class="v muted">${fmt(us.taxUSD, 2)} USD</span></div>
        <div class="kv"><span class="k">ได้รับสุทธิ</span><span class="v up-text">${fmt(us.netTHB, 2)} บาท</span></div>
        <div class="kv"><span class="k">จำนวนครั้ง</span><span class="v">${us.count} ครั้ง</span></div>
        ${us.bySymbol.length ? `<div style="margin-top:8px;padding-top:8px;border-top:1px dashed var(--line)">
          ${us.bySymbol.map(s => `<div class="kv"><span class="k">${esc(s.symbol)}</span>
            <span class="v">${fmt(s.netTHB, 0)} บาท</span></div>`).join('')}</div>` : ''}
      ` : '<div class="muted">ไม่มีเงินปันผลหุ้นสหรัฐในปีนี้</div>'}
    </div>

    <div class="section-head"><h2>กำไร/ขาดทุนจากการขายหุ้นสหรัฐ</h2></div>
    <div class="card">
      ${cg.count ? `
        <div class="kv"><span class="k">กำไรรวม (เป็นบาท ณ วันขายแต่ละครั้ง)</span>
          <span class="v ${plClass(cg.totalGainTHB)}">${signed(cg.totalGainTHB, 0)} บาท</span></div>
        <div class="kv"><span class="k">ยอดขายรวม</span><span class="v">${fmt(cg.totalProceedsTHB, 0)} บาท</span></div>
        <div style="margin-top:8px;padding-top:8px;border-top:1px dashed var(--line)">
          ${cg.sales.map(s => `
            <div class="list-row"><div><strong>${esc(s.symbol)}</strong>
              <div class="pos-sub">${esc(s.date)} · ${fmt(s.quantity, s.quantity % 1 ? 4 : 0)} หุ้น</div></div>
              <div class="${plClass(s.gainTHB)}" style="text-align:right">${signed(s.gainTHB, 0)}<div class="pos-sub">บาท</div></div>
            </div>`).join('')}
        </div>
      ` : '<div class="muted">ไม่มีการขายหุ้นสหรัฐในปีนี้</div>'}
      <p class="hint">ตัวเลขนี้เป็นข้อมูลดิบ ไม่ใช่ข้อสรุปว่าต้องเสียภาษีเท่าไร ขึ้นอยู่กับว่านำเงินเข้าไทยปีไหนและเงื่อนไขอื่นตามกฎหมาย</p>
    </div>

    <div class="section-head"><h2>อัตราภาษีที่ใช้อ้างอิง</h2></div>
    <div class="card">${t.rules.map(r => `
      <div class="kv"><span class="k">${esc(r.country)} · ${esc(r.note || r.taxType)}</span>
        <span class="v">${fmt(r.rate * 100, 1)}%</span></div>`).join('')}
      <p class="hint">ปรับอัตราได้ในชีท TaxRules ถ้ากฎหมายเปลี่ยน</p>
    </div>

    <p class="hint">${esc(t.caveat)}</p>
  `;
}

// ---------- เมนูลัดจากปุ่ม FAB กลาง ----------

// ---------- อ่านภาพรายการแลกเงิน/ฝากเงินจากแอป Webull ----------

/** ย่อภาพให้ไม่เกิน 1600px แล้วแปลงเป็น JPEG base64 — ภาพหน้าจอมือถือเล็กลงหลายเท่า ส่งเร็วขึ้น */
function shrinkImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, 1600 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      const g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.9).split(',')[1]);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('เปิดภาพไม่ได้')); };
    img.src = url;
  });
}

// ---------- Dime: ใบคำสั่งซื้อหุ้นสหรัฐด้วยเงินบาท → FX + BUY ----------

/**
 * เงิน THB ฝากเข้าพอร์ตไว้ก่อนแล้ว จึงไม่สร้าง DEPOSIT ซ้ำต่อใบซื้อ:
 *   แลกบาทเป็นดอลลาร์ที่เรตในใบ → ซื้อหุ้น (ค่าคอม+VAT เป็นดอลลาร์)
 * รหัสอ้างอิงช่วยกันบันทึกซ้ำถ้าอัปภาพเดิมอีกครั้ง
 */
function sheetDimeOrder(r) {
  openSheet('บันทึกจากใบคำสั่ง Dime', `
    <div class="card card-secondary" style="margin-bottom:12px">
      <div style="font-weight:600;margin-bottom:4px">📷 ซื้อ ${esc(r.symbol)} — ตรวจตัวเลขก่อนบันทึก</div>
      ${(r.warnings || []).map(w => `<div class="pos-sub down-text">⚠ ${esc(w)}</div>`).join('')}
      ${r.consistent && !(r.warnings || []).length ? '<div class="pos-sub up-text">ตัวเลขในใบตรงกันทุกช่อง</div>' : ''}
    </div>
    <div class="field-row">
      <div class="field"><label for="o-symbol">หุ้น</label><input id="o-symbol" type="text" value="${esc(r.symbol)}"></div>
      <div class="field"><label for="o-date">วันที่คำสั่งสำเร็จ</label><input id="o-date" type="date" value="${esc(r.date || new Date().toISOString().slice(0, 10))}"></div>
    </div>
    <div class="field-row">
      <div class="field"><label for="o-qty">จำนวนหุ้น</label><input id="o-qty" type="number" step="any" value="${r.quantity}"></div>
      <div class="field"><label for="o-price">ราคาที่ได้จริง (USD)</label><input id="o-price" type="number" step="any" value="${r.price}"></div>
    </div>
    <div class="field-row">
      <div class="field"><label for="o-thb">จ่ายรวม (บาท)</label><input id="o-thb" type="number" step="any" value="${r.thb}"></div>
      <div class="field"><label for="o-rate">อัตราแลกเปลี่ยน</label><input id="o-rate" type="number" step="any" value="${r.rate}"></div>
    </div>
    <div class="field"><label for="o-usd">จำนวนเงิน (USD) รวมค่าธรรมเนียม</label><input id="o-usd" type="number" step="any" value="${r.usd}"></div>
    <div class="card card-secondary" id="o-sum"></div>
    <button class="btn btn-primary" id="o-save">บันทึก 2 รายการ</button>
  `, (root) => {
    const v = id => Number($('#' + id, root).value) || 0;
    const sum = () => {
      const fee = Math.round((v('o-usd') - v('o-qty') * v('o-price')) * 100) / 100;
      $('#o-sum', root).innerHTML = `
        <div class="pos-sub" style="margin-bottom:4px">เงินฝากเดิมจะถูกใช้ โดยบันทึก</div>
        <div class="kv"><span class="k">1. หัก ${fmt(v('o-thb'), 2)} บาท · แลกเป็น USD @ ${fmt(v('o-rate'), 2)}</span><span class="v">${fmt(v('o-usd'), 2)} USD</span></div>
        
        <div class="kv"><span class="k">2. ซื้อ ${esc($('#o-symbol', root).value.toUpperCase())} รวมค่าคอม+VAT</span><span class="v ${fee < 0 ? 'down-text' : ''}">${fmt(v('o-usd'), 2)} USD</span></div>`;
    };
    $$('input', root).forEach(i => i.addEventListener('input', sum));
    sum();

    $('#o-save', root).addEventListener('click', async () => {
      const symbol = $('#o-symbol', root).value.trim().toUpperCase();
      const date = $('#o-date', root).value;
      const qty = v('o-qty'), price = v('o-price'), usd = v('o-usd'), thb = v('o-thb'), rate = v('o-rate');
      const fee = Math.round((usd - qty * price) * 100) / 100;
      if (!symbol || !qty || !price || !usd || !thb || !rate) return toast('กรอกตัวเลขให้ครบ', true);
      if (fee < 0) return toast('ดอลลาร์รวมน้อยกว่าจำนวนหุ้น × ราคา ตรวจตัวเลขอีกครั้ง', true);
      const acc = accountsList()[0];
      const ref = 'DIME:' + symbol + ':' + date + ':' + qty;
      const common = { date, accountId: acc ? acc.accountId : '', note: 'Dime ซื้อ ' + symbol + ' ด้วยเงินบาท (อ่านจากภาพ)' };
      const btn = $('#o-save', root);
      btn.disabled = true;
      try {

        const r1 = await api('tx.add', Object.assign({}, common, { type: 'FX_CONVERT', symbol: 'THB>USD', market: 'FX', currency: 'USD', quantity: usd, fxRate: rate, externalId: ref + ':FX' }));
        await api('tx.add', Object.assign({}, common, { type: 'BUY', symbol, market: 'US', currency: 'USD', quantity: qty, price, fee, tax: 0, fxRate: rate, externalId: ref + ':BUY' }));
        closeSheet();
        toast(r1 && r1.duplicate ? 'ใบนี้เคยบันทึกแล้ว ไม่บันทึกซ้ำ' : `บันทึกซื้อ ${symbol} แล้ว`);
        await refresh(true);
      } catch (e) {
        toast(e.message, true);
        btn.disabled = false;
      }
    });
  });
}

/** ยอดเงินใน Dime! Save ที่ยังไม่ได้ลงทุน — แสดงแยก ไม่รวมในมูลค่าพอร์ต */
function sheetUninvested(thb, asOf) {
  openSheet('เงินยังไม่ได้ลงทุน (Dime! Save)', `
    <div class="field"><label for="u-thb">ยอดใน Dime! Save (บาท)</label>
      <input id="u-thb" type="number" inputmode="decimal" step="any" value="${thb === '' ? '' : Number(thb)}"></div>
    <div class="field"><label for="u-date">ณ วันที่</label>
      <input id="u-date" type="date" value="${esc(asOf || new Date().toISOString().slice(0, 10))}"></div>
    <p class="hint">แสดงแยกใต้ยอดพอร์ต ไม่นับรวมในมูลค่าพอร์ตและผลตอบแทน อัปเดตได้ด้วยการแคปหน้าเงินสดของ Dime แล้วอ่านจากภาพ</p>
    <button class="btn btn-primary" id="u-save">บันทึก</button>
  `, (root) => {
    $('#u-save', root).addEventListener('click', async () => {
      try {
        await api('dime.save', { thb: Number($('#u-thb', root).value), asOf: $('#u-date', root).value });
        closeSheet();
        toast('อัปเดตยอดเงินยังไม่ได้ลงทุนแล้ว');
        await refresh(true);
      } catch (e) { toast(e.message, true); }
    });
  });
}

function readSlipImage() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    toast('กำลังอ่านภาพ…');
    try {
      const image = await shrinkImage(file);
      const r = await api('ocr.slip', { image, mime: 'image/jpeg' });
      if (!r.ok) {
        // แสดงข้อความที่ OCR อ่านได้จริง ให้ก๊อปส่งไปแก้ตัวอ่านได้ตรงจุด
        openSheet('อ่านภาพไม่สำเร็จ', `
          <div class="card card-secondary"><div class="down-text">⚠ ${esc((r.warnings || ['อ่านภาพไม่สำเร็จ'])[0])}</div></div>
          <div class="field"><label>ข้อความที่ระบบอ่านได้จากภาพ</label>
            <textarea readonly style="min-height:180px;font-size:12px">${esc(r.textPreview || '(ไม่มีข้อความ)')}</textarea></div>
          <p class="hint">ก๊อปข้อความนี้ส่งให้ Claude เพื่อปรับตัวอ่าน · ระหว่างนี้กดปุ่ม + แล้วกรอกเองได้</p>
          <button class="btn btn-ghost" data-close-sheet="1">ปิด</button>`, (root) => {
          $('[data-close-sheet]', root).addEventListener('click', closeSheet);
        });
        return;
      }
      if (r.kind === 'DIME_ORDER') return sheetDimeOrder(r);
      if (r.kind === 'DIME_CASH') return sheetUninvested(r.saveTHB, r.asOf);
      if (r.kind === 'DIME_DIV') {
        return sheetDividend({ symbol: r.symbol, market: r.market, exDate: r.exDate, payDate: r.payDate,
          perShare: r.perShare, shares: r.shares, net: r.net, note: 'อ่านจากภาพ · ภาษีหัก ' + r.tax + ' ' + r.currency, ocr: r });
      }
      const acc = accountsList()[0];
      const base = { date: r.date, note: 'อ่านจากภาพ', ocr: r, account: acc ? acc.accountId : '' };
      if (r.kind === 'FX') {
        sheetTx(Object.assign(base, { type: 'FX_CONVERT', direction: r.direction, fxAmount: r.usd, fxRate: r.rate }));
      } else {
        sheetTx(Object.assign(base, { type: r.kind, amount: r.amount, currency: r.currency }));
      }
    } catch (e) {
      toast(e.message, true);
    }
  };
  input.click();
}

function sheetQuickActions() {
  const items = [
    { cls: 'buy', label: 'ซื้อหุ้น', run: () => sheetTx({ type: 'BUY' }),
      icon: '<path d="M4 17V7m0 10 4-4M4 17l-4-4"/>' },
    { cls: 'sell', label: 'ขายหุ้น', run: () => sheetTx({ type: 'SELL' }),
      icon: '<path d="M20 7v10m0-10-4 4m4-4 4 4"/>' },
    { cls: '', label: 'เติมเงิน', run: () => sheetTx({ type: 'DEPOSIT' }),
      icon: '<path d="M12 5v14M5 12h14"/>' },
    { cls: 'div', label: 'เพิ่มปันผล', run: () => sheetDividend(),
      icon: '<path d="M12 3v18M7 8h7a3 3 0 0 1 0 6H8a3 3 0 0 0 0 6h7"/>' },
    { cls: '', label: 'อ่านจากภาพ', run: () => readSlipImage(),
      icon: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>' },
    { cls: 'transfer', label: 'โอนเงิน', run: () => {
        if (accountsList().length < 2) { toast('มีบัญชีเดียว ยังไม่มีที่ให้โอนไปครับ', true); return; }
        sheetTx({ type: 'TRANSFER' });
      }, icon: '<path d="M17 3 21 7l-4 4M3 11V9a2 2 0 0 1 2-2h16M7 21 3 17l4-4M21 13v2a2 2 0 0 1-2 2H3"/>' }
  ];

  openSheet('เมนูลัด', `
    <div class="quick-sheet-grid">
      ${items.map((it, i) => `
        <button class="quick-sheet-item ${it.cls}" data-qa="${i}">
          <span class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${it.icon}</svg></span>
          ${it.label}
        </button>`).join('')}
    </div>
  `, (root) => {
    $$('[data-qa]', root).forEach(btn => btn.addEventListener('click', () => {
      const it = items[Number(btn.dataset.qa)];
      closeSheet();
      it.run();
    }));
  });
}

function sheetTx(prefill) {
  const p = prefill || {};
  openSheet('บันทึกรายการ', `
    ${p.ocr ? `<div class="card card-secondary" style="margin-bottom:12px">
      <div style="font-weight:600;margin-bottom:4px">📷 อ่านจากภาพแล้ว — ตรวจตัวเลขก่อนบันทึก</div>
      ${(p.ocr.warnings || []).map(w => `<div class="pos-sub down-text">⚠ ${esc(w)}</div>`).join('')}
      ${p.ocr.consistent && !(p.ocr.warnings || []).length ? '<div class="pos-sub up-text">ยอดดอลลาร์ × เรต ตรงกับยอดบาท</div>' : ''}
    </div>` : ''}
    <div class="seg" id="tx-type">
      ${['BUY', 'SELL', 'DEPOSIT', 'WITHDRAW'].map((t) =>
        `<button data-type="${t}" class="${t === (p.type || 'BUY') ? 'is-on' : ''}">${TX_LABEL[t]}</button>`).join('')}
    </div>
    <div class="seg" id="tx-type2">
      ${['DIVIDEND', 'FX_CONVERT', 'FEE'].concat(accountsList().length > 1 ? ['TRANSFER'] : []).map(t =>
        `<button data-type="${t}" class="${t === p.type ? 'is-on' : ''}">${t === 'TRANSFER' ? 'โอน' : TX_LABEL[t]}</button>`).join('')}
    </div>

    ${accountsList().length > 1 ? `
    <div class="field-row">
      <div class="field"><label for="f-account" id="f-account-label">บัญชี</label>
        <select id="f-account">${accountOptions(p.account || state.lastAccount)}</select></div>
      <div class="field" id="tx-to-wrap" hidden><label for="f-to">โอนไปบัญชี</label>
        <select id="f-to">${accountOptions('', true)}</select></div>
    </div>` : ''}

    <div class="field"><label for="f-date">วันที่</label>
      <input id="f-date" type="date" value="${esc(p.date || new Date().toISOString().slice(0, 10))}"></div>

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
          <input id="f-amount" type="number" inputmode="decimal" step="any" placeholder="0" value="${p.amount || ''}"></div>
        <div class="field"><label for="f-currency">สกุลเงิน</label>
          <select id="f-currency"><option value="THB">THB</option><option value="USD" ${p.currency === 'USD' ? 'selected' : ''}>USD</option></select></div>
      </div>
    </div>

    <div id="tx-fx" hidden>
      <div class="field"><label for="f-direction">ทิศทางการแลก</label>
        <select id="f-direction">
          <option value="THB>USD">บาท → ดอลลาร์</option>
          <option value="USD>THB" ${p.direction === 'USD>THB' ? 'selected' : ''}>ดอลลาร์ → บาท</option>
        </select></div>
      <div class="field"><label for="f-fxamount">จำนวนดอลลาร์</label>
        <input id="f-fxamount" type="number" inputmode="decimal" step="any" placeholder="0" value="${p.fxAmount || ''}"></div>
      ${p.ocr && p.ocr.thb ? `<label class="pos-sub" style="display:flex;gap:8px;align-items:center;margin:-4px 0 12px">
        <input type="checkbox" id="f-cashleg" ${p.direction === 'THB>USD' ? 'checked' : ''}>
        ${p.direction === 'THB>USD'
          ? `บันทึก <b>ฝากเงิน ฿${fmt(p.ocr.thb, 2)}</b> ก่อนแลกด้วย (โอนบาทเข้า Webull แล้วแลกทันที)`
          : `บันทึก <b>ถอนเงิน ฿${fmt(p.ocr.thb, 2)}</b> หลังแลกด้วย (ถอนบาทออกจาก Webull)`}
      </label>` : ''}
    </div>

    <div class="field" id="tx-fxrate-wrap" hidden>
      <label for="f-fxrate">อัตราแลกเปลี่ยน (บาทต่อ 1 ดอลลาร์)</label>
      <input id="f-fxrate" type="number" inputmode="decimal" step="any"
             placeholder="ปล่อยว่างเพื่อใช้เรตล่าสุด" value="${p.fxRate || ''}">
    </div>

    <div class="field"><label for="f-note">บันทึกช่วยจำ</label>
      <input id="f-note" type="text" placeholder="เหตุผลที่ซื้อ/ขาย (ไม่บังคับ)" value="${esc(p.note || '')}"></div>

    <button class="btn btn-primary" id="f-save">บันทึกรายการ</button>
  `, (root) => {
    let type = p.type || 'BUY';

    const sync = () => {
      const isTrade = type === 'BUY' || type === 'SELL';
      const isFx = type === 'FX_CONVERT';
      const needsSymbol = isTrade || type === 'DIVIDEND';

      const toWrap = $('#tx-to-wrap', root);
      if (toWrap) {
        toWrap.hidden = type !== 'TRANSFER';
        $('#f-account-label', root).textContent = type === 'TRANSFER' ? 'จากบัญชี' : 'บัญชี';
      }

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
      const accSel = $('#f-account', root);
      if (accSel) { body.accountId = accSel.value; state.lastAccount = accSel.value; }
      if (type === 'TRANSFER') body.toAccountId = $('#f-to', root).value;

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
        // ขาเงินบาทของการแลกที่อ่านจากภาพ: ฝากก่อนแลก หรือ ถอนหลังแลก
        const leg = $('#f-cashleg', root);
        const legBody = leg && leg.checked && type === 'FX_CONVERT' ? {
          type: body.symbol === 'THB>USD' ? 'DEPOSIT' : 'WITHDRAW', date: body.date, market: 'CASH',
          currency: 'THB', amount: p.ocr.thb, accountId: body.accountId, note: 'อ่านจากภาพ Webull'
        } : null;
        if (legBody && legBody.type === 'DEPOSIT') await api('tx.add', legBody);
        const r = await api('tx.add', body);
        if (legBody && legBody.type === 'WITHDRAW') await api('tx.add', legBody);
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
      <input id="a-target" type="number" inputmode="decimal" step="any" min="0"
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
        c.indexOf('WBFX') === 0 ? 'เรตของ Webull (บาทต่อ 1 ดอลลาร์)' :
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

function sheetDividend(prefill) {
  const p = prefill || {};
  const today = new Date().toISOString().slice(0, 10);
  openSheet('บันทึกเงินปันผล', `
    <div class="field-row">
      <div class="field"><label for="d-symbol">ชื่อหุ้น</label>
        <input id="d-symbol" type="text" autocapitalize="characters" spellcheck="false"
               value="${esc(p.symbol || '')}" placeholder="เช่น PTT"></div>
      <div class="field"><label for="d-market">ตลาด</label>
        <select id="d-market">
          <option value="SET" ${p.market === 'US' ? '' : 'selected'}>SET</option>
          <option value="US" ${p.market === 'US' ? 'selected' : ''}>US</option>
        </select></div>
    </div>

    <div class="field-row">
      <div class="field"><label for="d-ex">วัน XD (ขึ้นเครื่องหมาย)</label>
        <input id="d-ex" type="date" value="${esc(p.exDate || today)}"></div>
      <div class="field"><label for="d-pay">วันจ่ายเงิน</label>
        <input id="d-pay" type="date" value="${esc(p.payDate || today)}"></div>
    </div>

    <div class="field-row">
      <div class="field"><label for="d-per">ปันผลต่อหุ้น</label>
        <input id="d-per" type="number" inputmode="decimal" step="any" placeholder="0" value="${p.perShare || ''}"></div>
      <div class="field"><label for="d-shares">จำนวนหุ้น</label>
        <input id="d-shares" type="number" inputmode="decimal" step="any"
               placeholder="เว้นว่างให้คำนวณเอง" value="${p.shares || ''}"></div>
    </div>

    <div class="seg" id="d-mode">
      <button data-mode="auto" class="${p.net ? '' : 'is-on'}">หักภาษีให้อัตโนมัติ</button>
      <button data-mode="manual" class="${p.net ? 'is-on' : ''}">กรอกยอดสุทธิเอง</button>
    </div>

    <div class="field" id="d-net-wrap" hidden>
      <label for="d-net">ยอดสุทธิที่เข้าบัญชีจริง</label>
      <input id="d-net" type="number" inputmode="decimal" step="any" placeholder="0" value="${p.net || ''}">
      <p class="hint">ระบบจะถอดกลับให้เองว่าถูกหักภาษีไปเท่าไร</p>
    </div>

    <div class="field" id="d-fx-wrap" hidden>
      <label for="d-fx">อัตราแลกเปลี่ยนวันที่ได้รับ</label>
      <input id="d-fx" type="number" inputmode="decimal" step="any"
             placeholder="ปล่อยว่างเพื่อใช้เรตล่าสุด">
    </div>

    <div class="field"><label for="d-note">บันทึกช่วยจำ</label>
      <input id="d-note" type="text" placeholder="ไม่บังคับ" value="${esc(p.note || '')}"></div>
    ${p.ocr ? `<p class="hint">📷 อ่านจากภาพ: ปันผล ${fmt(p.ocr.gross, 2)} − ภาษี ${fmt(p.ocr.tax, 2)} = ${fmt(p.ocr.net, 2)} ${esc(p.ocr.currency)} ตรวจก่อนบันทึก</p>` : ''}

    <button class="btn btn-primary" id="d-save">บันทึก</button>
  `, (root) => {
    let mode = p.net ? 'manual' : 'auto';

    const sync = () => {
      $('#d-net-wrap', root).hidden = mode !== 'manual';
      $('#d-fx-wrap', root).hidden = $('#d-market', root).value !== 'US';
    };

    $$('#d-mode button', root).forEach(b => b.addEventListener('click', () => {
      mode = b.dataset.mode;
      $$('#d-mode button', root).forEach(x => x.classList.remove('is-on'));
      b.classList.add('is-on');
      sync();
    }));
    $('#d-market', root).addEventListener('change', sync);
    $('#d-ex', root).addEventListener('change', () => {
      if (!$('#d-pay', root).value) $('#d-pay', root).value = $('#d-ex', root).value;
    });
    sync();

    $('#d-save', root).addEventListener('click', async () => {
      const market = $('#d-market', root).value;
      const btn = $('#d-save', root);
      btn.disabled = true;
      try {
        await api('dividends.add', {
          symbol: $('#d-symbol', root).value.trim().toUpperCase(),
          market,
          currency: market === 'US' ? 'USD' : 'THB',
          exDate: $('#d-ex', root).value,
          payDate: $('#d-pay', root).value || $('#d-ex', root).value,
          perShare: Number($('#d-per', root).value),
          shares: Number($('#d-shares', root).value) || 0,
          taxMode: mode,
          net: Number($('#d-net', root).value) || 0,
          fxRate: Number($('#d-fx', root).value) || 0,
          note: $('#d-note', root).value
        });
        closeSheet();
        toast('บันทึกเงินปันผลแล้ว');
        state.subTab = 'div';
        await renderTransactions();
        await refresh(false);
      } catch (e) {
        toast(e.message, true);
        btn.disabled = false;
      }
    });
  });
}

function sheetJournal(prefill) {
  const p = prefill || {};
  const edit = !!p.entryId;
  openSheet(edit ? 'แก้ไขบันทึก' : 'จดบันทึกการลงทุน', `
    <div class="seg" id="j-type">
      ${Object.keys(JN_LABEL).map((t) =>
        `<button data-type="${t}" class="${t === (p.type || 'THESIS') ? 'is-on' : ''}">${JN_LABEL[t]}</button>`).join('')}
    </div>

    <div class="field-row">
      <div class="field"><label for="j-symbol">ชื่อหุ้น</label>
        <input id="j-symbol" type="text" autocapitalize="characters" spellcheck="false"
               value="${esc(p.symbol || '')}" ${edit ? 'disabled' : ''}
               placeholder="เว้นว่างได้ถ้าจดภาพรวมตลาด"></div>
      <div class="field"><label for="j-market">ตลาด</label>
        <select id="j-market" ${edit ? 'disabled' : ''}>
          <option value="SET" ${p.market === 'US' ? '' : 'selected'}>SET</option>
          <option value="US" ${p.market === 'US' ? 'selected' : ''}>US</option>
        </select></div>
    </div>

    <div class="field"><label for="j-title">หัวข้อสั้นๆ</label>
      <input id="j-title" type="text" value="${esc(p.title || '')}"
             placeholder="เช่น ซื้อเพิ่มตอนงบไตรมาส 2 ออก"></div>

    <div class="field"><label for="j-thesis">เหตุผลและสิ่งที่คาดหวัง</label>
      <textarea id="j-thesis" rows="5"
        placeholder="ทำไมถึงซื้อ คาดว่าจะเกิดอะไรขึ้น และอะไรที่จะทำให้เปลี่ยนใจ">${esc(p.thesis || '')}</textarea></div>

    <div class="field-row">
      <div class="field"><label for="j-target">ราคาเป้าหมาย</label>
        <input id="j-target" type="number" inputmode="decimal" step="any" min="0"
               value="${p.targetPrice || ''}" placeholder="ไม่บังคับ"></div>
      <div class="field"><label for="j-stop">จุดตัดขาดทุน</label>
        <input id="j-stop" type="number" inputmode="decimal" step="any" min="0"
               value="${p.stopPrice || ''}" placeholder="ไม่บังคับ"></div>
    </div>
    <p class="hint">สองช่องนี้จะถูกตั้งเป็นการเตือนราคาให้อัตโนมัติ ไม่ต้องไปตั้งซ้ำ</p>

    <div class="field-row" style="margin-top:14px">
      <div class="field"><label for="j-horizon">ตั้งใจถือนาน</label>
        <select id="j-horizon">
          ${[['', 'ไม่ระบุ'], ['1M', '1 เดือน'], ['3M', '3 เดือน'], ['6M', '6 เดือน'],
             ['1Y', '1 ปี'], ['3Y', '3 ปีขึ้นไป']].map(([v, t]) =>
            `<option value="${v}" ${(p.horizon || '3M') === v ? 'selected' : ''}>${t}</option>`).join('')}
        </select></div>
      <div class="field"><label for="j-conv">ความมั่นใจ</label>
        <select id="j-conv">
          ${[['', 'ไม่ระบุ'], ['1', '1 — ลองดู'], ['2', '2'], ['3', '3 — ปานกลาง'],
             ['4', '4'], ['5', '5 — มั่นใจมาก']].map(([v, t]) =>
            `<option value="${v}" ${String(p.conviction || 3) === v ? 'selected' : ''}>${t}</option>`).join('')}
        </select></div>
    </div>

    <div class="field"><label for="j-review">วันที่อยากกลับมาทบทวน</label>
      <input id="j-review" type="date" value="${esc(p.reviewDate || '')}">
      <p class="hint">เว้นว่างไว้ ระบบจะตั้งให้เองตามกรอบเวลาที่เลือก แล้วส่งอีเมลเตือนเมื่อถึงกำหนด</p></div>

    <button class="btn btn-primary" id="j-save">${edit ? 'บันทึกการแก้ไข' : 'บันทึก'}</button>
  `, (root) => {
    let type = p.type || 'THESIS';
    $$('#j-type button', root).forEach(b => b.addEventListener('click', () => {
      type = b.dataset.type;
      $$('#j-type button', root).forEach(x => x.classList.remove('is-on'));
      b.classList.add('is-on');
    }));

    $('#j-save', root).addEventListener('click', async () => {
      const market = $('#j-market', root).value;
      const btn = $('#j-save', root);
      btn.disabled = true;
      try {
        const tp = Number($('#j-target', root).value) || 0;
        const sp = Number($('#j-stop', root).value) || 0;
        if (tp < 0 || sp < 0) throw new Error('ราคาต้องไม่ติดลบ');
        if (tp > 0 && sp > 0 && sp >= tp) {
          throw new Error('จุดตัดขาดทุนต้องต่ำกว่าราคาเป้าหมาย — น่าจะกรอกสลับช่องกัน');
        }

        const body = {
          type,
          title: $('#j-title', root).value,
          thesis: $('#j-thesis', root).value,
          targetPrice: tp,
          stopPrice: sp,
          horizon: $('#j-horizon', root).value,
          conviction: Number($('#j-conv', root).value) || 0,
          reviewDate: $('#j-review', root).value
        };

        if (edit) {
          await api('journal.update', Object.assign({ entryId: p.entryId }, body));
          closeSheet();
          toast('แก้ไขแล้ว');
          await renderWatchlist();
          return;
        }

        const r = await api('journal.add', Object.assign(body, {
          symbol: $('#j-symbol', root).value.trim().toUpperCase(),
          market,
          currency: market === 'US' ? 'USD' : 'THB'
        }));
        closeSheet();
        toast(r.alertsCreated ? `บันทึกแล้ว พร้อมตั้งเตือน ${r.alertsCreated} เงื่อนไข` : 'บันทึกแล้ว');
        state.tab = 'watchlist';
        state.watchSub = 'journal';
        switchTab('watchlist');
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

  const sub = t.closest('[data-sub]');
  if (sub) {
    state.subTab = sub.dataset.sub;
    return renderTransactions();
  }

  if (t.closest('[data-wb-sync]')) {
    return run('ซิงก์ Webull แล้ว', async () => {
      const r = await api('webull.sync');
      toast(`ดึงคำสั่ง ${r.orders} รายการ · บันทึกใหม่ ${r.created}`);
      await refresh(true);
      renderWebullSlot();
    });
  }

    if (t.closest('[data-goto-ledger]')) {
    state.subTab = 'cash';
    return switchTab('transactions');
  }

  const fxAlert = t.closest('[data-fx-alert]');
  if (fxAlert) {
    const [cond, val] = fxAlert.dataset.fxAlert.split('|');
    return sheetAlert({ condition: cond, price: Number(val) });
  }
  if (t.closest('[data-fx-record]')) return readSlipImage();

  const gotoPf = t.closest('[data-goto-portfolio]');
  if (gotoPf) { state.pfTab = gotoPf.dataset.gotoPortfolio; window.scrollTo(0, 0); return switchTab('portfolio'); }
  if (t.closest('[data-goto-dashboard]')) { window.scrollTo(0, 0); return switchTab('dashboard'); }
  const pfTab = t.closest('[data-pf-tab]');
  if (pfTab) { state.pfTab = pfTab.dataset.pfTab; return renderPortfolio(); }
  const pfAlloc = t.closest('[data-pf-alloc]');
  if (pfAlloc) { state.pfAlloc = pfAlloc.dataset.pfAlloc; return renderPortfolio(); }
  const pfSort = t.closest('[data-pf-sort]');
  if (pfSort) { state.pfSort = pfSort.dataset.pfSort; return renderPortfolio(); }
  if (t.closest('[data-goto-divs]')) { state.subTab = 'div'; return switchTab('transactions'); }

  if (t.closest('[data-edit-uninvested]')) {
    const u = (state.dashboard && state.dashboard.uninvested) || {};
    return sheetUninvested(u.thb || '', '');
  }

  if (t.closest('[data-toggle-holdings]')) {
    state.showAllHoldings = !state.showAllHoldings;
    return renderDashboard();
  }

  const perfBtn = t.closest('[data-perf-period]');
  if (perfBtn) {
    state.perfPeriod = perfBtn.dataset.perfPeriod;
    const s = el('perf-slot');
    if (s && state.perf) s.innerHTML = perfCard(state.perf);
    if (state.tab === 'portfolio' && state.pfTab === 'performance') renderPortfolio();
    return;
  }

  if (t.closest('[data-risk-detail]')) return sheetRisk();

  if (t.closest('[data-risk-refresh]')) {
    closeSheet();
    state.risk = null;
    return renderHealthSlot(true);
  }

  const wsub = t.closest('[data-wsub]');
  if (wsub) {
    state.watchSub = wsub.dataset.wsub;
    return renderWatchlist();
  }

  const open = t.closest('[data-open]');
  if (open) {
    const kind = open.dataset.open;
    if (kind === 'tx') return sheetTx();
    if (kind === 'alert') return sheetAlert();
    if (kind === 'watch') return sheetWatch();
    if (kind === 'div') return sheetDividend();
    if (kind === 'journal') return sheetJournal();
  }

  const qj = t.closest('[data-quick-journal]');
  if (qj) {
    const [symbol, market, currency] = qj.dataset.quickJournal.split('|');
    return sheetJournal({ symbol, market, currency });
  }

  const editJn = t.closest('[data-edit-jn]');
  if (editJn) {
    const row = (state.journalRows || []).find(j => j.entryId === editJn.dataset.editJn);
    if (row) return sheetJournal(row);
    return toast('ไม่พบข้อมูลบันทึก ลองรีเฟรชหน้าอีกครั้ง', true);
  }

  const closeJn = t.closest('[data-close-jn]');
  if (closeJn) {
    const outcome = prompt('ผลที่เกิดขึ้นเป็นอย่างไร (เขียนสั้นๆ ไว้อ่านทีหลัง)');
    if (outcome === null) return;
    return run('ปิดบันทึกแล้ว', async () => {
      await api('journal.close', { entryId: closeJn.dataset.closeJn, outcome });
      await renderWatchlist();
    });
  }

  const snoozeJn = t.closest('[data-snooze-jn]');
  if (snoozeJn) {
    const d = new Date();
    d.setMonth(d.getMonth() + 1);
    return run('เลื่อนไปอีก 1 เดือน', async () => {
      await api('journal.update', {
        entryId: snoozeJn.dataset.snoozeJn,
        reviewDate: d.toISOString().slice(0, 10)
      });
      await renderWatchlist();
    });
  }

  const delJn = t.closest('[data-del-jn]');
  if (delJn) {
    if (!confirm('ลบบันทึกนี้และการเตือนที่ผูกไว้?')) return;
    return run('ลบแล้ว', async () => {
      await api('journal.delete', { entryId: delJn.dataset.delJn });
      await renderWatchlist();
    });
  }

  if (t.closest('[data-discover]')) {
    return run('ค้นหาเสร็จแล้ว', async () => {
      const r = await api('dividends.discover', { range: '2y' });
      toast(r.message, r.createdCount === 0);
      await renderTransactions();
    });
  }

  const confDiv = t.closest('[data-confirm-div]');
  if (confDiv) {
    return run('ยืนยันแล้ว', async () => {
      await api('dividends.confirm', { divId: confDiv.dataset.confirmDiv });
      await renderTransactions();
      await refresh(false);
    });
  }

  const delDiv = t.closest('[data-del-div]');
  if (delDiv) {
    if (!confirm('ลบรายการปันผลนี้? ถ้ายืนยันไปแล้วระบบจะถอนเงินสดที่บันทึกไว้ด้วย')) return;
    return run('ลบแล้ว', async () => {
      await api('dividends.delete', { divId: delDiv.dataset.delDiv });
      await renderTransactions();
      await refresh(false);
    });
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

// วัดความสูงแถบหัวข้อจริง ให้แถบแท็บของหน้า Portfolio ติดใต้พอดี (ชื่อหน้ายาวบนมือถืออาจตกเป็นสองบรรทัด)
(function trackTopbarHeight() {
  const bar = $('.topbar');
  if (!bar) return;
  const set = () => document.documentElement.style.setProperty('--topbar-h', bar.offsetHeight + 'px');
  set();
  if (window.ResizeObserver) new ResizeObserver(set).observe(bar);
  else window.addEventListener('resize', set);
})();

el('btn-bell').addEventListener('click', () => switchTab('alerts'));
el('btn-fab').addEventListener('click', (e) => {
  const btn = e.currentTarget;
  btn.classList.remove('pop'); void btn.offsetWidth; btn.classList.add('pop');
  sheetQuickActions();
});

el('g-login').addEventListener('click', () => gateSubmit('login'));
el('g-register').addEventListener('click', () => gateSubmit('register'));
el('g-pin').addEventListener('keydown', (e) => { if (e.key === 'Enter') gateSubmit('login'); });

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

// ตัวกรอง Cash Ledger
document.addEventListener('change', (e) => {
  const f = e.target.closest('[data-ledger-filter]');
  if (!f) return;
  state.ledgerFilter = Object.assign({}, state.ledgerFilter, { [f.dataset.ledgerFilter]: f.value });
  renderTransactions();
});

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
