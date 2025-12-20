# Auto Detection dB Calculation Fix - Visual Summary

## Before vs After Comparison

### Data Flow Diagram

#### ❌ BEFORE (Incorrect):
```
Audio Data (Float32Array)
     ↓
getPlugin().getFrequencies()  [Using compute_spectrogram_u8]
     ↓
U8 Array (0-255 for visualization)
     ↓
calculatePeakMax(U8Array)
  maxU8 = 255
  peakMaxDb = (255/255) * 80 - 20 = 60 dB  ❌ WRONG!
     ↓
Threshold = 60 - 24 = 36 dB
     ↓
Send U8 data directly to WASM detect_segments
  Comparing: U8(0-255) >= dB(36)  ❌ WRONG DOMAIN!
     ↓
Result: Mostly false detections (incorrect thresholding)
```

#### ✅ AFTER (Correct):
```
Audio Data (Float32Array)
     ↓
WASM compute_spectrogram()
     ↓
Linear Magnitude Array (actual frequency bin values)
     ↓
calculatePeakMax(LinearMagnitude, fftSize)
  maxLinearMag = 0.234 (example value)
  powerLinear = (0.234^2) / 512 = 0.0001068
  peakMaxDb = 10 * log10(0.0001068) = -39.71 dB  ✅ CORRECT!
     ↓
Threshold = -39.71 - 24 = -63.71 dB
     ↓
Convert Linear to dB for WASM:
  for each bin: dbValue = 10 * log10((linearMag^2)/fftSize)
     ↓
Send dB data to WASM detect_segments
  Comparing: dB(-45.32) >= dB(-63.71)  ✅ CORRECT DOMAIN!
     ↓
Result: Accurate segment detection with proper thresholding
```

## Key Formula Changes

### Formula 1: Peak Maximum Calculation

**BEFORE (Wrong):**
```javascript
const maxU8 = 255;  // From visualization array
const peakMaxDb = (maxU8 / 255.0) * 80 - 20;  // = 60 dB ❌
```

**AFTER (Correct):**
```javascript
const maxLinearMagnitude = 0.234;  // From linear magnitude array
const fftSize = 512;
const powerLinear = (maxLinearMagnitude * maxLinearMagnitude) / fftSize;
const peakMaxDb = 10 * Math.log10(Math.max(powerLinear, 1e-16));  // = -39.71 dB ✅
```

### Formula 2: Spectrogram Conversion for WASM

**BEFORE (Wrong):**
```javascript
// Pass U8 values directly
const flatArray = new Float32Array(U8_data);  // Values 0-255
wasmModule.detect_segments(flatArray, ..., thresholdDb, ...);  // 255 >= -60? WRONG!
```

**AFTER (Correct):**
```javascript
// Convert linear magnitude to dB
const dbSpectrogram = new Float32Array(linearSpectrogram.length);
for (let i = 0; i < linearSpectrogram.length; i++) {
  const linearMag = linearSpectrogram[i];
  const powerLinear = (linearMag * linearMag) / fftSize;
  dbSpectrogram[i] = 10 * Math.log10(Math.max(powerLinear, 1e-16));
}
wasmModule.detect_segments(dbSpectrogram, ..., thresholdDb, ...);  // -45.32 >= -63.71? ✅
```

## Peak Max Value Ranges

### Expected Values by Signal Type

| Signal Type | Typical Peak Max |
|------------|-----------------|
| Loud bat call (strong signal) | -10 to -15 dB |
| Normal bat call (moderate) | -20 to -30 dB |
| Weak bat call (quiet) | -30 to -40 dB |
| Background noise only | -60 to -80 dB |
| Silence | -100 dB |

### Before Fix (Wrong):
- Always: +0 to +60 dB (regardless of actual signal strength)
- Example: "Peak Max: 60 dB" for quiet recording

### After Fix (Correct):
- Varies by signal: -15 dB to -80 dB
- Example: "Peak Max: -28 dB" for normal bat call recording

## Threshold Calculation Impact

