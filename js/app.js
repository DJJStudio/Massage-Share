import { CONFIG } from './config.js';
import {
  RULES, FIELDS, PAYMENTS, CONDITIONS, needFor, distanceM, isStale,
  formatPrices, formatDistance, displayValue, timeAgo,
} from './rules.js';
import { DemoStore } from './store-demo.js';
import { mountAd } from './ads.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = { pos: null, posFromGps: false, locations: [], currentId: null };
let store, map, markers, userMarker, userCircle;

// ---------- เริ่มต้น ----------
async function createStore() {
  if (CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY) {
    await loadScript('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js');
    const { SupabaseStore } = await import('./store-supabase.js');
    return new SupabaseStore(CONFIG);
  }
  return new DemoStore();
}
function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = () => rej(new Error('โหลดสคริปต์ไม่ได้: ' + src));
    document.head.appendChild(s);
  });
}

async function main() {
  document.querySelectorAll('[data-rule]').forEach(el => el.textContent = RULES[el.dataset.rule]);
  store = await createStore();
  store.onUserChange = () => { renderUser(); refresh(); };
  await store.init();
  initMap();
  renderUser();
  setupDemoBar();
  setupDialogs();
  setPos(CONFIG.DEFAULT_CENTER, false);
  map.setView([state.pos.lat, state.pos.lng], 15);
  await refresh();
  locate(false);
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
}

// ---------- แผนที่และตำแหน่ง ----------
// แผนที่ OpenStreetMap (ฟรี) — ปรับโทนสีให้เข้ากับธีมด้วย CSS filter ใน style.css
function tiles() {
  return L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; OpenStreetMap contributors',
  });
}

function initMap() {
  map = L.map('map', { zoomControl: false, attributionControl: false }).setView([CONFIG.DEFAULT_CENTER.lat, CONFIG.DEFAULT_CENTER.lng], 15);
  L.control.zoom({ position: 'topright' }).addTo(map);
  L.control.attribution({ position: 'bottomleft', prefix: false }).addTo(map); // มุมขวาล่างมีปุ่มตำแหน่งของฉัน
  tiles().addTo(map);
  markers = L.layerGroup().addTo(map);
  $('#locateBtn').onclick = () => locate(true);
}

function setPos(p, fromGps) {
  state.pos = { lat: p.lat, lng: p.lng };
  state.posFromGps = fromGps;
  const ll = [p.lat, p.lng];
  if (!userMarker) {
    userCircle = L.circle(ll, { radius: RULES.MAX_DISTANCE_M, color: '#2563eb', weight: 1, fillOpacity: .06 }).addTo(map);
    userMarker = L.circleMarker(ll, { radius: 8, color: '#fff', weight: 3, fillColor: '#2563eb', fillOpacity: 1 }).addTo(map)
      .bindTooltip('ตำแหน่งของคุณ');
  } else {
    userMarker.setLatLng(ll);
    userCircle.setLatLng(ll);
  }
  $('#posNote').textContent = fromGps ? '' : (store.mode === 'demo' ? 'ใช้ตำแหน่งจำลอง' : 'ไม่ได้ใช้ GPS — แสดงจากย่านสยาม');
}

