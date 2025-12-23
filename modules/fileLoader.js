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

    // ============================================================
    // [STEP 1: 暴力清理舊狀態] 
    // 這一步確保在載入新檔案前，RAM 是乾淨的 (歸零策略)
    // ============================================================
    if (wavesurfer) {
        try {
            // 1. 停止播放
            wavesurfer.stop();
            
            // 2. 斬斷對上一張頻譜圖數據的引用
            wavesurfer.decodedData = null;
            
            // 3. 清空 WebAudio Backend 的緩衝區
            if (wavesurfer.backend) {
                wavesurfer.backend.buffer = null;
                // 如果有 source node，斷開連接
                if (wavesurfer.backend.source) {
                    try { wavesurfer.backend.source.disconnect(); } catch(e){}
                }
            }

            // 4. 發送事件通知 Spectrogram 插件立即自我銷毀 (釋放 GPU 顯存)
            // 這會觸發我們在 wsManager 中寫的 canvas.width=0 邏輯
            document.dispatchEvent(new Event('file-list-cleared')); 
        } catch (e) {
            console.warn("Cleanup warning:", e);
        }
    }

    // ============================================================
    // [STEP 2: 清理遺留的 ObjectURL]
    // 雖然我們現在改用 loadBlob，但為了保險起見，如果之前有殘留的 URL，先清掉
    // ============================================================
    if (lastObjectUrl) {
        URL.revokeObjectURL(lastObjectUrl);
        lastObjectUrl = null;
    }

    // ============================================================
    // [STEP 3: Metadata 讀取 (保持原有功能不變)]
    // ============================================================
    const detectedSampleRate = await getWavSampleRate(file);

    if (typeof onBeforeLoad === 'function') {
      onBeforeLoad();
    }

    if (typeof onFileLoaded === 'function') {
      onFileLoaded(file);
    }

    if (typeof onSampleRateDetected === 'function') {
      await onSampleRateDetected(detectedSampleRate, true);
    }
    
    if (fileNameElem) {
      fileNameElem.textContent = file.name;
    }

    try {
      const result = await extractGuanoMetadata(file);
      guanoOutput.textContent = result || '(No GUANO metadata found)';
      const meta = parseGuanoMetadata(result);
      const idx = getCurrentIndex();
      setFileMetadata(idx, meta);
    } catch (err) {
      guanoOutput.textContent = '(Error reading GUANO metadata)';
    }

    // ============================================================
    // [STEP 4: 核心修改 - 改用 loadBlob]
    // 舊代碼: const fileUrl = URL.createObjectURL(file); await wavesurfer.load(fileUrl);
    // 新代碼: 直接傳遞 file 對象
    // ============================================================
    try {
        // loadBlob 會直接讀取 File 對象的內存，不會生成需要手動 revoke 的 URL
        // 配合 wavesurfer.esm.js 中的 try...finally { s = null }，
        // 一旦載入被中斷或完成，檔案引用會立即消失，GC 可以馬上回收。
        await wavesurfer.loadBlob(file);
    } catch (err) {
        // 如果是因為快速切換導致的 AbortError (中斷)，這是正常的，忽略它
        // 這樣控制台就不會報紅字
        if (err.name !== 'AbortError' && err.message !== 'The user aborted a request.') {
            console.warn("Load error:", err);
        }
    }

    // ============================================================
    // [STEP 5: 後續處理 (保持原有功能不變)]
    // ============================================================
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
