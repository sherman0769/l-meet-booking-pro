# l-meet-booking-pro

## 一、專案概要

l-meet-booking-pro 是一套預約系統，整合前台預約流程、Firebase / Firestore、Google Calendar、管理後台、sync_jobs 補償機制，以及 LINE alert / webhook。專案正式預約資料流主要走 `booking-service`，calendar 操作失敗會轉由 `sync_jobs` 做重試補償，不依賴 legacy 直接寫入 API。

## 二、核心架構

- 前台預約：使用者透過 UI 提交預約資料，建立流程會進入 booking-service。
- Firestore booking slots：預約資料儲存在 Firestore（`bookings` 等集合）。
- Google Calendar 同步：建立、改期、取消會嘗試與 Google Calendar 同步。
- `calendarSyncStatus`：記錄同步狀態，方便管理端判讀是否已同步。
- `sync_jobs` 失敗補償：當 Calendar 寫入失敗會建立補償任務，透過重試補上。
- Admin 後台：提供 Booking 管理、同步補償管理、OAuth 狀態與聯絡狀態更新。
- LINE：
  - `/api/line/webhook` 僅做簽章驗證與解析，保護 webhook 入口。
  - `LINE` alert 作為補償監控與通知機制（可於環境控制開關）。

## 三、本機啟動

```bash
npm install
npm run dev
npm run lint
npm run build
npm run start
```

## 四、Package Scripts

| 指令 | 用途 |
|---|---|
| `dev` | 啟動開發伺服器 |
| `build` | 建置 Next.js 專案 |
| `start` | 啟動正式模式 server |
| `lint` | 執行 ESLint |

## 五、環境變數矩陣

### 基礎 / admin / Firebase

| 變數名稱 | 用途 | 備註 |
|---|---|---|
| `ADMIN_PASSWORD` | 管理員登入密碼來源 | admin 登入 API 需要 |
| `ADMIN_SESSION_SECRET` | 管理員 session 簽章 | 驗證 admin session cookie |
| `FIREBASE_PROJECT_ID` | Firebase Admin 專案 ID | 用於取得 admin firestore |
| `FIREBASE_CLIENT_EMAIL` | Firebase Admin service account email | 用於簽章初始化 |
| `FIREBASE_PRIVATE_KEY` | Firebase Admin 私鑰 | 用於簽章初始化 |
| `NODE_ENV` | 運行環境 | 用於生產/測試行為切換 |

### Google Calendar / OAuth

| 變數名稱 | 用途 | 備註 |
|---|---|---|
| `GOOGLE_CLIENT_ID` | Google OAuth client id | 與 callback/授權流程配套 |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret | 與 callback/授權流程配套 |
| `GOOGLE_REDIRECT_URI` | OAuth callback URL | 與 callback route 對應 |
| `GOOGLE_CALENDAR_ID` | 預設 Calendar ID | 用於事件寫入/查詢 |
| `GOOGLE_REFRESH_TOKEN` | OAuth fallback token | 為 legacy fallback，建議以 Firestore `system_config/google_oauth` 為主 |
| `GOOGLE_BLOCKING_CALENDAR_IDS` | busy 查詢附加行事曆 | 以逗號分隔 |

### Internal / Cron

| 變數名稱 | 用途 | 備註 |
|---|---|---|
| `CRON_SECRET` | internal API bearer 驗證 | 用於 auto-retry / legacy calendar test |
| `AUTO_RETRY_DRY_RUN_SECRET` | auto-retry dry-run 額外授權 | 僅 dry-run 使用 |
| `AUTO_RETRY_DRY_RUN_ALLOW_PRODUCTION` | 生產環境 dry-run 權限開關 | 可控是否允許 production 觸發 dry-run |

### LINE

| 變數名稱 | 用途 | 備註 |
|---|---|---|
| `LINE_CHANNEL_SECRET` | webhook signature 驗證 | 用於 `x-line-signature` 驗證 |
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE push token | 發送 LINE 管理訊息 |
| `LINE_ADMIN_TO` | LINE 管理者接收人 | 管理者帳號 |
| `LINE_ALERT_ENABLED` | 是否啟用 LINE alert | 可控制預覽/測試階段是否發訊 |
| `LINE_TEST_SECRET` | 內部 LINE 測試授權 | 配合 `x-line-test-secret` |
| `LINE_TEST_ALLOW_PRODUCTION` | production LINE test 開關 | 生產環境安全控制 |

### LLM parser

| 變數名稱 | 用途 | 備註 |
|---|---|---|
| `LLM_API_KEY` | 外部 LLM API Key | 非必備，失敗時 fallback 到規則 parser |
| `LLM_API_URL` | 外部 LLM endpoint | 非必備 |
| `LLM_MODEL` | 外部 LLM model | 非必備 |