function locate(byUser) {
  if (!navigator.geolocation) { if (byUser) toast('อุปกรณ์นี้ไม่รองรับ GPS', true); return; }
  navigator.geolocation.getCurrentPosition(
    p => {
      setPos({ lat: p.coords.latitude, lng: p.coords.longitude }, true);
      map.setView([state.pos.lat, state.pos.lng], 16);
      refresh();
    },
    () => {
      if (!byUser) return;
      map.setView([state.pos.lat, state.pos.lng], 16);
      toast('ใช้ตำแหน่งไม่ได้ — กรุณาอนุญาตการเข้าถึงตำแหน่ง', true);
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
  );
}

// ---------- รายการและหมุด ----------
async function refresh() {
  try {
    state.locations = await store.nearby(state.pos, CONFIG.NEARBY_LIMIT);
  } catch (e) { toast(e.message, true); return; }
  renderMarkers();
  renderList();
}

function badgesHtml(l) {
  const b = [];
  if (l.condition === 'removed') b.push('<span class="badge bad">ถูกย้ายออก</span>');
  else if (l.condition === 'broken') b.push('<span class="badge bad">เครื่องเสีย</span>');
  if (l.status === 'pending') b.push(`<span class="badge warn">รอยืนยัน ${l.confirm_count}/${RULES.CONFIRM_LOCATION}</span>`);
  else b.push('<span class="badge ok">ยืนยันแล้ว</span>');
  if (isStale(l)) b.push('<span class="badge stale">ข้อมูลอาจเก่า</span>');
  return `<div class="badges">${b.join('')}</div>`;
}

function markerColor(l) {
  if (l.condition !== 'working') return '#a3352b';
  if (l.status === 'pending') return '#a8641a';
  if (isStale(l)) return '#8a857a';
  return '#2e3b2b';
}

function renderMarkers() {
  markers.clearLayers();
  for (const l of state.locations) {
    if (l.condition === 'removed') continue;
    L.circleMarker([l.lat, l.lng], { radius: 10, color: '#fff', weight: 2, fillColor: markerColor(l), fillOpacity: 1 })
      .bindTooltip(`${esc(l.place)} · ชั้น ${esc(l.floor)}`)
      .on('click', () => openDetail(l.id))
      .addTo(markers);
  }
}

function renderStats() {
  const active = state.locations.filter(l => l.condition !== 'removed');
  const near = active.filter(l => l.distance <= 5000).length;
  const verified = active.filter(l => l.status === 'verified').length;
  const nearest = active.reduce((m, l) => Math.min(m, l.distance ?? Infinity), Infinity);
  $('#stats').innerHTML = `
    <div class="stat"><b>${near}</b><span>จุดในระยะ 5 กม.</span></div>
    <div class="stat"><b>${verified}</b><span>ยืนยันแล้ว</span></div>
    <div class="stat"><b>${Number.isFinite(nearest) ? formatDistance(nearest) : '-'}</b><span>จุดที่ใกล้สุด</span></div>`;
}

function renderList() {
  renderStats();
  const list = $('#list');
  list.innerHTML = '';
  const items = [...state.locations].sort((a, b) => (a.condition === 'removed') - (b.condition === 'removed') || a.distance - b.distance);
  if (!items.length) {
    list.innerHTML = '<div class="empty">ยังไม่มีใครแชร์จุดแถวนี้<br>เป็นคนแรกที่แชร์ด้วยปุ่ม “＋ แชร์จุดใหม่”</div>';
    return;
  }
  items.forEach((l, i) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'card' + (l.condition === 'removed' ? ' dim' : '');
    card.innerHTML = `
      <div class="card-media">
        <img src="${esc(l.photos?.[0] || 'icon.svg')}" alt="" loading="lazy">
        ${badgesHtml(l)}
        <span class="card-dist">${formatDistance(l.distance)}</span>
      </div>
      <div class="card-foot">
        <div>
          <div class="card-title">${esc(l.place)}</div>
          <div class="card-sub">ชั้น ${esc(l.floor)}${l.zone ? ' · ' + esc(l.zone) : ''}</div>
          <div class="card-price">${esc(formatPrices(l.prices))}</div>
        </div>
        <span class="round-btn" aria-hidden="true">→</span>
      </div>`;
    card.onclick = () => openDetail(l.id);
    list.appendChild(card);
    if ((i + 1) % CONFIG.AD_EVERY_N_ITEMS === 0 || (i === items.length - 1 && items.length < CONFIG.AD_EVERY_N_ITEMS)) {
      mountAd(list, CONFIG.ADSENSE_SLOT_LIST, store.mode === 'demo');
    }
  });
}

