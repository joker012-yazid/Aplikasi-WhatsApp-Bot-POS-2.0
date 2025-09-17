# Aplikasi WhatsApp Bot + POS + Tiket + CRM (Docker, On-Prem)

> Platform lengkap untuk operasi servis/peruncitan: **Bot WhatsApp (Baileys)**, **POS**, **Tiket Kerja**, **Borang QR Intake**, **CRM**, **Dashboard**, dan **Backup ke Synology** — semuanya berjalan dalam **Docker Compose**. Baileys berasaskan **WhatsApp Web (WebSocket)** dan memerlukan **QR pairing**.

---

## 0) Prasyarat

* **OS/Host:** Linux/Windows/macOS (server lokal/on-prem disyorkan).
* **Docker & Docker Compose v2** terpasang. (Guna `docker compose`, bukan `docker-compose` legacy.)
* **Port** lalai: `3000` (Web UI), `8080` (API), `6379` (Redis), `5432` (Postgres).
* (Opsyenal) **Keycloak** untuk SSO OIDC, **QZ Tray** di PC kaunter untuk cetak resit thermal, **Synology NAS** untuk backup.

> Nota: Imej **Postgres** & **Redis** rasmi tersedia di Docker Hub; kami gunakan konfigurasi standard & volume persisten.

---

## 1) Struktur Repo

```
.
├── api/                # Backend (Node.js + Express untuk POS/CRM/Tiket)
├── bot/                # Servis WhatsApp (Baileys)
├── web/                # UI (React SPA untuk operasi harian)
├── infra/
│   ├── docker-compose.yml
│   └── db/
│       └── init/       # Skema + seed SQL (auto-run bila DB baru)
├── .env.example        # Contoh konfigurasi persekitaran
└── README.md
```

---

## 2) Ringkasan Senibina

Multi-container dengan **Docker Compose**:
`web (React)` ⇄ `api (Node.js)` ⇄ `db (Postgres)`
`bot (Baileys)` ⇄ `api` ⇄ `redis (BullMQ jobs)`

Compose memudahkan definisi servis, jaringan dalaman & volume persisten dalam satu fail.

---

## 3) Fail `docker-compose.yml` (contoh minimum)

> Letak di `infra/docker-compose.yml`.

```yaml
version: "3.9"

services:
  db:
    image: postgres:16
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app
      POSTGRES_DB: app
    volumes:
      - db_data:/var/lib/postgresql/data
      - ./db/init:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app -d app"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  redis:
    image: redis:7
    command: ["redis-server", "--appendonly", "yes"]
    volumes:
      - redis_data:/data
    restart: unless-stopped

  api:
    build: ../api
    env_file: ../.env
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_started
    ports: ["8080:8080"]
    restart: unless-stopped

  bot:
    build: ../bot
    env_file: ../.env
    depends_on:
      - api
      - redis
    volumes:
      - bot_store:/app/.wa_store   # Simpan sesi Baileys (QR pairing)
      - uploads:/app/uploads       # Media (gambar progress, invois PDF)
    restart: unless-stopped

  web:
    build: ../web
    env_file: ../.env
    depends_on: [api]
    ports: ["3000:3000"]
    restart: unless-stopped

volumes:
  db_data:
  redis_data:
  bot_store:
  uploads:
```

* **Postgres**: Gunakan env `POSTGRES_*` rasmi; volume untuk data persisten. Direktori `infra/db/init` dimount ke `docker-entrypoint-initdb.d` supaya **skema + seed** dimasukkan automatik bila volume `db_data` kosong.
* **Redis**: Simpan AOF dan jalankan jobs (BullMQ) untuk reminder 1/20/30 hari.
* `bot_store`: elak hilang sesi Baileys bila container restart. (Baileys gunakan protokol WhatsApp Web, bukan pelayar automasi.)

---

## 4) Fail `.env` (templat)

> Salin `cp .env.example .env` kemudian isi:

```
# API
PORT=8080
DATABASE_URL=postgresql://app:app@db:5432/app
REDIS_URL=redis://redis:6379

# WhatsApp (Baileys)
BOT_PORT=8081
WA_STORE_PATH=/app/.wa_store

# Web
WEB_PORT=3000
VITE_API_URL=http://localhost:8080
VITE_BOT_URL=http://localhost:8081

# (Opsyenal) SSO - Keycloak OIDC
# OIDC_ISSUER_URL=http://keycloak.local/realms/myrealm
# OIDC_CLIENT_ID=web-spa
# OIDC_REDIRECT_URI=http://localhost:3000/oidc/callback
```

