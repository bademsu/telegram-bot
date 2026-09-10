require("dotenv").config();

const { Bot } = require("node-telegram-bot-api");
const Database = require("better-sqlite3");

const bot = new Bot(process.env.BOT_TOKEN);

// SQLite veritabanı
const db = new Database("users.db");

// Tabloyu oluştur
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

// Profil oluştururken geçici adımlar burada tutulacak
const users = new Map();

bot.command("start", async (ctx) => {
  await ctx.reply(
    "👋 Bursa Tanışma'ya hoş geldin!\n\n" +
    "Yeni insanlarla tanış, profilleri keşfet ve eşleş.\n\n" +
    "🔞 Yalnızca 18 yaş ve üzeri kullanıcılar içindir.",
    {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "👤 Profil Oluştur",
              callback_data: "profil_olustur"
            }
          ],
          [
            {
              text: "🔍 Profilleri Keşfet",
              callback_data: "profilleri_kesfet"
            }
          ],
          [
            {
              text: "🪪 Profilimi Gör",
              callback_data: "profilimi_gor"
            }
          ]
        ]
      }
    }
  );
});

bot.on("callback_query", async (ctx) => {
  const data = ctx.callbackQuery?.data;
  const userId = ctx.from?.id;

  await ctx.answerCallbackQuery();

  if (!userId) return;

  if (data === "profil_olustur") {
    users.set(userId, {
      step: "isim"
    });

    await ctx.reply(
      "👤 Profil oluşturmaya başlayalım.\n\nAdını yaz:"
    );

    return;
  }

  if (data === "profilleri_kesfet") {
    const profiller = db.prepare(`
      SELECT *
      FROM users
      WHERE telegram_id != ?
      ORDER BY RANDOM()
      LIMIT 1
    `).all(userId);

    if (profiller.length === 0) {
      await ctx.reply(
        "🔍 Şimdilik gösterebileceğim başka profil yok."
      );
      return;
    }

    const profil = profiller[0];

    await ctx.api.sendPhoto({
      chat_id: ctx.chat.id,
      photo: profil.foto,
      caption:
        `👤 ${profil.isim}, ${profil.yas}\n` +
        `⚧ ${profil.cinsiyet}\n` +
        `📍 ${profil.sehir}\n\n` +
        `${profil.aciklama}`
    });

    return;
  }

  if (data === "profilimi_gor") {
    const profil = db.prepare(`
      SELECT *
      FROM users
      WHERE telegram_id = ?
    `).get(userId);

    if (!profil) {
      await ctx.reply(
        "Henüz kayıtlı bir profilin yok.\n\nÖnce 👤 Profil Oluştur butonuna bas."
      );
      return;
    }

    await ctx.api.sendPhoto({
      chat_id: ctx.chat.id,
      photo: profil.foto,
      caption:
        `🪪 PROFİLİN\n\n` +
        `👤 ${profil.isim}, ${profil.yas}\n` +
        `⚧ ${profil.cinsiyet}\n` +
        `📍 ${profil.sehir}\n\n` +
        `${profil.aciklama}`
    });

    return;
  }

  if (data === "cinsiyet_kadin") {
    const user = users.get(userId);

    if (!user) return;

    user.cinsiyet = "Kadın";
    user.step = "sehir";

    await ctx.reply(
      "📍 Hangi şehirde yaşıyorsun?\n\nÖrnek: Bursa"
    );

    return;
  }

  if (data === "cinsiyet_erkek") {
    const user = users.get(userId);

    if (!user) return;

    user.cinsiyet = "Erkek";
    user.step = "sehir";

    await ctx.reply(
      "📍 Hangi şehirde yaşıyorsun?\n\nÖrnek: Bursa"
    );

    return;
  }

  if (data === "profili_kaydet") {
    const user = users.get(userId);

    if (!user || user.step !== "tamamlandi") {
      await ctx.reply("Profil bulunamadı.");
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
      user.isim,
      user.yas,
      user.cinsiyet,
      user.sehir,
      user.foto,
      user.aciklama
    );

    users.delete(userId);

    await ctx.reply(
      "🎉 Profilin kalıcı olarak kaydedildi!\n\n" +
      "Artık bot kapanıp açılsa bile profilin silinmez."
    );

    return;
  }
});

bot.on("message", async (ctx) => {
  const msg = ctx.message;
  const userId = ctx.from?.id;

  if (!msg || !userId) return;

  const user = users.get(userId);

  if (msg.text?.startsWith("/")) return;
  if (!user) return;

  if (user.step === "isim") {
    if (!msg.text) return;

    user.isim = msg.text.trim();
    user.step = "yas";

    await ctx.reply(
      "🎂 Yaşını yaz:\n\nÖrnek: 25"
    );

    return;
  }

  if (user.step === "yas") {
    if (!msg.text) return;

    const yas = Number(msg.text.trim());

    if (!Number.isInteger(yas) || yas < 18 || yas > 99) {
      await ctx.reply(
        "⚠️ Lütfen 18 ile 99 arasında geçerli bir yaş yaz."
      );
      return;
    }

    user.yas = yas;
    user.step = "cinsiyet";

    await ctx.reply(
      "⚧ Cinsiyetini seç:",
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "👩 Kadın",
                callback_data: "cinsiyet_kadin"
              },
              {
                text: "👨 Erkek",
                callback_data: "cinsiyet_erkek"
              }
            ]
          ]
        }
      }
    );

    return;
  }

  if (user.step === "sehir") {
    if (!msg.text) return;

    user.sehir = msg.text.trim();
    user.step = "foto";

    await ctx.reply(
      "📸 Şimdi profil fotoğrafını gönder."
    );

    return;
  }

  if (user.step === "foto") {
    if (!msg.photo) {
      await ctx.reply(
        "⚠️ Lütfen fotoğraf olarak gönder."
      );
      return;
    }

    user.foto = msg.photo[msg.photo.length - 1].file_id;
    user.step = "aciklama";

    await ctx.reply(
      "✍️ Son olarak kendinden kısaca bahset."
    );

    return;
  }

  if (user.step === "aciklama") {
    if (!msg.text) return;

    user.aciklama = msg.text.trim();
    user.step = "tamamlandi";

    await ctx.api.sendPhoto({
      chat_id: msg.chat.id,
      photo: user.foto,
      caption:
        `👤 ${user.isim}, ${user.yas}\n` +
        `⚧ ${user.cinsiyet}\n` +
        `📍 ${user.sehir}\n\n` +
        `${user.aciklama}`,
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "✅ Profili Kaydet",
              callback_data: "profili_kaydet"
            }
          ],
          [
            {
              text: "🔄 Baştan Oluştur",
              callback_data: "profil_olustur"
            }
          ]
        ]
      }
    });

    return;
  }
});

console.log("Bot aktif ✅");
console.log("Veritabanı hazır ✅");

bot.startPolling();