// ---------- หน้ารายละเอียด ----------
const svg = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICONS = {
  price: svg('<circle cx="12" cy="12" r="9"/><path d="M15 9.5c-.5-1-1.6-1.5-3-1.5-1.7 0-3 .8-3 2s1.3 1.7 3 2 3 .8 3 2-1.3 2-3 2c-1.4 0-2.5-.5-3-1.5M12 6v12"/>'),
  floor: svg('<path d="M3 20h4v-4h4v-4h4V8h4V4"/>'),
  pin: svg('<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>'),
  pay: svg('<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18"/>'),
  chair: svg('<path d="M7 4v9h10a2 2 0 0 1 2 2v3M7 13a3 3 0 0 0-3 3v2M5 20h14"/>'),
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  tag: svg('<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.5"/>'),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7"/>'),
  route: svg('<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7"/>'),
};
function progress(n, need) {
  return `<span class="progress">${Array.from({ length: need }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</span>`;
}

async function openDetail(id) {
  state.currentId = id;
  let l;
  try { l = await store.get(id, state.pos); } catch (e) { toast(e.message, true); return; }
  if (!l) { toast('ไม่พบจุดนี้', true); return; }
  if (!$('#detailDlg').open) map.panTo([l.lat, l.lng]);
  const user = store.user;
  const d = state.pos ? distanceM(state.pos, l) : null;
  const near = d != null && d <= RULES.MAX_DISTANCE_M;
  const nav = `https://www.google.com/maps/dir/?api=1&destination=${l.lat},${l.lng}`;

  const confirmLabel = l.status === 'pending'
    ? (l.my_confirmed ? `คุณยืนยันแล้ว (${l.confirm_count}/${RULES.CONFIRM_LOCATION})` : `✓ ยืนยันว่ามีจุดนี้จริง (${l.confirm_count}/${RULES.CONFIRM_LOCATION})`)
    : '✓ ข้อมูลยังถูกต้อง';
  const confirmDisabled = l.status === 'pending' && l.my_confirmed;

  const statusBtns = Object.keys(CONDITIONS).filter(c => c !== l.condition).map(c => {
    const label = c === 'working' ? 'แจ้งว่ากลับมาใช้ได้' : c === 'broken' ? 'แจ้งเครื่องเสีย' : 'แจ้งว่าถูกย้ายออก';
    return `<button class="btn" data-act="status" data-val="${c}">${label}</button>`;
  }).join('');

  const proposals = (l.proposals || []).map(p => {
    const need = needFor(p.field);
    return `<div class="proposal">
      <div><b>${esc(FIELDS[p.field].label)}</b> → ${esc(displayValue(p.field, p.value))}
        <div class="muted small">${p.votes}/${need} คน ${progress(p.votes, need)} · หมดอายุใน ${Math.max(0, Math.ceil(RULES.PROPOSAL_TTL_DAYS - (Date.now() - p.created_at) / 86400000))} วัน</div></div>
      ${p.mine ? '<span class="muted small">คุณโหวตแล้ว</span>' : `<button class="btn" data-act="agree" data-pid="${esc(p.id)}">เห็นด้วย</button>`}
    </div>`;
  }).join('');

  const tile = (icon, label, value, wide) =>
    `<div class="tile${wide ? ' wide' : ''}"><div class="tile-icon">${ICONS[icon]}</div>
      <div class="tile-label">${label}</div><div class="tile-value">${esc(value)}</div></div>`;
  const tiles = [
    tile('price', FIELDS.prices.label, displayValue('prices', l.prices), true),
    tile('floor', FIELDS.floor.label, displayValue('floor', l.floor)),
    tile('pin', FIELDS.zone.label, displayValue('zone', l.zone)),
    tile('pay', FIELDS.payments.label, displayValue('payments', l.payments)),
    tile('chair', FIELDS.machines.label, displayValue('machines', l.machines)),
    tile('clock', FIELDS.hours.label, displayValue('hours', l.hours)),
    tile('tag', FIELDS.brand.label, displayValue('brand', l.brand)),
    tile('check', 'ยืนยันล่าสุด', timeAgo(l.last_verified_at)),
    tile('route', 'ระยะจากคุณ', formatDistance(d) || '-'),
  ].join('');

  const body = $('#detailBody');
  body.innerHTML = `
    <div class="sheet-head"><h2>${esc(l.place)}</h2><button type="button" class="icon-btn" data-close>✕</button></div>
    ${badgesHtml(l)}
    <div class="photos">${(l.photos || []).map(src => `<img src="${esc(src)}" alt="รูปเก้าอี้นวด" loading="lazy">`).join('')}</div>
    <div class="tiles">${tiles}</div>
    <div class="actions">
      <a class="btn primary" href="${nav}" target="_blank" rel="noopener">นำทาง <span class="dot">↗</span></a>
      <button class="btn" data-act="confirm" ${confirmDisabled ? 'disabled' : ''}>${confirmLabel}</button>
    </div>
    <div class="near-note ${near ? 'ok' : 'far'}">${near
      ? `คุณอยู่ในระยะ ${RULES.MAX_DISTANCE_M} ม. ยืนยันหรือแก้ไขข้อมูลได้`
      : `ต้องอยู่ใกล้จุดนี้ไม่เกิน ${RULES.MAX_DISTANCE_M} ม. จึงจะยืนยันหรือแก้ไขได้${user?.isAdmin ? ' (แอดมินได้รับยกเว้น)' : ''}`}</div>
    <div class="section"><h3>สถานะเครื่อง</h3>
      <p class="muted small">ต้องมี ${RULES.CONFIRM_STATUS} คนแจ้งตรงกันจึงเปลี่ยนสถานะ</p>
      <div class="actions">${statusBtns}</div></div>
    <div class="section"><h3>ข้อเสนอแก้ไขที่รอยืนยัน</h3>
      ${proposals || '<p class="muted small">ไม่มี</p>'}
      <div class="actions">
        <button class="btn" data-act="edit">✏️ เสนอแก้ไขข้อมูล</button>
        <label class="btn">📷 เพิ่มรูป<input type="file" accept="image/*" data-act="photo" hidden></label>
      </div></div>
    ${user?.isAdmin ? `<div class="section"><h3>แอดมิน</h3><div class="actions">
      <button class="btn" data-act="admin-edit">แก้ไขทันที</button>
      ${l.status === 'pending' ? '<button class="btn" data-act="admin-verify">อนุมัติจุดนี้</button>' : ''}
      <button class="btn danger" data-act="admin-delete">ลบจุดนี้</button></div></div>` : ''}
    <div id="detailAd"></div>`;
  mountAd($('#detailAd'), CONFIG.ADSENSE_SLOT_DETAIL, store.mode === 'demo');

  body.querySelector('[data-close]').onclick = () => $('#detailDlg').close();
  body.querySelectorAll('[data-act]').forEach(el => {
    const act = el.dataset.act;
    if (act === 'photo') el.onchange = () => run(async () => {
      const file = el.files[0]; if (!file) return;
      await requireUser();
      await store.addPhoto(id, await resizeImage(file), state.pos);
      toast('เพิ่มรูปแล้ว');
    });
    else el.onclick = () => handleAction(act, el, l);
  });
  if (!$('#detailDlg').open) $('#detailDlg').showModal();
}

