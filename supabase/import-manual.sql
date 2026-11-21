-- จุดเก้าอี้นวดที่เพิ่มเองจากบทความของห้าง (พิกัดเป็นตำแหน่งห้างโดยประมาณ ให้ผู้ใช้ช่วยแก้ให้ตรงจุด)
-- ที่มา: futurepark.co.th บทความ "พิกัดเก้าอี้นวดที่ฟิวเจอร์พาร์ค" (11 มิ.ย. 2026)
-- รันซ้ำได้โดยไม่เกิดข้อมูลซ้ำ
insert into locations (geom, place, floor, zone, prices, payments, brand, status, last_verified_at)
select ms_point(v.lat, v.lng), v.place, v.floor, v.zone, '[]'::jsonb, '{}'::text[], v.brand, 'verified', now()
from (values
  ('ฟิวเจอร์พาร์ค รังสิต', '3', 'ฝั่งอีสต์ · เก้าอี้สีน้ำตาลเข้ม ป้าย Little Rest / มีเครื่องนวดเท้าด้วย', 13.98930, 100.61870, 'Little Rest'),
  ('ฟิวเจอร์พาร์ค รังสิต', '2', 'ฝั่งเวสต์ · เก้าอี้สีขาว-เทา พื้นที่กว้าง', 13.98930, 100.61650, '')
) as v(place, floor, zone, lat, lng, brand)
where not exists (
  select 1 from locations l where l.place = v.place and l.floor = v.floor
);
