# Stick Run

像素風火柴人跳尖刺小遊戲，純 HTML + CSS + JavaScript，沒有任何套件或建置步驟。

- 跳躍：空白鍵、↑、W、Enter，或直接點擊／觸碰畫面
- 計分：每秒固定 +10 分
- 難度：每累積 500 分，尖刺逼近的速度加快一級
- 最高分會存在瀏覽器的 localStorage

## 檔案

| 檔案 | 用途 |
| --- | --- |
| `index.html` | 頁面結構 |
| `style.css` | 版面與像素風外框 |
| `game.js` | 遊戲邏輯與所有像素繪圖 |

## 部署到 GitHub Pages

1. 在 GitHub 建立新 repository（例如 `stick-run`），設為 Public。
2. 把這三個檔案（加上 README.md）放到 repository 根目錄。
   - 網頁操作：進入 repo → **Add file → Upload files** → 拖曳檔案 → **Commit changes**。
   - 或用 git：
     ```bash
     git init
     git add .
     git commit -m "Add Stick Run"
     git branch -M main
     git remote add origin https://github.com/<你的帳號>/stick-run.git
     git push -u origin main
     ```
3. 到 repo 的 **Settings → Pages**。
4. **Build and deployment** 的 Source 選 **Deploy from a branch**，Branch 選 `main`、資料夾選 `/ (root)`，按 Save。
5. 等一兩分鐘，重新整理該頁面，上方會出現網址：
   `https://<你的帳號>.github.io/stick-run/`

之後每次 push 到 `main`，網站會自動更新。

## 調整難度

所有數值都在 `game.js` 最上方的 `CFG`：

- `baseSpeed`：起始速度
- `speedStep`：每 500 分增加多少速度
- `maxSpeed`：速度上限（改成很大的數字就等於不封頂）
- `gravity`、`jumpVelocity`：跳躍手感