async function handleAction(act, el, l) {
  if (act === 'edit') return openEdit(l, false);
  if (act === 'admin-edit') return openEdit(l, true);
  await run(async () => {
    await requireUser();
    if (act === 'confirm') {
      const r = await store.confirm(l.id, state.pos);
      toast(r.status === 'verified' && l.status === 'pending' ? 'ครบแล้ว! จุดนี้ได้รับการยืนยัน' :
        l.status === 'pending' ? `ยืนยันแล้ว (${r.count}/${RULES.CONFIRM_LOCATION})` : 'ขอบคุณ! อัปเดตวันที่ยืนยันล่าสุดแล้ว');
    } else if (act === 'status') {
      reportResult(await store.submitEdit(l.id, 'condition', el.dataset.val, state.pos));
    } else if (act === 'agree') {
      const p = l.proposals.find(x => x.id === el.dataset.pid);
      reportResult(await store.submitEdit(l.id, p.field, p.value, state.pos));
    } else if (act === 'admin-verify') {
      await store.adminVerify(l.id); toast('อนุมัติแล้ว');
    } else if (act === 'admin-delete') {
      if (!confirm(`ลบ “${l.place}” ถาวร?`)) return;
      await store.adminDelete(l.id); $('#detailDlg').close(); toast('ลบแล้ว');
    }
  });
}

