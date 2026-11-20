# Massage Share

แผนที่เก้าอี้นวดหยอดเหรียญใกล้คุณ ข้อมูลมาจากผู้ใช้ที่ช่วยกันแชร์และยืนยัน

## กติกาการยืนยัน

| เรื่อง | เงื่อนไข |
|---|---|
| จุดใหม่ | ขึ้นแผนที่ทันทีพร้อมป้าย "รอยืนยัน" และเปลี่ยนเป็น "ยืนยันแล้ว" เมื่อครบ **3 คน** (นับคนเพิ่มด้วย) |
| แก้ข้อมูล (ราคา ชั้น ฯลฯ) | ต้องมี **3 คน**ส่งค่าที่**ตรงกัน** |
| สถานะเครื่อง (เสีย / ถูกย้ายออก / ใช้ได้) | ต้องมี **2 คน**แจ้งตรงกัน |
| ระยะ | ต้องอยู่ห่างจุดนั้นไม่เกิน **200 ม.** ทั้งตอนเพิ่ม ยืนยัน และแก้ไข |
| หนึ่งคนหนึ่งเสียง | ถ้าส่งค่าใหม่ในเรื่องเดิม เสียงจะย้ายไปที่ค่าใหม่ |
| ข้อเสนอหมดอายุ | **30 วัน** ถ้ายังไม่ครบจำนวน |
| ข้อมูลอาจเก่า | ไม่มีใครยืนยันเกิน **90 วัน** |
| แอดมิน | แก้ไข อนุมัติ หรือลบได้ทันที และไม่ติดเงื่อนไขระยะ |

ตัวเลขทั้งหมดตั้งค่าได้ที่ `js/rules.js` และ `supabase/schema.sql` (ต้องแก้ให้ตรงกันทั้งสองไฟล์)

## โครงสร้างไฟล์

```
index.html              หน้าแอป
css/style.css           หน้าตา (รองรับโหมดมืด)
js/config.js            ตั้งค่า Supabase และ AdSense  ← ไฟล์ที่ต้องแก้
js/rules.js             กติกาการยืนยัน
js/app.js               หน้าจอและการทำงาน
js/store-demo.js        โหมดทดลอง (เก็บในเบราว์เซอร์)
js/store-supabase.js    โหมดจริง (เชื่อม Supabase)
js/ads.js               โฆษณา Google AdSense
supabase/schema.sql     ฐานข้อมูลและกติกาฝั่งเซิร์ฟเวอร์
manifest.webmanifest, sw.js, icon.svg   ทำให้ติดตั้งเป็นแอปบนมือถือได้ (PWA)
```

## 1. ลองเล่นในเครื่อง (โหมดทดลอง)

```powershell
python -m http.server 8080
```

แล้วเปิด http://localhost:8080

โหมดทดลองมีผู้ใช้จำลอง A / B / C / แอดมิน ให้สลับ เพื่อลองระบบยืนยันหลายคนได้ ใช้ปุ่ม "📍 ย้ายตำแหน่งฉันไปกลางแผนที่" เพื่อจำลองว่าเดินไปถึงจุดนั้นแล้ว

## 2. ขึ้นเว็บด้วย GitHub Pages (ฟรี)

1. สร้าง repository ใหม่บน GitHub เช่น `massage-share`
2. อัปโหลดไฟล์ทั้งหมดในโฟลเดอร์นี้ขึ้นไป
3. ไปที่ **Settings → Pages** ตั้ง Source เป็น `Deploy from a branch` เลือก Branch `main` และโฟลเดอร์ `/ (root)`
4. รอสักครู่ เว็บจะอยู่ที่ `https://<ชื่อผู้ใช้>.github.io/massage-share/`

## 3. เปิดใช้ข้อมูลจริงด้วย Supabase (ฟรีช่วงเริ่มต้น)

1. สมัครที่ https://supabase.com แล้วสร้างโปรเจกต์ใหม่ (เลือกภูมิภาค Singapore จะเร็วสุดสำหรับไทย)
2. ไปที่ **SQL Editor** วางเนื้อหาไฟล์ `supabase/schema.sql` ทั้งหมด แล้วกด **Run**
3. ไปที่ **Authentication → Providers → Google** แล้วเปิดใช้
   - ต้องสร้าง OAuth Client ที่ Google Cloud Console และนำ Client ID กับ Secret มาใส่
   - ทำตามคู่มือ: https://supabase.com/docs/guides/auth/social-login/auth-google
