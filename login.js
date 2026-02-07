const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const axios = require('axios'); // Kita butuh axios untuk fetch devtools URL

puppeteer.use(StealthPlugin());

// --- KONFIGURASI ---
const EMAIL = ""; 
const PASSWORD = "";
const OUTPUT_FILE = path.resolve(__dirname, 'cookies.json');
const USER_DATA_DIR = path.resolve(process.env.HOME, '.config/chrome-bot-login');
const DEBUG_PORT = 9222;

async function run() {
    console.log("🚀 Memulai Login Otomatis (Metode EXACT IVAS - Chrome Launcher)...");
    
    // 1. Jalankan Chrome Manual (seperti di app.js)
    if (!fs.existsSync(USER_DATA_DIR)) {
        fs.mkdirSync(USER_DATA_DIR, { recursive: true });
    }

    // Command line persis seperti app.js
    const chromeCmd = `google-chrome-stable --remote-debugging-port=${DEBUG_PORT} --user-data-dir="${USER_DATA_DIR}" --no-first-run --disable-blink-features=AutomationControlled`;
    
    console.log(`🔥 Menjalankan Chrome: ${chromeCmd}`);
    const chromeProcess = exec(chromeCmd);

    // Tunggu Chrome nyala
    await new Promise(r => setTimeout(r, 4000));

    // 2. Connect Puppeteer ke Chrome yang sudah jalan
    let browser;
    try {
        const response = await axios.get(`http://127.0.0.1:${DEBUG_PORT}/json/version`, { timeout: 5000 });
        const webSocketDebuggerUrl = response.data.webSocketDebuggerUrl;
        
        console.log(`🔌 Menyambungkan Puppeteer ke ${webSocketDebuggerUrl}...`);
        
        browser = await puppeteer.connect({
            browserWSEndpoint: webSocketDebuggerUrl,
            defaultViewport: null
        });
        
    } catch (e) {
        console.error("❌ Gagal connect ke Chrome. Pastikan 'google-chrome-stable' terinstall.");
        console.error(e.message);
        chromeProcess.kill();
        return;
    }

    const pages = await browser.pages();
    const page = pages[0] || await browser.newPage();
    
    console.log("🔗 Mengakses Login Page...");
    try {
        await page.goto('https://www.ivasms.com/login', { 
            waitUntil: 'domcontentloaded', 
            timeout: 60000 
        });
    } catch (e) {
        console.log("⚠️ Mengakses page timeout, tapi lanjut...");
    }

    // --- LOGIKA WAIT FOR CLOUDFLARE (SAMA) ---
    console.log("🛡️  Memeriksa Cloudflare Challenge...");
    
    const maxWaitSeconds = 90;
    let clickAttempted = false;
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWaitSeconds * 1000) {
        try {
            const currentUrl = page.url();
            const pageContent = await page.content();

            const isCloudflare = pageContent.includes('Just a moment') || 
                                 pageContent.includes('Checking your browser') ||
                                 pageContent.includes('cf-turnstile') ||
                                 pageContent.includes('challenge-running') ||
                                 pageContent.includes('Verifying you are human');

            if (isCloudflare) {
                console.log("⚠️  Cloudflare terdeteksi!");
                
                if (!clickAttempted) {
                    clickAttempted = true;
                    try {
                        const selectors = [
                            'iframe[src*="challenges.cloudflare.com"]',
                            '#turnstile-wrapper iframe',
                            '.cf-turnstile iframe',
                            'iframe[title*="Widget"]'
                        ];

                        let clicked = false;
                        for (const selector of selectors) {
                            const frameElement = await page.$(selector);
                            if (frameElement) {
                                console.log(`👉 Iframe ditemukan: ${selector}`);
                                const box = await frameElement.boundingBox();
                                if (box) {
                                    // Klik tengah iframe
                                    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
                                    console.log("🖱️  KLIK!");
                                    clicked = true;
                                    await new Promise(r => setTimeout(r, 3000));
                                    break;
                                }
                            }
                        }
                    } catch (clickErr) {
                        console.log(`❌ Gagal klik: ${clickErr.message}`);
                    }
                }
                await new Promise(r => setTimeout(r, 2000));
                continue;
            }

            if (currentUrl.includes('portal') || (currentUrl.includes('login'))) {
                 const emailInput = await page.$('input[name="email"]');
                 if (emailInput || currentUrl.includes('portal')) {
                     console.log(`✅ Cloudflare Lolos!`);
                     break;
                 }
            }
            await new Promise(r => setTimeout(r, 1000));

        } catch (e) {
             // Ignore navigation errors
             await new Promise(r => setTimeout(r, 1000));
        }
    }

    // --- PROSES LOGIN ---
    if (page.url().includes('portal')) {
        console.log("🎉 Sudah Login!");
    } else {
        console.log("✍️  Form Login...");
        try {
            await page.waitForSelector('input[name="email"]', { timeout: 10000 });
            
            await page.$eval('input[name="email"]', el => el.value = '');
            await page.$eval('input[name="password"]', el => el.value = '');
            
            await page.type('input[name="email"]', EMAIL, { delay: 50 });
            await page.type('input[name="password"]', PASSWORD, { delay: 50 });
            
            console.log("🚀 Submit...");
            const submitBtn = await page.$('button[type="submit"]');
            if (submitBtn) {
                 await Promise.all([
                    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {}),
                    submitBtn.click()
                 ]);
            } else {
                 await page.keyboard.press('Enter');
                 await new Promise(r => setTimeout(r, 5000));
            }

        } catch (e) {
            console.log("Login step error: " + e.message);
        }
    }

    // --- SIMPAN COOKIE ---
    if (page.url().includes('portal')) {
        const cookies = await page.cookies();
        
        // Filter cookie penting & format
        const finalCookies = cookies.map(c => ({
            name: c.name,
            value: c.value,
            domain: c.domain,
            path: c.path,
            secure: c.secure,
            expirationDate: c.expires
        }));

        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(finalCookies, null, 4));
        console.log(`💾 BERHASIL! Cookie disimpan ke ${OUTPUT_FILE}`);
        
    } else {
        console.log("❌ GAGAL. URL Final: " + page.url());
    }

    // --- SELESAI ---
    console.log("✅ Proses Login Selesai. Chrome akan tetap DIBIARKAN HIDUP untuk API.");
    console.log("👉 Jangan tutup terminal ini atau matikan Chrome kalau mau bot jalan.");
    
    // Kita disconnect Puppeteer saja, tapi biarkan Chrome Process jalan
    try {
        await browser.disconnect();
    } catch(e) {}
    
    // chromeProcess.kill(); <--- JANGAN DI KILL
    // process.exit(0);      <--- Biarkan script ini selesai tapi chrome di background tetap idup
}

run();