function reportResult(r) {
  toast(r.applied ? `ครบ ${r.need} คน — อัปเดตข้อมูลแล้ว` : `ส่งแล้ว (${r.votes}/${r.need}) รอคนอื่นยืนยันค่าเดียวกัน`);
}

// ทำงาน แล้วรีเฟรชหน้าจอ แสดงข้อผิดพลาดเป็นข้อความ
async function run(fn) {
  try {
    await fn();
    await refresh();
    if ($('#detailDlg').open && state.locations.some(l => l.id === state.currentId)) await openDetail(state.currentId);
    else if ($('#detailDlg').open) $('#detailDlg').close();
  } catch (e) {
    toast(e.message || String(e), true);
  }
}

async function requireUser() {
  if (store.user) return;
  if (confirm('ต้องเข้าสู่ระบบก่อน เข้าสู่ระบบด้วย Google ไหม?')) await store.signIn();
  throw new Error('กรุณาเข้าสู่ระบบก่อน');
}

// ---------- ตัวแก้ไขราคา / ช่องทางจ่าย ----------
function pricesEditor(container, initial) {
  container.innerHTML = '<div class="rows"></div><button type="button" class="chip">＋ เพิ่มราคา</button>';
  const rows = $('.rows', container);
  const add = (p = {}) => {
    const r = document.createElement('div');
    r.className = 'price-row';
    r.innerHTML = `<input type="number" min="1" inputmode="decimal" placeholder="บาท" value="${esc(p.baht ?? '')}"> บาท /
      <input type="number" min="1" inputmode="numeric" placeholder="นาที" value="${esc(p.minutes ?? '')}"> นาที
      <button type="button" class="icon-btn" title="ลบ">✕</button>`;
    $('button', r).onclick = () => r.remove();
    rows.appendChild(r);
  };
  (initial?.length ? initial : [{}]).forEach(add);
  $('.chip', container).onclick = () => add();
  return () => [...rows.children].map(r => {
    const [b, m] = r.querySelectorAll('input');
    return { baht: b.value, minutes: m.value };
  });
}

function paymentsEditor(container, initial = []) {
  container.innerHTML = `<div class="checks">${Object.entries(PAYMENTS).map(([k, v]) =>
    `<label><input type="checkbox" value="${k}" ${initial.includes(k) ? 'checked' : ''}> ${v}</label>`).join('')}</div>`;
  return () => [...container.querySelectorAll('input:checked')].map(i => i.value);
}

function valueEditor(container, field, current) {
  const t = FIELDS[field].type;
  if (t === 'prices') return pricesEditor(container, current);
  if (t === 'payments') return paymentsEditor(container, current);
  if (t === 'condition') {
    container.innerHTML = `<select>${Object.entries(CONDITIONS).map(([k, v]) => `<option value="${k}" ${k === current ? 'selected' : ''}>${v}</option>`).join('')}</select>`;
    return () => $('select', container).value;
  }
  container.innerHTML = `<input ${t === 'number' ? 'type="number" min="0"' : ''} value="${esc(current ?? '')}">`;
  return () => $('input', container).value;
}

// ---------- เสนอแก้ไข ----------
let editCtx = null;
function openEdit(l, adminMode) {
  editCtx = { l, adminMode, get: null };
  $('#editTitle').textContent = adminMode ? 'แก้ไขทันที (แอดมิน)' : 'เสนอแก้ไขข้อมูล';
  $('#editHint').textContent = adminMode
    ? 'การแก้ไขของแอดมินมีผลทันที'
    : `ข้อมูลจะเปลี่ยนเมื่อมี ${RULES.CONFIRM_EDIT} คนส่งค่าที่ตรงกัน ภายใน ${RULES.PROPOSAL_TTL_DAYS} วัน`;
  const sel = $('#editField');
  const fields = Object.keys(FIELDS).filter(f => adminMode || f !== 'condition');
  sel.innerHTML = fields.map(f => `<option value="${f}">${FIELDS[f].label}</option>`).join('');
  const update = () => { editCtx.get = valueEditor($('#editInput'), sel.value, l[sel.value]); };
  sel.onchange = update;
  update();
  $('#editDlg').showModal();
}

