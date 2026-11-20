// โหมดทดลอง: เก็บข้อมูลใน localStorage ของเบราว์เซอร์ และใช้กติกาเดียวกับเซิร์ฟเวอร์จริง
import { RULES, DAY_MS, FIELDS, needFor, normalizeValue, valueKey, distanceM } from './rules.js';

const KEY = 'massage-share-demo-v1';
const USERS = [
  { id: 'u-a', name: 'ผู้ใช้ A' },
  { id: 'u-b', name: 'ผู้ใช้ B' },
  { id: 'u-c', name: 'ผู้ใช้ C' },
  { id: 'u-admin', name: 'แอดมิน', isAdmin: true },
];
const uid = () => Math.random().toString(36).slice(2, 10);

function samplePhoto(label, hue) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="hsl(${hue},28%,70%)"/><stop offset="1" stop-color="hsl(${hue + 25},25%,40%)"/></linearGradient></defs>
    <rect width="640" height="420" fill="url(#g)"/>
    <text x="320" y="200" font-size="96" text-anchor="middle">💺</text>
    <text x="320" y="290" font-size="30" fill="#fff" text-anchor="middle" font-family="sans-serif">${label}</text></svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

function seed() {
  const now = Date.now();
  const L = (o) => ({
    zone: '', machines: null, hours: '', brand: '', condition: 'working', status: 'verified',
    confirmers: ['u-a', 'u-b', 'u-c'], created_by: 'u-b', created_at: now - 60 * DAY_MS, last_verified_at: now - 3 * DAY_MS, ...o,
  });
  const locations = [
    L({ id: 'l-cw', lat: 13.7466, lng: 100.5393, place: 'Central World (ตัวอย่าง)', floor: '3', zone: 'หน้าโรงภาพยนตร์',
        prices: [{ baht: 20, minutes: 10 }, { baht: 50, minutes: 30 }], payments: ['coin', 'promptpay'], machines: 4,
        hours: '10:00-22:00', photos: [samplePhoto('รูปตัวอย่าง 1', 35), samplePhoto('รูปตัวอย่าง 2', 85)] }),
    L({ id: 'l-pg', lat: 13.7462, lng: 100.5347, place: 'Siam Paragon (ตัวอย่าง)', floor: 'G', zone: 'ใกล้ทางเชื่อม BTS',
        prices: [{ baht: 20, minutes: 15 }], payments: ['coin', 'bill'], machines: 2, photos: [samplePhoto('รูปตัวอย่าง', 20)] }),
    L({ id: 'l-mbk', lat: 13.7448, lng: 100.5299, place: 'MBK Center (ตัวอย่าง)', floor: '4', zone: 'โซนร้านอาหาร',
        prices: [{ baht: 10, minutes: 5 }], payments: ['coin'], status: 'pending', confirmers: ['u-b'],
        created_at: now - 2 * DAY_MS, last_verified_at: now - 2 * DAY_MS, photos: [samplePhoto('รอยืนยัน', 55)] }),
    L({ id: 'l-t21', lat: 13.7376, lng: 100.5604, place: 'Terminal 21 อโศก (ตัวอย่าง)', floor: '2', zone: 'ข้างบันไดเลื่อน',
        prices: [{ baht: 20, minutes: 10 }], payments: ['coin', 'truemoney'], condition: 'broken', photos: [samplePhoto('เครื่องเสีย', 5)] }),
    L({ id: 'l-dmk', lat: 13.9126, lng: 100.6068, place: 'สนามบินดอนเมือง (ตัวอย่าง)', floor: '3', zone: 'ขาออก ใกล้ประตู 32',
        prices: [{ baht: 40, minutes: 15 }], payments: ['bill', 'promptpay'], last_verified_at: now - 120 * DAY_MS,
        photos: [samplePhoto('ข้อมูลเก่า', 100)] }),
  ];
  const proposals = [
    { id: 'p-1', location_id: 'l-cw', field: 'prices', value: [{ baht: 20, minutes: 10 }, { baht: 60, minutes: 30 }],
      voters: ['u-b'], created_at: now - DAY_MS, status: 'open' },
  ];
  proposals.forEach(p => p.key = valueKey(p.field, p.value));
  return { userId: 'u-a', locations, proposals };
}

