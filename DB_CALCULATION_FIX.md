# dB Calculation Fix for Auto Detection Mode

## Problem Statement
The "Auto Detection Mode" was calculating physically incorrect dB values, showing Peak Max of +60 dB instead of realistic negative dBFS values (-10 to -30 dB) typical for bat call signals. This resulted in incorrect thresholding and massive false-positive selection areas.

## Root Cause Analysis

### Original Implementation Issues:
1. **Wrong Data Source**: Used U8 visualization values (0-255) from `compute_spectrogram_u8()` instead of linear magnitude values
2. **Wrong Formula**: Used `(U8 / 255) * rangeDB - gainDB` which mapped U8=255 to +60 dB
3. **Wrong Domain**: Passed U8 values directly to WASM function that expects dB values

### Why It Was Wrong:
- `compute_spectrogram_u8()` returns display-only visualization data (0-255 range)
- U8 value 255 does NOT mean the signal is at 0 dB or 60 dB
- The U8 scaling parameters (gainDB=20, rangeDB=80) are for visualization, not calculation
- WASM function `detect_segments` expects actual dB values for threshold comparison

## Solution Implemented

### Step 1: Use Linear Magnitude Data
Changed from using `plugin.getFrequencies()` (which returns U8 data) to using WASM's `compute_spectrogram()` function directly:
```javascript
const linearSpectrogram = wasmModule.compute_spectrogram(audioData, noverlap);
```

This returns **Float32Array with linear magnitude values** (actual frequency bin amplitudes), not visualization data.

### Step 2: Correct dB Conversion Formula
Implemented the same formula used in `batCallDetector.js`:
```javascript
// For power spectral density:
const powerLinear = (linearMagnitude * linearMagnitude) / fftSize;
const peakMaxDb = 10 * Math.log10(Math.max(powerLinear, 1e-16));
```

This matches the authoritative dB calculation in both:
- `batCallDetector.js` line 535: `result.signalPowerMean_dB = 10 * Math.log10(...)`
- `spectrogram-wasm/src/lib.rs` line 1079: `spectrum[i] = 10.0 * psd.max(1e-16).log10()`

### Step 3: Convert Spectrogram to dB Before Sending to WASM
The WASM `detect_segments` function expects dB values in the spectrogram array:
```javascript
const dbSpectrogram = new Float32Array(linearSpectrogram.length);
for (let i = 0; i < linearSpectrogram.length; i++) {
  const linearMag = linearSpectrogram[i];
  const powerLinear = (linearMag * linearMag) / fftSize;
  dbSpectrogram[i] = 10 * Math.log10(Math.max(powerLinear, 1e-16));
}
```

Then pass the dB-converted array to WASM:
```javascript
const segments = wasmModule.detect_segments(
  dbSpectrogram,           // dB values
  numBins,
  thresholdDb,             // dB threshold
  sampleRate,
  hopSize,
  5.0
);
```

This ensures the WASM comparison `spectrogram_flat[i] >= threshold_db` works correctly (dB vs dB, not linear vs dB).

## Changes Made to Files

### `/workspaces/spectrogram/modules/autoDetectionControl.js`

#### Modified Function: `performAutoDetection()`
**Key changes:**
1. Use `wasmModule.compute_spectrogram()` instead of `plugin.getFrequencies()`
2. Get linear magnitude data directly from WASM
3. Calculate FFT parameters (fftSize, hopSize) before computation
4. Convert linear magnitude spectrogram to dB using proper formula
5. Pass dB-converted array to WASM detect_segments

**Before:**
```javascript
const spectrogramMatrix = await plugin.getFrequencies(decodedData);
// ... process U8 data
wasmModule.detect_segments(flatArray, numCols, thresholdDb, ...);
```

**After:**
```javascript
const linearSpectrogram = wasmModule.compute_spectrogram(audioData, noverlap);
// ... convert linear to dB
const dbSpectrogram = new Float32Array(...);
for (let i = 0; i < linearSpectrogram.length; i++) {
  const linearMag = linearSpectrogram[i];
  const powerLinear = (linearMag * linearMag) / fftSize;
  dbSpectrogram[i] = 10 * Math.log10(Math.max(powerLinear, 1e-16));
}
wasmModule.detect_segments(dbSpectrogram, numBins, thresholdDb, ...);
```

#### Modified Function: `calculatePeakMax()`
**Key changes:**
1. Now accepts Float32Array of linear magnitudes (instead of U8 array)
2. Uses correct dB conversion: `10 * Math.log10(power)` where power = (mag²/fftSize)
3. Returns realistic dB values (typically -100 to -10 dB, not 0-60 dB)