// ---------- เพิ่มจุดใหม่ ----------
let addCtx = null;
function openAdd() {
  const form = $('#addForm');
  form.reset();
  $('#addThumbs').innerHTML = '';
  $('#photoNote').textContent = '';
  $('#placeList').innerHTML = [...new Set(state.locations.map(l => l.place))].map(p => `<option value="${esc(p)}">`).join('');
  addCtx = {
    photos: [],
    getPrices: pricesEditor($('[data-editor=prices]', form)),
    getPayments: paymentsEditor($('[data-editor=payments]', form)),
    pin: { ...state.pos },
  };
  $('#addDlg').showModal();
  // แผนที่เล็กสำหรับปักหมุด
  if (!openAdd.map) {
    const m = L.map('pickMap', { zoomControl: true, attributionControl: false });
    tiles().addTo(m);
    openAdd.map = m;
    openAdd.pin = L.marker([0, 0], { draggable: true }).addTo(m);
    openAdd.circle = L.circle([0, 0], { radius: RULES.MAX_DISTANCE_M, weight: 1, fillOpacity: .05 }).addTo(m);
  }
  const m = openAdd.map;
  openAdd.pin.setLatLng([state.pos.lat, state.pos.lng]);
  openAdd.circle.setLatLng([state.pos.lat, state.pos.lng]);
  openAdd.pin.off('dragend').on('dragend', e => { const ll = e.target.getLatLng(); addCtx.pin = { lat: ll.lat, lng: ll.lng }; });
  setTimeout(() => { m.invalidateSize(); m.setView([state.pos.lat, state.pos.lng], 18); }, 50);
}

async function submitAdd(e) {
  e.preventDefault();
  const f = new FormData(e.target);
  const btn = $('button[type=submit]', e.target);
  btn.disabled = true;
  const label = btn.innerHTML;
  try {
    await requireUser();
    btn.textContent = 'กำลังอัปโหลด…';
    const data = {
      lat: addCtx.pin.lat, lng: addCtx.pin.lng,
      place: f.get('place'), floor: f.get('floor'), zone: f.get('zone'),
      machines: f.get('machines'), hours: f.get('hours'), brand: f.get('brand'),
      prices: addCtx.getPrices(), payments: addCtx.getPayments(), photos: addCtx.photos,
    };
    const id = await store.addLocation(data, state.pos);
    $('#addDlg').close();
    toast(RULES.CONFIRM_LOCATION > 1 ? `แชร์แล้ว! รอคนอื่นยืนยันอีก ${RULES.CONFIRM_LOCATION - 1} คน` : 'แชร์แล้ว!');
    await refresh();
    openDetail(id);
  } catch (err) {
    toast(err.message, true);
  } finally {
    btn.disabled = false;
    btn.innerHTML = label;
  }
}

function renderAddThumbs() {
  const n = addCtx.photos.length;
  $('#photoNote').textContent = n ? `เลือกแล้ว ${n} รูป` : '';
  $('#addThumbs').innerHTML = addCtx.photos.map((url, i) =>
    `<span class="thumb"><img src="${url}" alt=""><button type="button" data-rm="${i}" aria-label="ลบรูป">✕</button></span>`).join('');
}

function loadImage(blob) {
  return new Promise((res, rej) => {
    const img = new Image();
    const src = URL.createObjectURL(blob);
    img.onload = () => { URL.revokeObjectURL(src); res(img); };
    img.onerror = () => { URL.revokeObjectURL(src); rej(new Error('decode')); };
    img.src = src;
  });
}

let heicLib = null;
function loadHeicLib() {
  heicLib ||= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js';
    s.onload = () => res(window.heic2any);
    s.onerror = () => { heicLib = null; rej(new Error('โหลดตัวแปลงรูปไม่สำเร็จ')); };
    document.head.appendChild(s);
  });
  return heicLib;
}

