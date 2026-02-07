const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

puppeteer.use(StealthPlugin());

const USER_DATA_DIR = path.resolve(process.env.HOME, '.config/chrome-bot-login');
const DEBUG_PORT = 9222;

// DEBUG ARGS
console.error("DEBUG ARGS:", JSON.stringify(process.argv));

async function run() {
    const args = process.argv.slice(2);
    const command = args[0]; // e.g. "getsms"
    const date = args[1]; // e.g. "03/02/2026"

    // Pastikan Chrome jalan dulu (jaga-jaga kalau mati)
    // Sebaiknya Chrome dibiarkan terus berjalan di background oleh sistem kamu
    
    // Connect ke Chrome
    let browser;
    try {
        const response = await axios.get(`http://127.0.0.1:${DEBUG_PORT}/json/version`, { timeout: 2000 });
        const webSocketDebuggerUrl = response.data.webSocketDebuggerUrl;
        
        browser = await puppeteer.connect({
            browserWSEndpoint: webSocketDebuggerUrl,
            defaultViewport: null
        });
    } catch (e) {
        console.error(JSON.stringify({ error: "Chrome tidak berjalan atau tidak bisa dikoneksi." }));
        process.exit(1);
    }

    const pages = await browser.pages();
    // Gunakan page pertama yang sudah login
    const page = pages[0] || await browser.newPage();

    if (command === 'getsms') {
        try {
            if (!page.url().includes('portal/live/my_sms')) {
                await page.goto('https://www.ivasms.com/portal/live/my_sms', { waitUntil: 'networkidle2' });
            }

            // Tunggu elemen tabel muncul (kita tunggu string 'Live SMS' atau selector table)
            try {
                await page.waitForSelector('table', { timeout: 10000 });
            } catch(e) {
                console.log(JSON.stringify({ error: "Table not found" }));
                return;
            }

            const result = await page.evaluate(() => {
                const rows = document.querySelectorAll('table tbody tr');
                const data = [];

                rows.forEach(row => {
                    const cols = row.querySelectorAll('td');
                    // Biasanya struktur tabel:
                    // Col 0: Country + Phone (ada img flag, ada text country, ada text phone)
                    // Col 1: SID (WhatsApp)
                    // Col 2: Paid
                    // Col 3: Limit
                    // Col 4: Message Content
                    
                    if (cols.length >= 5) {
                        // Extract RAW Text from Col 0
                        const col0Text = cols[0].innerText.trim();
                        
                        // Cari sequence angka minimal 7 digit (untuk menghindari angka pendek di nama negara seperti 'OMAN 770')
                        const phoneMatch = col0Text.match(/\b\d{7,}\b/);
                        const phoneNumber = phoneMatch ? phoneMatch[0] : "Unknown";
                        
                        // Ambil nama negara (segala sesuatu sebelum nomor hp atau baris pertama)
                        // Kita ambil baris pertama atau text sebelum nomor
                        let countryInfo = col0Text.split('\n')[0].trim();
                        if (countryInfo === phoneNumber) {
                            countryInfo = col0Text.replace(phoneNumber, '').trim();
                        }
                        if (!countryInfo) countryInfo = "Unknown Area";

                        const message = cols[4].innerText.trim();

                        data.push({
                            range: countryInfo,
                            number: phoneNumber,
                            message: message
                        });
                    }
                });
                return data;
            });

            console.log(JSON.stringify({ live_sms: result }));
        } catch (e) { console.error(JSON.stringify({ error: e.message })); }
    }
    
    else if (command === 'getnumbers') {
        const range = args[1]; // Index 1 is Range Name (was 2)
        const date = args[2];  // Index 2 is Date (was 3)
        try {
             // 1. Pastikan di halaman received
             if (!page.url().includes('portal/live/my_sms')) {
                await page.goto('https://www.ivasms.com/portal/live/my_sms', { waitUntil: 'networkidle2' });
             }

             // 2. Filter Tanggal Dulu (PENTING)
             // ... Logic filter tanggal agak ribet via klik, kita asumsikan user (atau API getsms sblmnya) sudah set tanggal via Session/Cookie?
             // TIDAK. Kita harus set tanggal manual via INPUT lalu klik Filter.
             
             // Tapi tunggu, summary (getsms) tadi berhasil ambil data tanggal 02/02/2026.
             // Berarti saat kita panggil getnumbers, kita berada di page yg sama.
             // Kita bisa inject script untuk klik item range.

             const result = await page.evaluate(async (range, date) => {
                 const csrfToken = $('input[name="_token"]').val();
                 if (!csrfToken) return "ERROR: Token Not Found";

                 return await new Promise((resolve) => {
                     // Kita gunakan payload dan URL yang SAMA PERSIS dengan script asli
                     // Dari log HTML: start:'02/02/2026', end:'02/02/2026', range:id
                     // Kita pakai 'date' untuk start dan end biar konsisten
                     
                     $.ajax({
                         'url': "https://www.ivasms.com/portal/live/my_sms/getsms/number",
                         'data': {
                             _token: csrfToken,
                             start: date, 
                             end: date, // Isi dua-duanya
                             range: range
                         },
                         'dataType': 'html',
                         'type': 'POST',
                         'success': function(response) {
                             resolve(response);
                         },
                         'error': function(xhr) {
                             resolve("ERROR: AJAX Failed " + xhr.status + " " + xhr.responseText);
                         }
                     });
                 });
             }, range, date);

             console.log(JSON.stringify({ html: result }));

        } catch (e) { console.error(JSON.stringify({ error: e.message })); }
    }

    else if (command === 'getmessage') {
        const number = args[1]; // Index 1 is Phone (was 2)
        const range = args[2];  // Index 2 is Range (was 3)
        const date = args[3];   // Index 3 is Date (was 4)
        try {
            const result = await page.evaluate(async (number, range, date) => {
                const csrfToken = $('input[name="_token"]').val();
                if (!csrfToken) return "ERROR: Token Not Found";

                return await new Promise((resolve) => {
                    $.ajax({
                        url: '/portal/live/my_sms/getsms/number/sms',
                        type: 'POST',
                        data: {
                            _token: csrfToken,
                            start: date,
                            end: date, // Isi end date juga
                            Number: number,
                            Range: range
                        },
                        success: function(response) { resolve(response); },
                        error: function(xhr) { resolve("ERROR: " + xhr.responseText); }
                    });
                });
            }, number, range, date);
            console.log(JSON.stringify({ html: result }));
        } catch (e) { console.error(JSON.stringify({ error: e.message })); }
    }

    // Jangan close browser, cuma disconnect puppeteer
    browser.disconnect();
}

run();
