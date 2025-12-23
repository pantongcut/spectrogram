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
    
    // [STEP 0: 建立視覺快照 (防止閃爍)]
    // 在我們殺死舊數據前，先用一張「假圖片」蓋住畫面
    // 這樣使用者就看不到中間的「全白/閃爍」瞬間
    const container = document.getElementById("spectrogram-only");
    if (container) {
        const oldCanvas = container.querySelector("canvas");
        // 只有當舊 Canvas 存在且有寬度時才截圖
        if (oldCanvas && oldCanvas.width > 0) {
            const snapshot = document.createElement("canvas");
            snapshot.id = "spectrogram-transition-snapshot";
            snapshot.width = oldCanvas.width;
            snapshot.height = oldCanvas.height;
            snapshot.style.position = "absolute";
            snapshot.style.top = "0";
            snapshot.style.left = "0";
            snapshot.style.width = "100%";
            snapshot.style.height = "100%";
            snapshot.style.zIndex = "100"; // 確保蓋在最上面
            snapshot.style.pointerEvents = "none"; // 讓滑鼠可以穿透

            const ctx = snapshot.getContext("2d");
            // 將舊 Canvas 的像素複製到快照上
            ctx.drawImage(oldCanvas, 0, 0);
            container.appendChild(snapshot);
        }
    }

    // [STEP 1: 暴力清理舊狀態 (RAM 歸零)] 
    // 使用者現在看到的是 Snapshot，所以我們可以放心在後台進行破壞性清理
    if (wavesurfer) {
        try {
            wavesurfer.stop();
            wavesurfer.decodedData = null;
            
            if (wavesurfer.backend) {
                wavesurfer.backend.buffer = null;
                if (wavesurfer.backend.source) {
                    try { wavesurfer.backend.source.disconnect(); } catch(e){}
                }
            }

            // 通知 Spectrogram 銷毀 (釋放顯存)
            // 雖然這會移除舊 Canvas，但我們的 Snapshot 還在，所以不會閃爍
            document.dispatchEvent(new Event('file-list-cleared')); 
        } catch (e) {
            console.warn("Cleanup warning:", e);
        }
    }

    // [STEP 2: 清理遺留的 ObjectURL]
    if (lastObjectUrl) {
        URL.revokeObjectURL(lastObjectUrl);
        lastObjectUrl = null;
    }

    // --- Metadata 處理 (保持不變) ---
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

    // [STEP 3: 使用 loadBlob (RAM 不累積)]
    try {
        await wavesurfer.loadBlob(file);
    } catch (err) {
        if (err.name !== 'AbortError' && err.message !== 'The user aborted a request.') {
            console.warn("Load error:", err);
        }
    }

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