**Before:**
```javascript
const peakMaxDb = (maxU8 / 255.0) * rangeDB - gainDB;  // Wrong: 255 → 60 dB
```

**After:**
```javascript
const powerLinear = (maxLinearMagnitude * maxLinearMagnitude) / fftSize;
const peakMaxDb = 10 * Math.log10(Math.max(powerLinear, 1e-16));  // Correct: 60 dB → -30 dB
```

## Expected Results After Fix

### Console Output Example:
```
[autoDetectionControl] ✅ performAutoDetection called
[autoDetectionControl] Computing linear magnitude spectrogram: fftSize=512, noverlap=384, hopSize=256
[autoDetectionControl] Linear spectrogram available: 4730 frames x 256 bins
[autoDetectionControl] ✅ calculatePeakMax returned: -25.38 dB
[autoDetectionControl] Peak Max: -25.38 dB, Slider: 50%, Threshold: -49.38 dB
[autoDetectionControl] Converted linear spectrogram to dB values. Sample: dbSpectrogram[0]=-85.32 dB
[autoDetectionControl] Calling detect_segments with: flatArray.length=1210880, numCols=256, threshold=-49.38 dB, sampleRate=44100, hopSize=256
[autoDetectionControl] ✅ detect_segments returned 4 values (2 segments)
[autoDetectionControl] ✅ Created 2 selections
```

### Peak Max Values:
- **Before**: +60 dB (incorrect - U8 conversion error)
- **After**: -15 to -35 dB (realistic for bat calls in noisy recording)

### Threshold Calculation:
- **Peak Max**: -25 dB
- **Slider 50%**: -24 dB relative attenuation
- **Resulting Threshold**: -49 dB (Peak Max - 24) ✓

## Validation

### ✅ Formula Alignment
- Uses same formula as `batCallDetector.js`: `10 * Math.log10(power)`
- Uses same normalization as Rust WASM: `power = (mag²) / fftSize`
- Uses epsilon protection: `Math.max(power, 1e-16)` to avoid log(0)

### ✅ Data Domain Consistency
- Input to calculatePeakMax: Float32Array (linear magnitude)
- Internal calculation: Power (magnitude squared / FFT size)
- Output from calculatePeakMax: dB (10 * log10 of power)
- Input to WASM: dB-converted spectrogram and dB threshold
- WASM comparison: dB value >= dB threshold ✓

### ✅ Parameters
- FFT Size: Retrieved from plugin (typically 512)
- Hop Size: Retrieved from plugin (typically 256)
- Sample Rate: Retrieved from plugin (typically 44100)
- Noverlap: Calculated from FFT size (typically 75% overlap = 384)
- Gain/Range: No longer used for calculation (visualization only)

## Testing Checklist

- [ ] Load bat call audio file
- [ ] Enable Auto Detection Mode
- [ ] Verify Peak Max shows negative dB value (e.g., -20 to -30 dB)
- [ ] Verify Threshold follows Peak Max - slider attenuation formula
- [ ] Verify segments are detected and highlighted
- [ ] Verify segment count is reasonable (not excessive)
- [ ] Verify console logs show correct dB values throughout process
- [ ] Test with different audio files (varying signal strength)
- [ ] Test with slider at different positions (affects threshold)

## References

### Key Source Files
1. **batCallDetector.js** (line 535):
   ```javascript
   result.signalPowerMean_dB = 10 * Math.log10(Math.max(signalPowerMean_linear, 1e-16));
   ```

2. **spectrogram-wasm/src/lib.rs** (lines 1070-1087):
   ```rust
   spectrum[i] = 10.0 * psd.max(1e-16).log10();
   // where psd = (rms * rms) / fft_size
   ```

3. **WASM TypeScript Definitions** (spectrogram_wasm.d.ts):
   - `compute_spectrogram()`: Returns linear magnitude values
   - `detect_segments()`: Expects dB threshold value

## Important Notes

1. **Performance**: Converting linear to dB for entire spectrogram adds CPU overhead. For real-time use, consider caching or optimization.
2. **Precision**: Using Float32Array maintains precision for dB calculations (no loss from U8 quantization).
3. **Audio Quality**: dB values now reflect actual signal energy, enabling proper threshold-based detection.
4. **Backward Compatibility**: Old selection data may not be compatible with new peak detection values.

---

**Date**: December 20, 2025  
**Files Modified**: `/workspaces/spectrogram/modules/autoDetectionControl.js`  
**Status**: ✅ Complete and Ready for Testing
