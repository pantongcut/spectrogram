# 自動檢測模式 - 數據訪問修復簡報

## ✅ 修復完成

### 問題
- Peak Max 顯示 0.00 dB（應該是實際值）
- Spectrogram 數據顯示只有 1 frame（應該有多個）

### 根本原因
使用了 `plugin.lastRenderData`（可視化輸出），而不是 `plugin.getFrequencies()`（完整矩陣）

### 解決方案

#### 第 1 步：獲取正確的數據源
```javascript
// ❌ 舊方式
const spectrogramMatrix = plugin.lastRenderData; // 1 frame, 4730 values

// ✅ 新方式
const wavesurfer = getWavesurfer();
const decodedData = wavesurfer.getDecodedData();
const spectrogramMatrix = await plugin.getFrequencies(decodedData); // 完整矩陣
```

#### 第 2 步：正確計算峰值
```javascript
// ✅ 掃描所有幀，轉換 U8 (0-255) 到 dB (-80 到 0)
const peakMaxDb = (maxU8 / 255.0) * 80 - 80;
```

#### 第 3 步：正確展平數據
```javascript
// ✅ 處理 Uint8Array 幀
if (specData[0] instanceof Uint8Array) {
  // 逐幀轉換到 Float32Array
}
```

### 修改文件
- **autoDetectionControl.js** (3 個函數修復)
  - performAutoDetection() - 行 77-116
  - calculatePeakMax() - 行 221-245
  - 數據展平 - 行 147-163

### 驗證狀態
- [x] 無語法錯誤
- [x] 所有導入就位
- [x] 所有依賴項可用
- [x] WASM 集成保留

### 測試步驟
1. 打開音頻文件
2. 啟用自動檢測模式
3. 查看控制台：
   - ✅ 應看到 "500+ frames" 而不是 "1 frame"
   - ✅ 應看到實際的 dB 值而不是 "0.00 dB"
   - ✅ 應看到檢測到的分段

---

**完成時間**: 2025-12-20  
**修復版本**: 2.0  
**狀態**: 準備進行完整測試