* Pembolehubah OIDC dikekalkan sebagai rujukan jika anda mahu sambung kepada **Keycloak** pada masa akan datang.

---

## 5) Pasang & Jalankan (Quick Start)

```bash
# 0) sediakan fail persekitaran
cp .env.example .env

# 1) dari root repo
cd infra

# 2) bina & hidupkan semua servis
docker compose build
docker compose up -d

# 3) semak log
docker compose logs -f db api bot web
```

> Rujuk rujukan Compose/CLI rasmi jika perlu.

---

## 6) Seed Database & Migrasi

* **Auto-init:** bila kontena `db` pertama kali naik (volume baharu), fail dalam `infra/db/init/*.sql` akan dijalankan – mencipta jadual CRM/Tiket/POS dan memasukkan contoh produk + pelanggan.
* **Manual/dev:** untuk jalankan semula skema pada DB sedia ada:

```bash
# dari direktori infra/
cat db/init/01-schema.sql | docker compose exec -T db psql -U app -d app
cat db/init/02-seed.sql   | docker compose exec -T db psql -U app -d app
```

API turut melakukan `CREATE TABLE IF NOT EXISTS` dan seed asas (`products`) ketika boot (selamat untuk ulang run).

---

## 7) Endpoint Utama (Ringkasan)

| Modul | Endpoint | Kaedah | Fungsi |
| --- | --- | --- | --- |
| Kesihatan | `/health` | GET | Semak status API ⇄ DB ⇄ Redis |
| CRM | `/customers` | GET | Senarai pelanggan (nama, telefon, emel) |
| Tiket | `/tickets` | GET | Senarai tiket + info pelanggan + status |
|  | `/tickets/:id` | GET | Butiran tiket (nota & log kemaskini) |
|  | `/tickets` | POST | Cipta tiket baharu + auto-schedule reminder 1/20/30 hari |
|  | `/tickets/:id` | PATCH | Ubah status/anggaran/nota, tambah log |
| POS | `/products` | GET | Senarai produk/inventori |
|  | `/products` | POST | Tambah/kemaskini produk berdasarkan SKU |
|  | `/products/:id` | PATCH | Ubah nama/harga/stok |
|  | `/sales` | GET | Senarai jualan + item + pelanggan |
|  | `/sales` | POST | Rekod transaksi POS, tolak stok, jana invois `INV-YYYY-#####` |
| Jobs | `/jobs/reminders` | POST | (Opsyenal) Trigger manual penjadualan BullMQ |

Semua permintaan `POST/PATCH` menggunakan `application/json` dan divalidasi oleh **Zod**.

---

## 8) Pairing WhatsApp (Baileys)

1. Pastikan `bot` sedang berjalan.
2. **Cara A (terminal):** Tonton log dan imbas QR yang dipaparkan oleh Baileys:

   ```bash
   docker compose logs -f bot
   ```
3. **Cara B (UI):** Buka **Web UI** dan gunakan seksyen **"WhatsApp Pairing"** pada papan pemuka untuk imbas kod QR yang dihasilkan bot.
4. Selepas berjaya, sesi disimpan dalam volume `bot_store`.

> Baileys menggunakan **WebSocket** (bukan Selenium/Chrome) dan kerap ada **breaking changes** — pastikan versi dipin & ikut nota migrasi repo rasmi.

---

## 9) Akses UI & API

