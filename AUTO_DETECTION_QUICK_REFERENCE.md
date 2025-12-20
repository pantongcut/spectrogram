# Auto Detection Mode - Quick Reference

## Button Location
- **Top Bar**, right of Peak button
- **Icon**: Wand with sparkles (fa-wand-magic-sparkles)
- **Title**: "Auto Detection Mode"
- **Active Color**: Green (#28a745)

## Slider Controls
| Control | Range | Default | Purpose |
|---------|-------|---------|---------|
| Detect Threshold Slider | 1-100 | 50 | Sets detection sensitivity |
| % Display | 1-100% | 50% | Shows current threshold |

## Threshold Formula
```
Threshold (dB) = Peak_Max - (48 × (1 - Slider% / 100))
```

### Threshold Examples
| Slider | dB Offset | Meaning |
|--------|-----------|---------|
| 100% | -0 dB | Peak energy level |
| 75% | -12 dB | Strong signals |
| 50% | -24 dB | Medium signals |
| 25% | -36 dB | Weak signals |
| 0% | -48 dB | Very weak signals |

## UI Elements

### HTML IDs
- `autoDetectBtn` - Toggle button
- `auto-detect-mode-tool-bar` - Container toolbar
- `detectThresholdSlider` - Threshold slider
- `detectThresholdVal` - Percentage display
- `autoDetectSwitch` - Enable/disable switch

### CSS Classes
- `.active` - Applied to button when mode is on
- `#autoDetectBtn.active { background-color: #28a745; }`

## JavaScript Functions

### Auto Detection Module
```javascript
// Import
import { initAutoDetection } from './modules/autoDetectionControl.js';

// Initialize
initAutoDetection({
  frequencyHoverControl,
  getDuration,
  getZoomLevel,
  spectrogramHeight,
  minFrequency,
  maxFrequency
});
```

### Programmatic Selection
```javascript
// From frequencyHover control
frequencyHoverControl.programmaticSelect(
  startTime,      // seconds
  endTime,        // seconds
  frequencyMin,   // kHz (optional)
  frequencyMax    // kHz (optional)
);
```

### WASM Function
```javascript
// From WASM engine
const segments = wasmEngine.detect_segments(
  spectrogramFlat,  // Float32Array
  numCols,          // number
  thresholdDb,      // number
  sampleRate,       // Hz
  hopSize,          // samples
  paddingMs         // milliseconds
);
// Returns: [start1, end1, start2, end2, ...] in seconds
```

## Workflow

```
Click Button
    ↓
Toolbar Shows
    ↓
Adjust Slider → Updates Display
    ↓
Toggle Switch ON
    ↓
Calculate Peak Max → Get Threshold
    ↓
Call WASM detect_segments
    ↓
Create Selections
    ↓
Visible on Spectrogram
```

## Key Parameters

### For WASM Call
- **spectrogram_flat**: Flattened 2D array (row-major)
- **num_cols**: Frequency bins per frame
- **threshold_db**: Target energy level
- **sample_rate**: Audio sample rate (Hz)
- **hop_size**: FFT hop size (samples)
- **padding_ms**: Pad amount (typically 5ms)

### For Selection Creation
- **startTime**: Segment start (seconds)
- **endTime**: Segment end (seconds)
- **frequencyMin**: Low frequency bound (kHz)
- **frequencyMax**: High frequency bound (kHz)

## Events

### UI Events
- Button click → Toggle mode on/off
- Slider input → Recalculate if switch is on
- Switch change → Run detection

### System Events
- File loaded → Reset peak max
- Zoom changed → Recalculate positions
- Freq range changed → Update selections

## Keyboard Shortcuts
Currently none. Access via button click.

## Tips & Tricks

1. **Higher slider = stronger signals only**
   - 75-100%: Clear, obvious calls
   - 50-75%: Most medium calls
   - 25-50%: Weak signals
   - 0-25%: Noise and artifacts

2. **Use with Peak Mode**
   - Can toggle both independently
   - They don't interfere

3. **Fine-tuning**
   - Adjust slider while switch is ON to see live results
   - Watch for noise/artifacts at low thresholds

4. **Frequency Range**
   - Auto detection uses current view range
   - Change frequency range then toggle switch to re-detect

## Troubleshooting

| Issue | Solution |
|-------|----------|
| No selections appear | Increase slider %, check WASM built |
| Selections too few | Lower slider % for more sensitive detection |
| Too much noise | Raise slider % to filter weak signals |
| Selections wrong frequency | Update frequency range min/max |
| Button not responding | Check browser console for errors |

## Files to Know

| File | Purpose |
|------|---------|
| `autoDetectionControl.js` | Main control logic |
| `frequencyHover.js` | Selection creation |
| `lib.rs` | WASM detection function |
| `sonoradar.html` | UI elements |
| `style.css` | Styling |
| `main.js` | Integration |

## Build & Deploy

Before first use:
```bash
cd spectrogram-wasm
wasm-pack build --target web --release
```

The WASM binary must be recompiled if `detect_segments` changes.

## Performance

- Peak max calculation: ~1ms
- WASM detection: ~10-50ms (varies with file length)
- Selection creation: ~5-20ms
- Total: Usually <100ms for typical recordings

---

For detailed documentation, see:
- `AUTO_DETECTION_IMPLEMENTATION.md`
- `WASM_BUILD_GUIDE.md`
- `IMPLEMENTATION_COMPLETE.md`