export class DemoStore {
  constructor() {
    this.mode = 'demo';
    this.db = this._load();
  }
  _load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      if (s && Array.isArray(s.locations)) return s;
    } catch { /* ไม่มีข้อมูลหรืออ่านไม่ได้ */ }
    return seed();
  }
  _save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.db)); }
    catch { throw new Error('พื้นที่เก็บข้อมูลในเบราว์เซอร์เต็ม ลองรีเซ็ตข้อมูลตัวอย่างหรือใช้รูปน้อยลง'); }
  }

  async init() {}
  users() { return USERS; }
  get user() { return USERS.find(u => u.id === this.db.userId) || USERS[0]; }
  async setUser(id) { this.db.userId = id; this._save(); }
  async signIn() {}
  async signOut() {}
  async reset() { this.db = seed(); this._save(); }

  _expire() {
    const now = Date.now();
    for (const p of this.db.proposals) {
      if (p.status === 'open' && now - p.created_at > RULES.PROPOSAL_TTL_DAYS * DAY_MS) p.status = 'expired';
    }
  }
  _loc(id) {
    const l = this.db.locations.find(x => x.id === id);
    if (!l) throw new Error('ไม่พบจุดนี้');
    return l;
  }
  _near(target, pos) {
    if (this.user.isAdmin) return;
    if (!pos) throw new Error('ต้องเปิดตำแหน่ง (GPS) ก่อน');
    const d = distanceM(pos, target);
    if (d > RULES.MAX_DISTANCE_M) throw new Error(`คุณอยู่ห่างจุดนี้ ${Math.round(d)} ม. ต้องอยู่ในระยะ ${RULES.MAX_DISTANCE_M} ม.`);
  }
  _public(l, pos) {
    const { confirmers, created_by, ...rest } = l;
    return {
      ...rest,
      confirm_count: confirmers.length,
      my_confirmed: confirmers.includes(this.user.id),
      distance: pos ? distanceM(pos, l) : null,
    };
  }

  async nearby(pos, limit = 50) {
    this._expire();
    return this.db.locations.map(l => this._public(l, pos)).sort((a, b) => a.distance - b.distance).slice(0, limit);
  }

  async get(id, pos) {
    this._expire();
    const l = this._loc(id);
    const me = this.user.id;
    const proposals = this.db.proposals
      .filter(p => p.location_id === id && p.status === 'open')
      .map(p => ({ id: p.id, field: p.field, value: p.value, created_at: p.created_at, votes: p.voters.length, mine: p.voters.includes(me) }));
    return { ...this._public(l, pos), proposals };
  }

  async addLocation(data, pos) {
    const loc = { lat: Number(data.lat), lng: Number(data.lng) };
    if (!Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) throw new Error('ตำแหน่งไม่ถูกต้อง');
    for (const f of Object.keys(FIELDS)) if (f !== 'condition') loc[f] = normalizeValue(f, data[f]);
    if (!data.photos?.length) throw new Error('กรุณาใส่รูปอย่างน้อย 1 รูป');
    this._near(loc, pos);
    const now = Date.now(), me = this.user.id;
    const row = {
      id: 'l-' + uid(), ...loc, photos: [...data.photos], condition: 'working',
      status: RULES.CONFIRM_LOCATION <= 1 ? 'verified' : 'pending',
      confirmers: [me], created_by: me, created_at: now, last_verified_at: now,
    };
    this.db.locations.push(row);
    this._save();
    return row.id;
  }

  async confirm(id, pos) {
    const l = this._loc(id);
    this._near(l, pos);
    const me = this.user.id;
    if (l.status === 'pending' && l.confirmers.includes(me)) throw new Error('คุณยืนยันจุดนี้ไปแล้ว รอคนอื่นช่วยยืนยัน');
    if (!l.confirmers.includes(me)) l.confirmers.push(me);
    if (l.status === 'pending' && l.confirmers.length >= RULES.CONFIRM_LOCATION) l.status = 'verified';
    l.last_verified_at = Date.now();
    this._save();
    return { status: l.status, count: l.confirmers.length };
  }

  async submitEdit(id, field, raw, pos) {
    if (!FIELDS[field]) throw new Error('ฟิลด์ไม่ถูกต้อง');
    const l = this._loc(id);
    this._near(l, pos);
    this._expire();
    const value = normalizeValue(field, raw);
    const key = valueKey(field, value);
    if (key === valueKey(field, l[field])) throw new Error('ค่านี้ตรงกับข้อมูลปัจจุบันอยู่แล้ว');

    const me = this.user.id;
    const open = this.db.proposals.filter(p => p.location_id === id && p.field === field && p.status === 'open');
    for (const p of open) p.voters = p.voters.filter(v => v !== me); // หนึ่งคนหนึ่งเสียงต่อเรื่อง: ย้ายเสียงไปค่าใหม่
    let prop = open.find(p => p.key === key);
    if (!prop) {
      prop = { id: 'p-' + uid(), location_id: id, field, value, key, voters: [], created_at: Date.now(), status: 'open' };
      this.db.proposals.push(prop);
      open.push(prop);
    }
    prop.voters.push(me);

    const need = needFor(field);
    let applied = false;
    if (prop.voters.length >= need) {
      l[field] = prop.value;
      l.last_verified_at = Date.now();
      for (const p of open) p.status = p === prop ? 'applied' : 'rejected';
      applied = true;
    }
    this.db.proposals = this.db.proposals.filter(p => !(p.status === 'open' && p.voters.length === 0));
    this._save();
    return { applied, votes: prop.voters.length, need };
  }

  async addPhoto(id, photo, pos) {
    const l = this._loc(id);
    this._near(l, pos);
    l.photos.push(photo);
    this._save();
  }

  _admin() { if (!this.user.isAdmin) throw new Error('เฉพาะแอดมินเท่านั้น'); }
  async adminUpdate(id, field, raw) {
    this._admin();
    const l = this._loc(id);
    l[field] = normalizeValue(field, raw);
    l.last_verified_at = Date.now();
    for (const p of this.db.proposals) if (p.location_id === id && p.field === field && p.status === 'open') p.status = 'rejected';
    this._save();
  }
  async adminVerify(id) {
    this._admin();
    const l = this._loc(id);
    l.status = 'verified';
    l.last_verified_at = Date.now();
    this._save();
  }
  async adminDelete(id) {
    this._admin();
    this.db.locations = this.db.locations.filter(l => l.id !== id);
    this.db.proposals = this.db.proposals.filter(p => p.location_id !== id);
    this._save();
  }
}
