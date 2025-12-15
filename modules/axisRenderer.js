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
  
  // 1. 定義時間膨脹係數 (通常 TE 是 10 倍)
  const timeFactor = timeExpansion ? 10 : 1;

  // 2. 計算「視覺上的」每秒像素數 (Effective Pixels Per Real Second)
  // 如果是 TE 模式，檔案的一秒其實是現實的 0.1 秒，所以視覺密度應該按放大 10 倍後的標準來算
  const effectivePxPerSec = pxPerSec * timeFactor;

  let step = 1000;
  // 使用還原後的 effectivePxPerSec 來決定 step，確保視覺密度一致
  if (effectivePxPerSec >= 5000) step = 10;        // 10ms
  else if (effectivePxPerSec >= 2000) step = 20;   // 20ms
  else if (effectivePxPerSec >= 1000) step = 50;   // 50ms
  else if (effectivePxPerSec >= 800) step = 100;
  else if (effectivePxPerSec >= 500) step = 200;
  else if (effectivePxPerSec >= 300) step = 500;

  // 3. 計算實際繪圖迴圈需要的增量 (Draw Step)
  // step 是「現實世界」的毫秒數。
  // 在 TE 檔案中，現實的 10ms 等於檔案的 100ms。
  // 所以迴圈每次要跳 step * timeFactor
  const loopStep = step * timeFactor;

  const fragment = document.createDocumentFragment();
  
  // t 是檔案的時間 (File Time)
  for (let t = 0; t < duration * 1000; t += loopStep) {
    const left = (t / 1000) * pxPerSec;

    // 主刻度線
    const majorTick = document.createElement('div');
    majorTick.className = 'time-major-tick';
    majorTick.style.left = `${left}px`;
    fragment.appendChild(majorTick);

    // 副刻度線
    // 副刻度也需要根據 loopStep 調整位置
    const midLeft = left + (loopStep / 1000 / 2) * pxPerSec;
    if (midLeft <= totalWidth) {
      const minorTick = document.createElement('div');
      minorTick.className = 'time-minor-tick';
      minorTick.style.left = `${midLeft}px`;
      fragment.appendChild(minorTick);
    }

    // 時間標籤
    // 這裡需要顯示「現實世界」的時間
    // t 是檔案時間 (ms), 轉成秒是 t/1000
    // 如果是 TE 模式，現實時間 = 檔案時間 / 10
    const fileSeconds = t / 1000;
    const realSeconds = timeExpansion ? (fileSeconds / 10) : fileSeconds;
    
    // 根據 step 大小決定標籤格式
    let labelStr;
    if (step >= 1000) {
        // 如果間隔大於 1秒，顯示秒數 (e.g. "1", "2")
        // 注意：如果是 TE 模式，這裡顯示的數值已經被 /10 了，所以邏輯一致
        labelStr = `${Number(realSeconds.toFixed(1))}`; 
    } else {
        // 顯示毫秒或小數點秒
        // 為了美觀，我們統一用小數點表示秒 (e.g. "0.1", "0.02") 
        // 或者是原本的 step (ms) 邏輯，視乎你想顯示 "100" 還是 "0.1"
        // 這裡沿用你原本的邏輯：如果 step < 1000，通常顯示相對值或純數字，
        // 但為了統一，建議直接顯示 realSeconds
        labelStr = `${Number(realSeconds.toFixed(3))}`; // 去除多餘的0
    }
    
    const label = document.createElement('span');
    label.className = 'time-axis-label';
    if (Number(labelStr) === 0) label.classList.add('zero-label');
    label.style.left = `${left}px`;
    label.textContent = labelStr;
    fragment.appendChild(label);
  }

  axisElement.innerHTML = '';
  axisElement.appendChild(fragment);
  axisElement.style.width = `${totalWidth}px`;
  labelElement.textContent = step >= 1000 ? 'Time (s)' : 'Time (s)'; // 建議統一單位
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