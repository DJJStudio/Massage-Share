-- ทดสอบกติกาบนเซิร์ฟเวอร์จริง: รันใน SQL Editor
-- ทุกอย่างอยู่ใน DO block ที่จบด้วย raise exception จึงถูกยกเลิก (rollback) ทั้งหมด ไม่เหลือข้อมูลทดสอบ
-- ผลลัพธ์จะแสดงในข้อความ error ที่ขึ้นต้นด้วย "TEST RESULTS"
do $$
declare
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); c uuid := gen_random_uuid(); adm uuid := gen_random_uuid();
  loc uuid; r json; out text := '';
  near_lat float8 := 13.74485; near_lng float8 := 100.52995;  -- ห่างจุด ~10 ม.
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (a, 'a@test.invalid', '{"full_name":"A"}'), (b, 'b@test.invalid', '{}'),
    (c, 'c@test.invalid', '{}'), (adm, 'adm@test.invalid', '{}');
  update profiles set is_admin = true where id = adm;
  out := out || format('profiles=%s; ', (select count(*) from profiles where id in (a, b, c, adm)));

  -- A เพิ่มจุด
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  begin
    perform add_location(13.7448, 100.5299, near_lat, near_lng, 'MBK', '4', '', '[{"baht":10,"minutes":5}]', '["coin"]', null, '', '', array['https://x.test/a.jpg']);
    out := out || 'add OK; ';
  exception when others then out := out || 'ERR ' || sqlerrm || '; ';
  end;
  begin
    perform add_location(13.7448, 100.5299, near_lat, near_lng, 'MBK', '4', '', '[{"baht":10,"minutes":5}]', '["coin"]', null, '', '', '{}');
    out := out || 'FAIL no-photo allowed; ';
  exception when others then out := out || 'no-photo blocked OK; ';
  end;
  select id into loc from locations where created_by = a;
  out := out || format('status=%s; ', (select status from locations where id = loc));

  -- B ยืนยันจากที่ไกล (ต้องถูกปฏิเสธ)
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  begin
    perform confirm_location(loc, 13.75, 100.54);
    out := out || 'FAIL far allowed; ';
  exception when others then out := out || 'far blocked OK (' || sqlerrm || '); ';
  end;
  r := confirm_location(loc, near_lat, near_lng);
  out := out || 'B confirm ' || r::text || '; ';

  -- C ยืนยัน -> ครบ 3
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  r := confirm_location(loc, near_lat, near_lng);
  out := out || 'C confirm ' || r::text || '; ';

  -- แก้ราคา 3 คน (B ใส่ 20.0 ต้องนับเป็นค่าเดียวกับ 20)
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  out := out || 'editA ' || submit_edit(loc, 'prices', '[{"baht":20,"minutes":10}]', near_lat, near_lng)::text || '; ';
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  out := out || 'editB ' || submit_edit(loc, 'prices', '[{"baht":"20.0","minutes":10}]', near_lat, near_lng)::text || '; ';
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  out := out || 'editC ' || submit_edit(loc, 'prices', '[{"baht":20,"minutes":10}]', near_lat, near_lng)::text || '; ';
  out := out || 'prices now ' || (select prices::text from locations where id = loc) || '; ';

  -- แจ้งเสีย 2 คน
  out := out || 'brokenC ' || submit_edit(loc, 'condition', '"broken"', near_lat, near_lng)::text || '; ';
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  out := out || 'brokenA ' || submit_edit(loc, 'condition', '"broken"', near_lat, near_lng)::text || '; ';
  out := out || 'condition now ' || (select condition from locations where id = loc) || '; ';

  -- อ่านข้อมูล
  out := out || format('nearby rows=%s; ', (select count(*) from nearby_locations(13.7462, 100.5347, 50)));
  r := get_location(loc);
  out := out || format('get: confirm_count=%s my_confirmed=%s; ', r->>'confirm_count', r->>'my_confirmed');

  -- คนทั่วไปลบไม่ได้ / แอดมินแก้ได้จากที่ไกล
  begin
    perform admin_delete_location(loc);
    out := out || 'FAIL non-admin delete; ';
  exception when others then out := out || 'non-admin delete blocked OK; ';
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  perform admin_update_location(loc, 'floor', '"5"');
  out := out || 'admin floor=' || (select floor from locations where id = loc) || '; ';

  raise exception 'TEST RESULTS: %', out;
end $$;