### Example: Slider at 50% (default)

**BEFORE (Wrong):**
```
Peak Max: 60 dB (incorrect)
Attenuation: 60 - 50 = 10 dB (incorrect base)
Threshold: 60 - 24 = 36 dB

Result: Almost everything above -20 dB gets detected ❌
```

**AFTER (Correct):**
```
Peak Max: -28 dB (correct for normal bat call)
Attenuation: 48 * (1 - 50/100) = 24 dB (same formula)
Threshold: -28 - 24 = -52 dB

Result: Only segments within ~24 dB of peak get detected ✅
```

## Console Output Examples

### BEFORE (Wrong):
```
[autoDetectionControl] Spectrogram data available: 4730 frames x 256 bins
[autoDetectionControl] calculatePeakMax returned: 60
[autoDetectionControl] Peak Max: 60.00 dB, Threshold: 36.00 dB
[autoDetectionControl] Calling detect_segments with: flatArray.length=1210880, numCols=256, threshold=36.00, ...
[autoDetectionControl] detect_segments returned 482 values (241 segments)  ❌ Massive false positives!
```

### AFTER (Correct):
```
[autoDetectionControl] Computing linear magnitude spectrogram: fftSize=512, noverlap=384, hopSize=256
[autoDetectionControl] Linear spectrogram available: 4730 frames x 256 bins (total 1210880 values)
[autoDetectionControl] ✅ calculatePeakMax returned: -28.45 dB
[autoDetectionControl] Peak Max: -28.45 dB, Slider: 50%, Threshold: -52.45 dB
[autoDetectionControl] Converted linear spectrogram to dB values. Sample: dbSpectrogram[0]=-85.32 dB
[autoDetectionControl] Calling detect_segments with: flatArray.length=1210880, numCols=256, threshold=-52.45 dB, ...
[autoDetectionControl] ✅ detect_segments returned 4 values (2 segments)  ✅ Reasonable number of detections
[autoDetectionControl] ✅ Created 2 selections
```

## Technical Details

### Linear to dB Conversion Formula
```
power_linear = (linear_magnitude²) / fft_size
dB = 10 × log₁₀(max(power_linear, 1e-16))
```

**Why this formula:**
- `linear_magnitude²`: Converts amplitude to power
- `/ fft_size`: Normalizes power spectral density (PSD)
- `10 × log₁₀()`: Standard power-to-dB conversion (not amplitude!)
- `max(power_linear, 1e-16)`: Avoids log(0) with epsilon protection

### Why Not 20*log10?
- 20*log10 is for **amplitude**:  `20 × log₁₀(amplitude)`
- 10*log10 is for **power**: `10 × log₁₀(power)`
- We calculate power (mag²), so we use 10*log10 ✓
- This matches both batCallDetector.js and Rust WASM implementation

### Domain Matching
```
WASM detect_segments expects:
  spectrogram_flat[i] = dB value
  threshold_db = dB value
  
Comparison: dB_value >= dB_threshold ✓ (same domain)

Before fix:
  spectrogram_flat[i] = U8 value (0-255)
  threshold_db = dB value
  
Comparison: U8_value >= dB_threshold ✗ (different domains!)
```

## Performance Impact

- **Memory**: +1× for dbSpectrogram array (same size as linearSpectrogram)
- **CPU**: One loop through spectrogram for dB conversion (~milliseconds for typical audio)
- **Accuracy**: Gains proper dB calculation, loses nothing

## Validation Checklist

- [x] Uses linear magnitude data (not U8 visualization)
- [x] Applies correct dB formula: 10*log10(power)
- [x] Matches batCallDetector.js methodology
- [x] Matches Rust WASM implementation
- [x] Converts spectrogram before sending to WASM
- [x] Domain matching: dB to dB comparison
- [x] Epsilon protection: avoid log(0)
- [x] Console logging for debugging

---

**Status**: ✅ Implementation Complete  
**Files Modified**: autoDetectionControl.js  
**Date**: December 20, 2025
