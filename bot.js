require("dotenv").config();

const fs = require("fs");
const Database = require("better-sqlite3");

// ======================================================
// AYARLAR
// ======================================================

const TOKEN = process.env.BOT_TOKEN;

if (!TOKEN) {
  console.error("❌ BOT_TOKEN bulunamadı!");
  console.error("👉 .env dosyanı kontrol et.");
  process.exit(1);
}

const API = `https://api.telegram.org/bot${TOKEN}`;

// Railway'de /data kullan.
// Mac'te proje klasöründeki users.db kullan.
const dbPath =
  process.env.DB_PATH ||
  (fs.existsSync("/data") ? "/data/users.db" : "./users.db");

const db = new Database(dbPath);

db.pragma("journal_mode = WAL");

// ======================================================
// VERİTABANI
// ======================================================

db.prepare(`
  CREATE TABLE IF NOT EXISTS users (
    telegram_id INTEGER PRIMARY KEY,
    isim TEXT,
    yas INTEGER,
    cinsiyet TEXT,
    sehir TEXT,
    foto TEXT,
    aciklama TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS likes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    liker_id INTEGER NOT NULL,
    liked_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(liker_id, liked_id)
  )
`).run();

// Profil oluşturma aşamaları
const sessions = new Map();

// ======================================================
// TELEGRAM API
// ======================================================

async function telegram(method, body = {}) {
  const response = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const result = await response.json();

  if (!result.ok) {
    throw new Error(
      `${method}: ${result.description || "Telegram API hatası"}`
    );
  }

  return result.result;
}

// ======================================================
// MESAJ GÖNDER
// ======================================================

async function sendMessage(chatId, text, extra = {}) {
  return telegram("sendMessage", {
    chat_id: chatId,
    text,
    ...extra,
  });
}

// ======================================================
// FOTOĞRAF GÖNDER
// ======================================================

async function sendPhoto(chatId, photo, caption = "", extra = {}) {
  return telegram("sendPhoto", {
    chat_id: chatId,
    photo,
    caption,
    ...extra,
  });
}

// ======================================================
// CALLBACK CEVAPLA
// ======================================================

async function answerCallbackQuery(id) {
  try {
    await telegram("answerCallbackQuery", {
      callback_query_id: id,
    });
  } catch (error) {
    console.log("Callback cevap hatası:", error.message);
  }
}

// ======================================================
// ANA MENÜ
// ======================================================

function anaMenu() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "👤 Profil Oluştur / Düzenle",
            callback_data: "profil_olustur",
          },
        ],

        [
          {
            text: "🔍 Profilleri Keşfet",
            callback_data: "profilleri_kesfet",
          },
        ],

        [
          {
            text: "🪪 Profilimi Gör",
            callback_data: "profilimi_gor",
          },
        ],
      ],
    },
  };
}

// ======================================================
// PROFİL YAZISI
// ======================================================

function profilYazisi(profil, baslik = "") {
  let text = "";

  if (baslik) {
    text += `${baslik}\n\n`;
  }

  text += `👤 ${profil.isim}, ${profil.yas}\n`;
  text += `⚧ ${profil.cinsiyet}\n`;
  text += `📍 ${profil.sehir}\n\n`;
  text += profil.aciklama || "";

  return text;
}

// ======================================================
// PROFİL GÖSTER
// ======================================================

async function profilGoster(chatId, profil) {
  await sendPhoto(
    chatId,
    profil.foto,
    profilYazisi(profil),

    {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "❤️ Beğen",
              callback_data: `begen_${profil.telegram_id}`,
            },

            {
              text: "❌ Geç",
              callback_data: `gec_${profil.telegram_id}`,
            },
          ],
        ],
      },
    }
  );
}

// ======================================================
// RASTGELE PROFİL
// ======================================================

function rastgeleProfil(userId, haricId = null) {
  if (haricId) {
    return db
      .prepare(`
        SELECT *
        FROM users
        WHERE telegram_id != ?
          AND telegram_id != ?
        ORDER BY RANDOM()
        LIMIT 1
      `)
      .get(userId, haricId);
  }

  return db
    .prepare(`
      SELECT *
      FROM users
      WHERE telegram_id != ?
      ORDER BY RANDOM()
      LIMIT 1
    `)
    .get(userId);
}

// ======================================================
// /START
// ======================================================

async function startKomutu(message) {
  const chatId = message.chat.id;

  await sendMessage(
    chatId,

    "👋 Bursa Tanışma'ya hoş geldin!\n\n" +
      "Yeni insanlarla tanış, profilleri keşfet ve eşleş.\n\n" +
      "🔞 Yalnızca 18 yaş ve üzeri kullanıcılar içindir.",

    anaMenu()
  );
}

