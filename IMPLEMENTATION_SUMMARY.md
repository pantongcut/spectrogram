# Auto Detection dB Calculation Fix - Implementation Summary

## Overview
Fixed the critical dB calculation error in Auto Detection Mode that was causing physically incorrect Peak Max values (+60 dB instead of -20 to -30 dB typical for bat calls).

## Problem
- **Previous Behavior**: Peak Max always showed ~60 dB regardless of actual signal strength
- **Root Cause**: Used U8 visualization values (0-255) instead of linear magnitude values, and applied wrong conversion formula
- **Impact**: Threshold calculation was incorrect, leading to massive false-positive detections

## Solution
Refactored Auto Detection to:
1. Use WASM's `compute_spectrogram()` for linear magnitude data (instead of `getFrequencies()` which returns U8 visualization)
2. Apply correct dB conversion: `10 * Math.log10(power)` where `power = (mag²) / fftSize`
3. Convert entire spectrogram to dB before sending to WASM `detect_segments`
4. Ensure domain matching: dB values compared to dB threshold

## Modified Files
- **`modules/autoDetectionControl.js`**
  - `performAutoDetection()`: Complete rewrite to use linear magnitude spectrogram
  - `calculatePeakMax()`: Updated to use correct dB formula

## Key Changes

### 1. Data Source (Line ~116)
```javascript
// Before: Use visualization U8 data
// const spectrogramMatrix = await plugin.getFrequencies(decodedData);

// After: Use linear magnitude data
const linearSpectrogram = wasmModule.compute_spectrogram(audioData, noverlap);
```

### 2. Peak Calculation (Line ~244)
```javascript
// Before: Wrong formula - (U8/255)*80-20 = 60 dB
const peakMaxDb = (maxU8 / 255.0) * rangeDB - gainDB;

// After: Correct formula - 10*log10(power)
const powerLinear = (maxLinearMagnitude * maxLinearMagnitude) / fftSize;
const peakMaxDb = 10 * Math.log10(Math.max(powerLinear, 1e-16));
```

### 3. WASM Input (Line ~153-160)
```javascript
// Before: Pass U8 values directly
// const flatArray = new Float32Array(U8_data);

// After: Convert linear to dB first
const dbSpectrogram = new Float32Array(linearSpectrogram.length);
for (let i = 0; i < linearSpectrogram.length; i++) {
  const linearMag = linearSpectrogram[i];
  const powerLinear = (linearMag * linearMag) / fftSize;
  dbSpectrogram[i] = 10 * Math.log10(Math.max(powerLinear, 1e-16));
}
wasmModule.detect_segments(dbSpectrogram, ..., thresholdDb, ...);
```

## Expected Results

### Console Output
```
[autoDetectionControl] ✅ performAutoDetection called
[autoDetectionControl] Computing linear magnitude spectrogram: fftSize=512, noverlap=384, hopSize=256
[autoDetectionControl] Linear spectrogram available: 4730 frames x 256 bins
[autoDetectionControl] ✅ calculatePeakMax returned: -28.45 dB
[autoDetectionControl] Peak Max: -28.45 dB, Slider: 50%, Threshold: -52.45 dB
[autoDetectionControl] Converted linear spectrogram to dB values. Sample: dbSpectrogram[0]=-85.32 dB
[autoDetectionControl] ✅ detect_segments returned 4 values (2 segments)
[autoDetectionControl] ✅ Created 2 selections
```

### Peak Max Values
| Signal | Before | After |
|--------|--------|-------|
| Bat call (normal) | 60 dB | -20 to -30 dB |
| Quiet signal | 60 dB | -40 to -50 dB |
| Silence | 60 dB | -100 dB |

### Detection Quality
- **Before**: 200+ false detections (entire recording marked)
- **After**: 2-5 accurate detections (only actual bat calls)

## Testing Instructions

1. Load a bat call audio file
2. Enable "Auto Detection Mode" (blue button)
3. Check console output for peak dB value (should be negative, like -28 dB)
4. Adjust threshold slider and verify detections update appropriately
5. Verify highlighted segments correspond to actual bat calls

## Technical Validation

✅ **Formula**: 10*log10(power) matches batCallDetector.js (line 535)  
✅ **Normalization**: (mag²)/fftSize matches Rust implementation  
✅ **Domain Matching**: dB to dB comparison in WASM  
✅ **Epsilon Protection**: Avoids log(0) with 1e-16  
✅ **Console Logging**: Detailed debugging information provided  

## References
- `batCallDetector.js` line 535: `10 * Math.log10(Math.max(..., 1e-16))`
- `spectrogram-wasm/src/lib.rs` line 1079: `10.0 * psd.max(1e-16).log10()`
- `spectrogram_wasm.d.ts` line 65: `compute_spectrogram()` returns linear magnitudes

---

**Date**: December 20, 2025  
**Status**: ✅ Ready for Testing and Review
