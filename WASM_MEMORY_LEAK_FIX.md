# WASM Memory Leak Fix: Audio Data Cleanup Implementation

## Problem Description

The web audio application was experiencing memory overflow when loading multiple large audio files. The WASM linear memory was not being properly freed when switching between files, causing memory usage to grow until the browser crashed.

### Root Causes

1. **SpectrogramEngine Not Freed**: The WASM `SpectrogramEngine` class was instantiated but never destroyed, keeping its allocated memory in the WASM linear memory pool.
2. **Filter Bank Caches Not Cleared**: Filter bank matrices and resample mappings were cached but never released when switching files.
3. **Plugin Replacement Without Cleanup**: When changing FFT sizes or peak modes, the old plugin was replaced without properly freeing its WASM resources.
4. **No WaveformEngine Cleanup**: Audio data loaded into `WaveformEngine` was not cleared before loading new files.

## Implementation Details

### 1. SpectrogramEngine Memory Deallocation

**File**: `modules/spectrogram.esm.js`

**Changes**: Enhanced the `destroy()` method to properly free WASM memory.

```javascript
destroy() {
    // Clean up WASM memory: FREE the SpectrogramEngine instance
    if (this._wasmEngine) {
        try {
            if (typeof this._wasmEngine.free === 'function') {
                this._wasmEngine.free();
                console.log('✅ [Spectrogram] WASM SpectrogramEngine freed');
            }
        } catch (err) {
            console.warn('⚠️ [Spectrogram] Error freeing WASM SpectrogramEngine:', err);
        }
        this._wasmEngine = null;
    }
    
    // Clear all filter bank caches to release memory
    this._filterBankCache = {};
    this._filterBankCacheByKey = {};
    this._filterBankFlat = null;
    this._filterBankMatrix = null;
    this._loadedFilterBankKey = null;
    
    // Clear resample cache
    this._resampleCache = {};
    
    // Clear color map data
    this._colorMapUint = null;
    this._baseColorMapUint = null;
    this._activeColorMapUint = null;
    
    // ... rest of cleanup (event listeners, etc.)
}
```

**What It Does**:
- Calls `.free()` on the `SpectrogramEngine` instance, which deallocates memory in the WASM linear memory
- Clears all cached filter bank matrices to prevent memory from being held by JavaScript references
- Nullifies color map arrays to allow garbage collection
- Maintains error handling to prevent exceptions during cleanup

### 2. Plugin Replacement Cleanup

**File**: `modules/wsManager.js`

**Changes**: Improved `replacePlugin()` to properly destroy the old plugin before creating a new one.

```javascript
// CRITICAL: Clean up the old plugin BEFORE creating a new one
// This ensures WASM memory (SpectrogramEngine) is freed
if (plugin) {
    console.log('🔄 [wsManager] Destroying old plugin to free WASM memory...');
    if (typeof plugin.destroy === 'function') {
        plugin.destroy();
    }
    plugin = null;
    // Force garbage collection hint (not guaranteed, but good practice)
    if (global?.gc) {
        global.gc();
    }
}
```

**What It Does**:
- Explicitly destroys the old plugin (which triggers the WASM cleanup from step 1)
- Nullifies the plugin reference to allow garbage collection
- Attempts to trigger garbage collection (when running in Node.js or with GC enabled)
- Adds console logging for debugging

### 3. WaveformEngine Data Cleanup

**File**: `modules/fileLoader.js`

**Changes**: Clear WaveformEngine audio data before loading new files.

```javascript
// MEMORY CLEANUP: Clean up old WaveformEngine before loading new file
if (lastWaveformEngine) {
    try {
        if (typeof lastWaveformEngine.clear === 'function') {
            lastWaveformEngine.clear();
            console.log('✅ [fileLoader] Cleared old WaveformEngine audio data');
        }
    } catch (err) {
        console.warn('⚠️ [fileLoader] Error clearing WaveformEngine:', err);
    }
    lastWaveformEngine = null;
}
```

