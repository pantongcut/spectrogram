// modules/powerSpectrum.js
// Power Spectrum 繪製、計算和互動模塊
// 提供 Power Spectrum 的計算、繪製和用戶交互功能
// 2025 優化：計算邏輯已遷移至 Rust/WASM，此模塊專注於繪製和交互

/**
 * 尋找最優的 overlap 值
 * Auto mode 時直接返回 75%
 * @param {Float32Array} audioData - 音頻數據
 * @param {number} sampleRate - 採樣率
 * @param {number} fftSize - FFT 大小
 * @param {string} windowType - 窗口類型
 * @returns {number} 最優的 overlap 百分比 (固定 75%)
 */
export function findOptimalOverlap(audioData, sampleRate, fftSize, windowType) {
  // Auto mode 時直接使用 75% overlap
  return 75;
}

/**
 * 計算 Power Spectrum (使用 WASM FFT，考慮 Overlap)
 * 2025: 完全由 Rust/WASM 實現，JavaScript 僅作為包裝器
 */
export function calculatePowerSpectrumWithOverlap(audioData, sampleRate, fftSize, windowType, overlap = 'auto') {
  if (!audioData || audioData.length === 0) return null;

  // 確保 WASM 已加載
  if (!globalThis._spectrogramWasm || !globalThis._spectrogramWasm.compute_power_spectrum) {
    console.error('[powerSpectrum] WASM module not loaded. Cannot compute power spectrum.');
    return null;
  }

  // 將 overlap 參數轉換為 0-100 的百分比，或 null 表示 auto (75%)
  let overlapPercent = null;
  if (overlap === 'auto' || overlap === '' || overlap === null || overlap === undefined) {
    overlapPercent = 75; // WASM 中的 auto 模式
  } else {
    const parsed = parseInt(overlap, 10);
    if (!isNaN(parsed) && parsed >= 0 && parsed <= 99) {
      overlapPercent = parsed;
    } else {
      // 預設 75% overlap
      overlapPercent = 75;
    }
  }

  try {
    // 調用 WASM 函數計算 Power Spectrum
    const spectrum = globalThis._spectrogramWasm.compute_power_spectrum(
      audioData,
      sampleRate,
      fftSize,
      windowType.toLowerCase(),
      overlapPercent
    );

    return spectrum && spectrum.length > 0 ? new Float32Array(spectrum) : null;
  } catch (err) {
    console.error('[powerSpectrum] Error computing spectrum via WASM:', err);
    return null;
  }
}

/**
 * 計算 Power Spectrum (單幀，不使用 Overlap)
 * 2025: 已遷移至 WASM
 */
export function calculatePowerSpectrum(audioData, sampleRate, fftSize, windowType) {
  if (!audioData || audioData.length === 0) return null;

  // 使用 WASM 版本，設 overlap = 0 表示單幀
  return calculatePowerSpectrumWithOverlap(audioData, sampleRate, fftSize, windowType, 0);
}

/**
 * 從 Power Spectrum 頻譜數組中找到峰值頻率 (直接對應顯示的曲線)
 * 2025: 已遷移至 WASM 實現拋物線插值
 */
export function findPeakFrequencyFromSpectrum(spectrum, sampleRate, fftSize, flowKHz, fhighKHz) {
  if (!spectrum || spectrum.length === 0) return null;

  // 確保 WASM 已加載
  if (!globalThis._spectrogramWasm || !globalThis._spectrogramWasm.find_peak_frequency_from_spectrum) {
    console.error('[powerSpectrum] WASM module not loaded. Cannot find peak frequency.');
    return null;
  }

  try {
    const flowHz = flowKHz * 1000;
    const fhighHz = fhighKHz * 1000;

    // 調用 WASM 函數找峰值
    const peakFreqHz = globalThis._spectrogramWasm.find_peak_frequency_from_spectrum(
      spectrum,
      sampleRate,
      fftSize,
      flowHz,
      fhighHz
    );

    return peakFreqHz > 0 ? peakFreqHz / 1000 : null; // 轉換為 kHz
  } catch (err) {
    console.error('[powerSpectrum] Error finding peak frequency via WASM:', err);
    return null;
  }
}

