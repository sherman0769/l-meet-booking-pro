# l-meet-booking-pro 操作手冊

> 本文件為專案唯一操作準則（single source of truth）。  
> 所有測試與部署流程應優先遵循此文件。

## 🔰 每次開工（必跑流程）
- [ ] 啟動專案：`npm run dev`
- [ ] 打開 `http://localhost:3000` 並確認可開
- [ ] 確認 `.env.local` 已載入
- [ ] 確認 LINE 狀態（`LINE_ALERT_ENABLED` 是否符合本次測試目標）
- [ ] 確認 dry-run 正常（僅使用 dry-run）

## 🧭 本次測試模式判斷
- 如果只是確認系統健康 → 使用 dry-run
- 如果要驗證 LINE → 使用 `/api/internal/line/test`
- 如果要驗證 auto-retry → 必須先確認 staging 安全條件

---

## 一、角色分工
- ChatGPT：負責架構判讀、風險控制、步驟設計
- Codex app：負責執行、改檔、測試
- 使用者：負責觸發流程與驗證結果

---

## 二、開工流程（Local）
### 啟動專案
```bash
npm run dev
```

確認：
- `http://localhost:3000` 可開
- `.env.local` 已載入

---

## 三、本地測試
### LINE 單次測試（Local）
- 僅限 local 使用 `sendLineAdminAlert()`
- 條件：
- `LINE_ALERT_ENABLED=true`
- 僅發送給自己

### LINE 測試（Staging）
- 使用：`POST /api/internal/line/test`

### auto-retry dry-run
- 路徑：`/api/internal/sync-jobs/auto-retry?dryRun=1`
- 用途：
- 不寫資料
- 不發 LINE
- 檢查 alert 判斷

---

## ⚠️ 環境切換注意事項
- local 與 staging env 不共用
- staging 預設不發 LINE（`LINE_ALERT_ENABLED=false`）
- staging 測試 LINE 前需確認接收者為自己

---

## 🌐 Staging 操作流程（一步一步）
### Step 1：部署
- 部署到 Vercel staging
- 先走 Phase 1（安全啟動）：`LINE_ALERT_ENABLED=false`

### Step 2：dry-run 驗證
- 僅測試 dry-run：`/api/internal/sync-jobs/auto-retry?dryRun=1`
- 驗證重點：回應正常、無資料寫入、副作用受控

### Step 3：LINE 測試
- 進入 Phase 2（LINE 測試）前，先確認僅發送給自己
- 開啟：`LINE_ALERT_ENABLED=true`
- 使用：`POST /api/internal/line/test`

### Step 4：進階測試（未來）
- 保留未來擴充（更完整的 staging 整合驗證）

---

## 🚨 不可以做的事情
- 不直接在 production 專案做任何測試（除非明確允許）
- 不直接打 auto-retry（非 dry-run）
- 不在 staging 用 production Firebase
- 不在 staging 用 production Google 設定
- 不把 LINE 發給正式使用者

---

## 五、安全規則
- 不直接測 auto-retry（除非使用 dry-run）
- LINE 僅發送給自己
- `LINE_ADMIN_TO=你的userId`
- staging 與 production 必須隔離：
- Firebase
- Google
- LINE

---

## 🧭 常用操作指令
- dry-run URL：`/api/internal/sync-jobs/auto-retry?dryRun=1`
- LINE test route：`POST /api/internal/line/test`
- git commit 指令：

```bash
git add <檔案路徑>
git commit -m "<type>: <message>"
```

---

## 六、常見錯誤
- `401`：`CRON_SECRET` 不一致
- `403`：dry-run 被 production gate 擋
- `404`：route 未部署
- LINE 不發：`LINE_ALERT_ENABLED=false`
- `to invalid`：`userId` 錯誤

## 🛠 問題排查順序
1. 確認 URL 是否正確（local / staging）
2. 確認 env 是否載入（尤其 `CRON_SECRET`）
3. 確認 deployment 是否最新
4. 確認是否誤用 production 專案
5. 再看錯誤碼（`401` / `403` / `404`）

---

## 七、目前系統狀態
- LINE：已驗證
- auto-retry：安全可測
- staging：已部署完成
