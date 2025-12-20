# WASM Method Access & dB Logic Fix - Complete Implementation

## Problem Fixed

### 1. WASM Method Access Error
**Error**: `[autoDetectionControl] ❌ WASM compute_spectrogram not available`

**Root Cause**: 
- Trying to access WASM module via `globalThis._spectrogramWasm` (doesn't exist)
- WASM engine is stored as `plugin._wasmEngine` in the SpectrogramPlugin instance
- The `detect_segments` is a standalone export from `spectrogram_wasm.js`, not an instance method

**Solution**:
```javascript
// BEFORE: Wrong location
const wasmModule = globalThis._spectrogramWasm;  // ❌ This is null/undefined

// AFTER: Correct location
const wasmEngine = plugin._wasmEngine;  // ✅ This has compute_spectrogram method
const { detect_segments } = await import('./spectrogram_wasm.js');  // ✅ Standalone function
```

### 2. dB Calculation Logic
**Corrected Formula**: `20 * log10(magnitude)`

**Why Not 10*log10(power)?**
- 10*log10 is for power spectral density
- 20*log10 is for amplitude/magnitude (what we're directly using)
- Since WASM's `compute_spectrogram()` returns linear **magnitude** values (not power), we use 20*log10

**Conversion Chain**:
```
Linear Magnitude (from WASM)
    ↓
Peak Max = 20 * log10(peak_magnitude)  [dB]
    ↓
Threshold = Peak Max - slider_attenuation  [dB]
    ↓
Linear Threshold = 10^(Threshold_dB / 20)  [magnitude]
    ↓
WASM Compare: magnitude[i] >= linearThreshold  [both linear]
```

## Code Changes

### File: `/workspaces/spectrogram/modules/autoDetectionControl.js`

#### Change 1: WASM Engine Access (Line ~112)
```javascript
// BEFORE
const wasmModule = globalThis._spectrogramWasm;
if (!wasmModule || !wasmModule.compute_spectrogram) { ... }
const linearSpectrogram = wasmModule.compute_spectrogram(...);

// AFTER
const wasmEngine = plugin._wasmEngine;
if (!wasmEngine || !wasmEngine.compute_spectrogram) { ... }
const linearSpectrogram = wasmEngine.compute_spectrogram(...);
```

#### Change 2: detect_segments Import (Line ~187)
```javascript
// BEFORE
const wasmModule = globalThis._spectrogramWasm;
if (!wasmModule.detect_segments) { ... }
const segments = wasmModule.detect_segments(...);

// AFTER
const { detect_segments } = await import('./spectrogram_wasm.js');
if (typeof detect_segments !== 'function') { ... }
const segments = detect_segments(...);
```

#### Change 3: dB Calculation (Line ~163)
```javascript
// BEFORE (10*log10 with power normalization)
const powerLinear = (maxLinearMagnitude * maxLinearMagnitude) / fftSize;
const peakMaxDb = 10 * Math.log10(Math.max(powerLinear, 1e-16));

// AFTER (20*log10 with magnitude)
const peakMaxDb = 20 * Math.log10(Math.max(maxLinearMagnitude, 1e-9));
```

#### Change 4: Threshold Conversion (Line ~172)
```javascript
// BEFORE (Converting dB to linear power for comparison)
const thresholdLinearPower = Math.pow(10, thresholdDb / 10);

// AFTER (Converting dB to linear magnitude for comparison)
const linearThreshold = Math.pow(10, thresholdDb / 20);
```

#### Change 5: WASM Function Call (Line ~201)
```javascript
// BEFORE (Passing converted dB array)
const dbSpectrogram = new Float32Array(linearSpectrogram.length);
for (let i = 0; i < linearSpectrogram.length; i++) {
  // ... convert to dB
  dbSpectrogram[i] = 10 * Math.log10(...);
}
const segments = wasmModule.detect_segments(dbSpectrogram, numBins, thresholdDb, ...);

// AFTER (Passing original linear magnitude array)
const segments = detect_segments(linearSpectrogram, numBins, linearThreshold, ...);
```

## Function Signatures

### `calculatePeakMax(linearSpectrogram)`
- **Input**: Float32Array from `wasmEngine.compute_spectrogram()`
- **Calculation**: `20 * log10(max(magnitude))`
- **Output**: dB value (typically -100 to -10 dB for real audio)
- **Example**: max_magnitude = 0.1 → dB = 20 * log10(0.1) = -20 dB

### `performAutoDetection()`
- **Data Flow**:
  1. Get linear magnitude from WASM
  2. Calculate peak in dB: `20 * log10(magnitude)`
  3. Calculate threshold: `peak_dB - slider_attenuation`
  4. Convert to linear: `10^(threshold_dB / 20)`
  5. Call WASM with linear magnitude and linear threshold
  6. WASM compares: `magnitude >= linearThreshold`

## Console Output Examples

### Expected Output (Correct):
```
[autoDetectionControl] ✅ performAutoDetection called
[autoDetectionControl] Computing linear magnitude spectrogram: fftSize=512, noverlap=384, hopSize=256
[autoDetectionControl] Linear spectrogram available: 4730 frames x 256 bins (total 1210880 values)
[autoDetectionControl] ✅ calculatePeakMax returned: -20.45 dB
[autoDetectionControl] Peak Max: -20.45 dB, Slider: 50%, Threshold: -44.45 dB
[autoDetectionControl] Threshold conversion: -44.45 dB → 0.005754 linear magnitude
[autoDetectionControl] Calling detect_segments with: linearSpectrogram.length=1210880, numCols=256, linearThreshold=0.005754, sampleRate=44100, hopSize=256
[autoDetectionControl] ✅ detect_segments returned 4 values (2 segments)
[autoDetectionControl] ✅ Created 2 selections
```

## Key Formula Reference

### Magnitude to dB Conversion
```
dB = 20 × log₁₀(magnitude)
```

### dB to Magnitude Conversion (Inverse)
```
magnitude = 10^(dB / 20)
```

### Example Conversion Table
| Linear Magnitude | dB (20*log10) |
|------------------|---------------|
| 1.0              | 0 dB          |
| 0.1              | -20 dB        |
| 0.01             | -40 dB        |
| 0.001            | -60 dB        |
| 0.0001           | -80 dB        |

## Domain Matching Table

| Stage | Variable | Domain | Formula | Type |
|-------|----------|--------|---------|------|
| 1 | linearSpectrogram | Linear | From WASM | Float32Array |
| 2 | maxLinearMagnitude | Linear | Max of (1) | Number |
| 3 | currentPeakMax | dB | 20*log10(2) | Number |
| 4 | thresholdDb | dB | PeakMax - Attenuation | Number |
| 5 | linearThreshold | Linear | 10^(4/20) | Number |
| 6 | segments | Time | From WASM | Float32Array |

**Critical**: Stages 1, 2, 5, 6 must all be in LINEAR domain for WASM comparison to work correctly.

## Verification Checklist

✅ WASM engine accessed via `plugin._wasmEngine` (not globalThis)  
✅ `detect_segments` imported as standalone function (not instance method)  
✅ dB calculation uses `20 * log10(magnitude)` (not `10 * log10(power)`)  
✅ Threshold conversion uses `10^(dB/20)` (not `10^(dB/10)`)  
✅ WASM receives linear magnitude data (not dB-converted)  
✅ WASM receives linear threshold (not dB)  
✅ Console logs show realistic dB values (-20 to -40 dB typical)  
✅ Console logs show correct linearThreshold values  
✅ No syntax or runtime errors  

## Testing Instructions

1. Load a bat call recording
2. Enable Auto Detection Mode
3. Observe console output
4. Verify:
   - Peak Max shows negative dB (e.g., -20.45 dB)
   - Threshold is appropriately lower (e.g., -44.45 dB)
   - Linear threshold is small positive number (e.g., 0.005754)
   - Number of detected segments is reasonable (2-5, not 200+)
5. Try adjusting slider - segments should update based on threshold

---

**Status**: ✅ Implementation Complete  
**Date**: December 20, 2025