* **Web UI:** [http://localhost:3000](http://localhost:3000) (React SPA).
* **API:** [http://localhost:8080](http://localhost:8080) (REST).
* Login admin/staf akan bergantung pada seed/SSO.

---

## 10) Cetak Resit Thermal (QZ Tray)

Untuk cetakan resit POS terus dari pelayar (silent print / ESC-POS):

1. Pasang **QZ Tray** pada PC kaunter.
2. Ikuti panduan **Print Server / HTTPS cert** jika mahu komunikasi selamat.
3. Uji dengan `sample.html` yang datang bersama pemasangan QZ Tray.

> QZ Tray membolehkan aplikasi web menghantar kerja cetakan terus ke pencetak.

---

## 11) (Opsyenal) Pembayaran Malaysia

* **FPX (Stripe):** aktifkan di Stripe Dashboard & integrasi `Elements/Checkout`. Hanya untuk peniaga berdaftar di Malaysia.
* **DuitNow QR (PayNet):** ikut spesifikasi **Merchant-Presented QR** (statik/dinamik) melalui pemeroleh (acquirer) anda.

---

## 12) Reminder Jobs (1/20/30 hari)

* Konfigurasi **BullMQ** (Redis) di `api` untuk menjadualkan notifikasi *follow-up* (idempotent, retry/backoff).
* Pastikan `REDIS_URL` betul dan worker berjalan.

---

## 12) SSO & Peranan (Opsyenal)

* Jalankan Keycloak (Docker) atau gunakan Keycloak sedia ada.
* Cipta **Realm** & **Client (SPA)**, ambil `issuer`, `authorization_endpoint`, `token_endpoint`, dsb., dan masukkan ke `.env`.

---

## 13) PWA (Mod Kiosk/Kaunter)

* UI diset supaya **installable PWA** (manifest + service worker + HTTPS).
* Semak kriteria pemasangan & sokongan pelayar.

---

## 14) Aksesibiliti (WCAG 2.2)

* Sasarkan tahap **AA** (kontras, fokus, navigasi papan kekunci, mesej ralat jelas).

---

## 15) Backup ke Synology (Disyorkan)

1. Pada Synology DSM → **Package Center → Hyper Backup**.
2. **Create Data Backup Task**, pilih destinasi (NAS lain/USB/awan), pilih folder volume Docker & eksport dump DB.
3. Jadualkan (harian/mingguan) dan uji **restore** berkala.

---

## 16) Pemerhatian (Opsyenal tapi disyorkan)

* **OpenTelemetry (Node.js):** aktifkan traces/metrics untuk `api`/`bot`.
* **Sentry self-hosted** (jika mahu host on-prem): perlukan Docker & Compose versi minimum + sumber memori mencukupi.

---

## 17) Keselamatan & Amalan Baik

* **Pin versi** Baileys & dependencies; awasi nota migrasi.
* Guna **secrets**/`.env` (jangan commit).
* Had kadar mesej keluar untuk elak spam/ban nombor WA.
* Had akses dengan **RBAC** (peranan Admin/Staf/Boss/Pelanggan).
* Sandarkan volume & **uji pemulihan**.

---

## 18) Ujian Asas (Sanity Check)

```bash
# API sihat?
curl -i http://localhost:8080/health

# Web UI terbuka?
xdg-open http://localhost:3000  # (Linux) atau open (macOS)

# Redis OK?
docker compose exec redis redis-cli ping

# Postgres OK?
docker compose exec db psql -U app -d app -c "\dt"
```

---

## 19) Menyelenggara

* **Naik taraf imej**:

  ```bash
  docker compose pull
  docker compose up -d
  ```
* **Backup manual DB** (contoh):

  ```bash
  docker compose exec db pg_dump -U app app > ./infra/backup/app-$(date +%F).sql
  ```

---

## 20) Soal Jawab Ringkas

**S: QR tak muncul di log bot?**
J: Pastikan `bot` boleh akses internet & `WA_STORE_PATH` wujud. Cuba `docker compose restart bot`. Baileys memaparkan QR untuk **WhatsApp Web multi-device** melalui WebSocket.

**S: Cetak resit tak keluar?**
J: Pastikan **QZ Tray** sedang berjalan & sijil HTTPS diset jika perlu; uji dengan `sample.html`.

**S: Compose command yang betul?**
J: Gunakan `docker compose` (Compose v2).

---

## 21) Halaman Rujukan

* **Docker Compose** (definisi & rujukan spec).
* **Postgres** (Docker Official Image + contoh).
* **Redis** (Docker/Run guide).
* **Baileys** (docs, npm, repo & breaking changes).
* **react-admin** (UI admin data-heavy).
* **Keycloak OIDC** (SSO).
* **QZ Tray** (pemasangan/HTTPS/print).
* **BullMQ** (jobs & penjadualan).
* **Synology Hyper Backup** (Quick Start + task).
* **OpenTelemetry (Node.js)** (getting started).
* **PWA install criteria** (web.dev).
* **WCAG 2.2** (garis panduan).

---
