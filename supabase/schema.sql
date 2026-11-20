-- Massage Share — ฐานข้อมูลบน Supabase
-- วิธีใช้: Supabase Dashboard > SQL Editor > วางทั้งไฟล์ > Run
-- กติกาตรงกับ js/rules.js: จุดใหม่ 3 คน, แก้ข้อมูล 3 คน, สถานะเครื่อง 2 คน, ระยะ 200 ม., ข้อเสนอหมดอายุ 30 วัน
--
-- หลักการ: ทุกการเขียนข้อมูลต้องผ่านฟังก์ชัน (RPC) ด้านล่างเท่านั้น
-- ตาราง locations / proposals / votes ไม่เปิดให้ client เขียนหรืออ่านตรง ๆ

create extension if not exists postgis;

-- ---------- ตาราง ----------
create table if not exists profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists locations (
  id uuid primary key default gen_random_uuid(),
  geom geography(point, 4326) not null,
  place text not null,
  floor text not null,
  zone text not null default '',
  prices jsonb not null,
  payments text[] not null,
  machines int,
  hours text not null default '',
  brand text not null default '',
  photos text[] not null default '{}',
  status text not null default 'pending' check (status in ('pending', 'verified')),
  condition text not null default 'working' check (condition in ('working', 'broken', 'removed')),
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  last_verified_at timestamptz not null default now()
);
create index if not exists locations_geom_idx on locations using gist (geom);

create table if not exists location_confirmations (
  location_id uuid not null references locations on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  primary key (location_id, user_id)
);

create table if not exists proposals (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references locations on delete cascade,
  field text not null,
  value jsonb,
  value_key text not null,
  status text not null default 'open' check (status in ('open', 'applied', 'rejected', 'expired')),
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists proposals_open_idx on proposals (location_id, field) where status = 'open';

create table if not exists proposal_votes (
  proposal_id uuid not null references proposals on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  primary key (proposal_id, user_id)
);

alter table profiles enable row level security;
alter table locations enable row level security;
alter table location_confirmations enable row level security;
alter table proposals enable row level security;
alter table proposal_votes enable row level security;

drop policy if exists "read own profile" on profiles;
create policy "read own profile" on profiles for select to authenticated using (id = auth.uid());

-- สร้างโปรไฟล์อัตโนมัติเมื่อสมัคร
create or replace function ms_handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', 'ผู้ใช้'))
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function ms_handle_new_user();

-- ---------- รูปภาพ (Storage) ----------
insert into storage.buckets (id, name, public) values ('photos', 'photos', true) on conflict (id) do nothing;
drop policy if exists "upload own photos" on storage.objects;
create policy "upload own photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- ค่าคงที่และตัวช่วย ----------
create or replace function ms_need(p_field text) returns int language sql immutable as $$
  select case when p_field = 'condition' then 2 else 3 end
$$;

create or replace function ms_require_user() returns uuid language plpgsql stable as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'กรุณาเข้าสู่ระบบก่อน'; end if;
  return u;
end $$;

create or replace function ms_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from profiles where id = auth.uid()), false)
$$;

create or replace function ms_point(p_lat float8, p_lng float8) returns geography language sql immutable as $$
  select st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography
$$;

create or replace function ms_require_near(p_geom geography, p_lat float8, p_lng float8) returns void
language plpgsql stable security definer set search_path = public as $$
declare d float8;
begin
  if ms_is_admin() then return; end if;
  if p_lat is null or p_lng is null then raise exception 'ต้องเปิดตำแหน่ง (GPS) ก่อน'; end if;
  d := st_distance(p_geom, ms_point(p_lat, p_lng));
  if d > 200 then raise exception 'คุณอยู่ห่างจุดนี้ % ม. ต้องอยู่ในระยะ 200 ม.', round(d); end if;
end $$;

