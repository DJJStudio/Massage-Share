// Google AdSense สำหรับเว็บ
// ในแอป APK (Capacitor) ห้ามใช้ AdSense ตามนโยบายของ Google ต้องใช้ AdMob แทน (ดู README)
import { CONFIG } from './config.js';

const isNativeApp = () => !!window.Capacitor?.isNativePlatform?.();
let scriptAdded = false;

function ensureScript() {
  if (scriptAdded) return;
  scriptAdded = true;
  const s = document.createElement('script');
  s.async = true;
  s.crossOrigin = 'anonymous';
  s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(CONFIG.ADSENSE_CLIENT)}`;
  document.head.appendChild(s);
}

// ใส่โฆษณาต่อท้าย container; ถ้ายังไม่ได้ตั้งค่า จะแสดงกรอบตัวอย่างเฉพาะโหมดทดลอง
export function mountAd(container, slot, showPlaceholder) {
  if (isNativeApp()) return;
  const el = document.createElement('div');
  el.className = 'ad-slot';
  if (!CONFIG.ADSENSE_CLIENT || !slot) {
    if (!showPlaceholder) return;
    el.classList.add('placeholder');
    el.textContent = 'พื้นที่โฆษณา (Google AdSense)';
    container.appendChild(el);
    return;
  }
  ensureScript();
  const ins = document.createElement('ins');
  ins.className = 'adsbygoogle';
  ins.style.display = 'block';
  ins.dataset.adClient = CONFIG.ADSENSE_CLIENT;
  ins.dataset.adSlot = slot;
  ins.dataset.adFormat = 'auto';
  ins.dataset.fullWidthResponsive = 'true';
  el.appendChild(ins);
  container.appendChild(el);
  try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch { /* ตัวบล็อกโฆษณา */ }
}
