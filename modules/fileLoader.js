// modules/fileLoader.js

import { extractGuanoMetadata, parseGuanoMetadata } from './guanoReader.js';
import { addFilesToList, getFileList, getCurrentIndex, setCurrentIndex, removeFilesByName, setFileMetadata, getTimeExpansionMode } from './fileState.js';
import { showMessageBox } from './messageBox.js';

export async function getWavSampleRate(file) {
  if (!file) return 256000;
  const buffer = await file.arrayBuffer();
  const view = new DataView(buffer);
  let pos = 12;
  while (pos < view.byteLength - 8) {
    const chunkId = String.fromCharCode(
      view.getUint8(pos),
      view.getUint8(pos + 1),
      view.getUint8(pos + 2),
      view.getUint8(pos + 3)
    );
    const chunkSize = view.getUint32(pos + 4, true);
    if (chunkId === 'fmt ') {
      return view.getUint32(pos + 12, true);
    }
    pos += 8 + chunkSize;
    if (chunkSize % 2 === 1) pos += 1; // word alignment
  }
  return 256000;
}

export async function getWavDuration(file) {
  if (!file) return 0;
  const buffer = await file.arrayBuffer();
  const view = new DataView(buffer);
  let pos = 12;
  let sampleRate = 0;
  let numChannels = 1;
  let bitsPerSample = 16;
  let dataSize = 0;
  while (pos < view.byteLength - 8) {
    const chunkId = String.fromCharCode(
      view.getUint8(pos),
      view.getUint8(pos + 1),
      view.getUint8(pos + 2),
      view.getUint8(pos + 3)
    );
    const chunkSize = view.getUint32(pos + 4, true);
    if (chunkId === 'fmt ') {
      numChannels = view.getUint16(pos + 10, true);
      sampleRate = view.getUint32(pos + 12, true);
      bitsPerSample = view.getUint16(pos + 22, true);
    } else if (chunkId === 'data') {
      dataSize = chunkSize;
      break;
    }
    pos += 8 + chunkSize;
    if (chunkSize % 2 === 1) pos += 1;
  }
  if (sampleRate > 0 && dataSize > 0) {
    const bytesPerSample = (bitsPerSample / 8) * numChannels;
    const numSamples = dataSize / bytesPerSample;
    return numSamples / sampleRate;
  }
  return 0;
}

let lastObjectUrl = null;

