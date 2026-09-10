require("dotenv").config();

const fs = require("fs");
const Database = require("better-sqlite3");

// ======================================================
// AYARLAR
// ======================================================

const TOKEN = process.env.BOT_TOKEN;

if (!TOKEN) {
  console.error("❌ BOT_TOKEN bulunamadı!");
  process.exit(1);
}

const API = `https://api.telegram.org/bot${TOKEN}`;

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
    username TEXT,
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

// Eski veritabanında username sütunu yoksa ekle
try {
  db.prepare(`ALTER TABLE users ADD COLUMN username TEXT`).run();
} catch (_) {}

// Geçici profil oturumları
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

async function sendMessage(chatId, text, extra = {}) {
  return telegram("sendMessage", {
    chat_id: chatId,
    text,
    ...extra,
  });
}

async function sendPhoto(chatId, photo, caption = "", extra = {}) {
  return telegram("sendPhoto", {
    chat_id: chatId,
    photo,
    caption,
    ...extra,
  });
}

async function answerCallbackQuery(id) {
  try {
    await telegram("answerCallbackQuery", {
      callback_query_id: id,
    });
  } catch (_) {}
}

// ======================================================
// MENÜ
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
// USERNAME GÜNCELLE
// ======================================================

function usernameGuncelle(userId, username) {
  try {
    db.prepare(`
      UPDATE users
      SET username = ?
      WHERE telegram_id = ?
    `).run(username || null, userId);
  } catch (_) {}
}

// ======================================================
// /START
// ======================================================

async function startKomutu(message) {
  const chatId = message.chat.id;
  const userId = message.from?.id;
  const username = message.from?.username || null;

  if (userId) {
    usernameGuncelle(userId, username);
  }

  await sendMessage(
    chatId,
    "👋 Bursa Tanışma'ya hoş geldin!\n\n" +
      "Yeni insanlarla tanış, profilleri keşfet ve eşleş.\n\n" +
      "🔞 Yalnızca 18 yaş ve üzeri kullanıcılar içindir.",
    anaMenu()
  );
}

// ======================================================
// EŞLEŞME MESAJI
// ======================================================

async function eslesmeMesaji(chatId, digerProfil) {
  const text =
    `🎉 EŞLEŞTİNİZ!\n\n` +
    `❤️ ${digerProfil.isim} de seni beğenmiş!`;

  if (digerProfil.username) {
    await sendMessage(chatId, text, {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "💬 Telegram’dan Yaz",
              url: `https://t.me/${digerProfil.username}`,
            },
          ],
        ],
      },
    });

    return;
  }

  await sendMessage(
    chatId,
    text +
      "\n\n⚠️ Bu kullanıcının Telegram kullanıcı adı olmadığı için doğrudan mesaj butonu gösterilemiyor."
  );
}

// ======================================================
// CALLBACK
// ======================================================

async function callbackIsle(query) {
  const data = query.data;
  const userId = query.from.id;
  const chatId = query.message?.chat?.id;
  const username = query.from?.username || null;

  await answerCallbackQuery(query.id);

  if (!data || !chatId) return;

  usernameGuncelle(userId, username);

  // PROFİL OLUŞTUR
  if (data === "profil_olustur") {
    sessions.set(userId, {
      step: "isim",
      username,
    });

    await sendMessage(
      chatId,
      "👤 Profil oluşturmaya başlayalım.\n\nAdını yaz:"
    );

    return;
  }

  // KEŞFET
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

  // PROFİLİM
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
        "⚠️ Henüz kayıtlı bir profilin yok.",
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

  // CİNSİYET
  if (data === "cinsiyet_kadin" || data === "cinsiyet_erkek") {
    const session = sessions.get(userId);

    if (!session) {
      await sendMessage(
        chatId,
        "⚠️ Profil oluşturma işlemi bulunamadı. /start yaz."
      );
      return;
    }

    session.cinsiyet =
      data === "cinsiyet_kadin" ? "Kadın" : "Erkek";

    session.step = "sehir";

    await sendMessage(
      chatId,
      "📍 Hangi şehirde yaşıyorsun?\n\nÖrnek: Bursa"
    );

    return;
  }

  // PROFİL KAYDET
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
        username,
        isim,
        yas,
        cinsiyet,
        sehir,
        foto,
        aciklama
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)

      ON CONFLICT(telegram_id)
      DO UPDATE SET
        username = excluded.username,
        isim = excluded.isim,
        yas = excluded.yas,
        cinsiyet = excluded.cinsiyet,
        sehir = excluded.sehir,
        foto = excluded.foto,
        aciklama = excluded.aciklama
    `).run(
      userId,
      session.username || username || null,
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
      "🎉 Profilin başarıyla kaydedildi!\n\nArtık profilleri keşfedebilirsin.",
      anaMenu()
    );

    return;
  }

  // ❤️ BEĞEN
  if (data.startsWith("begen_")) {
    const likedId = Number(data.replace("begen_", ""));

    if (!Number.isSafeInteger(likedId) || likedId === userId) {
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

    if (!benimProfilim || !digerProfil) {
      await sendMessage(
        chatId,
        "⚠️ Profil bulunamadı."
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

    if (eslesme) {
      await eslesmeMesaji(
        chatId,
        digerProfil
      );

      try {
        await eslesmeMesaji(
          likedId,
          benimProfilim
        );
      } catch (error) {
        console.log(
          "Karşı tarafa eşleşme mesajı gönderilemedi:",
          error.message
        );
      }
    } else {
      await sendMessage(
        chatId,
        "❤️ Profil beğenildi!"
      );
    }

    const sonraki =
      rastgeleProfil(userId, likedId);

    if (sonraki) {
      await profilGoster(
        chatId,
        sonraki
      );
    }

    return;
  }

  // ❌ GEÇ
  if (data.startsWith("gec_")) {
    const skippedId =
      Number(data.replace("gec_", ""));

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
// MESAJLAR
// ======================================================

async function mesajIsle(msg) {
  const chatId = msg.chat.id;
  const userId = msg.from?.id;
  const username = msg.from?.username || null;

  if (!userId) return;

  usernameGuncelle(userId, username);

  if (
    msg.text === "/start" ||
    msg.text?.startsWith("/start@")
  ) {
    await startKomutu(msg);
    return;
  }

  if (msg.text?.startsWith("/")) {
    return;
  }

  const session =
    sessions.get(userId);

  if (!session) {
    return;
  }

  session.username = username;

  // İSİM
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

  // YAŞ
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

  // ŞEHİR
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

  // FOTO
  if (session.step === "foto") {
    if (!msg.photo?.length) {
      await sendMessage(
        chatId,
        "⚠️ Lütfen fotoğraf olarak gönder."
      );
      return;
    }

    session.foto =
      msg.photo[msg.photo.length - 1].file_id;

    session.step = "aciklama";

    await sendMessage(
      chatId,
      "✍️ Son olarak kendinden kısaca bahset."
    );
    return;
  }

  // AÇIKLAMA
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

    session.step = "tamamlandi";

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
// UPDATE
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
    }
  } catch (error) {
    console.error(
      "❌ Update hatası:",
      error.message
    );
  }
}

// ======================================================
// POLLING
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
// BAŞLAT
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
    process.exit(1);
  }
}

// ======================================================
// KAPAT
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

baslat();