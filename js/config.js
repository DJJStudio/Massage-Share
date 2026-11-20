// ตั้งค่าแอป
// - ปล่อย SUPABASE_URL ว่างไว้ = โหมดทดลอง (เก็บข้อมูลในเบราว์เซอร์ มีผู้ใช้จำลองให้สลับ)
// - ใส่ค่าจาก Supabase (Project Settings > API) = โหมดจริง
export const CONFIG = {
  SUPABASE_URL: '',
  SUPABASE_ANON_KEY: '',

  // Google AdSense (เว็บ) — ได้หลังสมัครและเว็บผ่านการอนุมัติ
  // ADSENSE_CLIENT เช่น 'ca-pub-1234567890123456', ADSENSE_SLOT เช่น '1234567890'
  // ถ้าว่างไว้ จะแสดงกรอบ "พื้นที่โฆษณา" แทน (เฉพาะโหมดทดลอง)
  ADSENSE_CLIENT: '',
  ADSENSE_SLOT_LIST: '',   // โฆษณาแทรกในรายการจุดใกล้คุณ
  ADSENSE_SLOT_DETAIL: '', // โฆษณาท้ายหน้ารายละเอียด
  AD_EVERY_N_ITEMS: 5,     // แทรกโฆษณาทุกกี่รายการ

  DEFAULT_CENTER: { lat: 13.7462, lng: 100.5347 }, // สยาม — ใช้เมื่อไม่ได้รับอนุญาตใช้ GPS
  NEARBY_LIMIT: 50,
};