export function initFileLoader({
  fileInputId,
  wavesurfer,
  spectrogramHeight,
  colorMap,
  onPluginReplaced,
  onFileLoaded,
  onBeforeLoad,
  onAfterLoad,
  onSampleRateDetected
}) {
  const fileInput = document.getElementById(fileInputId);
  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');
  const fileNameElem = document.getElementById('fileNameText');
  const guanoOutput = document.getElementById('guano-output');
  const spectrogramSettingsText = document.getElementById('spectrogram-settings-text');
  const uploadOverlay = document.getElementById('upload-overlay');
  const uploadProgressBar = document.getElementById('upload-progress-bar');
  const uploadProgressText = document.getElementById('upload-progress-text');

  function showUploadOverlay(total) {
    if (!uploadOverlay) return;
    document.dispatchEvent(new Event('drop-overlay-hide'));
    if (uploadProgressBar) uploadProgressBar.style.width = '0%';
    if (uploadProgressText) uploadProgressText.textContent = `0/${total}`;
    uploadOverlay.style.display = 'flex';
  }

  function updateUploadOverlay(count, total) {
    if (uploadProgressBar) {
      const pct = total > 0 ? (count / total) * 100 : 0;
      uploadProgressBar.style.width = `${pct}%`;
    }
    if (uploadProgressText) {
      uploadProgressText.textContent = `${count}/${total}`;
    }
  }

  function hideUploadOverlay() {
    if (uploadOverlay) uploadOverlay.style.display = 'none';
  }

  async function loadFile(file) {
    if (!file) return;

    console.log(`📂 [FileLoader] Start loading: ${file.name}`);

    // ============================================================
    // [STEP 0: 視覺快照管理 (單例模式)]
    // ============================================================
    
    // 1. 殺死所有殘留的快照 (防止堆疊)
    // 這是解決 RAM 累積的隱藏關鍵：如果舊快照沒刪乾淨，它會佔用顯存
    const existingSnapshots = document.querySelectorAll('#spectrogram-transition-snapshot');
    existingSnapshots.forEach(s => s.remove());

    const container = document.getElementById("spectrogram-only");
    if (container) {
        // 尋找舊的 Canvas
        const canvases = container.querySelectorAll("canvas:not(#spectrogram-transition-snapshot)");
        let oldCanvas = null;
        let maxArea = 0;
        canvases.forEach(c => {
            const area = c.width * c.height;
            if (area > maxArea) {
                maxArea = area;
                oldCanvas = c;
            }
        });
        
        if (oldCanvas && oldCanvas.width > 0) {
            console.log(`📸 [Snapshot] Creating snapshot from old canvas (${oldCanvas.width}x${oldCanvas.height})...`);
            
            // 獲取舊 Canvas 在螢幕上的絕對位置
            const rect = oldCanvas.getBoundingClientRect();
            
            const snapshot = document.createElement("canvas");
            snapshot.id = "spectrogram-transition-snapshot";
            // 設定與舊 Canvas 相同的解析度
            snapshot.width = oldCanvas.width;
            snapshot.height = oldCanvas.height;
            
            // 設定樣式：固定在螢幕上，完全覆蓋舊的位置
            Object.assign(snapshot.style, {
                position: "fixed", // 使用 fixed 避免受父容器 overflow 影響
                top: `${rect.top}px`,
                left: `${rect.left}px`,
                width: `${rect.width}px`,
                height: `${rect.height}px`,
                zIndex: "10", // 最高層級
                pointerEvents: "none",
                boxSizing: "border-box"
            });

            const ctx = snapshot.getContext("2d");
            ctx.drawImage(oldCanvas, 0, 0);
            document.body.appendChild(snapshot);
            
            console.log('📸 [Snapshot] Snapshot appended to BODY.');

            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

        } else {
            console.log('📸 [Snapshot] No valid old canvas found. Skipping.');
        }
    }

    // [STEP 1: 暴力清理]
    if (wavesurfer) {
        try {
            wavesurfer.stop();
            wavesurfer.empty();
            wavesurfer.decodedData = null;
            if (wavesurfer.backend) {
                wavesurfer.backend.buffer = null;
                if (wavesurfer.backend.source) {
                    try { wavesurfer.backend.source.disconnect(); } catch(e){}
                }
            }
            document.dispatchEvent(new Event('file-list-cleared')); 
        } catch (e) {
            console.warn("Cleanup warning:", e);
        }
    }
    
    // ... (STEP 2, 3, 4, 5 保持原本 loadBlob 的代碼不變) ...
    // [STEP 2]
    if (lastObjectUrl) {
        URL.revokeObjectURL(lastObjectUrl);
        lastObjectUrl = null;
    }

    // [STEP 3]
    const detectedSampleRate = await getWavSampleRate(file);
    if (typeof onBeforeLoad === 'function') onBeforeLoad();
    if (typeof onFileLoaded === 'function') onFileLoaded(file);
    if (typeof onSampleRateDetected === 'function') await onSampleRateDetected(detectedSampleRate, true);
    if (fileNameElem) fileNameElem.textContent = file.name;

    try {
      const result = await extractGuanoMetadata(file);
      guanoOutput.textContent = result || '(No GUANO metadata found)';
      const meta = parseGuanoMetadata(result);
      const idx = getCurrentIndex();
      setFileMetadata(idx, meta);
    } catch (err) {
      guanoOutput.textContent = '(Error reading GUANO metadata)';
    }

    // [STEP 4]
    try {
        await new Promise(r => setTimeout(r, 20));
        await wavesurfer.loadBlob(file);
    } catch (err) {
        if (err.name !== 'AbortError' && err.message !== 'The user aborted a request.') {
            console.warn("Load error:", err);
        }
    }

    // [STEP 5]
    if (typeof onPluginReplaced === 'function') {
      onPluginReplaced();
    }
    const sampleRate = detectedSampleRate || wavesurfer?.options?.sampleRate || 256000;
    if (typeof onAfterLoad === 'function') {
      onAfterLoad();
    }
    document.dispatchEvent(new Event('file-loaded'));
  }

  fileInput.addEventListener('change', async (event) => {
    const files = Array.from(event.target.files);
    const selectedFile = files[0];
    if (!selectedFile) return;

    const sameDirFiles = files.filter(f => f.name.endsWith('.wav'));
    showUploadOverlay(sameDirFiles.length);

    if (typeof onBeforeLoad === 'function') {
      onBeforeLoad();
    }

    let skippedLong = 0;
    let skippedSmall = 0;
    const sortedList = sameDirFiles.sort((a, b) => a.name.localeCompare(b.name));
    const filteredList = [];
    const metaList = [];
    for (let i = 0; i < sortedList.length; i++) {
      const fileItem = sortedList[i];
      const dur = await getWavDuration(fileItem);
      if (fileItem.size < 200 * 1024) {
        skippedSmall++;
      } else if (dur > 20 && !getTimeExpansionMode()) {
        // normally skip files longer than 20s, but allow when Time Expansion mode
        // is active (user requested 10x time expansion)
        skippedLong++;
      } else {
        filteredList.push(fileItem);
        try {
          const txt = await extractGuanoMetadata(sortedList[i]);
          metaList.push(parseGuanoMetadata(txt));
        } catch (err) {
          metaList.push({ date: '', time: '', latitude: '', longitude: '' });
        }
      }
      updateUploadOverlay(i + 1, sortedList.length);
    }

    const index = filteredList.findIndex(f => f.name === selectedFile.name);

    removeFilesByName('demo_recording.wav');
    const startIdx = getFileList().length;
    if (filteredList.length > 0) {
      addFilesToList(filteredList, index >= 0 ? index : 0);
      for (let i = 0; i < filteredList.length; i++) {
        setFileMetadata(startIdx + i, metaList[i]);
      }
    }
    hideUploadOverlay();
    if (filteredList.length > 0) {
      await loadFile(filteredList[index >= 0 ? index : 0]);
    }
    // reset value so that selecting the same file again triggers change
    fileInput.value = '';
    if (skippedLong > 0) {
      showMessageBox({
        title: 'Warning',
        message: `.wav files longer than 20 seconds are not supported and a total of (${skippedLong}) such files were skipped during the loading process. Please trim or preprocess these files to meet the duration requirement before loading.`
      });
    }
    if (skippedSmall > 0) {
      showMessageBox({
        title: 'Warning',
        message: `${skippedSmall} wav files were skipped due to small file size (<200kb).`
      });
    }
  });

  prevBtn.addEventListener('click', () => {
    const index = getCurrentIndex();
    if (index > 0) {
      setCurrentIndex(index - 1);
      const file = getFileList()[index - 1];
      loadFile(file);
    }
  });

  nextBtn.addEventListener('click', () => {
    const index = getCurrentIndex();
    const files = getFileList();
    if (index < files.length - 1) {
      setCurrentIndex(index + 1);
      const file = files[index + 1];
      loadFile(file);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey) return; // avoid conflict with zoom shortcuts
    
    // 如果正在調節 number input，禁止切換文件
    if (window.__isAdjustingNumberInput === true) return;
    
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      prevBtn.click();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      nextBtn.click();
    }
  });

  return {
    loadFileAtIndex: async (index) => {
      const files = getFileList();
      if (index >= 0 && index < files.length) {
        setCurrentIndex(index);
        await loadFile(files[index]);
      }
    }
  };  
}