/**
 * 繪製 Power Spectrum 圖表 (SVG 版本 - 2025 優化)
 * 使用 SVG 而非 Canvas，支持動態更新和 CSS 樣式
 */
/**
 * 繪製 Power Spectrum 圖表 (SVG 版本 - 2025 優化 - Theme Adapted)
 * 使用 SVG 而非 Canvas，支持動態更新和 CSS 樣式
 */
export function drawPowerSpectrumSVG(svg, spectrum, sampleRate, flowKHz, fhighKHz, fftSize, peakFreq) {
  if (!svg || !spectrum) return;

  // 清空 SVG（移除舊的圖表元素，但保留定義）
  const existingGroups = svg.querySelectorAll('g.spectrum-chart');
  existingGroups.forEach(g => g.remove());

  const width = 438;
  const height = 438;
  const topPadding = 30;
  const padding = 45;
  const leftPadding = 60;
  const plotWidth = width - leftPadding - padding;
  const plotHeight = height - topPadding - padding;

  // 計算頻率解析度
  const freqResolution = sampleRate / fftSize;
  const minBinFreq = flowKHz * 1000;
  const maxBinFreq = fhighKHz * 1000;
  const minBin = Math.max(0, Math.floor(minBinFreq / freqResolution));
  const maxBin = Math.min(spectrum.length - 1, Math.floor(maxBinFreq / freqResolution));

  if (minBin >= maxBin) return;

  // 找到 dB 值範圍用於歸一化
  let minDb = Infinity, maxDb = -Infinity;
  for (let i = minBin; i <= maxBin; i++) {
    minDb = Math.min(minDb, spectrum[i]);
    maxDb = Math.max(maxDb, spectrum[i]);
  }
  
  const dbRange = maxDb - minDb;
  if (dbRange < 60) {
    minDb = maxDb - 60;
  }
  maxDb = maxDb + 5;
  if (minDb >= maxDb) {
    minDb = maxDb - 60;
  }

  // 建立主圖表組
  const chartGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  chartGroup.setAttribute('class', 'spectrum-chart');

  // ============================================================
  // 繪製背景 (移除實體 rect，使用 CSS 控制容器背景)
  // ============================================================
  // 舊代碼: const background = ... (已移除，讓 CSS var(--bg-tertiary) 生效)

  // ============================================================
  // 繪製網格線 (顏色由 CSS .spectrum-grid 控制)
  // ============================================================
  const gridGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  gridGroup.setAttribute('class', 'spectrum-grid');
  // 移除硬編碼 stroke, stroke-width 保留或移至 CSS

  const freqSteps = 5;
  for (let i = 1; i < freqSteps; i++) {
    const x = leftPadding + (plotWidth * i) / freqSteps;
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', x);
    line.setAttribute('y1', topPadding);
    line.setAttribute('x2', x);
    line.setAttribute('y2', topPadding + plotHeight);
    gridGroup.appendChild(line);
  }

  const dbSteps = 4;
  for (let i = 1; i < dbSteps; i++) {
    const y = topPadding + (plotHeight * i) / dbSteps;
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', leftPadding);
    line.setAttribute('y1', y);
    line.setAttribute('x2', leftPadding + plotWidth);
    line.setAttribute('y2', y);
    gridGroup.appendChild(line);
  }

  chartGroup.appendChild(gridGroup);

  // ============================================================
  // 繪製坐標軸 (顏色由 CSS .spectrum-axes 控制)
  // ============================================================
  const axisGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  axisGroup.setAttribute('class', 'spectrum-axes');
  // 移除硬編碼 stroke

  // Y 軸
  const yAxis = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  yAxis.setAttribute('x1', leftPadding);
  yAxis.setAttribute('y1', topPadding);
  yAxis.setAttribute('x2', leftPadding);
  yAxis.setAttribute('y2', topPadding + plotHeight);
  axisGroup.appendChild(yAxis);

  // X 軸
  const xAxis = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  xAxis.setAttribute('x1', leftPadding);
  xAxis.setAttribute('y1', topPadding + plotHeight);
  xAxis.setAttribute('x2', leftPadding + plotWidth);
  xAxis.setAttribute('y2', topPadding + plotHeight);
  axisGroup.appendChild(xAxis);

  chartGroup.appendChild(axisGroup);

  // ============================================================
  // 繪製坐標軸刻度和標籤 (顏色由 CSS .spectrum-labels 控制)
  // ============================================================
  const labelsGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  labelsGroup.setAttribute('class', 'spectrum-labels');
  // 移除硬編碼 fill

  // X 軸標籤（頻率）
  for (let i = 0; i <= freqSteps; i++) {
    const freq = flowKHz + (fhighKHz - flowKHz) * (i / freqSteps);
    const x = leftPadding + (plotWidth * i) / freqSteps;
    
    // 刻度線 (使用 CSS 變量)
    const tick = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    tick.setAttribute('x1', x);
    tick.setAttribute('y1', topPadding + plotHeight);
    tick.setAttribute('x2', x);
    tick.setAttribute('y2', topPadding + plotHeight + 5);
    tick.setAttribute('stroke', 'var(--text-primary)'); // 使用變量
    tick.setAttribute('stroke-width', '1');
    labelsGroup.appendChild(tick);

    // 標籤文字
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', x);
    text.setAttribute('y', topPadding + plotHeight + 25);
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'middle');
    text.textContent = freq.toFixed(1);
    labelsGroup.appendChild(text);
  }

  // Y 軸標籤（能量 dB）
  for (let i = 0; i <= dbSteps; i++) {
    const db = maxDb - ((maxDb - minDb) * i) / dbSteps;
    const y = topPadding + (plotHeight * i) / dbSteps;

    // 刻度線
    const tick = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    tick.setAttribute('x1', leftPadding - 5);
    tick.setAttribute('y1', y);
    tick.setAttribute('x2', leftPadding);
    tick.setAttribute('y2', y);
    tick.setAttribute('stroke', 'var(--text-primary)'); // 使用變量
    tick.setAttribute('stroke-width', '1');
    labelsGroup.appendChild(tick);

    // 標籤文字
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', leftPadding - 10);
    text.setAttribute('y', y);
    text.setAttribute('text-anchor', 'end');
    text.setAttribute('dominant-baseline', 'middle');
    text.textContent = db.toFixed(0);
    labelsGroup.appendChild(text);
  }

  // X 軸標籤
  const xLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  xLabel.setAttribute('x', leftPadding + plotWidth / 2);
  xLabel.setAttribute('y', height + 7);
  xLabel.setAttribute('text-anchor', 'middle');
  xLabel.setAttribute('font-weight', 'bold');
  xLabel.setAttribute('font-family', "'Noto Sans HK'", 'sans-serif');
  xLabel.textContent = 'Frequency (kHz)';
  labelsGroup.appendChild(xLabel);

  // Y 軸標籤（旋轉）
  const yLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  yLabel.setAttribute('x', '17');
  yLabel.setAttribute('y', topPadding + plotHeight / 2);
  yLabel.setAttribute('text-anchor', 'middle');
  yLabel.setAttribute('font-weight', 'bold');
  yLabel.setAttribute('font-family', "'Noto Sans HK'", 'sans-serif');
  yLabel.setAttribute('transform', `rotate(-90 17 ${topPadding + plotHeight / 2})`);
  yLabel.textContent = 'Energy (dB)';
  labelsGroup.appendChild(yLabel);

  chartGroup.appendChild(labelsGroup);

  // ============================================================
  // 繪製 Power Spectrum 曲線
  // ============================================================
  
  // 計算 peakFreq 對應的 dB 值 (保持原有邏輯)
  let peakDbValue = null;
  if (peakFreq !== null && peakFreq >= flowKHz && peakFreq <= fhighKHz) {
    const peakFreqHz = peakFreq * 1000;
    const peakBinExact = (peakFreqHz - minBinFreq) / freqResolution + minBin;
    
    const peakBinFloor = Math.floor(peakBinExact);
    const peakBinCeil = Math.ceil(peakBinExact);
    const binFraction = peakBinExact - peakBinFloor;
    
    if (peakBinFloor >= minBin && peakBinCeil <= maxBin) {
      const dbFloor = spectrum[peakBinFloor];
      const dbCeil = spectrum[peakBinCeil];
      peakDbValue = dbFloor + (dbCeil - dbFloor) * binFraction;
    }
  }

  // 收集所有點進行繪製
  let pointsToRender = [];
  for (let i = minBin; i <= maxBin; i++) {
    const db = spectrum[i];
    const freqHz = i * freqResolution;
    pointsToRender.push({ bin: i, freqHz, db, isPeakPoint: false });
  }

  // 插入峰值點
  if (peakDbValue !== null && peakFreq !== null) {
    const peakFreqHz = peakFreq * 1000;
    let insertIndex = 0;
    for (let i = 0; i < pointsToRender.length; i++) {
      if (pointsToRender[i].freqHz < peakFreqHz) {
        insertIndex = i + 1;
      } else {
        break;
      }
    }

    const nearbyThreshold = freqResolution * 0.1;
    let shouldInsert = true;
    if (insertIndex > 0 && Math.abs(pointsToRender[insertIndex - 1].freqHz - peakFreqHz) < nearbyThreshold) {
      shouldInsert = false;
    }
    if (insertIndex < pointsToRender.length && Math.abs(pointsToRender[insertIndex].freqHz - peakFreqHz) < nearbyThreshold) {
      shouldInsert = false;
    }
    if (shouldInsert) {
      pointsToRender.splice(insertIndex, 0, { bin: -1, freqHz: peakFreqHz, db: peakDbValue, isPeakPoint: true });
    }
  }

  // 建立 SVG 路徑數據
  let pathData = '';
  for (let p = 0; p < pointsToRender.length; p++) {
    const point = pointsToRender[p];
    const db = point.db;
    const normalizedDb = Math.max(0, Math.min(1, (db - minDb) / (maxDb - minDb)));
    
    const freqPercent = (point.freqHz - minBinFreq) / (maxBinFreq - minBinFreq);
    const x = leftPadding + freqPercent * plotWidth;
    const y = topPadding + plotHeight - normalizedDb * plotHeight;

    if (p === 0) {
      pathData += `M ${x} ${y}`;
    } else {
      pathData += ` L ${x} ${y}`;
    }
  }

  // 繪製曲線 (顏色由 CSS .spectrum-curve 控制)
  const curve = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  curve.setAttribute('d', pathData);
  curve.setAttribute('fill', 'none');
  // 移除硬編碼 stroke, stroke-width (已在 CSS .spectrum-curve 中定義)
  curve.setAttribute('stroke-linecap', 'round');
  curve.setAttribute('stroke-linejoin', 'round');
  curve.setAttribute('class', 'spectrum-curve');

  // 添加剪裁路徑防止超出邊界
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  const clipPath = document.createElementNS('http://www.w3.org/2000/svg', 'clipPath');
  clipPath.setAttribute('id', 'spectrum-clip-path');
  const clipRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  clipRect.setAttribute('x', leftPadding);
  clipRect.setAttribute('y', topPadding);
  clipRect.setAttribute('width', plotWidth);
  clipRect.setAttribute('height', plotHeight);
  clipPath.appendChild(clipRect);
  defs.appendChild(clipPath);
  svg.appendChild(defs);

  curve.setAttribute('clip-path', 'url(#spectrum-clip-path)');

  const curveGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  curveGroup.setAttribute('class', 'spectrum-curve-group');
  curveGroup.appendChild(curve);
  chartGroup.appendChild(curveGroup);

  // ============================================================
  // 添加交互層
  // ============================================================
  const interactiveGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  interactiveGroup.setAttribute('class', 'spectrum-interactive');
  
  // 儲存所有交互點的資訊用於查詢
  const interactivePoints = [];
  
  // 為每個數據點創建透明的交互點
  for (let p = 0; p < pointsToRender.length; p++) {
    const point = pointsToRender[p];
    const db = point.db;
    const normalizedDb = Math.max(0, Math.min(1, (db - minDb) / (maxDb - minDb)));
    
    const freqPercent = (point.freqHz - minBinFreq) / (maxBinFreq - minBinFreq);
    const x = leftPadding + freqPercent * plotWidth;
    const y = topPadding + plotHeight - normalizedDb * plotHeight;

    const interactivePoint = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    interactivePoint.setAttribute('cx', x);
    interactivePoint.setAttribute('cy', y);
    interactivePoint.setAttribute('r', '6');
    interactivePoint.setAttribute('fill', 'transparent');
    interactivePoint.setAttribute('stroke', 'none');
    interactivePoint.setAttribute('class', 'spectrum-interactive-point');
    
    const pointData = {
      freqHz: point.freqHz,
      freqKHz: point.freqHz / 1000,
      db: db,
      x: x,
      y: y,
      element: interactivePoint
    };
    interactivePoints.push(pointData);
    
    interactiveGroup.appendChild(interactivePoint);
  }
  
  chartGroup.appendChild(interactiveGroup);

  // ============================================================
  // 添加輔助線和提示框層
  // ============================================================
  const helperGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  helperGroup.setAttribute('class', 'spectrum-helper-lines');
  chartGroup.appendChild(helperGroup);

  // 添加 SVG 背景層用於捕捉滑鼠事件
  const interactiveBackground = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  interactiveBackground.setAttribute('x', leftPadding);
  interactiveBackground.setAttribute('y', topPadding);
  interactiveBackground.setAttribute('width', plotWidth);
  interactiveBackground.setAttribute('height', plotHeight);
  interactiveBackground.setAttribute('fill', 'transparent');
  interactiveBackground.setAttribute('stroke', 'none');
  interactiveBackground.setAttribute('class', 'spectrum-interactive-bg');
  chartGroup.appendChild(interactiveBackground);

  svg.appendChild(chartGroup);

  // ============================================================
  // 設置基於 X 座標的自動檢測交互 (支持鎖定功能)
  // ============================================================
  
  let lockedPoint = null;
  let isLocked = false;
  
  svg.addEventListener('mousemove', (event) => {
    if (isLocked) return;
    const rect = svg.getBoundingClientRect();
    const svgX = event.clientX - rect.left;
    const svgY = event.clientY - rect.top;
    
    if (svgX < leftPadding || svgX > leftPadding + plotWidth || 
        svgY < topPadding || svgY > topPadding + plotHeight) {
      while (helperGroup.firstChild) {
        helperGroup.removeChild(helperGroup.firstChild);
      }
      return;
    }
    
    let closestPoint = null;
    let minDistance = Infinity;
    
    for (const point of interactivePoints) {
      const distance = Math.abs(point.x - svgX);
      if (distance < minDistance) {
        minDistance = distance;
        closestPoint = point;
      }
    }
    
    if (closestPoint && minDistance < 15) {
      while (helperGroup.firstChild) {
        helperGroup.removeChild(helperGroup.firstChild);
      }
      
      // 繪製垂直線
      const vLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      vLine.setAttribute('x1', closestPoint.x);
      vLine.setAttribute('y1', closestPoint.y);
      vLine.setAttribute('x2', closestPoint.x);
      vLine.setAttribute('y2', topPadding + plotHeight);
      vLine.setAttribute('stroke', 'var(--text-secondary)');
      vLine.setAttribute('stroke-width', '1');
      vLine.setAttribute('stroke-dasharray', '3,3');
      vLine.setAttribute('class', 'spectrum-guide-line');
      helperGroup.appendChild(vLine);
      
      // 繪製水平線
      const hLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      hLine.setAttribute('x1', leftPadding);
      hLine.setAttribute('y1', closestPoint.y);
      hLine.setAttribute('x2', closestPoint.x);
      hLine.setAttribute('y2', closestPoint.y);
      hLine.setAttribute('stroke', 'var(--text-secondary)');
      hLine.setAttribute('stroke-width', '1');
      hLine.setAttribute('stroke-dasharray', '3,3');
      hLine.setAttribute('class', 'spectrum-guide-line');
      helperGroup.appendChild(hLine);
      
      // 繪製交互點圓形 (Unlocked)
      const interactiveCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      interactiveCircle.setAttribute('cx', closestPoint.x);
      interactiveCircle.setAttribute('cy', closestPoint.y);
      interactiveCircle.setAttribute('r', '4');
      if (isLocked) {
        // Locked style (Red)
        interactiveCircle.setAttribute('fill', 'rgba(255, 0, 0, 0.3)');
        interactiveCircle.setAttribute('stroke', '#ff0000');
      } else {
        // Unlocked style (Theme Color)
        interactiveCircle.setAttribute('fill', 'var(--paravalue-color)');
        interactiveCircle.setAttribute('fill-opacity', '0.3');
        interactiveCircle.setAttribute('stroke', 'var(--paravalue-color)');
      }
      interactiveCircle.setAttribute('stroke-width', '1');
      interactiveCircle.setAttribute('class', 'spectrum-highlight-point');
      helperGroup.appendChild(interactiveCircle);
      
      // 創建提示框文字（頻率）
      const tooltipFreq = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      tooltipFreq.setAttribute('x', closestPoint.x);
      tooltipFreq.setAttribute('y', closestPoint.y - 25);
      tooltipFreq.setAttribute('text-anchor', 'middle');
      tooltipFreq.setAttribute('dominant-baseline', 'middle');
      tooltipFreq.setAttribute('font-family', "'Noto Sans HK'", 'sans-serif');
      tooltipFreq.setAttribute('font-size', '12');
      tooltipFreq.setAttribute('font-weight', 'bold');
      // 移除硬編碼 fill, 使用 class .spectrum-tooltip-text-freq (CSS 定義)
      tooltipFreq.setAttribute('class', 'spectrum-tooltip-text-freq');
      tooltipFreq.textContent = closestPoint.freqKHz.toFixed(2) + ' kHz';
      helperGroup.appendChild(tooltipFreq);
      
      // 創建提示框文字（dB）
      const tooltipDb = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      tooltipDb.setAttribute('x', closestPoint.x);
      tooltipDb.setAttribute('y', closestPoint.y - 10);
      tooltipDb.setAttribute('text-anchor', 'middle');
      tooltipDb.setAttribute('dominant-baseline', 'middle');
      tooltipDb.setAttribute('font-family', "'Noto Sans HK'", 'sans-serif');
      tooltipDb.setAttribute('font-size', '12');
      tooltipDb.setAttribute('font-weight', 'bold');
      // 移除硬編碼 fill
      tooltipDb.setAttribute('fill', 'var(--paravalue-color)'); 
      tooltipDb.setAttribute('class', 'spectrum-tooltip-text-db');
      tooltipDb.textContent = closestPoint.db.toFixed(1) + ' dB';
      helperGroup.appendChild(tooltipDb);
    } else {
      while (helperGroup.firstChild) {
        helperGroup.removeChild(helperGroup.firstChild);
      }
    }
  });
  
  svg.addEventListener('mouseleave', () => {
    if (!isLocked) {
      while (helperGroup.firstChild) {
        helperGroup.removeChild(helperGroup.firstChild);
      }
    }
  });

  // ============================================================
  // 添加左鍵點擊事件監聽 - 用於鎖定/解除鎖定
  // ============================================================
  svg.addEventListener('click', (event) => {
    const rect = svg.getBoundingClientRect();
    const svgX = event.clientX - rect.left;
    const svgY = event.clientY - rect.top;
    
    if (svgX < leftPadding || svgX > leftPadding + plotWidth || 
        svgY < topPadding || svgY > topPadding + plotHeight) {
      if (isLocked) {
        isLocked = false;
        lockedPoint = null;
        while (helperGroup.firstChild) {
          helperGroup.removeChild(helperGroup.firstChild);
        }
      }
      return;
    }
    
    if (!isLocked) {
      let closestPoint = null;
      let minDistance = Infinity;
      
      for (const point of interactivePoints) {
        const distance = Math.abs(point.x - svgX);
        if (distance < minDistance) {
          minDistance = distance;
          closestPoint = point;
        }
      }
      
      if (closestPoint && minDistance < 15) {
        isLocked = true;
        lockedPoint = closestPoint;
        
        while (helperGroup.firstChild) {
          helperGroup.removeChild(helperGroup.firstChild);
        }
        
        // 繪製垂直線
        const vLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        vLine.setAttribute('x1', closestPoint.x);
        vLine.setAttribute('y1', closestPoint.y);
        vLine.setAttribute('x2', closestPoint.x);
        vLine.setAttribute('y2', topPadding + plotHeight);
        vLine.setAttribute('stroke', 'var(--text-secondary)');
        vLine.setAttribute('stroke-width', '1');
        vLine.setAttribute('stroke-dasharray', '3,3');
        vLine.setAttribute('class', 'spectrum-guide-line');
        helperGroup.appendChild(vLine);
        
        // 繪製水平線
        const hLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        hLine.setAttribute('x1', leftPadding);
        hLine.setAttribute('y1', closestPoint.y);
        hLine.setAttribute('x2', closestPoint.x);
        hLine.setAttribute('y2', closestPoint.y);
        hLine.setAttribute('stroke', 'var(--text-secondary)');
        hLine.setAttribute('stroke-width', '1');
        hLine.setAttribute('stroke-dasharray', '3,3');
        hLine.setAttribute('class', 'spectrum-guide-line');
        helperGroup.appendChild(hLine);
        
        // 繪製交互點圓形 (Locked - Red)
        const interactiveCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        interactiveCircle.setAttribute('cx', closestPoint.x);
        interactiveCircle.setAttribute('cy', closestPoint.y);
        interactiveCircle.setAttribute('r', '4');
        interactiveCircle.setAttribute('fill', 'rgba(255, 0, 0, 0.3)');
        interactiveCircle.setAttribute('stroke', '#ff0000');
        interactiveCircle.setAttribute('stroke-width', '1');
        interactiveCircle.setAttribute('class', 'spectrum-highlight-point');
        helperGroup.appendChild(interactiveCircle);
        
        // 提示框文字（頻率）
        const tooltipFreq = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        tooltipFreq.setAttribute('x', closestPoint.x);
        tooltipFreq.setAttribute('y', closestPoint.y - 25);
        tooltipFreq.setAttribute('text-anchor', 'middle');
        tooltipFreq.setAttribute('dominant-baseline', 'middle');
        tooltipFreq.setAttribute('font-family', "'Noto Sans HK'", 'sans-serif');
        tooltipFreq.setAttribute('font-size', '12');
        tooltipFreq.setAttribute('font-weight', 'bold');
        tooltipFreq.setAttribute('class', 'spectrum-tooltip-text-freq');
        tooltipFreq.textContent = closestPoint.freqKHz.toFixed(2) + ' kHz';
        helperGroup.appendChild(tooltipFreq);
        
        // 提示框文字（dB）
        const tooltipDb = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        tooltipDb.setAttribute('x', closestPoint.x);
        tooltipDb.setAttribute('y', closestPoint.y - 10);
        tooltipDb.setAttribute('text-anchor', 'middle');
        tooltipDb.setAttribute('dominant-baseline', 'middle');
        tooltipDb.setAttribute('font-family', "'Noto Sans HK'", 'sans-serif');
        tooltipDb.setAttribute('font-size', '12');
        tooltipDb.setAttribute('font-weight', 'bold');
        tooltipDb.setAttribute('fill', 'var(--paravalue-color)');
        tooltipDb.setAttribute('class', 'spectrum-tooltip-text-db');
        tooltipDb.textContent = closestPoint.db.toFixed(1) + ' dB';
        helperGroup.appendChild(tooltipDb);
      }
    } else {
      isLocked = false;
      lockedPoint = null;
      while (helperGroup.firstChild) {
        helperGroup.removeChild(helperGroup.firstChild);
      }
    }
  });
}

// ============================================================
// 2025 優化：以下計算函數已遷移至 Rust/WASM
// ============================================================

// 導出輔助函數供其他模塊使用（現在只作為空保留，以防舊代碼直接調用）
export function getApplyWindowFunction() {
  console.warn('[powerSpectrum] getApplyWindowFunction() is deprecated. Window application is now done in WASM.');
  return null;
}

export function getGoertzelEnergyFunction() {
  console.warn('[powerSpectrum] getGoertzelEnergyFunction() is deprecated. Energy calculation is now done in WASM.');
  return null;
}