// ======================================================
// CALLBACK BUTONLARI
// ======================================================

async function callbackIsle(query) {
  const data = query.data;
  const userId = query.from.id;
  const chatId = query.message?.chat?.id;

  await answerCallbackQuery(query.id);

  if (!data || !chatId) {
    return;
  }

  // ====================================================
  // PROFİL OLUŞTUR
  // ====================================================

  if (data === "profil_olustur") {
    sessions.set(userId, {
      step: "isim",
    });

    await sendMessage(
      chatId,
      "👤 Profil oluşturmaya başlayalım.\n\nAdını yaz:"
    );

    return;
  }

  // ====================================================
  // PROFİLLERİ KEŞFET
  // ====================================================

  if (data === "profilleri_kesfet") {
    const kendiProfilin = db
      .prepare(`
        SELECT *
        FROM users
        WHERE telegram_id = ?
      `)
      .get(userId);

    if (!kendiProfilin) {
      await sendMessage(
        chatId,

        "⚠️ Profilleri keşfetmeden önce kendi profilini oluşturmalısın.",

        anaMenu()
      );

      return;
    }

    const profil = rastgeleProfil(userId);

    if (!profil) {
      await sendMessage(
        chatId,
        "🔍 Şimdilik gösterebileceğim başka profil yok."
      );

      return;
    }

    await profilGoster(chatId, profil);

    return;
  }

  // ====================================================
  // PROFİLİMİ GÖR
  // ====================================================

  if (data === "profilimi_gor") {
    const profil = db
      .prepare(`
        SELECT *
        FROM users
        WHERE telegram_id = ?
      `)
      .get(userId);

    if (!profil) {
      await sendMessage(
        chatId,

        "⚠️ Henüz kayıtlı bir profilin yok.\n\n" +
          "Önce Profil Oluştur butonuna bas.",

        anaMenu()
      );

      return;
    }

    await sendPhoto(
      chatId,
      profil.foto,
      profilYazisi(profil, "🪪 PROFİLİN"),

      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "✏️ Profilimi Düzenle",
                callback_data: "profil_olustur",
              },
            ],

            [
              {
                text: "🔍 Profilleri Keşfet",
                callback_data: "profilleri_kesfet",
              },
            ],
          ],
        },
      }
    );

    return;
  }

  // ====================================================
  // CİNSİYET KADIN
  // ====================================================

  if (data === "cinsiyet_kadin") {
    const session = sessions.get(userId);

    if (!session) {
      await sendMessage(
        chatId,
        "⚠️ Profil oluşturma işlemi bulunamadı.\n/start yaz."
      );

      return;
    }

    session.cinsiyet = "Kadın";
    session.step = "sehir";

    await sendMessage(
      chatId,
      "📍 Hangi şehirde yaşıyorsun?\n\nÖrnek: Bursa"
    );

    return;
  }

  // ====================================================
  // CİNSİYET ERKEK
  // ====================================================

  if (data === "cinsiyet_erkek") {
    const session = sessions.get(userId);

    if (!session) {
      await sendMessage(
        chatId,
        "⚠️ Profil oluşturma işlemi bulunamadı.\n/start yaz."
      );

      return;
    }

    session.cinsiyet = "Erkek";
    session.step = "sehir";

    await sendMessage(
      chatId,
      "📍 Hangi şehirde yaşıyorsun?\n\nÖrnek: Bursa"
    );

    return;
  }

  // ====================================================
  // PROFİL KAYDET
  // ====================================================

  if (data === "profili_kaydet") {
    const session = sessions.get(userId);

    if (!session || session.step !== "tamamlandi") {
      await sendMessage(
        chatId,
        "⚠️ Kaydedilecek profil bulunamadı."
      );

      return;
    }

    db.prepare(`
      INSERT INTO users (
        telegram_id,
        isim,
        yas,
        cinsiyet,
        sehir,
        foto,
        aciklama
      )

      VALUES (?, ?, ?, ?, ?, ?, ?)

      ON CONFLICT(telegram_id)

      DO UPDATE SET
        isim = excluded.isim,
        yas = excluded.yas,
        cinsiyet = excluded.cinsiyet,
        sehir = excluded.sehir,
        foto = excluded.foto,
        aciklama = excluded.aciklama
    `).run(
      userId,
      session.isim,
      session.yas,
      session.cinsiyet,
      session.sehir,
      session.foto,
      session.aciklama
    );

    sessions.delete(userId);

    await sendMessage(
      chatId,

      "🎉 Profilin başarıyla kaydedildi!\n\n" +
        "Artık profilleri keşfedebilirsin.",

      anaMenu()
    );

    return;
  }

  // ====================================================
  // ❤️ BEĞEN
  // ====================================================

  if (data.startsWith("begen_")) {
    const likedId = Number(
      data.replace("begen_", "")
    );

    if (!Number.isSafeInteger(likedId)) {
      return;
    }

    if (likedId === userId) {
      return;
    }

    const benimProfilim = db
      .prepare(`
        SELECT *
        FROM users
        WHERE telegram_id = ?
      `)
      .get(userId);

    const digerProfil = db
      .prepare(`
        SELECT *
        FROM users
        WHERE telegram_id = ?
      `)
      .get(likedId);

    if (!benimProfilim) {
      await sendMessage(
        chatId,
        "⚠️ Önce kendi profilini oluşturmalısın."
      );

      return;
    }

    if (!digerProfil) {
      await sendMessage(
        chatId,
        "⚠️ Bu profil artık bulunamıyor."
      );

      return;
    }

    db.prepare(`
      INSERT OR IGNORE INTO likes (
        liker_id,
        liked_id
      )

      VALUES (?, ?)
    `).run(userId, likedId);

    const eslesme = db
      .prepare(`
        SELECT *
        FROM likes
        WHERE liker_id = ?
        AND liked_id = ?
      `)
      .get(likedId, userId);

    // ==================================================
    // EŞLEŞME
    // ==================================================

    if (eslesme) {
      await sendMessage(
        chatId,

        "🎉 EŞLEŞTİNİZ!\n\n" +
          `❤️ ${digerProfil.isim} de seni beğenmiş!`
      );

      try {
        await sendMessage(
          likedId,

          "🎉 EŞLEŞTİNİZ!\n\n" +
            `❤️ ${benimProfilim.isim} de seni beğenmiş!`
        );
      } catch (error) {
        console.log(
          "Eşleşme mesajı karşı tarafa gönderilemedi:",
          error.message
        );
      }
    } else {
      await sendMessage(
        chatId,
        "❤️ Profil beğenildi!"
      );
    }

    // Sonraki profil
    const sonrakiProfil =
      rastgeleProfil(userId, likedId);

    if (sonrakiProfil) {
      await profilGoster(
        chatId,
        sonrakiProfil
      );
    }

    return;
  }

  // ====================================================
  // ❌ GEÇ
  // ====================================================

  if (data.startsWith("gec_")) {
    const skippedId = Number(
      data.replace("gec_", "")
    );

    const profil =
      rastgeleProfil(userId, skippedId);

    if (!profil) {
      await sendMessage(
        chatId,
        "🔍 Şimdilik gösterebileceğim başka profil yok."
      );

      return;
    }

    await profilGoster(
      chatId,
      profil
    );

    return;
  }
}