### Rate limit / Upstash

| 變數名稱 | 用途 | 備註 |
|---|---|---|
| `UPSTASH_REDIS_REST_URL` | 建立預約 Rate limit Redis endpoint | 無設定時 fallback 到 memory limit |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash 存取 token | 無設定時 fallback 到 memory limit |

### 核心規則

- Google OAuth credential priority：`system_config/google_oauth`（Firestore）→ `GOOGLE_* env` fallback → 無法建立則報錯。
- `GOOGLE_REFRESH_TOKEN` 為 legacy fallback，不建議作為主要部署長期來源。
- `UPSTASH_*` 未設定時，`/api/bookings/create` 會退回 in-memory 的 rate limit；Production 建議設定 Upstash。

## 六、Route 權限矩陣

### Public routes

| route | 說明 |
|---|---|
| `POST /api/bookings/create` | 前台建立預約，會進入 booking-service |
| `POST /api/ai/parse-booking` | 預約意圖解析（AI / rule fallback） |
| `POST /api/calendar/busy` | 查詢 busy，驗證 `YYYY-MM-DD` 且限制 0~90 天 |
| `GET /api/service-buffers` | 讀取服務 buffer（前台共用設定） |
| `POST /api/line/webhook` | webhook 入口，需 LINE `x-line-signature` 驗證 |
| `GET /api/auth/google` | Google OAuth 啟動入口 |
| `GET /api/auth/callback` | Google OAuth callback |
| `POST /api/admin/login` | 管理員登入（建置 admin session） |
| `POST /api/admin/logout` | 管理員登出 |

### Admin routes

| route | 說明 |
|---|---|
| `GET /api/admin/service-buffers` | admin 取得 service-buffers 設定 |
| `POST /api/admin/service-buffers` | admin 寫入 service-buffers |
| `GET /api/admin/sync-jobs` | 查詢待補償清單 |
| `POST /api/admin/sync-jobs/retry` | 管理員手動 retry sync job |
| `POST /api/admin/sync-jobs/dismiss` | 管理員忽略 sync job |
| `GET /api/admin/oauth-calendar-status` | 管理員查詢 Calendar OAuth 狀態 |
| `POST /api/admin/update-contact-status` | 更新 booking 聯絡狀態 |
| `POST /api/bookings/reschedule` | admin 改期 |
| `POST /api/bookings/cancel` | admin 取消 |
| `POST /api/bookings/resync` | admin 補同步 |

### Internal routes

| route | 說明 |
|---|---|
| `GET/POST /api/internal/sync-jobs/auto-retry` | 內部補償排程入口，含 dry-run 控制 |
| `POST /api/internal/line/test` | 內部 LINE 測試入口 |

### Deprecated legacy routes

| route | 說明 |
|---|---|
| `POST /api/calendar/create-booking-event` | deprecated legacy admin route（已加 admin-only） |
| `POST /api/calendar/update-event` | deprecated legacy admin route（已加 admin-only） |
| `POST /api/calendar/delete-event` | deprecated legacy admin route（已加 admin-only） |
| `GET /api/calendar/test` | internal legacy test route，需 `CRON_SECRET`，production 下直接 403 |

## 七、人工驗收流程摘要

- service-buffers：確認 `GET /api/service-buffers` 可回傳預設/儲存值；admin 端 `POST /api/admin/service-buffers` 能更新。
- LINE webhook signature：未帶/錯誤 `x-line-signature` 應拒絕，簽章正確才會進入 JSON parse 與 log。
- Calendar routes：
  - `busy` 合法日期回傳 200；缺少或格式錯誤/超 90 天回 400。
  - legacy 寫入路由（create/update/delete）未登入 admin 需 401。
  - `/api/calendar/test` 在 local/staging 需 `CRON_SECRET`，production 直接 403。
- booking 流程：依序驗證 create、reschedule、cancel、resync 可正常執行且回傳預期結果。

> 詳細操作步驟請依 `docs/runbook.md`。

## 八、部署前檢查

1. working tree 是否乾淨。
2. `npm run lint` 通過。
3. `npm run build` 通過。
4. 核對環境變數齊全（含 `GOOGLE` / admin / LINE / CRON / `NODE_ENV`）。
5. 確認 Google OAuth 與 Calendar 狀態正確。
6. 確認 staging / production 資源隔離（Firebase、Google、LINE）。
7. auto-retry 先跑 dry-run（非生產可先跑 dry-run 驗證）。

## 九、相關文件

- [docs/runbook.md](docs/runbook.md)
- [AGENTS.md](AGENTS.md)
- [docs/boot-prompt.md](docs/boot-prompt.md)
