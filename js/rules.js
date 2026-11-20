// กติกาการยืนยันและฟังก์ชันช่วยที่ใช้ร่วมกันทั้งโหมดทดลองและโหมดจริง
// ถ้าแก้ค่าตรงนี้ ต้องแก้ใน supabase/schema.sql ให้ตรงกันด้วย

export const RULES = {
  CONFIRM_LOCATION: 3,   // จุดใหม่: ต้องมีคนยืนยันกี่คน (รวมคนเพิ่ม) จึงเป็น "ยืนยันแล้ว"
  CONFIRM_EDIT: 3,       // แก้ข้อมูล: ต้องมีคนส่งค่าตรงกันกี่คน
  CONFIRM_STATUS: 2,     // แจ้งเสีย / ถูกย้ายออก / กลับมาใช้ได้
  MAX_DISTANCE_M: 200,   // ต้องอยู่ใกล้จุดนั้นภายในกี่เมตร
  PROPOSAL_TTL_DAYS: 30, // ข้อเสนอที่ไม่ครบจำนวนจะหมดอายุ
  STALE_DAYS: 90,        // ไม่มีคนยืนยันนานเกินนี้ = "ข้อมูลอาจเก่า"
};

export const DAY_MS = 86400000;

export const PAYMENTS = {
  coin: 'เหรียญ',
  bill: 'ธนบัตร',
  promptpay: 'QR พร้อมเพย์',
  truemoney: 'TrueMoney',
};

export const CONDITIONS = {
  working: 'ใช้ได้',
  broken: 'เสีย',
  removed: 'ถูกย้ายออก',
};

export const FIELDS = {
  place:     { label: 'ชื่อสถานที่',       type: 'text', required: true },
  floor:     { label: 'ชั้น',              type: 'text', required: true },
  zone:      { label: 'โซน / จุดสังเกต',  type: 'text' },
  prices:    { label: 'ราคา',              type: 'prices', required: true },
  payments:  { label: 'ช่องทางจ่าย',       type: 'payments', required: true },
  machines:  { label: 'จำนวนเครื่อง',      type: 'number' },
  hours:     { label: 'เวลาเปิด-ปิด',      type: 'text' },
  brand:     { label: 'ยี่ห้อ / รุ่น',       type: 'text' },
  condition: { label: 'สถานะเครื่อง',      type: 'condition' },
};

export function needFor(field) {
  return field === 'condition' ? RULES.CONFIRM_STATUS : RULES.CONFIRM_EDIT;
}

// ทำให้ค่าอยู่ในรูปมาตรฐาน เพื่อให้ "ค่าตรงกัน" เทียบกันได้
export function normalizeValue(field, v) {
  const def = FIELDS[field];
  if (!def) throw new Error('ฟิลด์ไม่ถูกต้อง');
  switch (def.type) {
    case 'text': {
      const s = String(v ?? '').trim().replace(/\s+/g, ' ');
      if (def.required && !s) throw new Error(`กรุณากรอก${def.label}`);
      return s;
    }
    case 'number': {
      if (v === '' || v == null) return null;
      const n = Math.round(Number(v));
      if (!Number.isFinite(n) || n < 0) throw new Error(`${def.label}ไม่ถูกต้อง`);
      return n;
    }
    case 'prices': {
      const list = (Array.isArray(v) ? v : [])
        .map(p => ({ baht: Number(p.baht), minutes: Math.round(Number(p.minutes)) }))
        .filter(p => p.baht > 0 && p.minutes > 0)
        .sort((a, b) => a.minutes - b.minutes || a.baht - b.baht);
      if (!list.length) throw new Error('กรุณาใส่ราคาอย่างน้อย 1 แบบ');
      return list;
    }
    case 'payments': {
      const list = [...new Set(Array.isArray(v) ? v : [])].filter(k => k in PAYMENTS).sort();
      if (!list.length) throw new Error('กรุณาเลือกช่องทางจ่ายอย่างน้อย 1 แบบ');
      return list;
    }
    case 'condition':
      if (!(v in CONDITIONS)) throw new Error('สถานะไม่ถูกต้อง');
      return v;
  }
}

export function valueKey(field, v) {
  return FIELDS[field].type === 'text' ? String(v ?? '').toLowerCase() : JSON.stringify(v ?? null);
}

export function distanceM(a, b) {
  const R = 6371000, rad = d => d * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function isStale(loc) {
  return Date.now() - loc.last_verified_at > RULES.STALE_DAYS * DAY_MS;
}

export function formatPrices(prices) {
  if (!prices?.length) return '-';
  return prices.map(p => `${p.baht} บาท / ${p.minutes} นาที`).join(' · ');
}

export function formatDistance(m) {
  if (m == null) return '';
  return m < 1000 ? `${Math.round(m)} ม.` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} กม.`;
}

export function displayValue(field, v) {
  switch (FIELDS[field]?.type) {
    case 'prices': return formatPrices(v);
    case 'payments': return (v || []).map(k => PAYMENTS[k] || k).join(', ') || '-';
    case 'condition': return CONDITIONS[v] || v;
    case 'number': return v == null ? '-' : String(v);
    default: return v || '-';
  }
}

const rtf = new Intl.RelativeTimeFormat('th', { numeric: 'auto' });
export function timeAgo(ms) {
  const diff = (ms - Date.now()) / 1000;
  const steps = [[60, 'second'], [3600, 'minute'], [86400, 'hour'], [2592000, 'day'], [31536000, 'month'], [Infinity, 'year']];
  const div = [1, 60, 3600, 86400, 2592000, 31536000];
  for (let i = 0; i < steps.length; i++) {
    if (Math.abs(diff) < steps[i][0]) return rtf.format(Math.round(diff / div[i]), steps[i][1]);
  }
}
