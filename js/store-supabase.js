// โหมดจริง: ข้อมูลอยู่บน Supabase กติกาการยืนยันทั้งหมดตรวจที่ฝั่งเซิร์ฟเวอร์ (supabase/schema.sql)
// ฝั่งนี้แค่ส่งคำขอและแปลงรูปแบบข้อมูล
import { normalizeValue } from './rules.js';

const ms = t => (t ? new Date(t).getTime() : null);

function row(r) {
  return {
    ...r,
    distance: r.distance_m ?? null,
    created_at: ms(r.created_at),
    last_verified_at: ms(r.last_verified_at),
    proposals: (r.proposals || []).map(p => ({ ...p, created_at: ms(p.created_at) })),
  };
}

export class SupabaseStore {
  constructor(cfg) {
    this.mode = 'live';
    this.sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    this._user = null;
  }

  async init() {
    const { data } = await this.sb.auth.getSession();
    await this._loadUser(data.session);
    this.sb.auth.onAuthStateChange((_e, session) => {
      this._loadUser(session).then(() => this.onUserChange?.());
    });
  }
  async _loadUser(session) {
    if (!session) { this._user = null; return; }
    const { data } = await this.sb.from('profiles').select('display_name,is_admin').eq('id', session.user.id).maybeSingle();
    this._user = {
      id: session.user.id,
      name: data?.display_name || session.user.user_metadata?.full_name || 'ผู้ใช้',
      isAdmin: !!data?.is_admin,
    };
  }
  get user() { return this._user; }
  async signIn() {
    await this.sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname } });
  }
  async signOut() { await this.sb.auth.signOut(); }

  async _rpc(name, args) {
    const { data, error } = await this.sb.rpc(name, args);
    if (error) throw new Error(error.message);
    return data;
  }
  _pos(pos) { return { p_user_lat: pos?.lat ?? null, p_user_lng: pos?.lng ?? null }; }

  async nearby(pos, limit = 50) {
    const rows = await this._rpc('nearby_locations', { p_lat: pos.lat, p_lng: pos.lng, p_limit: limit });
    return rows.map(row);
  }
  async get(id) {
    const r = await this._rpc('get_location', { p_id: id });
    return r ? row(r) : null;
  }

  async _upload(dataUrl) {
    const blob = await (await fetch(dataUrl)).blob();
    const path = `${this._user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
    const { error } = await this.sb.storage.from('photos').upload(path, blob, { contentType: 'image/jpeg' });
    if (error) throw new Error('อัปโหลดรูปไม่สำเร็จ: ' + error.message);
    return this.sb.storage.from('photos').getPublicUrl(path).data.publicUrl;
  }

  async addLocation(d, pos) {
    if (!d.photos?.length) throw new Error('กรุณาใส่รูปอย่างน้อย 1 รูป');
    // ตรวจข้อมูลก่อนอัปโหลดรูป จะได้ไม่เสียรูปเปล่า ๆ
    ['place', 'floor', 'prices', 'payments'].forEach(f => normalizeValue(f, d[f]));
    const photos = [];
    for (const p of d.photos) photos.push(await this._upload(p));
    return this._rpc('add_location', {
      p_lat: d.lat, p_lng: d.lng, ...this._pos(pos),
      p_place: d.place, p_floor: d.floor, p_zone: d.zone || '',
      p_prices: d.prices, p_payments: d.payments,
      p_machines: d.machines === '' || d.machines == null ? null : Number(d.machines),
      p_hours: d.hours || '', p_brand: d.brand || '', p_photos: photos,
    });
  }
  async confirm(id, pos) {
    return this._rpc('confirm_location', { p_id: id, ...this._pos(pos) });
  }
  async submitEdit(id, field, value, pos) {
    return this._rpc('submit_edit', { p_id: id, p_field: field, p_value: value, ...this._pos(pos) });
  }
  async addPhoto(id, dataUrl, pos) {
    // ตรวจระยะก่อนอัปโหลด
    await this._rpc('check_near', { p_id: id, ...this._pos(pos) });
    const url = await this._upload(dataUrl);
    await this._rpc('add_photo', { p_id: id, p_url: url, ...this._pos(pos) });
  }
  async adminUpdate(id, field, value) { await this._rpc('admin_update_location', { p_id: id, p_field: field, p_value: value }); }
  async adminVerify(id) { await this._rpc('admin_verify_location', { p_id: id }); }
  async adminDelete(id) { await this._rpc('admin_delete_location', { p_id: id }); }
}
