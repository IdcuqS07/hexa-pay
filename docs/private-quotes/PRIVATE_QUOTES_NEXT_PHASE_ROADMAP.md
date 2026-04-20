# Private Quotes Next-Phase Roadmap

Companion roadmap untuk workstream private quotes setelah bootstrap receipt + `mock-api` phase.

Roadmap ini sengaja lebih taktis dari [ROADMAP_HEXAPAY.md](../../ROADMAP_HEXAPAY.md) supaya bisa dipakai sebagai urutan kerja harian.

## Current Baseline

Sudah tersedia saat roadmap ini dibuat:

- merchant, payer, dan auditor flow bootstrap sudah hidup
- receipt store punya 3 mode: `local`, `mock-registry`, `mock-api`
- `mock-api` projection sudah dipindah ke service
- projected receipt sudah punya metadata additive `accessBridge`
- UI merchant, payer, dan auditor sudah membaca source of truth mode yang sama

## Goal

Geser private quotes dari bootstrap receipt mock menuju selective disclosure yang permit-aware, tanpa mengubah kontrak UI besar yang sudah stabil.

## Working Rules

- pertahankan shape UI yang sudah dipakai merchant, payer, dan auditor
- semua perubahan baru masuk lewat store, service, policy, atau access bridge
- additive metadata lebih diprioritaskan daripada breaking change
- setiap milestone harus punya verifikasi build dan smoke test yang jelas

## Milestone 1: Client Permit Bridge

Objective:
- alirkan permit context nyata dari runtime ke `ApiReceiptStore`

Tasks:
- [x] definisikan helper untuk membentuk receipt access context dari runtime aktif
- [x] kirim `accessToken`, `permitHash`, dan `permitPublicKey` dari adapter API
- [x] pastikan `mock-api` GET flow menerima context yang sama untuk merchant, payer, dan auditor
- [x] simpan fallback aman saat permit belum tersedia

Exit criteria:
- `mock-api` read path membawa bridge context tanpa mengubah UI
- receipt projection masih identik untuk user yang belum punya permit

## Milestone 2: Service-Side Projection Policy

Objective:
- jadikan service sebagai tempat keputusan disclosure, bukan UI

Tasks:
- [x] rapikan contract antara canonical receipt, viewer context, dan projected receipt
- [x] pisahkan policy evaluation dari transport middleware
- [x] tambahkan policy branch untuk `full`, `limited`, dan `denied`
- [x] definisikan error/state untuk viewer yang context-nya tidak cukup

Exit criteria:
- service bisa menjawab projection berdasarkan role + context
- masking auditor tidak lagi hardcoded sebagai satu-satunya limited strategy

## Milestone 3: Permit-Aware Selective Disclosure

Objective:
- mulai ganti limited mock projection dengan disclosure yang ditentukan policy

Tasks:
- [x] tentukan field receipt mana yang public, masked, sealed-handle, atau permit-required
- [x] tambahkan shape metadata disclosure per field di projection
- [x] hubungkan `accessBridge` dengan viewer scope yang lebih spesifik
- [x] definisikan fallback bootstrap bila decrypt belum tersedia

Exit criteria:
- projection sudah bisa membedakan field yang langsung terlihat vs butuh permit
- auditor route tetap jalan meski decrypt final belum aktif

## Milestone 4: Receipt Source of Truth Hardening

Objective:
- siapkan perpindahan dari browser-local receipt ke source of truth bersama

Tasks:
- [x] tentukan contract untuk canonical receipt persistence di backend/shared registry
- [x] bedakan event settlement, canonical record, dan projected read model
- [x] tambahkan versioning untuk canonical receipt schema
- [x] siapkan strategi migrasi dari `local` dan `mock-registry`

Exit criteria:
- store factory siap diarahkan ke backend/shared adapter berikutnya
- receipt browser-local tidak lagi dianggap final source of truth

## Milestone 5: Verification And Operational Readiness

Objective:
- buat phase berikutnya gampang diuji dan di-demo

Tasks:
- [x] tambah smoke test untuk service projection lintas role
- [x] tambah smoke test untuk API adapter dengan dan tanpa permit bridge
- [x] update acceptance doc setiap milestone selesai
- [x] siapkan demo script untuk merchant, payer, dan auditor paths

Exit criteria:
- setiap milestone punya bukti verifikasi yang bisa diulang
- dokumentasi selaras dengan implementasi terakhir

## Suggested Execution Order

1. Milestone 1 dulu
2. lanjut Milestone 2
3. baru Milestone 3
4. setelah itu Milestone 4
5. Milestone 5 berjalan terus sebagai pendamping

## Out Of Scope For Now

- redesign besar merchant/payer/auditor UI
- receipt download/export final
- full cryptographic enforcement end-to-end di satu langkah
- backend production auth model final

## Definition Of Done For This Roadmap

Roadmap ini dianggap selesai jika:

- UI tetap stabil
- projection decision sepenuhnya hidup di service/policy layer
- permit bridge nyata sudah mengalir dari client ke API mode
- selective disclosure tidak lagi sekadar mask statis
- backend/shared source of truth siap menggantikan bootstrap storage

## Post-Baseline Hardening

Sudah masuk setelah roadmap inti selesai:

- [x] challenge registry dipisah menjadi adapter shareable
- [x] canonical receipt registry dipisah menjadi adapter shareable
- [x] JSON state-store seam diberi revision + optimistic conflict handling
- [x] service/plugin/registry dibuat async-compatible untuk persistence backend
- [x] HTTP-backed state-store adapter dan internal `_state` control plane tersedia untuk simulasi persistence remote
- [x] shared receipt/challenge registries sekarang bisa dikonfigurasi langsung ke mode `http`

Next up yang paling natural:

- [ ] ganti internal `_state` control plane ini dengan backend/KV/shared cache adapter nyata
- [ ] tambahkan auth atau signer policy untuk state-store control plane non-dev
- [ ] pertimbangkan pruning/retention policy untuk canonical receipt registry di backend
