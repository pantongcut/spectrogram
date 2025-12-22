// modules/axisRenderer.js

export function drawTimeAxis({
  containerWidth,
  duration,
  zoomLevel,
  axisElement,
  labelElement,
  timeExpansion = false,
}) {
  const pxPerSec = zoomLevel;
  const totalWidth = duration * pxPerSec;
  
  // 1. 定義時間膨脹係數
  const timeFactor = timeExpansion ? 10 : 1;

  // 2. 計算「視覺上的」每秒像素數 (Effective Pixels Per Real Second)
  const effectivePxPerSec = pxPerSec * timeFactor;

  let step = 1000;
  // 使用還原後的 effectivePxPerSec 來決定 step
  if (effectivePxPerSec >= 5000) step = 10;        // 10ms
  else if (effectivePxPerSec >= 2000) step = 20;   // 20ms
  else if (effectivePxPerSec >= 1000) step = 50;   // 50ms
  else if (effectivePxPerSec >= 800) step = 100;
  else if (effectivePxPerSec >= 500) step = 200;
  else if (effectivePxPerSec >= 300) step = 500;
  // 預設 step = 1000

  // 3. 計算實際繪圖迴圈需要的增量 (Draw Step)
  // step 是「現實世界」的毫秒數，loopStep 是「檔案世界」的毫秒數
  const loopStep = step * timeFactor;

  const fragment = document.createDocumentFragment();
  
  for (let t = 0; t < duration * 1000; t += loopStep) {
    const left = (t / 1000) * pxPerSec;

    // 主刻度線
    const majorTick = document.createElement('div');
    majorTick.className = 'time-major-tick';
    majorTick.style.left = `${left}px`;
    fragment.appendChild(majorTick);

    // 副刻度線
    const midLeft = left + (loopStep / 1000 / 2) * pxPerSec;
    if (midLeft <= totalWidth) {
      const minorTick = document.createElement('div');
      minorTick.className = 'time-minor-tick';
      minorTick.style.left = `${midLeft}px`;
      fragment.appendChild(minorTick);
    }

    // 時間標籤處理
    // 先算出「現實世界」的毫秒數
    const fileTimeMs = t;
    const realTimeMs = timeExpansion ? (fileTimeMs / 10) : fileTimeMs;
    
    let labelStr;

    // 恢復邏輯：根據 step 大小決定顯示單位 (s 或 ms)
    if (step >= 1000) {
        // [模式：秒]
        // 顯示為秒數，保留小數點 (e.g., 0, 1, 2, 3.5)
        const seconds = realTimeMs / 1000;
        labelStr = `${Number(seconds.toFixed(1))}`; 
    } else {
        // [模式：毫秒]
        // 直接顯示毫秒整數 (e.g., 0, 50, 100, 200)
        labelStr = `${Math.round(realTimeMs)}`;
    }
    
    const label = document.createElement('span');
    label.className = 'time-axis-label';
    if (Number(labelStr) === 0) label.classList.add('zero-label');
    label.style.left = `${left}px`;
    label.textContent = labelStr;
    fragment.appendChild(label);
  }

  // 更新 DOM
  axisElement.innerHTML = '';
  axisElement.appendChild(fragment);
  
  // [Fix] 判斷寬度：如果計算出的總寬度跟容器寬度非常接近 (誤差 < 5px)，
  // 則強制設為 '100%'，避免出現水平滾動條或右側白邊。
  if (Math.abs(totalWidth - containerWidth) < 5) {
    axisElement.style.width = '100%';
  } else {
    axisElement.style.width = `${totalWidth}px`;
  }
  
  // 恢復邏輯：更新軸的單位標籤
  labelElement.textContent = step >= 1000 ? 'Time (s)' : 'Time (ms)';
}

