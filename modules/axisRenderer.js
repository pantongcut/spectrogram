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

  let step = 1000;
  if (pxPerSec >= 5000) step = 10;        // zoom level > 5000: 10ms 精細度
  else if (pxPerSec >= 2000) step = 20;   // zoom level > 2000: 20ms 精細度
  else if (pxPerSec >= 1000) step = 50;   // zoom level > 1000: 50ms 精細度
  else if (pxPerSec >= 800) step = 100;
  else if (pxPerSec >= 500) step = 200;
  else if (pxPerSec >= 300) step = 500;

  // [Fix] Time Expansion 模式修正：
  // 因為 TE 模式下 duration 是實際時間的 10 倍，導致同樣的 zoomLevel 下 pxPerSec 會變小，
  // 造成 step 計算過小，刻度過於密集。
  // 此處將 step 乘以 10，讓視覺密度 (像素間距) 回復到與非 TE 模式一致。
  if (timeExpansion) {
    step *= 10;
  }

  // 使用 DocumentFragment 批量插入 DOM，減少重排
  const fragment = document.createDocumentFragment();
  
  // 確保循環使用整數運算以避免浮點數累積誤差
  const maxTimeMs = Math.floor(duration * 1000);

  for (let t = 0; t < maxTimeMs; t += step) {
    const left = (t / 1000) * pxPerSec;

    // 主刻度線
    const majorTick = document.createElement('div');
    majorTick.className = 'time-major-tick';
    majorTick.style.left = `${left}px`;
    fragment.appendChild(majorTick);

    // 副刻度線
    const midLeft = left + (step / 1000 / 2) * pxPerSec;
    if (midLeft <= totalWidth) {
      const minorTick = document.createElement('div');
      minorTick.className = 'time-minor-tick';
      minorTick.style.left = `${midLeft}px`;
      fragment.appendChild(minorTick);
    }

    // 時間標籤
    const baseLabel = step >= 1000 ? (t / 1000) : t;
    const displayLabel = timeExpansion ? (baseLabel / 10) : baseLabel;
    
    // 格式化標籤：如果使用了 Time Expansion 且數值較小，避免過長的小數
    let labelStr;
    if (step >= 1000 && !timeExpansion) {
        labelStr = `${baseLabel}`;
    } else {
        // 對於小數，去除多餘的零，例如 0.10 -> 0.1
        labelStr = Number(displayLabel.toPrecision(12)).toString();
    }
    
    const label = document.createElement('span');
    label.className = 'time-axis-label';
    if (Number(displayLabel) === 0) label.classList.add('zero-label');
    label.style.left = `${left}px`;
    label.textContent = labelStr;
    fragment.appendChild(label);
  }

  // 一次性更新 DOM
  axisElement.innerHTML = '';
  axisElement.appendChild(fragment);
  axisElement.style.width = `${totalWidth}px`;
  
  // 更新軸單位顯示
  labelElement.textContent = step >= 1000 ? 'Time (s)' : 'Time (ms)';
}

export function drawFrequencyGrid({
  gridCanvas,
  labelContainer,
  containerElement,
  spectrogramHeight = 800,
  maxFrequency = 128,
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
  
  // Check if the viewer-wrapper has the theme-light class to determine grid color
  const viewerWrapper = document.getElementById('viewer-wrapper');
  const isLightTheme = viewerWrapper && viewerWrapper.classList.contains('theme-light');
  
  ctx.strokeStyle = isLightTheme ? 'rgba(0, 0, 0, 0.5)' : 'rgba(255, 255, 255, 0.3)';
  ctx.lineWidth = 0.4;

  const range = maxFrequency;
  
  // 根據 frequency range 調整精細度
  // 無論是否為 Time Expansion 模式，都使用相同的 step 邏輯 (物理間隔一致)
  let majorStep, minorStep;
  if (range <= 20) {
    majorStep = 1;
    minorStep = 0.5;
  } else if (range <= 50) {
    majorStep = 5;
    minorStep = 2.5;
  } else {
    majorStep = 10;
    minorStep = 5;
  }

  // 優化：批量繪製所有網格線
  ctx.beginPath();
  for (let f = 0; f <= range; f += majorStep) {
    const y = (1 - f / range) * spectrogramHeight;
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
  }
  ctx.stroke();

  // 使用 DocumentFragment 批量操作 DOM
  const fragment = document.createDocumentFragment();
  
  // 繪製主刻度和標籤
  for (let f = 0; f <= range; f += majorStep) {
    const y = Math.round((1 - f / range) * spectrogramHeight);

    // 主刻度線
    const tick = document.createElement('div');
    tick.className = 'freq-major-tick';
    tick.style.top = `${y}px`;
    fragment.appendChild(tick);

    // 文字標籤
    const label = document.createElement('div');
    label.className = 'freq-label-static freq-axis-label';
    label.style.top = `${y - 1}px`;
    const freqValue = f + offsetKHz;
    // TE 模式下，頻率數值顯示為 10 倍
    const displayValue = timeExpansion ? (freqValue * 10) : freqValue;
    label.textContent = Number(displayValue.toFixed(1)).toString();
    fragment.appendChild(label);
  }

  // 繪製次刻度
  for (let f = minorStep; f <= range; f += minorStep) {
    // 跳過與主刻度位置重合的位置
    if (Math.abs((f / majorStep) - Math.round(f / majorStep)) < 1e-6) continue;

    const y = Math.round((1 - f / range) * spectrogramHeight);

    const minorTick = document.createElement('div');
    minorTick.className = 'freq-minor-tick';
    minorTick.style.top = `${y}px`;
    fragment.appendChild(minorTick);
  }

  // 一次性更新 DOM
  labelContainer.innerHTML = '';
  labelContainer.appendChild(fragment);
}