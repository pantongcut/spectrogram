/**
 * Peak Control Module
 * 管理 Peak Mode 的切換和 Spectrogram 重新渲染
 */

let peakModeActive = false;
let peakThreshold = 0.4;  // 默認閾值 40%
let peakToolBarOpen = false;

/**
 * 初始化 Peak Control
 * @param {Object} options - 配置選項
 * @param {string} options.peakBtnId - Peak Button 的 ID
 * @param {Function} options.onPeakModeToggled - Peak mode 切換時的回調函數 (newState)
 * @param {Function} options.onThresholdChanged - 閾值改變時的回調函數 (newThreshold)
 */
export function initPeakControl(options = {}) {
  const {
    peakBtnId = 'peakBtn',
    onPeakModeToggled = () => {},
    onThresholdChanged = () => {}
  } = options;

  const peakBtn = document.getElementById(peakBtnId);
  const peakModeToolBar = document.getElementById('peak-mode-tool-bar');
  const peakModeSwitch = document.getElementById('peakModeSwitch');
  const peakThresholdSlider = document.getElementById('peakThresholdSlider');
  const peakThresholdVal = document.getElementById('peakThresholdVal');
  const toolBar = document.getElementById('tool-bar');

  if (!peakBtn) {
    console.warn(`[peakControl] Button with ID "${peakBtnId}" not found`);
    return { toggle: () => {}, isActive: () => peakModeActive };
  }

  // Peak Button 點擊事件 - 切換工具欄的顯示
  peakBtn.addEventListener('click', () => {
    if (peakModeToolBar) {
      peakModeToolBar.classList.toggle('open');
      peakToolBarOpen = peakModeToolBar.classList.contains('open');
      updatePeakButtonUI();
    }
  });

  // 監聽 Peak Mode Tool Bar 的開啟/關閉
  if (peakModeToolBar) {
    const observer = new MutationObserver(() => {
      peakToolBarOpen = peakModeToolBar.classList.contains('open');
      updatePeakButtonUI();
    });
    observer.observe(peakModeToolBar, { attributes: true, attributeFilter: ['class'] });
  }

  // 監聽 Tool Bar 的開啟/關閉（用於協調定位）
  if (toolBar) {
    const observer = new MutationObserver(() => {
      updatePeakButtonUI();
    });
    observer.observe(toolBar, { attributes: true, attributeFilter: ['class'] });
  }

  // Peak Mode Switch 事件
  if (peakModeSwitch) {
    peakModeSwitch.addEventListener('change', () => {
      peakModeActive = peakModeSwitch.checked;
      updatePeakButtonUI();
      onPeakModeToggled(peakModeActive);
    });
  }

  // Peak Threshold Slider 事件
  if (peakThresholdSlider) {
    peakThresholdSlider.addEventListener('input', (e) => {
      peakThreshold = parseFloat(e.target.value);
      if (peakThresholdVal) {
        peakThresholdVal.textContent = Math.round(peakThreshold * 100) + '%';
      }
      // 修改：改為在 input 事件中即時更新 spectrogram
      onThresholdChanged(peakThreshold);
    });

    // 修改：移除了原本的 change 事件監聽器 (滑塊放開時更新)
  }

  return {
    toggle: togglePeakMode,
    isActive: () => peakModeActive,
    getState: () => ({ peakModeActive, peakThreshold }),
    getThreshold: () => peakThreshold,
    setThreshold: (threshold) => {
      peakThreshold = threshold;
      if (peakThresholdSlider) peakThresholdSlider.value = threshold;
      if (peakThresholdVal) peakThresholdVal.textContent = Math.round(threshold * 100) + '%';
    }
  };
}

/**
 * 切換 Peak Mode 狀態
 */
function togglePeakMode() {
  peakModeActive = !peakModeActive;
  updatePeakButtonUI();
  
  const peakModeSwitch = document.getElementById('peakModeSwitch');
  if (peakModeSwitch) {
    peakModeSwitch.checked = peakModeActive;
  }
}

/**
 * 更新 Peak Button 的 UI 狀態
 * 狀態優先級：
 * 1. 紅色：Peak Mode 啟用（peakModeActive = true）
 * 2. 藍色：Peak-Tool-bar 開啟但 Peak Mode 未啟用（peakToolBarOpen = true）
 * 3. 灰色：默認狀態
 */
function updatePeakButtonUI() {
  const peakBtn = document.getElementById('peakBtn');
  if (!peakBtn) return;

  // 移除所有狀態類
  peakBtn.classList.remove('active', 'toolbar-open');
  
  if (peakModeActive) {
    // 狀態 1：Peak Mode 啟用 → 紅色
    peakBtn.classList.add('active');
    peakBtn.title = 'Peak Tracking Mode (Active';
  } else if (peakToolBarOpen) {
    // 狀態 2：Peak-Tool-bar 開啟，Peak Mode 未啟用 → 藍色
    peakBtn.classList.add('toolbar-open');
    peakBtn.title = 'Peak Tracking Mode (Toolbar Open)';
  } else {
    // 狀態 3：默認 → 灰色
    peakBtn.title = 'Peak Tracking Mode';
  }
}

/**
 * 獲取 Peak Mode 的狀態
 */
export function isPeakModeActive() {
  return peakModeActive;
}

/**
 * 設置 Peak Mode 狀態
 */
export function setPeakModeActive(active) {
  peakModeActive = active;
  updatePeakButtonUI();
  
  const peakModeSwitch = document.getElementById('peakModeSwitch');
  if (peakModeSwitch) {
    peakModeSwitch.checked = active;
  }
}

/**
 * 獲取 Peak Threshold
 */
export function getPeakThreshold() {
  return peakThreshold;
}

/**
 * 設置 Peak Threshold
 */
export function setPeakThreshold(threshold) {
  peakThreshold = threshold;
  const peakThresholdSlider = document.getElementById('peakThresholdSlider');
  const peakThresholdVal = document.getElementById('peakThresholdVal');
  
  if (peakThresholdSlider) {
    peakThresholdSlider.value = threshold;
  }
  if (peakThresholdVal) {
    peakThresholdVal.textContent = Math.round(threshold * 100) + '%';
  }
}