// ======================================================
// PROFİL OLUŞTURMA MESAJLARI
// ======================================================

async function mesajIsle(msg) {
  const chatId = msg.chat.id;
  const userId = msg.from?.id;

  if (!userId) {
    return;
  }

  // /start
  if (
    msg.text === "/start" ||
    msg.text?.startsWith("/start@")
  ) {
    await startKomutu(msg);
    return;
  }

  // Diğer komutları geç
  if (msg.text?.startsWith("/")) {
    return;
  }

  const session =
    sessions.get(userId);

  if (!session) {
    return;
  }

  // ====================================================
  // İSİM
  // ====================================================

  if (session.step === "isim") {
    if (!msg.text?.trim()) {
      await sendMessage(
        chatId,
        "⚠️ Lütfen adını yaz."
      );

      return;
    }

    session.isim =
      msg.text.trim().slice(0, 50);

    session.step = "yas";

    await sendMessage(
      chatId,
      "🎂 Yaşını yaz:\n\nÖrnek: 25"
    );

    return;
  }

  // ====================================================
  // YAŞ
  // ====================================================

  if (session.step === "yas") {
    const yas =
      Number(msg.text?.trim());

    if (
      !Number.isInteger(yas) ||
      yas < 18 ||
      yas > 99
    ) {
      await sendMessage(
        chatId,
        "⚠️ Lütfen 18 ile 99 arasında geçerli bir yaş yaz."
      );

      return;
    }

    session.yas = yas;
    session.step = "cinsiyet";

    await sendMessage(
      chatId,
      "⚧ Cinsiyetini seç:",

      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "👩 Kadın",
                callback_data: "cinsiyet_kadin",
              },

              {
                text: "👨 Erkek",
                callback_data: "cinsiyet_erkek",
              },
            ],
          ],
        },
      }
    );

    return;
  }

  // ====================================================
  // CİNSİYET
  // ====================================================

  if (session.step === "cinsiyet") {
    await sendMessage(
      chatId,
      "⚠️ Lütfen Kadın veya Erkek butonuna bas."
    );

    return;
  }

  // ====================================================
  // ŞEHİR
  // ====================================================

  if (session.step === "sehir") {
    if (!msg.text?.trim()) {
      await sendMessage(
        chatId,
        "⚠️ Lütfen şehir adını yaz."
      );

      return;
    }

    session.sehir =
      msg.text.trim().slice(0, 50);

    session.step = "foto";

    await sendMessage(
      chatId,
      "📸 Şimdi profil fotoğrafını gönder."
    );

    return;
  }

  // ====================================================
  // FOTOĞRAF
  // ====================================================

  if (session.step === "foto") {
    if (
      !msg.photo ||
      msg.photo.length === 0
    ) {
      await sendMessage(
        chatId,
        "⚠️ Lütfen fotoğraf olarak gönder."
      );

      return;
    }

    const fotograf =
      msg.photo[
        msg.photo.length - 1
      ];

    session.foto =
      fotograf.file_id;

    session.step =
      "aciklama";

    await sendMessage(
      chatId,
      "✍️ Son olarak kendinden kısaca bahset."
    );

    return;
  }

  // ====================================================
  // AÇIKLAMA
  // ====================================================

  if (session.step === "aciklama") {
    if (!msg.text?.trim()) {
      await sendMessage(
        chatId,
        "⚠️ Lütfen açıklamanı yaz."
      );

      return;
    }

    session.aciklama =
      msg.text.trim().slice(0, 500);

    session.step =
      "tamamlandi";

    await sendPhoto(
      chatId,

      session.foto,

      profilYazisi(
        session,
        "✅ PROFİL ÖNİZLEME"
      ),

      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "✅ Profili Kaydet",
                callback_data: "profili_kaydet",
              },
            ],

            [
              {
                text: "🔄 Baştan Oluştur",
                callback_data: "profil_olustur",
              },
            ],
          ],
        },
      }
    );

    return;
  }
}