-- ทำค่าให้อยู่ในรูปมาตรฐาน (ต้องให้ผลเหมือน normalizeValue ใน js/rules.js)
create or replace function ms_normalize(p_field text, p_value jsonb) returns jsonb
language plpgsql immutable as $$
declare v jsonb; s text;
begin
  case p_field
    when 'place', 'floor', 'zone', 'hours', 'brand' then
      s := regexp_replace(btrim(coalesce(p_value #>> '{}', '')), '\s+', ' ', 'g');
      if p_field in ('place', 'floor') and s = '' then raise exception 'กรุณากรอกชื่อสถานที่และชั้น'; end if;
      if length(s) > 200 then raise exception 'ข้อความยาวเกินไป'; end if;
      v := to_jsonb(s);
    when 'machines' then
      if p_value is null or jsonb_typeof(p_value) = 'null' or p_value #>> '{}' = '' then
        v := 'null'::jsonb;
      else
        v := to_jsonb(round((p_value #>> '{}')::numeric)::int);
        if (v)::int < 0 or (v)::int > 500 then raise exception 'จำนวนเครื่องไม่ถูกต้อง'; end if;
      end if;
    when 'prices' then
      select coalesce(jsonb_agg(jsonb_build_object('baht', b, 'minutes', m) order by m, b), '[]'::jsonb) into v
      from (select (e->>'baht')::numeric as b, round((e->>'minutes')::numeric)::int as m
            from jsonb_array_elements(p_value) e) x
      where b > 0 and m > 0;
      if jsonb_array_length(v) = 0 then raise exception 'กรุณาใส่ราคาอย่างน้อย 1 แบบ'; end if;
      if jsonb_array_length(v) > 10 then raise exception 'ราคามากเกินไป'; end if;
    when 'payments' then
      select coalesce(jsonb_agg(distinct x order by x), '[]'::jsonb) into v
      from jsonb_array_elements_text(p_value) x
      where x in ('coin', 'bill', 'promptpay', 'truemoney');
      if jsonb_array_length(v) = 0 then raise exception 'กรุณาเลือกช่องทางจ่ายอย่างน้อย 1 แบบ'; end if;
    when 'condition' then
      if coalesce(p_value #>> '{}', '') not in ('working', 'broken', 'removed') then raise exception 'สถานะไม่ถูกต้อง'; end if;
      v := to_jsonb(p_value #>> '{}');
    else
      raise exception 'ฟิลด์ไม่ถูกต้อง';
  end case;
  return v;
end $$;

create or replace function ms_key(p_field text, p_value jsonb) returns text language sql immutable as $$
  select case when p_field in ('place', 'floor', 'zone', 'hours', 'brand') then lower(p_value #>> '{}') else p_value::text end
$$;

create or replace function ms_current(l locations, p_field text) returns jsonb language sql stable as $$
  select case p_field
    when 'place' then to_jsonb(l.place) when 'floor' then to_jsonb(l.floor) when 'zone' then to_jsonb(l.zone)
    when 'hours' then to_jsonb(l.hours) when 'brand' then to_jsonb(l.brand)
    when 'machines' then to_jsonb(l.machines) when 'prices' then l.prices
    when 'payments' then to_jsonb(l.payments) when 'condition' then to_jsonb(l.condition) end
$$;

create or replace function ms_apply(p_id uuid, p_field text, v jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  update locations set
    place     = case when p_field = 'place' then v #>> '{}' else place end,
    floor     = case when p_field = 'floor' then v #>> '{}' else floor end,
    zone      = case when p_field = 'zone' then v #>> '{}' else zone end,
    hours     = case when p_field = 'hours' then v #>> '{}' else hours end,
    brand     = case when p_field = 'brand' then v #>> '{}' else brand end,
    machines  = case when p_field = 'machines' then (v #>> '{}')::int else machines end,
    prices    = case when p_field = 'prices' then v else prices end,
    payments  = case when p_field = 'payments' then array(select jsonb_array_elements_text(v)) else payments end,
    condition = case when p_field = 'condition' then v #>> '{}' else condition end,
    last_verified_at = now()
  where id = p_id;
end $$;

create or replace function ms_expire() returns void
language sql security definer set search_path = public as $$
  update proposals set status = 'expired' where status = 'open' and created_at < now() - interval '30 days'
$$;

-- ---------- อ่านข้อมูล ----------
create or replace function nearby_locations(p_lat float8, p_lng float8, p_limit int default 50)
returns table (
  id uuid, lat float8, lng float8, place text, floor text, zone text, prices jsonb, payments text[],
  machines int, hours text, brand text, photos text[], status text, condition text,
  confirm_count int, created_at timestamptz, last_verified_at timestamptz, distance_m float8
)
language sql stable security definer set search_path = public as $$
  select l.id, st_y(l.geom::geometry), st_x(l.geom::geometry), l.place, l.floor, l.zone, l.prices, l.payments,
         l.machines, l.hours, l.brand, l.photos, l.status, l.condition,
         (select count(*)::int from location_confirmations c where c.location_id = l.id),
         l.created_at, l.last_verified_at, st_distance(l.geom, ms_point(p_lat, p_lng))
  from locations l
  order by l.geom <-> ms_point(p_lat, p_lng)
  limit least(greatest(p_limit, 1), 200)
$$;

create or replace function get_location(p_id uuid) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'id', l.id, 'lat', st_y(l.geom::geometry), 'lng', st_x(l.geom::geometry),
    'place', l.place, 'floor', l.floor, 'zone', l.zone, 'prices', l.prices, 'payments', l.payments,
    'machines', l.machines, 'hours', l.hours, 'brand', l.brand, 'photos', l.photos,
    'status', l.status, 'condition', l.condition, 'created_at', l.created_at, 'last_verified_at', l.last_verified_at,
    'confirm_count', (select count(*) from location_confirmations c where c.location_id = l.id),
    'my_confirmed', exists (select 1 from location_confirmations c where c.location_id = l.id and c.user_id = auth.uid()),
    'proposals', coalesce((
      select json_agg(json_build_object(
        'id', p.id, 'field', p.field, 'value', p.value, 'created_at', p.created_at,
        'votes', (select count(*) from proposal_votes v where v.proposal_id = p.id),
        'mine', exists (select 1 from proposal_votes v where v.proposal_id = p.id and v.user_id = auth.uid())
      ) order by p.created_at)
      from proposals p
      where p.location_id = l.id and p.status = 'open' and p.created_at >= now() - interval '30 days'
    ), '[]'::json)
  )
  from locations l where l.id = p_id
$$;

-- ---------- เขียนข้อมูล ----------
create or replace function add_location(
  p_lat float8, p_lng float8, p_user_lat float8, p_user_lng float8,
  p_place text, p_floor text, p_zone text, p_prices jsonb, p_payments jsonb,
  p_machines int, p_hours text, p_brand text, p_photos text[]
) returns uuid
language plpgsql security definer set search_path = public as $$
declare u uuid := ms_require_user(); g geography := ms_point(p_lat, p_lng); new_id uuid;
begin
  perform ms_require_near(g, p_user_lat, p_user_lng);
  if coalesce(array_length(p_photos, 1), 0) = 0 then raise exception 'กรุณาใส่รูปอย่างน้อย 1 รูป'; end if;
  if array_length(p_photos, 1) > 10 then raise exception 'รูปมากเกินไป (สูงสุด 10 รูป)'; end if;
  if exists (select 1 from unnest(p_photos) x where x not like 'https://%') then raise exception 'ลิงก์รูปไม่ถูกต้อง'; end if;
  -- กันสแปม: วันละไม่เกิน 20 จุดต่อคน
  if (select count(*) from locations where created_by = u and created_at > now() - interval '1 day') >= 20 then
    raise exception 'วันนี้คุณเพิ่มจุดครบโควตาแล้ว';
  end if;

  insert into locations (geom, place, floor, zone, prices, payments, machines, hours, brand, photos, created_by)
  values (
    g,
    ms_normalize('place', to_jsonb(p_place)) #>> '{}',
    ms_normalize('floor', to_jsonb(p_floor)) #>> '{}',
    ms_normalize('zone', to_jsonb(p_zone)) #>> '{}',
    ms_normalize('prices', p_prices),
    array(select jsonb_array_elements_text(ms_normalize('payments', p_payments))),
    (ms_normalize('machines', to_jsonb(p_machines)) #>> '{}')::int,
    ms_normalize('hours', to_jsonb(p_hours)) #>> '{}',
    ms_normalize('brand', to_jsonb(p_brand)) #>> '{}',
    p_photos, u
  ) returning id into new_id;

  insert into location_confirmations (location_id, user_id) values (new_id, u);
  return new_id;
end $$;

create or replace function check_near(p_id uuid, p_user_lat float8, p_user_lng float8) returns void
language plpgsql stable security definer set search_path = public as $$
declare g geography;
begin
  perform ms_require_user();
  select geom into g from locations where id = p_id;
  if g is null then raise exception 'ไม่พบจุดนี้'; end if;
  perform ms_require_near(g, p_user_lat, p_user_lng);
end $$;

create or replace function confirm_location(p_id uuid, p_user_lat float8, p_user_lng float8) returns json
language plpgsql security definer set search_path = public as $$
declare u uuid := ms_require_user(); l locations; n int;
begin
  select * into l from locations where id = p_id for update;
  if not found then raise exception 'ไม่พบจุดนี้'; end if;
  perform ms_require_near(l.geom, p_user_lat, p_user_lng);
  if l.status = 'pending' and exists (select 1 from location_confirmations where location_id = p_id and user_id = u) then
    raise exception 'คุณยืนยันจุดนี้ไปแล้ว รอคนอื่นช่วยยืนยัน';
  end if;
  insert into location_confirmations (location_id, user_id) values (p_id, u) on conflict do nothing;
  select count(*) into n from location_confirmations where location_id = p_id;
  update locations set
    status = case when status = 'pending' and n >= 3 then 'verified' else status end,
    last_verified_at = now()
  where id = p_id returning status into l.status;
  return json_build_object('status', l.status, 'count', n);
end $$;

create or replace function submit_edit(p_id uuid, p_field text, p_value jsonb, p_user_lat float8, p_user_lng float8) returns json
language plpgsql security definer set search_path = public as $$
declare
  u uuid := ms_require_user(); l locations; v jsonb; k text; pid uuid; n int; need int := ms_need(p_field);
begin
  select * into l from locations where id = p_id for update; -- ล็อกกันโหวตชนกัน
  if not found then raise exception 'ไม่พบจุดนี้'; end if;
  perform ms_require_near(l.geom, p_user_lat, p_user_lng);
  perform ms_expire();

  v := ms_normalize(p_field, p_value);
  k := ms_key(p_field, v);
  if k = ms_key(p_field, ms_current(l, p_field)) then raise exception 'ค่านี้ตรงกับข้อมูลปัจจุบันอยู่แล้ว'; end if;

  -- หนึ่งคนหนึ่งเสียงต่อเรื่อง: ถอนเสียงเดิมของคนนี้ออกจากข้อเสนออื่นในเรื่องเดียวกัน
  delete from proposal_votes pv using proposals p
  where pv.proposal_id = p.id and pv.user_id = u and p.location_id = p_id and p.field = p_field and p.status = 'open';

  select id into pid from proposals where location_id = p_id and field = p_field and status = 'open' and value_key = k;
  if pid is null then
    insert into proposals (location_id, field, value, value_key, created_by) values (p_id, p_field, v, k, u) returning id into pid;
  end if;
  insert into proposal_votes (proposal_id, user_id) values (pid, u) on conflict do nothing;

  -- ลบข้อเสนอที่ไม่มีเสียงเหลือแล้ว
  delete from proposals p where p.location_id = p_id and p.status = 'open'
    and not exists (select 1 from proposal_votes pv where pv.proposal_id = p.id);

  select count(*) into n from proposal_votes where proposal_id = pid;
  if n >= need then
    perform ms_apply(p_id, p_field, (select value from proposals where id = pid));
    update proposals set status = case when id = pid then 'applied' else 'rejected' end
      where location_id = p_id and field = p_field and status = 'open';
    return json_build_object('applied', true, 'votes', n, 'need', need);
  end if;
  return json_build_object('applied', false, 'votes', n, 'need', need);
end $$;

create or replace function add_photo(p_id uuid, p_url text, p_user_lat float8, p_user_lng float8) returns void
language plpgsql security definer set search_path = public as $$
declare g geography;
begin
  perform ms_require_user();
  select geom into g from locations where id = p_id for update;
  if g is null then raise exception 'ไม่พบจุดนี้'; end if;
  perform ms_require_near(g, p_user_lat, p_user_lng);
  if p_url not like 'https://%' then raise exception 'ลิงก์รูปไม่ถูกต้อง'; end if;
  update locations set photos = photos || p_url where id = p_id and coalesce(array_length(photos, 1), 0) < 20;
end $$;

-- ---------- แอดมิน ----------
create or replace function ms_require_admin() returns void language plpgsql stable as $$
begin
  if not ms_is_admin() then raise exception 'เฉพาะแอดมินเท่านั้น'; end if;
end $$;

create or replace function admin_update_location(p_id uuid, p_field text, p_value jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform ms_require_admin();
  perform ms_apply(p_id, p_field, ms_normalize(p_field, p_value));
  update proposals set status = 'rejected' where location_id = p_id and field = p_field and status = 'open';
end $$;

create or replace function admin_verify_location(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform ms_require_admin();
  update locations set status = 'verified', last_verified_at = now() where id = p_id;
end $$;

create or replace function admin_delete_location(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform ms_require_admin();
  delete from locations where id = p_id;
end $$;

-- ฟังก์ชันภายใน ไม่ให้เรียกจากภายนอกโดยตรง
revoke execute on function ms_apply(uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function ms_expire() from public, anon, authenticated;

-- ตั้งแอดมิน (รันเองหลังล็อกอินครั้งแรก เปลี่ยนอีเมลเป็นของคุณ):
-- update profiles set is_admin = true where id = (select id from auth.users where email = 'อีเมลของคุณ');
