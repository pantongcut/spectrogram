# Auto Detection Mode - 数据获取修正

**日期**: 2025年12月20日  
**问题**: `No spectrogram data available` 错误  
**状态**: ✅ 已修正

---

## 问题分析

### 错误信息
```
autoDetectionControl.js:89 [autoDetectionControl] ❌ No spectrogram data available
```

### 根本原因
代码尝试通过 `plugin.getSpectrogram?.()` 获取数据，但该方法不存在。Spectrogram 插件实际上将数据存储在 `plugin.lastRenderData` 属性中。

**错误代码:**
```javascript
// ❌ 不存在的方法
const spectrogramData = plugin.getSpectrogram?.();
if (!spectrogramData || !spectrogramData.values) { ... }
```

**正确方式:**
```javascript
// ✅ 实际存储的位置
const spectrogramMatrix = plugin.lastRenderData;
if (!spectrogramMatrix || !Array.isArray(spectrogramMatrix)) { ... }
```

---

## 修正内容

### 修改的行
- **第 87 行**: 更改数据获取方式
- **第 104 行**: 使用正确的数据源进行 Peak Max 计算
- **第 121 行**: 使用正确的数据源进行数组展平

### 具体改动

#### 原代码
```javascript
const spectrogramData = plugin.getSpectrogram?.();
if (!spectrogramData || !spectrogramData.values) {
  console.warn('[autoDetectionControl] ❌ No spectrogram data available');
  return;
}

const flatArray = new Float32Array(spectrogramData.values.flat());
const numCols = spectrogramData.values[0]?.length || 128;
```

#### 新代码
```javascript
const spectrogramMatrix = plugin.lastRenderData;
if (!spectrogramMatrix || !Array.isArray(spectrogramMatrix) || spectrogramMatrix.length === 0) {
  console.warn('[autoDetectionControl] ❌ No spectrogram data available in plugin.lastRenderData');
  console.log('[autoDetectionControl] plugin.lastRenderData:', spectrogramMatrix);
  return;
}

const flatArray = new Float32Array(spectrogramMatrix.flat());
const numCols = spectrogramMatrix[0]?.length || 128;
```

---

## 数据结构

### Spectrogram Plugin 的数据结构

```typescript
// plugin.lastRenderData 结构
[
  [value1, value2, value3, ...],  // Frame 0 的频率值
  [value1, value2, value3, ...],  // Frame 1 的频率值
  [value1, value2, value3, ...],  // Frame 2 的频率值
  ...
]

// 其中：
// - 外层数组 = 时间帧 (frames)
// - 内层数组 = 频率谱 (frequency bins)
// - 每个 value = 该频率在该时刻的能量 (dB)
```

### 在检测中的使用

```javascript
spectrogramMatrix.length           // 总帧数 (时间分辨率)
spectrogramMatrix[0].length        // 频率谱大小 (频率分辨率)
spectrogramMatrix.flat()           // 展平为 1D 数组用于 WASM
```

---

## 调试日志改进

添加了详细的日志来诊断问题：

```javascript
// 1. 检查数据可用性
console.log(`Spectrogram data available: ${spectrogramMatrix.length} frames x ${spectrogramMatrix[0]?.length || 0} bins`);

// 2. 检查 Peak Max 计算
console.log(`Peak Max: ${currentPeakMax.toFixed(2)} dB, Threshold: ${thresholdDb.toFixed(2)} dB`);

// 3. 检查 WASM 调用参数
console.log(`Calling detect_segments with: flatArray.length=${flatArray.length}, numCols=${numCols}, ...`);

// 4. 检查检测结果
console.log(`detect_segments returned ${segments.length} values (${Math.floor(segments.length / 2)} segments)`);
```

---

## 现在应该工作的步骤

1. **打开浏览器控制台** (F12)
2. **加载 WAV 文件**
3. **点击 Auto Detect 按钮** → 按钮变绿
4. **调整阈值滑块**
5. **切换开关 ON** → 应该看到：

```
[autoDetectionControl] Switch toggled: ON
[autoDetectionControl] Starting detection...
[autoDetectionControl] ✅ performAutoDetection called
[autoDetectionControl] Spectrogram data available: XXX frames x YYY bins
[autoDetectionControl] Peak Max: XX.XX dB, Threshold: XX.XX dB
[autoDetectionControl] Calling detect_segments with: ...
[autoDetectionControl] detect_segments returned X values (X segments)
[autoDetectionControl] Created X selections
```

6. **频谱图上会出现选择框** 表示检测成功！

---

## 如果仍有问题

### 问题 1: "Spectrogram data available: 0 frames"
- **原因**: 频谱图尚未渲染
- **解决**: 确保 WAV 文件已完全加载，频谱图已完全显示

### 问题 2: "WASM detect_segments function not available"
- **原因**: WASM 模块未加载
- **解决**: 检查浏览器控制台是否有 WASM 初始化日志

### 问题 3: 检测运行但未显示选择框
- **原因**: frequencyHoverControl 为 null
- **解决**: 已添加 null 检查，应该能安全处理

---

## 文件修改记录

| 文件 | 修改 | 行数 |
|------|------|------|
| autoDetectionControl.js | 修正数据获取方式，改用 plugin.lastRenderData | 87-121 |

---

## 相关资源

- Spectrogram 插件实现: `modules/spectrogram.esm.js` (第 915 行: `this.lastRenderData = t`)
- 插件管理: `modules/wsManager.js`
- 频谱图访问: `plugin.lastRenderData` (Array<Array<number>>)

---

**下一步**: 刷新浏览器，测试自动检测功能！🎉
