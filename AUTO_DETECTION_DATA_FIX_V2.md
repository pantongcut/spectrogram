# Auto Detection Mode - Data Access Fix v2.0

## 修復日期: 2025年12月20日
## 狀態: ✅ 完成

---

## 問題描述

### 症狀
使用者報告在啟用自動檢測模式時，控制台顯示：
```
Spectrogram data available: 1 frames x 4730 bins ❌ 只有 1 幀
Peak Max: 0.00 dB ❌ 應該是實際的峰值
```

### 根本原因
```javascript
// 錯誤的數據源
const spectrogramMatrix = plugin.lastRenderData;
// ❌ plugin.lastRenderData 是可視化輸出（單幀、重新採樣後）
// ❌ 不是完整的頻譜矩陣（所有時間幀）
```

---

## 修復方案

### 修復 1: 使用正確的數據源

**位置**: `modules/autoDetectionControl.js` 行 77-116

**改變前**:
```javascript
const spectrogramMatrix = plugin.lastRenderData;
// 返回: 1 幀 × 4730 個值 ❌
```

**改變後**:
```javascript
const wavesurfer = getWavesurfer();
const decodedData = wavesurfer.getDecodedData();
const spectrogramMatrix = await plugin.getFrequencies(decodedData);
let specData = spectrogramMatrix[0] || spectrogramMatrix;
// 返回: 500 幀 × 256 個頻率箱 ✅
```

### 修復 2: 正確的峰值計算

**位置**: `modules/autoDetectionControl.js` 行 221-245

**改變前**:
```javascript
// ❌ 掃描單幀，導致返回 0.00 dB
let max = -Infinity;
for (let j = 0; j < spectrogramValues.length; j++) {
  const val = spectrogramValues[j];
  if (val > max) max = val;
}
```

**改變後**:
```javascript
// ✅ 掃描所有幀，正確轉換為 dB
let maxU8 = 0;
for (let i = 0; i < spectrogramValues.length; i++) {
  for (let j = 0; j < spectrogramValues[i].length; j++) {
    if (spectrogramValues[i][j] > maxU8) {
      maxU8 = spectrogramValues[i][j];
    }
  }
}

// U8 (0-255) 到 dB 轉換
const rangeDB = 80;
const peakMaxDb = (maxU8 / 255.0) * rangeDB - rangeDB;
// 例: U8=200 -> dB=-17.6 ✅
```

### 修復 3: 正確的數據展平

**位置**: `modules/autoDetectionControl.js` 行 147-163

**改變前**:
```javascript
// ❌ 錯誤的展平方式
const flatArray = new Float32Array(spectrogramMatrix.flat());
```

**改變後**:
```javascript
// ✅ 正確處理 Uint8Array
if (specData[0] instanceof Uint8Array) {
  flatArray = new Float32Array(numFrames * numBins);
  for (let i = 0; i < numFrames; i++) {
    const frameData = specData[i];
    for (let j = 0; j < numBins; j++) {
      flatArray[i * numBins + j] = frameData[j];
    }
  }
} else {
  flatArray = new Float32Array(specData.flat());
}
```

---

## 技術細節

### plugin.getFrequencies() 的返回值結構

```
[
  [Uint8Array(256), Uint8Array(256), ..., Uint8Array(256)],  // 通道1：100幀
  [Uint8Array(256), Uint8Array(256), ..., Uint8Array(256)]   // 通道2：100幀(如有)
]
     ↓
  第一維: 通道
  第二維: 時間幀
  第三維: 頻率箱
```

### U8 到 dB 的轉換公式

```javascript
// Spectrogram 外掛使用 80dB 動態範圍
// U8 值 (0-255) 映射到 dB (-80 到 0)

peakMaxDb = (maxU8 / 255.0) * 80 - 80

例子:
  U8 = 255 -> dB = (255/255) * 80 - 80 = 0 dB     ✓
  U8 = 200 -> dB = (200/255) * 80 - 80 = -17.6 dB ✓
  U8 = 128 -> dB = (128/255) * 80 - 80 = -39.8 dB ✓
  U8 = 0   -> dB = (0/255) * 80 - 80 = -80 dB     ✓
```

---

## 預期的改進結果

### 修復前的控制台輸出
```
[autoDetectionControl] Spectrogram data available: 1 frames x 4730 bins
[autoDetectionControl] Peak Max: 0.00 dB, Threshold: -24.00 dB
[autoDetectionControl] Calling detect_segments with: flatArray.length=4730, numCols=4730
```

### 修復後的控制台輸出
```
[autoDetectionControl] Spectrogram data available: 500 frames x 256 bins
[autoDetectionControl] calculatePeakMax: maxU8=200, peakMaxDb=-17.60
[autoDetectionControl] Peak Max: -17.60 dB, Threshold: -41.60 dB
[autoDetectionControl] Calling detect_segments with: flatArray.length=128000, numCols=256
[autoDetectionControl] detect_segments returned 20 values (10 segments)
```

---

## 修改的文件

| 文件 | 修改行數 | 修改內容 |
|------|--------|--------|
| `modules/autoDetectionControl.js` | 77-116 | 修復數據獲取邏輯 |
| `modules/autoDetectionControl.js` | 147-163 | 修復數據展平邏輯 |
| `modules/autoDetectionControl.js` | 221-245 | 修復峰值計算邏輯 |

---

## 驗證清單

### 代碼驗證
- [x] 導入 `getWavesurfer` 函數（已在第1行）
- [x] 調用 `wavesurfer.getDecodedData()` 
- [x] 調用 `plugin.getFrequencies(decodedData)`
- [x] 正確處理返回值的多維結構
- [x] 正確轉換 Uint8Array 為 Float32Array
- [x] 正確計算 U8 到 dB 的轉換
- [x] 無語法錯誤

### 已驗證的依賴項
- [x] `wsManager.js` 導出 `getWavesurfer()`
- [x] `frequencyHover.js` 包含 `programmaticSelect()`
- [x] `main.js` 正確初始化 `initAutoDetection()`
- [x] WASM 模塊 `detect_segments()` 函數可用

---

## 下一步測試步驟

1. 打開或拖入音頻文件
2. 點擊自動檢測按鈕啟用模式
3. 打開開發者控制台 (F12)
4. 切換自動檢測開關
5. 驗證控制台輸出：
   - ✅ 應看到多個時間幀（不是 1）
   - ✅ 應看到實際的峰值 dB（不是 0.00）
   - ✅ 應看到檢測到的分段數量
6. 調整閾值滑塊
7. 驗證選擇框是否更新

---

## 相關文檔

- [AUTO_DETECTION_IMPLEMENTATION.md](AUTO_DETECTION_IMPLEMENTATION.md) - 完整的實現文檔
- [AUTO_DETECTION_README.md](AUTO_DETECTION_README.md) - 用戶指南
- [VERIFICATION_CHECKLIST.md](VERIFICATION_CHECKLIST.md) - 詳細的驗證清單
