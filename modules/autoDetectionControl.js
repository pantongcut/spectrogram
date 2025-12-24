/**
 * Auto Detection Control Module
 * 管理 Auto Detection Toolbar 的顯示與互動
 */

export function initAutoDetectionControl() {
  // 動態導入 wsManager 中的 runAutoDetection
  // 注意：這會在 module 初始化時執行，所以 wsManager 應該已經準備好
  import('./wsManager.js').then(({ runAutoDetection }) => {
    const autoDetectBtn = document.getElementById('autoDetectBtn');
    const toolBar = document.getElementById('auto-detect-tool-bar');
    const slider = document.getElementById('autoDetectThresholdSlider');
    const valDisplay = document.getElementById('autoDetectThresholdVal');
    const runBtn = document.getElementById('runAutoDetectBtn');
    const exportBtn = document.getElementById('exportCallsBtn');
    
    if (!autoDetectBtn || !toolBar) return;
    
    // 關閉其他的 Toolbar (Helper)
    const closeOtherToolbars = () => {
      document.querySelectorAll('.tool-bar-submenu.open').forEach(el => {
        if (el !== toolBar) el.classList.remove('open');
      });
      // 移除其他按鈕的 toolbar-open 狀態
      document.querySelectorAll('.top-bar button.toolbar-open').forEach(el => {
        if (el !== autoDetectBtn) el.classList.remove('toolbar-open');
      });
    };

    // 1. Toggle Toolbar
    autoDetectBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeOtherToolbars();
      
      const isOpen = toolBar.classList.toggle('open');
      if (isOpen) {
        autoDetectBtn.classList.add('toolbar-open');
      } else {
        autoDetectBtn.classList.remove('toolbar-open');
      }
    });

    // 點擊外部關閉 Toolbar
    document.addEventListener('click', (e) => {
      if (toolBar.classList.contains('open') && 
          !toolBar.contains(e.target) && 
          e.target !== autoDetectBtn && 
          !autoDetectBtn.contains(e.target)) {
        toolBar.classList.remove('open');
        autoDetectBtn.classList.remove('toolbar-open');
      }
    });

    // 2. Slider Interaction
    if (slider && valDisplay) {
      slider.addEventListener('input', () => {
        valDisplay.textContent = `${slider.value} dB`;
      });
    }

    // 3. Run Detection Button
    if (runBtn) {
      runBtn.addEventListener('click', () => {
        const threshold = parseInt(slider.value, 10);
        console.log(`[AutoDetect] Starting detection with threshold: ${threshold}dB`);
        
        // 執行偵測
        runAutoDetection(threshold);
        
        // 可選：執行後自動關閉 Toolbar
        // toolBar.classList.remove('open');
        // autoDetectBtn.classList.remove('toolbar-open');
      });
    }

    // [NEW] 4. Export Calls Button
    if (exportBtn) {
      exportBtn.addEventListener('click', () => {
        console.log('[AutoDetect] Requesting export of detected calls...');
        // 發送自定義事件，通知主控制器導出偵測結果
        document.dispatchEvent(new CustomEvent('request-export-calls'));
      });
    }
  }).catch(err => {
    console.error('[autoDetectionControl] Failed to import wsManager:', err);
  });
}

