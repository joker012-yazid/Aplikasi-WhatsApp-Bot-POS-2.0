Berikut **rumusan TERKINI** sistem **Aplikasi + UI Web** yang akan kita bina — sejajar dengan SOP anda, siap untuk **on-prem** dan **Docker**.

# 1) Matlamat & Hasil

Satu platform bersepadu merangkumi **WhatsApp Bot (Baileys)**, **POS**, **Tiket Kerja**, **Borang QR Intake**, **CRM**, **Dashboard/Laporan**, serta **Backup ke Synology**, dengan **UI web** mesra peranan (Admin, Staf, Boss, Pelanggan). Bot menggunakan **Baileys** (pairing QR, berasaskan event/WebSocket), yang memudahkan terima/hantar mesej serta hook automasi. ([Baileys][1])

# 2) Modul Teras

* **WhatsApp Bot (Baileys)**: Auto-balas, status tiket, hantar invois/resit, reminder 1/20/30 hari; kita pin versi & ikut nota “breaking changes” repo rasmi. ([GitHub][2])
* **POS**: Jualan tunai/kad, cetak resit, inventori asas, laporan harian/mingguan.
* **Tiket Kerja**: Dicipta oleh staf atau auto dari mesej WA; alur status jelas (Dropped-off → Diagnosing → Waiting Approval → Approved/Rejected → In Repair → Ready → Closed).
* **Borang + QR Intake**: Daftar servis/aduan; data terus masuk CRM & boleh trigger tiket.
* **CRM**: Profil pelanggan, sejarah pembelian (link POS), log interaksi WA & rekod tiket.
* **Jobs/Reminder**: Guna **BullMQ + Redis** untuk kerja latar, jadual, retry/backoff yang stabil. ([docs.bullmq.io][3])
* **Backup**: **Synology Hyper Backup** untuk versi berbilang generasi & destinasi pelbagai (local/remote/cloud). ([Synology Knowledge Center][4])

# 3) Aliran Kerja (ringkas ikut SOP)

1. **QR Intake** → cipta tiket + mesej terima.
2. **Diagnosis** → hantar ringkasan masalah + anggaran; tunggu *Setuju/Tak setuju*.
3. **Setuju** → **In Repair** (update + gambar) ; **Tak setuju** → **Waiting Pickup**.
4. **Siap** → **Ready for Pickup** + invois/resit; **POS** sahkan bayaran → **Closed**.
5. **Reminder auto** jika tiada respons: **1/20/30 hari**.

# 4) Senibina & Teknologi

* **Kontena & Orkestrasi**: **Docker Compose** untuk takrif & jalankan multi-container (api, bot, web, db, redis) dengan rangkaian dalaman & volumes persisten. ([Docker Documentation][5])
* **Backend API**: Node.js (Express/NestJS) — non-blocking, sesuai trafik masa nyata.
* **Bot**: Servis Node.js terpisah menggunakan Baileys (event-driven). ([Baileys][1])
* **Frontend (UI Web)**: **React**; untuk panel data-heavy kita gunakan **react-admin** (senarai/borang/sort/filter, auth, dsb.) agar pantas bina & konsisten. ([Marmelab][6])
* **SSO & Peranan**: **Keycloak (OIDC)** untuk login terpusat, token, serta kawalan akses berasaskan peranan. ([Keycloak][7])
* **Cetak Resit**: **QZ Tray** membolehkan cetakan terus dari browser (PDF/HTML/ESC-POS) untuk pencetak thermal. ([Quartz][8])
* **Aksesibiliti**: Patuhi **WCAG 2.2** (fokus, navigasi, ralat jelas) agar UI mesra staf & pelanggan. ([W3C][9])

# 5) Reka Bentuk UI Web (ringkas)

* **Peranan & Navigasi**

  * *Admin*: tetapan sistem/role, WhatsApp pairing, templat mesej, SLA reminder, audit.
  * *Staf*: papan tiket (kanban+list), POS checkout, form diagnosis, upload gambar, pelanggan/CRM.
  * *Boss*: dashboard KPI (jualan, approval rate, SLA respon, backlog).
  * *Pelanggan*: portal mini (status tiket / borang).
* **Pola UI Utama**

  * Jadual data dengan carian, penapis, sort, **saved views**; borang dengan **inline validation**; **skeleton states** semasa loading; **toast/snackbar** untuk maklum balas cepat.
  * **Cetak resit** satu klik (QZ Tray) pada halaman Invois/Checkout. ([Quartz][10])
  * **Akses mudah alih** (responsive) & sedia **PWA** untuk mod kaunter/kiosk.

# 6) Deliverables

* **Repo skeleton**: `/api`, `/bot`, `/web`, `/infra`
* **`docker-compose.yml`** + `.env.example` (DB/Redis/Volumes/Ports) — *compose up* sekali jalan. ([Docker Documentation][5])
* **Skema DB** (SQL) + seed asas (produk/role).
* **Templat mesej WA** (intake/quote/progress/ready/reminders).
* **Skrip backup** (DB dump) + nota Hyper Backup (NAS Synology). ([Synology Knowledge Center][11])
* **Panduan pasang ringkas** (README).

# 7) Roadmap Ringkas

* **MVP**: Bot Baileys, POS asas, CRM minimal, Tiket, QR Intake, Jobs/Reminder (BullMQ), Compose, Backup. ([Baileys][1])
* **Fasa 2**: Cetak resit thermal (QZ Tray), laporan lanjutan, portal pelanggan. ([Quartz][8])
* **Fasa 3**: SSO penuh (Keycloak), kebolehcapaian WCAG 2.2, multi-cawangan & AI. ([Keycloak][7])
