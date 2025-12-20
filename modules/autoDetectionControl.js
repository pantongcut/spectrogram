import { getWavesurfer, getPlugin } from './wsManager.js';
import { getTimeExpansionMode } from './fileState.js';

/**
 * Initialize Auto Detection Mode
 * @param {Object} config - Configuration object
 * @param {Object} config.frequencyHoverControl - Reference to frequency hover control
 * @param {Function} config.getDuration - Function to get current audio duration
 * @param {Function} config.getZoomLevel - Function to get current zoom level
 * @param {number} config.spectrogramHeight - Height of spectrogram in pixels
 * @param {number} config.minFrequency - Minimum frequency displayed (kHz)
 * @param {number} config.maxFrequency - Maximum frequency displayed (kHz)
 */
export function initAutoDetection(config) {
  const {
    frequencyHoverControl,
    getDuration,
    getZoomLevel,
    spectrogramHeight,
    minFrequency = 10,
    maxFrequency = 128
  } = config;

  const autoDetectBtn = document.getElementById('autoDetectBtn');
  const autoDetectModeToolBar = document.getElementById('auto-detect-mode-tool-bar');
  const detectThresholdSlider = document.getElementById('detectThresholdSlider');
  const detectThresholdVal = document.getElementById('detectThresholdVal');
  const autoDetectSwitch = document.getElementById('autoDetectSwitch');

  let isAutoDetectModeActive = false;
  let currentPeakMax = null; // Store the global peak for calculations

  // Toggle Auto Detection Mode
  autoDetectBtn.addEventListener('click', () => {
    isAutoDetectModeActive = !isAutoDetectModeActive;
    
    if (isAutoDetectModeActive) {
      autoDetectBtn.classList.add('active');
      autoDetectModeToolBar.style.display = '';
    } else {
      autoDetectBtn.classList.remove('active');
      autoDetectModeToolBar.style.display = 'none';
      autoDetectSwitch.checked = false;
      if (frequencyHoverControl) {
        frequencyHoverControl.clearSelections();
      }
    }
  });

  // Update threshold value display
  detectThresholdSlider.addEventListener('input', (e) => {
    detectThresholdVal.textContent = `${e.target.value}%`;
    
    // If auto-detect is enabled, re-run detection
    if (autoDetectSwitch.checked) {
      performAutoDetection();
    }
  });

  // Handle auto-detect switch toggle
  autoDetectSwitch.addEventListener('change', (e) => {
    console.log(`[autoDetectionControl] Switch toggled: ${e.target.checked ? 'ON' : 'OFF'}`);
    if (e.target.checked) {
      console.log('[autoDetectionControl] Starting detection...');
      performAutoDetection();
    } else {
      console.log('[autoDetectionControl] Clearing selections...');
      if (frequencyHoverControl) {
        frequencyHoverControl.clearSelections();
      }
    }
  });

  /**
   * Perform auto-detection based on current threshold
   */
// autoDetectionControl.js - Revised performAutoDetection

async function performAutoDetection() {
    console.log('[autoDetectionControl] ✅ performAutoDetection called');

    // 1. Get Audio Data & Spectrogram Data
    // 優先嘗試從現有的 Spectrogram Plugin 獲取已計算的數據 (效能最佳)
    const plugin = wsManager.getPlugin();
    let flatArray = null;
    let numCols = 0; // Frequency bins
    let numRows = 0; // Time frames
    let sampleRate = 0;
    let fftSize = 0;
    
    // 獲取 Wavesurfer 解碼後的音訊數據 (用於參數參考或 Fallback)
    const ws = wsManager.getWavesurfer();
    if (!ws) return;
    const decodedData = ws.getDecodedData();
    if (!decodedData) {
        console.warn('[autoDetectionControl] Audio not decoded yet');
        return;
    }
    sampleRate = decodedData.sampleRate;

    // 嘗試從 Plugin 提取數據
    // 注意：不同的 Spectrogram 實作存放數據的變數名可能不同 (spectrogram, frequenciesData, etc.)
    // 這裡假設是標準結構，如果你的 plugin 結構不同，請調整屬性名
    if (plugin && plugin.spectrogram && plugin.spectrogram.length > 0) {
        console.log('[autoDetectionControl] Using existing plugin data');
        // plugin.spectrogram 通常是 Array of Uint8Array (0-255) 或 Float32Array
        // 如果是 Uint8Array，這是已經 mapping 過顏色的數據，不適合做精確的物理運算
        // 我們需要原始的 Magnitude 數據。
        // 如果 plugin 沒有保留原始 magnitude，我們必須用 WASM 重算。
        
        // 檢查是否有原始數據 (rawSpectrogram or similar)
        // 如果沒有，我們進入下方的 WASM 重算流程
    }

    // 如果無法從 Plugin 直接獲取原始 Magnitude，我們使用 WASM Engine 重算
    // 這是最穩妥的方法，確保我們拿到的是 Linear Amplitude 用於計算 dB
    if (!flatArray) {
        const wasmEngine = wsManager.getOrCreateWasmEngine();
        
        // 檢查 WASM Engine 是否可用
        if (wasmEngine) {
            try {
                const channelData = decodedData.getChannelData(0);
                
                // [關鍵修正] 檢查正確的方法名稱
                // 通常是 compute() 或是在建構時傳入，這裡假設是用 compute
                // 如果你的 Rust 方法叫 compute_spectrogram，請確保 bindgen 有導出它
                // 如果沒有，我們嘗試標準的 compute 方法
                
                let spectrogramVec;
                
                if (typeof wasmEngine.compute_spectrogram === 'function') {
                    spectrogramVec = wasmEngine.compute_spectrogram(channelData);
                } else if (typeof wasmEngine.compute === 'function') {
                    spectrogramVec = wasmEngine.compute(channelData);
                } else {
                     // 如果找不到計算方法，可能需要重新初始化 Engine 或檢查 API
                     console.error('[autoDetectionControl] ❌ WASM engine has no compute method. Methods:', Object.getPrototypeOf(wasmEngine));
                     return;
                }

                // 轉換 WASM Vector 到 JS Float32Array
                // 注意：這取決於你的 WASM 回傳什麼。如果是指針，需要 unsafe view。
                // 假設它回傳的是 JS 側的 Float32Array 副本
                flatArray = spectrogramVec; 
                
                // 獲取維度資訊
                // 假設 engine 有 getters
                fftSize = wsManager.getCurrentFftSize ? wsManager.getCurrentFftSize() : 1024;
                numCols = fftSize / 2 + 1; // Standard FFT bins
                numRows = flatArray.length / numCols;
                
                console.log(`[autoDetectionControl] Computed new spectrogram: ${numRows} x ${numCols}`);

            } catch (e) {
                console.error('[autoDetectionControl] Error computing spectrogram via WASM:', e);
                return;
            }
        } else {
             console.error('[autoDetectionControl] ❌ WASM engine not initialized');
             return;
        }
    }

    if (!flatArray) {
        console.error('[autoDetectionControl] Failed to acquire spectrogram data');
        return;
    }

    // 2. Calculate Peak Max (Correct Physics Logic)
    // 模擬 BatCallDetector 的算法：20 * log10(magnitude)
    // 我們需要遍歷整個陣列找出最大的 dB 值
    
    let maxDB = -1000;
    // 為了效能，可以抽樣檢查，但為了準確度，建議檢查全部 (使用簡單的 for loop)
    // 注意：flatArray 應該是 Linear Magnitude
    
    for (let i = 0; i < flatArray.length; i++) {
        const mag = flatArray[i];
        // 防止 log(0)
        if (mag > 0.00000001) {
             const db = 20 * Math.log10(mag);
             if (db > maxDB) maxDB = db;
        }
    }
    
    // 如果訊號太弱或全靜音
    if (maxDB < -999) maxDB = -100;

    // 3. Calculate Threshold
    // Logic: Slider 50% = -24dB relative to Peak
    // Slider 100% = 0dB relative to Peak (Threshold = Peak)
    // Slider 0% = -48dB relative to Peak
    const sliderVal = parseInt(detectThresholdSlider.value, 10);
    const dropDB = 48 * (1 - sliderVal / 100); 
    const thresholdDB = maxDB - dropDB;
    
    // Convert Threshold back to Linear for WASM comparison
    // 因為 WASM 裡面的數據是 Linear 的，我們傳 Linear Threshold 進去比對最快
    const linearThreshold = Math.pow(10, thresholdDB / 20);

    console.log(`[autoDetectionControl] Peak: ${maxDB.toFixed(2)} dB, Slider: ${sliderVal}, Threshold: ${thresholdDB.toFixed(2)} dB (Linear: ${linearThreshold.toExponential(4)})`);

    // 4. Call WASM Detection Logic
    // 確保 wsManager 有提供調用 detect_segments 的方法
    // 這裡我們直接使用全局的 WASM 模組函數，或者掛載在 wsManager 上的 helper
    
    if (!globalThis._spectrogramWasm || !globalThis._spectrogramWasm.detect_segments) {
        console.error('[autoDetectionControl] ❌ detect_segments function not found in WASM module');
        return;
    }

    const paddingMs = 5.0; // 5ms padding
    // Hop size (overlap) calculation
    // 假設 standard overlap 50% 或從 wsManager 獲取
    // 為了安全，重新計算 hopSize
    const hopSize = Math.floor(sampleRate / (sampleRate / (fftSize / 2))); // 粗略估算，最好從 wsManager 拿準確的
    // 實際上 Spectrogram 繪製通常是 FFT size, Hop size = FFT / 2 (若無 overlap 設定)
    // 這裡假設 hopSize = fftSize / 2 (50% overlap is standard)
    const exactHopSize = fftSize / 2; 

    try {
        const segments = globalThis._spectrogramWasm.detect_segments(
            flatArray,
            numCols,
            linearThreshold, // Pass LINEAR threshold
            sampleRate,
            fftSize,
            exactHopSize, // hop_size
            paddingMs
        );

        console.log(`[autoDetectionControl] Detected ${segments.length / 2} segments`);

        // 5. Generate Selections
        frequencyHoverControl.clearSelections();
        
        // Spectrogram 的頻率範圍 (UI 顯示範圍)
        const freqMin = wsManager.getPlugin().options.frequencyMin / 1000 || 10;
        const freqMax = wsManager.getPlugin().options.frequencyMax / 1000 || 128;

        for (let i = 0; i < segments.length; i += 2) {
            const start = segments[i];
            const end = segments[i+1];
            
            // 呼叫 frequencyHover.js 的 programmaticSelect
            if (frequencyHoverControl && frequencyHoverControl.programmaticSelect) {
                frequencyHoverControl.programmaticSelect(start, end, freqMin, freqMax);
            }
        }
        
    } catch (e) {
        console.error('[autoDetectionControl] Error during WASM detection:', e);
    }
}

  /**
   * Calculate the global peak maximum from linear magnitude spectrogram
   * Matches batCallDetector.js methodology: 10 * Math.log10(linearMagnitude)
   * @param {Float32Array} linearSpectrogram - Linear magnitude spectrogram data
   * @param {number} fftSize - FFT size (used for power calculation)
   * @returns {number} Peak maximum in dB
   */
  function calculatePeakMax(linearSpectrogram, fftSize = 512) {
    console.log(`[calculatePeakMax] Input type: ${linearSpectrogram.constructor.name}, length: ${linearSpectrogram.length}, FFT size: ${fftSize}`);
    
    // Find peak linear magnitude value across all bins
    let maxLinearMagnitude = 0;
    let binCount = 0;
    
    for (let i = 0; i < linearSpectrogram.length; i++) {
      const linearMag = linearSpectrogram[i];
      if (linearMag > maxLinearMagnitude) {
        maxLinearMagnitude = linearMag;
      }
      binCount++;
    }
    
    console.log(`[calculatePeakMax] Scanned ${binCount} bins, max linear magnitude: ${maxLinearMagnitude.toFixed(6)}`);
    
    // Convert linear magnitude to power (magnitude squared) and then to dB
    // Following batCallDetector.js formula: 10 * Math.log10(power)
    // power = (linearMagnitude^2) / fftSize (normalized power spectral density)
    if (maxLinearMagnitude > 0) {
      const powerLinear = (maxLinearMagnitude * maxLinearMagnitude) / fftSize;
      const peakMaxDb = 10 * Math.log10(Math.max(powerLinear, 1e-16));
      console.log(`[calculatePeakMax] Conversion: linear_mag=${maxLinearMagnitude.toFixed(6)} → power=(mag²/fftSize)=${powerLinear.toFixed(9)} → dB=10*log10(${powerLinear.toFixed(9)}) = ${peakMaxDb.toFixed(2)} dB`);
      return peakMaxDb;
    }
    
    console.log(`[calculatePeakMax] No data found, returning -100 dB (silence)`);
    return -100;  // Return very low dB when no data
  }

  // Reset peak max when a new file is loaded
  document.addEventListener('fileLoaded', () => {
    currentPeakMax = null;
    if (frequencyHoverControl) {
      frequencyHoverControl.clearSelections();
    }
  });

  return {
    isActive: () => isAutoDetectModeActive,
    performDetection: performAutoDetection,
    clearSelections: () => {
      if (frequencyHoverControl) {
        frequencyHoverControl.clearSelections();
      }
    },
    setActive: (active) => {
      isAutoDetectModeActive = active;
      if (active) {
        autoDetectBtn.classList.add('active');
        autoDetectModeToolBar.style.display = '';
      } else {
        autoDetectBtn.classList.remove('active');
        autoDetectModeToolBar.style.display = 'none';
        autoDetectSwitch.checked = false;
        if (frequencyHoverControl) {
          frequencyHoverControl.clearSelections();
        }
      }
    }
  };
}
