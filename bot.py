import time
import requests
import json
import logging
import re
from datetime import datetime
from app import IVASSMSClient

# --- KONFIGURASI ---
TELEGRAM_BOT_TOKEN = ''
TELEGRAM_CHAT_ID = ''
CHECK_INTERVAL = 30 

# Setup Logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    datefmt='%H:%M:%S'
)
logger = logging.getLogger("IVAS_BOT")

HISTORY_FILE = 'sent_history.json'

def send_telegram(message):
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    payload = {'chat_id': TELEGRAM_CHAT_ID, 'text': message, 'parse_mode': 'Markdown'}
    try:
        r = requests.post(url, json=payload, timeout=10)
        if r.status_code == 200:
            # logger.info("✅ Telegram API: OK") # Uncomment jika ingin log sukses juga
            pass
        else:
            logger.error(f"❌ Telegram Error {r.status_code}: {r.text}")
    except Exception as e:
        logger.error(f"❌ Gagal koneksi ke Telegram: {e}")

def load_history():
    try:
        with open(HISTORY_FILE, 'r') as f:
            return set(json.load(f))
    except (FileNotFoundError, json.JSONDecodeError):
        return set()

def save_history(history_set):
    with open(HISTORY_FILE, 'w') as f:
        json.dump(list(history_set), f)

    if len(phone) > 6:
        return phone[:3] + "*****" + phone[-3:]
    return phone

def extract_otp(text):
    # Pola: 4-8 digit, bisa dipisah strip. Prioritaskan yang ada dash dulu
    # Contoh match: 123-456, 123456, 1234
    match = re.search(r'\b(?:\d{3}-\d{3}|\d{4,8})\b', text)
    if match:
        return match.group(0)
    return None

def run_bot():
    client = IVASSMSClient()
    sent_messages = load_history()
    
    # Status Alert agar tidak spam notifikasi error
    is_alert_sent = False 
    
    logger.info("🤖 Bot IVASms LIVE MODE (Auto-Reconnect) Aktif!")

    while True:
        try:
            # 1. Cek Login / Re-Login Otomatis
            if not client.logged_in:
                # Coba login
                if client.login_with_cookies():
                    logger.info("✅ Login Berhasil!")
                    if is_alert_sent:
                        send_telegram("✅ **SISTEM PULIH!**\nCookie baru diterima. Bot lanjut kerja.")
                        is_alert_sent = False
                else:
                    # Jika Gagal Login
                    logger.warning("⚠️ Gagal Login. Cookie mungkin expired.")
                    if not is_alert_sent:
                        send_telegram(
                            "🚨 **PERINGATAN: SESI MATI!** 🚨\n\n"
                            "Bot tidak bisa login. Cookie expired atau User-Agent salah.\n"
                            "👉 **Tindakan:** Segera update file `cookies.json` dengan yang baru.\n"
                            "Bot akan otomatis mencoba lagi setiap 30 detik."
                        )
                        is_alert_sent = True
                    
                    # Tunggu 30 detik sebelum coba baca file cookie lagi
                    time.sleep(30)
                    continue

            # === LOGIKA UTAMA (Hanya jalan jika login sukses) ===
            
            # === LOGIKA BARU (LIVE SMS) ===
            msgs = client.get_live_messages()
            
            # Jika msgs None/list kosong, tetap lanjut loop
            # Tapi jika None, mungkin ada error di Node bridge
            
            if msgs:
                logger.info(f"🔎 Ditemukan {len(msgs)} pesan di Live SMS.")
                
                for item in msgs:
                    range_name = item.get('range', 'Unknown')
                    phone_number = item.get('number', 'Unknown')
                    message_content = item.get('message', '')
                    
                    if not message_content: continue

                    # Unique ID untuk mencegah duplikat
                    unique_id = f"{phone_number}_{message_content}"
                    
                    if unique_id not in sent_messages:
                        masked_phone = sensor_number(phone_number)
                        otp_code = extract_otp(message_content)
                        
                        otp_line = ""
                        if otp_code:
                            otp_line = f"\n🔢 **OTP:** `{otp_code}` (Tap to Copy)"

                        text = (
                            f"📩 **SMS BARU MASUK!**\n"
                            f"➖➖➖➖➖➖➖➖➖\n"
                            f"📱 **Nomor:** `{masked_phone}`\n"
                            f"🌍 **Area:** {range_name}\n"
                            f"💬 **Pesan:**\n`{message_content}`"
                            f"{otp_line}"
                        )
                        send_telegram(text)
                        logger.info(f"🚀 TERKIRIM KE TELEGRAM: {masked_phone}")
                        print(f"📨 Mengirim pesan dari {masked_phone}...")
                        sent_messages.add(unique_id)
                        save_history(sent_messages)
                        time.sleep(0.1) # Delay dikit biar gak spam server telegram jika banyak sekaligus
            else:
                print("... Tidak ada pesan baru di Live SMS ...")

            # Tunggu interval normal
            time.sleep(CHECK_INTERVAL)

        except KeyboardInterrupt:
            logger.info("Bot dimatikan manual.")
            break
        except Exception as e:
            logger.error(f"Error Loop: {e}")
            client.logged_in = False # Asumsikan error karena koneksi/sesi, coba relogin
            time.sleep(CHECK_INTERVAL)

if __name__ == '__main__':
    run_bot()