4. ไปที่ **Authentication → URL Configuration** ใส่ URL ของเว็บ (จากขั้นที่ 2) ใน Site URL และ Redirect URLs
5. ไปที่ **Project Settings → API** คัดลอก `Project URL` และ `anon public key` มาใส่ใน `js/config.js`
6. ล็อกอินเข้าเว็บครั้งแรก แล้วตั้งตัวเองเป็นแอดมินใน SQL Editor:
   ```sql
   update profiles set is_admin = true where id = (select id from auth.users where email = 'อีเมลของคุณ');
   ```

> anon key เปิดเผยในเว็บได้ตามปกติ เพราะกติกาทั้งหมดตรวจที่ฝั่งเซิร์ฟเวอร์ แต่**ห้าม**ใส่ `service_role` key ในไฟล์ใดเด็ดขาด

## 4. ทำเป็นแอป APK (Android)

ใช้ Capacitor ห่อเว็บนี้เป็นแอป โดยต้องติดตั้ง [Node.js](https://nodejs.org) และ [Android Studio](https://developer.android.com/studio) ก่อน

```powershell
npm init -y
npm install @capacitor/core @capacitor/cli @capacitor/android @capacitor/geolocation
npx cap init "Massage Share" com.massageshare.app --web-dir www
```

คัดลอกไฟล์เว็บทั้งหมด (`index.html`, `css`, `js`, `icon.svg`, `manifest.webmanifest`) ไปไว้ในโฟลเดอร์ `www` แล้วรัน:

```powershell
npx cap add android
npx cap sync
npx cap open android
```

ใน Android Studio เลือก **Build → Build App Bundle(s) / APK(s) → Build APK(s)** แล้วต้องเพิ่ม `com.massageshare.app://` ใน Redirect URLs ของ Supabase ด้วย เพื่อให้ล็อกอิน Google ในแอปได้

## 5. หารายได้จากโฆษณา

### เว็บ: Google AdSense

ตำแหน่งโฆษณาที่เตรียมไว้มีสองจุด คือแทรกในรายการทุก 5 จุด และท้ายหน้ารายละเอียด

1. **ต้องมีโดเมนของตัวเอง** เช่น `massageshare.com` เพราะ AdSense ไม่รับเว็บบนโดเมน `github.io` ของคนอื่น ซื้อโดเมนแล้วผูกกับ GitHub Pages ได้ที่ Settings → Pages → Custom domain
2. **ต้องมีหน้านโยบายความเป็นส่วนตัว (Privacy Policy)** ที่บอกว่าใช้คุกกี้โฆษณาของ Google
3. สมัครที่ https://adsense.google.com แล้วรอการอนุมัติ ซึ่งมักใช้เวลาหลายวันถึงหลายสัปดาห์ และเว็บควรมีเนื้อหาจริงพอสมควรก่อน
4. สร้าง Ad unit แบบ Display แล้วนำรหัสมาใส่ใน `js/config.js`:
   - `ADSENSE_CLIENT` เช่น `ca-pub-1234567890123456`
   - `ADSENSE_SLOT_LIST` และ `ADSENSE_SLOT_DETAIL`
5. สร้างไฟล์ `ads.txt` ไว้ที่รากของเว็บตามที่ AdSense กำหนด

### แอป APK: Google AdMob

นโยบายของ Google **ห้ามใช้ AdSense ในแอปมือถือ** ในแอป `js/ads.js` จึงปิดโฆษณา AdSense เองอัตโนมัติ ส่วนการแสดงโฆษณาในแอปให้ใช้ AdMob:

1. สมัครที่ https://admob.google.com แล้วสร้างแอปและ Banner ad unit
2. ติดตั้งปลั๊กอิน `npm install @capacitor-community/admob` แล้วเรียกแสดงแบนเนอร์ตามคู่มือของปลั๊กอิน
3. ถ้าจะขึ้น Google Play ต้องมีหน้านโยบายความเป็นส่วนตัว และกรอกข้อมูลเรื่องการเก็บข้อมูล (Data safety) ให้ตรงด้วย

> ข้อควรระวัง: ห้ามกดโฆษณาของตัวเองหรือชวนคนอื่นกด เพราะบัญชีอาจถูกระงับถาวร