export function drawFrequencyGrid({
  gridCanvas,
  labelContainer,
  containerElement,
  spectrogramHeight = 800,
  maxFrequency = 128, // 這是檔案的原始 Nyquist 頻率 (TE 模式下通常很低，如 12.8kHz)
  offsetKHz = 0,
  timeExpansion = false,
}) {
  const width = containerElement.scrollWidth;
  gridCanvas.width = width;
  gridCanvas.height = spectrogramHeight;
  gridCanvas.style.width = width + 'px';
  gridCanvas.style.height = spectrogramHeight + 'px';

  const ctx = gridCanvas.getContext('2d');
  ctx.clearRect(0, 0, width, spectrogramHeight);
  
  const viewerWrapper = document.getElementById('viewer-wrapper');
  const isLightTheme = viewerWrapper && viewerWrapper.classList.contains('theme-light');
  
  ctx.strokeStyle = isLightTheme ? 'rgba(0, 0, 0, 0.5)' : 'rgba(255, 255, 255, 0.3)';
  ctx.lineWidth = 0.4;

  // 1. 定義時間膨脹係數
  const timeFactor = timeExpansion ? 10 : 1;

  // 2. 計算「現實世界」的頻率範圍 (Effective Range)
  // 如果檔案是 25.6kHz 採樣率 (maxFreq = 12.8)，在 TE 10x 模式下，代表現實世界是 0-128kHz
  const effectiveRange = maxFrequency * timeFactor;
  
  // 3. 根據「現實範圍」決定刻度間隔
  let majorStep, minorStep;
  if (effectiveRange <= 20) {
    // 0-20kHz (Real): 1kHz
    majorStep = 1;
    minorStep = 0.5;
  } else if (effectiveRange <= 50) {
    // 0-50kHz (Real): 5kHz
    majorStep = 5;
    minorStep = 2.5;
  } else {
    // > 50kHz (Real): 10kHz
    majorStep = 10;
    minorStep = 5;
  }

  // 4. 將現實世界的 Step 轉換回檔案的 Step (Draw Step)
  // 因為迴圈是跑在原始檔案的頻率範圍 (0 - maxFrequency)
  // 所以如果現實要每 10kHz 畫一條，檔案中就是每 1kHz (10 / 10) 畫一條
  const drawMajorStep = majorStep / timeFactor;
  const drawMinorStep = minorStep / timeFactor;

  // 繪製橫線 (Grid Lines)
  ctx.beginPath();
  // 注意：這裡用原始 maxFrequency 做邊界，用轉換後的 drawMajorStep 做步長
  for (let f = 0; f <= maxFrequency; f += drawMajorStep) {
    const y = (1 - f / maxFrequency) * spectrogramHeight;
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
  }
  ctx.stroke();

  const fragment = document.createDocumentFragment();
  
  // 繪製主刻度和標籤
  for (let f = 0; f <= maxFrequency; f += drawMajorStep) {
    const y = Math.round((1 - f / maxFrequency) * spectrogramHeight);

    const tick = document.createElement('div');
    tick.className = 'freq-major-tick';
    tick.style.top = `${y}px`;
    fragment.appendChild(tick);

    const label = document.createElement('div');
    label.className = 'freq-label-static freq-axis-label';
    label.style.top = `${y - 1}px`;
    
    // 計算標籤數值：還原成現實世界的頻率
    // 檔案頻率 f + offset -> 乘上 10 倍
    const freqValue = f + offsetKHz;
    const displayValue = timeExpansion ? (freqValue * 10) : freqValue;
    
    label.textContent = Number(displayValue.toFixed(1)).toString();
    fragment.appendChild(label);
  }

  // 繪製次刻度
  for (let f = drawMinorStep; f <= maxFrequency; f += drawMinorStep) {
    // 跳過與主刻度重疊的部分 (使用 drawMajorStep 比較)
    if (Math.abs((f / drawMajorStep) - Math.round(f / drawMajorStep)) < 1e-6) continue;

    const y = Math.round((1 - f / maxFrequency) * spectrogramHeight);

    const minorTick = document.createElement('div');
    minorTick.className = 'freq-minor-tick';
    minorTick.style.top = `${y}px`;
    fragment.appendChild(minorTick);
  }

  labelContainer.innerHTML = '';
  labelContainer.appendChild(fragment);
}