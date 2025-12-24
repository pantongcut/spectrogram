# Two-Pass Detection 實現總結（2025）

## 概述
已完成業界標準的 **Two-Pass Detection** (兩階段偵測) 優化方案的完整實現。該方案適用於長錄音檔的高效蝙蝠叫聲偵測。

### 核心原理
1. **PASS 1 (快速掃描)**：用低解析度、低重疊率的 FFT 快速掃描能量，找出感興趣區域 (ROI)
2. **PASS 2 (精細偵測)**：只對 ROI 區域進行高解析度的詳細分析
3. **結果**：大幅降低計算時間，同時保持偵測精度

---

## 修改詳述

### 1. `modules/batCallDetector.js`

#### 1.1 BatCall 類修改
- **新增屬性**：`frequencyContour = []`
  - 儲存平滑的頻率軌跡：`{ time_s, freq_kHz, power_dB }`
  - 用於 Peak Mode 視覺化

- **修改 `applyTimeExpansion()` 方法**
  - 新增時間膨脹修正邏輯，同步轉換 `frequencyContour` 中的時間和頻率

#### 1.2 BatCallDetector 類新增方法

**`processFullFile(fullAudioData, sampleRate, flowKHz, fhighKHz, options)`**
- 對完整音頻檔案進行 Two-Pass 偵測
- 參數：
  - `fullAudioData`: 完整音頻數據 (Float32Array)
  - `sampleRate`: 採樣率
  - `flowKHz`, `fhighKHz`: 頻率範圍
  - `options.threshold_dB`: 快速掃描閾值 (預設 -60dB)
  - `options.padding_ms`: 前後 Padding (預設 5ms)
  - `options.progressCallback`: 進度回呼函數

- 流程：
  1. 執行 `fastScanSegments()` 找出所有信號區段
  2. 執行 `mergeAndPadSegments()` 合併重疊並添加 Padding
  3. 對每個 ROI 區段執行 `detectCalls()` 進行詳細偵測
  4. 修正時間偏移，返回全檔偵測結果

**`fastScanSegments(audioData, sampleRate, flowKHz, fhighKHz, threshold_dB)`**
- 快速掃描音頻找出能量超過閾值的區段
- 使用 512 點 FFT 和 50% Overlap (256 點跳躍) 以加速
- 時域 RMS 預檢以進一步優化

**`mergeAndPadSegments(segments, totalSamples, sampleRate, padding_ms)`**
- 合併重疊的區段並添加前後 Padding
- 確保不漏掉任何可能的蝙蝠叫聲

#### 1.3 `measureFrequencyParameters()` 修改
- 新增頻率軌跡提取邏輯
- 在計算完所有頻率參數後，填充 `call.frequencyContour`
- 使用已計算的 `smoothedFrequencies` (Savitzky-Golay 平滑處理)
- 提取每幀的時間、平滑頻率和功率值

---

### 2. `modules/spectrogram.esm.js`

#### 2.1 新增方法

**`setBatCalls(calls)`**
- 接收外部傳入的偵測結果 (BatCall 數組)
- 儲存在 `this.detectedBatCalls`
- 如果 Peak Mode 開啟，觸發重繪

**`drawSmartPeakOverlay(ctx, canvasWidth, drawY, drawH, calls)`**
- 繪製平滑的頻率輪廓線
- 根據品質評級著色：
  - 綠色：Good/Excellent
  - 黃色：Normal
  - 橙/紅色：Poor/Very Poor
- 使用 Canvas 線條繪製 (lineJoin='round', lineCap='round')

#### 2.2 修改 `drawSpectrogram()` 方法
- 在 Peak Mode 繪製後添加 Smart Contour 繪製邏輯
- 如果有 `detectedBatCalls`，呼叫 `drawSmartPeakOverlay()`

---

### 3. `modules/wsManager.js`

#### 3.1 Import 修改
- 新增 import：`import { defaultDetector } from './batCallDetector.js';`

#### 3.2 全局變數
- 新增 `isDetecting` flag 防止並發偵測

#### 3.3 修改 `setPeakMode(peakMode)` 函數
- 當開啟 Peak Mode 時，自動觸發全檔掃描
- 邏輯流程：
  1. 獲取 WaveSurfer 音頻緩衝區
  2. 設置防呆標誌 `isDetecting = true`
  3. 異步執行 `defaultDetector.processFullFile()`
  4. 將偵測結果傳給 Plugin (`plugin.setBatCalls()`)
  5. 處理完成或錯誤後清除標誌

---

## 效能優化特點

### 快速掃描優化
- **FFT 大小**：512 點 (vs. 1024 點詳細偵測)
- **Hop Size**：256 點 (50% Overlap，vs. 96.875% 詳細偵測)
- **時域預檢**：RMS 能量評估，提前過濾靜音區域
- **預期效果**：掃描速度提升 4-8 倍

### 區段合併策略
- 自動合併重疊區段
- 添加可配置的前後 Padding (預設 5-10ms)
- 避免在區段邊界切割信號

### 完整性保證
- 所有時間參數自動修正 (相對 → 絕對)
- `frequencyContour` 時間座標同步修正
- 支援 Time Expansion 模式

---

## 使用流程

### 開啟 Peak Mode 時的自動流程
1. 用戶在 UI 點擊 "Peak Mode" 開關
2. `setPeakMode(true)` 被觸發
3. 自動呼叫 `processFullFile()` 開始偵測
4. 偵測結果通過 `plugin.setBatCalls()` 傳入
5. Spectrogram 繪製平滑的頻率輪廓線

### 可選：手動呼叫
```javascript
import { defaultDetector } from './modules/batCallDetector.js';

const calls = await defaultDetector.processFullFile(
    audioBuffer.getChannelData(0),
    audioBuffer.sampleRate,
    10,    // 10 kHz
    128,   // 128 kHz
    { threshold_dB: -60, padding_ms: 5 }
);
```

---

## 相容性說明

- ✅ 完全復用現有 `detectCalls()` 邏輯
- ✅ 保留所有現有頻率參數計算
- ✅ 支援 Anti-Rebounce 機制
- ✅ 支援 Time Expansion 模式
- ✅ 支援 SNR 計算
- ✅ 與現有 UI 無縫整合

---

## 後續優化建議

1. **WASM 加速**：若 WASM 支援自定義 Hop Size，可直接用 WASM FFT 加速快速掃描
2. **適應性閾值**：根據檔案統計特性自動調整掃描閾值
3. **多執行緒/Worker**：利用 Web Worker 並行處理多個 ROI 區段
4. **快取機制**：檔案未改變時重用上次偵測結果
5. **進度 UI**：詳細的進度條和即時統計顯示

---

## 驗證信息

- 文件：已通過 VS Code 語法檢查
- 所有新方法均遵循現有代碼風格
- 所有時間參數計算均已驗證
