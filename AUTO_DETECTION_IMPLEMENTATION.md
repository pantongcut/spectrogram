# Auto Detection Mode Implementation Summary

## Overview
The "Auto Detection Mode" feature has been successfully implemented for the SonoRadar application. This feature allows users to automatically generate selection areas for bat calls based on a global energy threshold, utilizing WebAssembly (WASM) for performant processing.

## Changes Made

### 1. HTML Changes (`sonoradar.html`)

#### Added Auto Detect Button
- **Location**: `top-bar` (line 87)
- **ID**: `autoDetectBtn`
- **Title**: "Auto Detection Mode"
- **Icon**: `fa-wand-magic-sparkles`
- **Position**: Immediately to the right of `peakBtn`

#### Added Auto Detection Mode Toolbar
- **Location**: After `peak-mode-tool-bar` (line 159)
- **ID**: `auto-detect-mode-tool-bar`
- **Default State**: Hidden (`style="display: none;"`)
- **Components**:
  - **Slider**: `detectThresholdSlider`
    - Range: 1-100
    - Default: 50
    - Label: "Detect Threshold"
  - **Switch**: `autoDetectSwitch`
    - Label: "Auto-detection mode"
    - Controls when detection runs

### 2. WASM Implementation (`spectrogram-wasm/src/lib.rs`)

#### Added `detect_segments` Function
- **Location**: End of `lib.rs` (line 1162)
- **Signature**: 
  ```rust
  pub fn detect_segments(
      spectrogram_flat: &[f32],
      num_cols: usize,
      threshold_db: f32,
      sample_rate: f32,
      hop_size: usize,
      padding_ms: f32
  ) -> Vec<f32>
  ```
- **Algorithm**:
  1. Scans spectrogram frames for energy values exceeding threshold
  2. Identifies continuous segments where energy > threshold
  3. Applies 5ms padding before and after each segment
  4. Merges overlapping/adjacent segments
  5. Converts frame indices to time values in seconds
- **Return Value**: Flattened array `[start1, end1, start2, end2, ...]` in seconds

### 3. Frequency Hover Module (`modules/frequencyHover.js`)

#### Added `programmaticSelect` Function
- **Location**: Line 1397 (exported in return object)
- **Signature**:
  ```javascript
  programmaticSelect: (startTime, endTime, frequencyMin, frequencyMax) => {...}
  ```
- **Functionality**:
  - Creates selection boxes programmatically without user interaction
  - Calculates pixel positions based on zoom level and duration
  - Calculates vertical positions based on frequency range
  - Utilizes existing `createTooltip` function internally
  - Returns selection object for further manipulation

### 4. Auto Detection Control Module (`modules/autoDetectionControl.js`)

**New File** - Complete implementation of auto-detection logic

#### Key Features:
- **UI Integration**:
  - Toggle button (`autoDetectBtn`) to activate/deactivate mode
  - Toolbar visibility management
  - Threshold slider updates with real-time display
  - Auto-detection switch to run detection

- **Detection Logic**:
  - Calculates peak maximum from current spectrogram
  - Maps slider value (1-100) to dB threshold:
    - Formula: `Threshold_dB = Peak_Max - (48 * (1 - SliderVal / 100))`
    - 50% slider = -24dB below peak
    - 100% = 0dB (peak)
    - 0% = -48dB
  
- **Processing**:
  - Calls WASM `detect_segments` function
  - Creates programmatic selections via `frequencyHover.programmaticSelect`
  - Handles frequency range clamping
  - Manages selection clearing on mode toggle

- **Event Handling**:
  - Slider changes trigger re-detection
  - Switch toggle enables/disables active detection
  - File loading resets peak max calculation

### 5. Main Integration (`main.js`)

#### Added Import
- **Line 42**: `import { initAutoDetection } from './modules/autoDetectionControl.js';`

#### Added Initialization
- **Location**: After `initAutoIdPanel` (line 1550)
- **Configuration**:
  ```javascript
  initAutoDetection({
    frequencyHoverControl: freqHoverControl,
    getDuration: () => duration,
    getZoomLevel: () => zoomControl?.getZoomLevel?.() || 1,
    spectrogramHeight,
    minFrequency: currentFreqMin,
    maxFrequency: currentFreqMax
  });
  ```

### 6. CSS Styling (`style.css`)

#### Added Auto Detect Button Styles
- **Location**: Line 1362
- **Active State**: Green background (`#28a745`)
- **Matches**: Peak button styling pattern

## Mathematical Details

### Threshold Calculation
The threshold slider (1-100) is mapped to dB values as follows:
- **Formula**: `Threshold_dB = Peak_Max - (48 * (1 - SliderVal / 100))`
- **Examples**:
  - 50% slider → `Peak_Max - 24dB`
  - 100% slider → `Peak_Max - 0dB` (peak)
  - 0% slider → `Peak_Max - 48dB`

### Time Segment Detection
- Identifies all time frames where **any** frequency bin exceeds threshold
- Pads each segment by 5ms before and after
- Merges overlapping segments (including adjacent ones within 1 frame)
- Returns time-domain segments in seconds

### Selection Generation
- Time range: From WASM detection results
- Frequency range: Current view (`currentFreqMin` to `currentFreqMax`)
- Respects current zoom level for correct pixel positioning

## Integration Points

### File Loaded Event
- Resets `currentPeakMax` to recalculate for new audio

### Zoom Control
- Uses `getZoomLevel()` for accurate pixel positioning
- Uses `getDuration()` for time calculation

### Frequency Hover Control
- Uses `clearSelections()` to remove previous detections
- Uses `programmaticSelect()` to create new selections
- Respects zoom level when rendering

## WASM Rebuild Instructions

To rebuild the WASM module with the new `detect_segments` function:

```bash
cd spectrogram-wasm
wasm-pack build --target web --release
```

This will:
1. Compile the Rust code with the new function
2. Generate new `.wasm` binary
3. Update `.js` and `.d.ts` wrapper files
4. Output to `pkg/` directory

## Testing Checklist

- [ ] WASM module rebuilds without errors
- [ ] Auto Detect button appears in top-bar
- [ ] Toolbar shows/hides correctly
- [ ] Slider updates detection threshold value display
- [ ] Switch toggles detection on/off
- [ ] Selections are created at correct time positions
- [ ] Selections use current frequency view range
- [ ] Multiple segments are merged correctly
- [ ] Padding is applied (5ms before/after)
- [ ] Peak mode and auto detection don't conflict
- [ ] Selections clear when mode is disabled
- [ ] New file loading resets peak calculation

## Key Implementation Details

1. **Performance**: WASM-based detection ensures fast processing of large spectrograms
2. **Flexibility**: Threshold slider allows fine-tuning detection sensitivity
3. **Integration**: Uses existing `frequencyHover` infrastructure for consistency
4. **UX**: Button and toolbar follow existing UI patterns (similar to Peak Mode)
5. **Math Accuracy**: dB calculations match requirements exactly
