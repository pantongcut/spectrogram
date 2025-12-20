# WASM Module Rebuild Guide

## Prerequisites

Before rebuilding the WASM module, ensure you have the following installed:

1. **Rust toolchain**: https://rustup.rs/
2. **wasm-pack**: Install via `cargo install wasm-pack`
3. **Node.js**: For running the JavaScript tests (optional)

## Building the WASM Module

### Quick Build

```bash
cd /workspaces/spectrogram/spectrogram-wasm
wasm-pack build --target web --release
```

### Step-by-Step Build

1. **Navigate to the WASM directory**:
   ```bash
   cd spectrogram-wasm
   ```

2. **Build the project**:
   ```bash
   wasm-pack build --target web --release
   ```
   
   The `--release` flag creates an optimized build.

3. **Verify the build**:
   ```bash
   ls -la pkg/
   ```
   
   You should see:
   - `spectrogram_wasm.js` - JavaScript bindings
   - `spectrogram_wasm_bg.wasm` - WebAssembly binary
   - `spectrogram_wasm_bg.wasm.d.ts` - TypeScript definitions
   - `spectrogram_wasm.d.ts` - TypeScript definitions

4. **Test (optional)**:
   ```bash
   wasm-pack test --headless --firefox
   ```

## Build Options

### Development Build (faster compilation)
```bash
wasm-pack build --target web --dev
```

### Release Build (optimized, smaller size)
```bash
wasm-pack build --target web --release
```

### Debug Build (with debug info)
```bash
wasm-pack build --target web --debug
```

## What Gets Rebuilt

The new `detect_segments` function will be:
1. Compiled from Rust to WebAssembly
2. Wrapped with JavaScript bindings via `wasm_bindgen`
3. Made available as `detect_segments` in the module

## After Building

The built artifacts in `pkg/` are already referenced in the project:
- `modules/spectrogram_wasm.js` (symlink/copy of `pkg/spectrogram_wasm.js`)
- `modules/spectrogram_wasm_bg.wasm` (symlink/copy of `pkg/spectrogram_wasm_bg.wasm`)
- TypeScript definitions auto-update

## Troubleshooting

### "wasm-pack not found"
```bash
cargo install wasm-pack
```

### "Rust toolchain not installed"
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

### Build fails with permission denied
Ensure the directory is writable and you have the necessary permissions.

### Tests fail
This is usually safe to ignore for production builds. The WASM binary is still valid.

## Verifying the Function

After building, you can verify `detect_segments` is available:

```javascript
import * as wasm from './modules/spectrogram_wasm.js';

// Check if function exists
console.log(typeof wasm.detect_segments); // Should be 'function'

// The function signature
const result = wasm.detect_segments(
  spectrogram_flat,  // Float32Array
  num_cols,          // number
  threshold_db,      // number
  sample_rate,       // number
  hop_size,          // number
  padding_ms         // number
);
// result is a Float32Array with [start1, end1, start2, end2, ...]
```

## Optimization Tips

- Use `--release` for production builds (2-3x faster execution)
- The binary is ~500KB-1MB depending on optimization level
- gzip compression reduces it to ~100-200KB for transfer

## Additional Resources

- WASM-pack docs: https://rustwasm.org/docs/wasm-pack/
- Rust FFT documentation: https://docs.rs/rustfft/
- wasm_bindgen: https://docs.rs/wasm-bindgen/