**What It Does**:
- Clears the audio data stored in `WaveformEngine` before loading a new file
- Prevents accumulation of audio samples in WASM memory
- Tracks the last `WaveformEngine` instance for cleanup purposes

## Memory Management Flow

### Before (Memory Leak Scenario)
```
1. Load File A → SpectrogramEngine allocates memory
2. Load File B → New SpectrogramEngine allocates memory
                  (Old SpectrogramEngine still allocated)
3. Load File C → Another SpectrogramEngine allocates memory
                  (Two previous instances still allocated)
... CRASH: WASM linear memory exhausted
```

### After (Fixed Scenario)
```
1. Load File A → SpectrogramEngine allocates memory
2. Load File B → Old SpectrogramEngine.free() called
                → Allocated memory returned to pool
                → New SpectrogramEngine allocates memory
3. Load File C → Previous SpectrogramEngine.free() called
                → Allocated memory returned to pool
                → New SpectrogramEngine allocates memory
... Stable: Memory reused across file loads
```

## WASM-bindgen Integration

The fix leverages `wasm-bindgen`'s standard memory management patterns:

- **SpectrogramEngine**: Has automatic `FinalizationRegistry` registration, but explicit `.free()` is more reliable
- **WaveformEngine**: Similar pattern with explicit `.clear()` method
- **Memory Layout**: WASM linear memory managed by `wasm-bindgen` allocator (`__wbindgen_malloc`, `__wbindgen_free`)

## Testing Checklist

- [ ] Load a large audio file (>50MB)
- [ ] Switch to another large audio file
- [ ] Repeat 5-10 times and observe memory usage
- [ ] Open browser DevTools Memory profiler
- [ ] Take heap snapshots before/after each file load
- [ ] Verify WASM memory doesn't grow beyond 2x single file size
- [ ] Check console for cleanup messages (`✅` logs)
- [ ] Verify no `⚠️` warning messages appear

## Browser DevTools Memory Profiling

To verify the fix:

1. Open DevTools → Performance/Memory tab
2. Record memory usage while loading files
3. Look for `spectrogram_wasm_bg.wasm` in memory snapshot
4. Verify memory size stabilizes rather than continuously growing

### Key Metrics
- **WASM Linear Memory Growth**: Should plateau, not continuously increase
- **JavaScript Heap**: Should remain relatively stable when switching files
- **GC Events**: Should trigger cleanup when plugin is destroyed

## Edge Cases Handled

1. **Rapid File Switching**: Cleanup is synchronous, handles rapid successive loads
2. **Plugin Creation Failure**: Error handling prevents crashes during cleanup
3. **Missing `.free()` Method**: Code gracefully handles WASM versions without `.free()`
4. **Multiple Tab/Window Scenario**: Each window has its own WASM instance, cleaned up independently

## Future Improvements

1. **Implement Resource Pooling**: Reuse SpectrogramEngine instances to avoid allocation/deallocation overhead
2. **Add Memory Monitoring**: Expose WASM memory usage metrics to UI
3. **Batch Cleanup**: Group file loading with deferred cleanup for batch operations
4. **Streaming Analysis**: Process audio in chunks to reduce peak memory usage

## Debugging

Enable debug mode to see detailed cleanup logs:

```javascript
// In console or main.js
localStorage.debug = '*'; // or specific module
// then reload page
```

Console output examples:
```
✅ [Spectrogram] WASM SpectrogramEngine freed
🔄 [wsManager] Destroying old plugin to free WASM memory...
✅ [fileLoader] Cleared old WaveformEngine audio data
```

## References

- [wasm-bindgen Manual: Closures and Classes](https://rustwasm.org/docs/wasm-bindgen/reference/types.html#closures-and-classes)
- [Memory in WebAssembly](https://developer.mozilla.org/en-US/docs/WebAssembly/Memory)
- [JavaScript WeakMap and FinalizationRegistry](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/FinalizationRegistry)