// ย่อรูปก่อนอัปโหลด (ด้านยาวสุด 1024px, JPEG) รองรับ HEIC จากมือถือบางรุ่น
async function resizeImage(file, max = 1024) {
  let img;
  try {
    img = await loadImage(file);
  } catch {
    const isHeic = /hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name || '');
    if (!isHeic) throw new Error(`เปิดรูป "${file.name || ''}" ไม่ได้ ลองถ่ายใหม่หรือเลือกรูปอื่น`);
    try {
      const heic2any = await loadHeicLib();
      const out = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.8 });
      img = await loadImage(Array.isArray(out) ? out[0] : out);
    } catch {
      throw new Error('แปลงรูป HEIC ไม่สำเร็จ ลองตั้งกล้องให้บันทึกเป็น JPG');
    }
  }
  const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.75);
}

// ---------- ผูกเหตุการณ์ ----------
function setupDialogs() {
  document.querySelectorAll('dialog').forEach(d => {
    d.addEventListener('click', e => { if (e.target === d) d.close(); });
    d.querySelectorAll('[data-close]').forEach(b => b.onclick = () => d.close());
  });
  $('#addBtn').onclick = () => openAdd();
  $('#addForm').onsubmit = submitAdd;
  $('#addForm [name=photos]').onchange = async e => {
    const files = [...e.target.files];
    e.target.value = '';
    if (!files.length || !addCtx) return;
    const note = $('#photoNote');
    note.textContent = 'กำลังเตรียมรูป…';
    for (const file of files) {
      try {
        addCtx.photos.push(await resizeImage(file));
      } catch (err) { toast(err.message, true); }
    }
    renderAddThumbs();
  };
  $('#addThumbs').onclick = e => {
    const b = e.target.closest('[data-rm]');
    if (!b) return;
    addCtx.photos.splice(Number(b.dataset.rm), 1);
    renderAddThumbs();
  };
  $('#editForm').onsubmit = async e => {
    e.preventDefault();
    const { l, adminMode, get } = editCtx;
    const field = $('#editField').value;
    await run(async () => {
      await requireUser();
      if (adminMode) { await store.adminUpdate(l.id, field, get()); toast('แก้ไขแล้ว'); }
      else reportResult(await store.submitEdit(l.id, field, get(), state.pos));
      $('#editDlg').close();
    });
  };
}

function renderUser() {
  const area = $('#userArea');
  const u = store.user;
  if (store.mode === 'demo') { area.innerHTML = `<span class="muted">${esc(u.name)}</span>`; return; }
  area.innerHTML = u
    ? `<span>${esc(u.name)}${u.isAdmin ? ' (แอดมิน)' : ''}</span><button class="chip" id="signOut">ออกจากระบบ</button>`
    : '<button class="chip" id="signIn">เข้าสู่ระบบด้วย Google</button>';
  $('#signIn')?.addEventListener('click', () => store.signIn());
  $('#signOut')?.addEventListener('click', () => store.signOut());
}

function setupDemoBar() {
  if (store.mode !== 'demo') return;
  $('#demoBar').hidden = false;
  const sel = $('#demoUser');
  sel.innerHTML = store.users().map(u => `<option value="${u.id}">${esc(u.name)}</option>`).join('');
  sel.value = store.user.id;
  sel.onchange = async () => { await store.setUser(sel.value); renderUser(); refresh(); };
  $('#demoMoveHere').onclick = () => { const c = map.getCenter(); setPos({ lat: c.lat, lng: c.lng }, false); refresh(); toast('ย้ายตำแหน่งของคุณมากลางแผนที่แล้ว'); };
  $('#demoReset').onclick = async () => { await store.reset(); sel.value = store.user.id; renderUser(); refresh(); toast('รีเซ็ตข้อมูลตัวอย่างแล้ว'); };
}

let toastTimer;
function toast(msg, isError = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.className = 'toast', 3200);
}

main().catch(e => { console.error(e); toast('เริ่มแอปไม่สำเร็จ: ' + e.message, true); });