// ======================================================
// UPDATE İŞLE
// ======================================================

async function updateIsle(update) {
  try {
    if (update.callback_query) {
      await callbackIsle(
        update.callback_query
      );

      return;
    }

    if (update.message) {
      await mesajIsle(
        update.message
      );

      return;
    }
  } catch (error) {
    console.error(
      "❌ Update hatası:",
      error.message
    );
  }
}

// ======================================================
// LONG POLLING
// ======================================================

let offset = 0;
let running = true;

async function polling() {
  console.log("🤖 Telegram bağlantısı başlatılıyor...");

  while (running) {
    try {
      const updates =
        await telegram("getUpdates", {
          offset,
          timeout: 30,
          allowed_updates: [
            "message",
            "callback_query",
          ],
        });

      for (const update of updates) {
        offset =
          update.update_id + 1;

        await updateIsle(update);
      }
    } catch (error) {
      console.error(
        "⚠️ Polling hatası:",
        error.message
      );

      await new Promise(
        (resolve) =>
          setTimeout(resolve, 3000)
      );
    }
  }
}

// ======================================================
// BOT BİLGİSİ TESTİ
// ======================================================

async function baslat() {
  try {
    const me =
      await telegram("getMe");

    console.log("");
    console.log("=================================");
    console.log("✅ BOT AKTİF");
    console.log(`🤖 Bot: @${me.username}`);
    console.log(`💾 Veritabanı: ${dbPath}`);
    console.log("=================================");
    console.log("");

    await polling();
  } catch (error) {
    console.error("");
    console.error("❌ BOT BAŞLATILAMADI");
    console.error(error.message);
    console.error("");
    console.error(
      "👉 BOT_TOKEN değerini kontrol et."
    );

    process.exit(1);
  }
}

// ======================================================
// KAPANIŞ
// ======================================================

process.on("SIGINT", () => {
  console.log("\nBot kapatılıyor...");
  running = false;

  try {
    db.close();
  } catch (_) {}

  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\nBot kapatılıyor...");
  running = false;

  try {
    db.close();
  } catch (_) {}

  process.exit(0);
});

// ======================================================
// ÇALIŞTIR
// ======================================================

baslat();