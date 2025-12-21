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

    const fileUrl = URL.createObjectURL(file);
    // Don't revoke old URL yet - WaveSurfer might still be using it
    // Store it for later revocation
    const oldObjectUrl = lastObjectUrl;
    lastObjectUrl = fileUrl;

    await wavesurfer.load(fileUrl);

    if (typeof onPluginReplaced === 'function') {
      onPluginReplaced();
    }

    const sampleRate = detectedSampleRate || wavesurfer?.options?.sampleRate || 256000;

    if (typeof onAfterLoad === 'function') {
      onAfterLoad();
    }
    
    // POST-LOAD CLEANUP: After loading new file, clean up old resources
    // Use longer delay to ensure WaveSurfer worker has finished decoding
    setTimeout(() => {
      try {
        // Now safe to revoke old URL since new file is loaded
        if (oldObjectUrl) {
          URL.revokeObjectURL(oldObjectUrl);
          console.log('✅ [fileLoader] Revoked old Blob URL');
        }
        
        // Additional aggressive clearing of anything that might have been cached
        if (wavesurfer && wavesurfer.backend) {
          // Try more property names
          const keysToNull = [
            'audioBuffer', 'decodedData', 'buffer', 'data', 'rawData',
            'originalAudioBuffer', 'filteredBuffer', 'offlineContext',
            'convolver', 'analyser', 'scriptProcessor', 'gainNode',
            'duration', 'frameData', 'audioContext', 'dest'
          ];
          keysToNull.forEach(key => {
            if (wavesurfer.backend[key]) {
              wavesurfer.backend[key] = null;
            }
          });
          console.log('🗑️ [fileLoader] Cleared WaveSurfer audio buffers and nodes after load');
        }
        
        // Try to force garbage collection by suggesting it to the browser
        if (window.gc) {
          window.gc();
          console.log('💾 [fileLoader] Triggered manual garbage collection');
        }
      } catch (err) {
        console.warn('⚠️ [fileLoader] Error in post-load cleanup:', err);
      }
    }, 400);
    
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
