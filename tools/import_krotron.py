"""ดึงรายชื่อสาขาเก้าอี้นวด Krotron จากหน้าค้นหาสาขาบนเว็บไซต์ของ Krotron แล้วสร้างไฟล์ SQL สำหรับนำเข้า

ใช้: python tools/import_krotron.py  ->  เขียน supabase/import-krotron.sql
ไฟล์ SQL นำเข้าเฉพาะชื่อสถานที่ ชั้น จุดสังเกต และพิกัด (ไม่ดึงรูปของ Krotron)
รันซ้ำได้: จุดที่มีชื่อสถานที่และชั้นเดียวกันอยู่แล้วจะถูกข้าม
"""
import html, json, pathlib, re, urllib.request

BASE = 'https://krotronmassagechair.com/map/index.php?page={}&keyword=&myselect=&nearby=0&lat=&lng='
OUT = pathlib.Path(__file__).resolve().parent.parent / 'supabase' / 'import-krotron.sql'


def fetch(page):
    req = urllib.request.Request(BASE.format(page), headers={'User-Agent': 'Mozilla/5.0'})
    return urllib.request.urlopen(req, timeout=30).read().decode('utf-8', 'replace')


def clean(s):
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', '', s))).strip(' ,')


def branches():
    first = fetch(1)
    last = max(int(n) for n in re.findall(r'page=(\d+)&', first))
    for p in range(1, last + 1):
        doc = first if p == 1 else fetch(p)
        for card in doc.split('<div class="card w-100')[1:]:
            name = re.search(r'card-title[^>]*>(.*?)</h5>', card, re.S)
            loc = re.search(r'location-text">(.*?)</p>', card, re.S)
            ll = re.search(r'destination=([-\d.]+)%2C([-\d.]+)', card)
            if not (name and ll):
                continue
            lines = [clean(x) for x in re.split(r'<br\s*/?>', loc.group(1) if loc else '')]
            yield clean(name.group(1)), [x for x in lines if x], float(ll.group(1)), float(ll.group(2))


def split_floors(lines):
    """'ชั้น 2 ข้างร้าน A ชั้น 3 หน้าลิฟต์' -> [('2', 'ข้างร้าน A'), ('3', 'หน้าลิฟต์')]"""
    segs = []
    for line in lines:
        ms = list(re.finditer(r'ชั้น\s*([A-Za-z0-9ก-๙]+)', line))
        if not ms:
            m = re.match(r'(\d+|G|B\d?|LG)\s+(.*)', line)  # บางสาขาเขียนเลขชั้นโดยไม่มีคำว่า "ชั้น"
            segs.append((m.group(1), m.group(2)) if m else ('-', line))
            continue
        for i, m in enumerate(ms):
            end = ms[i + 1].start() if i + 1 < len(ms) else len(line)
            segs.append((m.group(1), line[m.end():end].strip(' ,')))
    merged = {}
    for floor, zone in segs or [('-', '')]:
        merged[floor] = ' / '.join(x for x in (merged.get(floor), zone) if x)
    return merged.items()


def q(s):
    return "'" + s.replace("'", "''") + "'"


def main():
    rows, seen = [], set()
    for place, lines, lat, lng in branches():
        for floor, zone in split_floors(lines):
            if (place, floor) in seen:
                continue
            seen.add((place, floor))
            rows.append(f'({q(place)}, {q(floor)}, {q(zone)}, {lat}, {lng})')
    sql = f"""-- นำเข้าจุดเก้าอี้นวด Krotron จากหน้าค้นหาสาขาของ Krotron ({len(rows)} จุด)
-- สร้างโดย tools/import_krotron.py  รันใน Supabase SQL Editor ได้ซ้ำโดยไม่เกิดข้อมูลซ้ำ
insert into locations (geom, place, floor, zone, prices, payments, brand, status, last_verified_at)
select ms_point(v.lat, v.lng), v.place, v.floor, v.zone, '[]'::jsonb, '{{}}'::text[], 'Krotron', 'verified', now()
from (values
  {(',' + chr(10) + '  ').join(rows)}
) as v(place, floor, zone, lat, lng)
where not exists (
  select 1 from locations l where l.place = v.place and l.floor = v.floor and l.brand = 'Krotron'
);
"""
    OUT.write_text(sql, encoding='utf-8', newline='\n')
    print(f'{len(rows)} rows -> {OUT}')


if __name__ == '__main__':
    main()
