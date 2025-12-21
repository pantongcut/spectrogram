let wasm;

function getArrayF32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayU16FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint16ArrayMemory0().subarray(ptr / 2, ptr / 2 + len);
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedFloat32ArrayMemory0 = null;
function getFloat32ArrayMemory0() {
    if (cachedFloat32ArrayMemory0 === null || cachedFloat32ArrayMemory0.byteLength === 0) {
        cachedFloat32ArrayMemory0 = new Float32Array(wasm.memory.buffer);
    }
    return cachedFloat32ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return decodeText(ptr, len);
}

let cachedUint16ArrayMemory0 = null;
function getUint16ArrayMemory0() {
    if (cachedUint16ArrayMemory0 === null || cachedUint16ArrayMemory0.byteLength === 0) {
        cachedUint16ArrayMemory0 = new Uint16Array(wasm.memory.buffer);
    }
    return cachedUint16ArrayMemory0;
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArrayF32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getFloat32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    }
}

let WASM_VECTOR_LEN = 0;

const SpectrogramEngineFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_spectrogramengine_free(ptr >>> 0, 1));

const WaveformEngineFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_waveformengine_free(ptr >>> 0, 1));

/**
 * SpectrogramEngine: 處理音頻頻譜圖計算
 * 將 FFT、窗函數應用、濾波器組應用和 dB 轉換從 JavaScript 移到 Rust
 */
export class SpectrogramEngine {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        SpectrogramEngineFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_spectrogramengine_free(ptr, 0);
    }
    /**
     * 獲取 FFT 大小
     * @returns {number}
     */
    get_fft_size() {
        const ret = wasm.spectrogramengine_get_fft_size(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * 獲取頻率箱數
     * @returns {number}
     */
    get_freq_bins() {
        const ret = wasm.spectrogramengine_get_freq_bins(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * 設置 256 色的色彩映射 (RGBA)
     *
     * # Arguments
     * * `colors` - 256 * 4 字節的 RGBA 顏色數組
     * @param {Uint8Array} colors
     */
    set_color_map(colors) {
        const ptr0 = passArray8ToWasm0(colors, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.spectrogramengine_set_color_map(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * 獲取最後計算的全局最大幅度值
     *
     * 此值在最後一次 compute_spectrogram_u8 調用時計算。
     * 用於與閾值進行比較以進行峰值檢測。
     *
     * # Returns
     * 線性幅度值（未轉換為 dB）
     * @returns {number}
     */
    get_global_max() {
        const ret = wasm.spectrogramengine_get_global_max(this.__wbg_ptr);
        return ret;
    }
    /**
     * 獲取濾波器數量
     * @returns {number}
     */
    get_num_filters() {
        const ret = wasm.spectrogramengine_get_num_filters(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * 載入濾波器組矩陣
     *
     * # Arguments
     * * `flat_weights` - 扁平化的濾波器組權重矩陣 (Float32Array)
     * * `num_filters` - 濾波器數量
     *
     * 矩陣順序: 行優先 (row-major)
     * 每行長度: fft_size / 2 + 1
     * @param {Float32Array} flat_weights
     * @param {number} num_filters
     */
    load_filter_bank(flat_weights, num_filters) {
        const ptr0 = passArrayF32ToWasm0(flat_weights, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.spectrogramengine_load_filter_bank(this.__wbg_ptr, ptr0, len0, num_filters);
    }
    /**
     * 清除濾波器組 (禁用濾波)
     */
    clear_filter_bank() {
        wasm.spectrogramengine_clear_filter_bank(this.__wbg_ptr);
    }
    /**
     * 獲取窗函數值（用於調試/驗證）
     * @returns {Float32Array}
     */
    get_window_values() {
        const ret = wasm.spectrogramengine_get_window_values(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * 計算 FFT 頻譜（返回幅度值，不進行 dB 轉換）
     *
     * # Arguments
     * * `audio_data` - 音頻數據 (Float32Array)
     * * `noverlap` - 重疊樣本數
     *
     * # Returns
     * 平面的 Float32Array（頻率箱 * 時間步），包含幅度值
     * @param {Float32Array} audio_data
     * @param {number} noverlap
     * @returns {Float32Array}
     */
    compute_spectrogram(audio_data, noverlap) {
        const ptr0 = passArrayF32ToWasm0(audio_data, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.spectrogramengine_compute_spectrogram(this.__wbg_ptr, ptr0, len0, noverlap);
        var v2 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v2;
    }
    /**
     * 獲取每個時間幀的峰值幅度值
     *
     * 基於在最後一次 compute_spectrogram_u8 調用中計算的線性幅度值。
     * 返回每個時間幀中峰值 bin 的幅度值（線性，未轉換為 dB）。
     *
     * # Returns
     * Float32Array，其中每個元素是對應時間幀的峰值幅度值
     * 如果該幀沒有有效的峰值，返回 0.0
     * @param {number} threshold_ratio
     * @returns {Float32Array}
     */
    get_peak_magnitudes(threshold_ratio) {
        const ret = wasm.spectrogramengine_get_peak_magnitudes(this.__wbg_ptr, threshold_ratio);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * 設置光譜配置 (用於記錄，但主要用於驗證)
     * @param {string} scale
     * @param {number} freq_min
     * @param {number} freq_max
     */
    set_spectrum_config(scale, freq_min, freq_max) {
        const ptr0 = passStringToWasm0(scale, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.spectrogramengine_set_spectrum_config(this.__wbg_ptr, ptr0, len0, freq_min, freq_max);
    }
    /**
     * 計算頻譜圖並轉換為 u8 量化值 (0-255)
     *
     * # Arguments
     * * `audio_data` - 音頻數據 (Float32Array)
     * * `noverlap` - 重疊樣本數
     * * `gain_db` - 增益 dB 值（用於縮放）
     * * `range_db` - 動態範圍 dB 值
     *
     * # Returns
     * 扁平化的 Uint8Array (filter_nums * num_frames 或 freq_bins * num_frames)
     * 包含映射到 0-255 範圍的頻譜數據
     * @param {Float32Array} audio_data
     * @param {number} noverlap
     * @param {number} gain_db
     * @param {number} range_db
     * @returns {Uint8Array}
     */
    compute_spectrogram_u8(audio_data, noverlap, gain_db, range_db) {
        const ptr0 = passArrayF32ToWasm0(audio_data, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.spectrogramengine_compute_spectrogram_u8(this.__wbg_ptr, ptr0, len0, noverlap, gain_db, range_db);
        var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v2;
    }
    /**
     * 計算完整的光譜圖像 (FFT -> 重採樣 -> 色彩化)
     *
     * # Arguments
     * * `audio_data` - 單通道音頻數據 (Float32Array)
     * * `width` - 輸出圖像寬度 (時間軸)
     * * `height` - 輸出圖像高度 (頻率軸)
     * * `noverlap` - 窗重疊樣本數
     * * `gain_db` - 增益 (dB)
     * * `range_db` - 動態範圍 (dB)
     *
     * # Returns
     * RGBA 圖像數據 (Uint8ClampedArray) 大小：width * height * 4
     * @param {Float32Array} audio_data
     * @param {number} width
     * @param {number} height
     * @param {number} noverlap
     * @param {number} gain_db
     * @param {number} range_db
     * @returns {Uint8Array}
     */
    compute_spectrogram_image(audio_data, width, height, noverlap, gain_db, range_db) {
        const ptr0 = passArrayF32ToWasm0(audio_data, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.spectrogramengine_compute_spectrogram_image(this.__wbg_ptr, ptr0, len0, width, height, noverlap, gain_db, range_db);
        var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v2;
    }
    /**
     * 創建新的 SpectrogramEngine 實例
     *
     * # Arguments
     * * `fft_size` - FFT 大小（必須是 2 的冪）
     * * `window_func` - 窗函數名稱 (hann, hamming, bartlett, blackman, etc.)
     * * `alpha` - 某些窗函數的 alpha 參數（可選）
     * @param {number} fft_size
     * @param {string} window_func
     * @param {number | null} [alpha]
     */
    constructor(fft_size, window_func, alpha) {
        const ptr0 = passStringToWasm0(window_func, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.spectrogramengine_new(fft_size, ptr0, len0, isLikeNone(alpha) ? 0x100000001 : Math.fround(alpha));
        this.__wbg_ptr = ret >>> 0;
        SpectrogramEngineFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * 獲取峰值檢測結果 (頻率 bin 索引)
     *
     * 基於在最後一次 compute_spectrogram_u8 調用中計算的線性幅度值。
     * 返回每個時間幀中超過閾值的峰值頻率 bin 索引。
     *
     * # Arguments
     * * `threshold_ratio` - 相對於全局最大值的閾值比率 (0.0-1.0, 典型值: 0.4)
     *
     * # Returns
     * Uint16Array，每個元素對應一個時間幀：
     * - 如果超過閾值: 峰值所在的頻率 bin 索引 (0 到 fft_size/2-1)
     * - 如果未超過閾值: u16::MAX (0xFFFF，表示無效)
     * @param {number} threshold_ratio
     * @returns {Uint16Array}
     */
    get_peaks(threshold_ratio) {
        const ret = wasm.spectrogramengine_get_peaks(this.__wbg_ptr, threshold_ratio);
        var v1 = getArrayU16FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 2, 2);
        return v1;
    }
}
if (Symbol.dispose) SpectrogramEngine.prototype[Symbol.dispose] = SpectrogramEngine.prototype.free;

/**
 * WaveformEngine: 實現波形下採樣和峰值提取
 * 用於在縮放和滾動時高效渲染波形，避免重複計算
 */
export class WaveformEngine {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WaveformEngineFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_waveformengine_free(ptr, 0);
    }
    /**
     * 加載單個通道的完整音頻數據
     *
     * # Arguments
     * * `channel_idx` - 通道索引
     * * `data` - 音頻樣本數據 (Float32Array)
     *
     * 此方法在音頻加載時調用一次，存儲完整的音頻數據供後續查詢使用
     * @param {number} channel_idx
     * @param {Float32Array} data
     */
    load_channel(channel_idx, data) {
        const ptr0 = passArrayF32ToWasm0(data, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.waveformengine_load_channel(this.__wbg_ptr, channel_idx, ptr0, len0);
    }
    /**
     * 獲取通道數量
     *
     * # Returns
     * 當前加載的通道數量
     * @returns {number}
     */
    get_num_channels() {
        const ret = wasm.waveformengine_get_num_channels(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * 獲取指定通道的樣本總數
     *
     * # Arguments
     * * `channel_idx` - 通道索引
     *
     * # Returns
     * 該通道的樣本數
     * @param {number} channel_idx
     * @returns {number}
     */
    get_channel_length(channel_idx) {
        const ret = wasm.waveformengine_get_channel_length(this.__wbg_ptr, channel_idx);
        return ret >>> 0;
    }
    /**
     * 在指定範圍內獲取波形峰值
     *
     * # Arguments
     * * `channel_idx` - 通道索引
     * * `start_sample` - 起始樣本索引
     * * `end_sample` - 結束樣本索引（不包含）
     * * `target_width` - 目標寬度（輸出峰值數量）
     *
     * # Returns
     * Float32Array，長度為 target_width，包含每個像素的峰值（絕對值最大值）
     *
     * 邏輯:
     * 1. 計算每個像素對應的樣本數: step = (end_sample - start_sample) / target_width
     * 2. 對於每個像素，在對應的樣本區間內找到最大絕對值
     * 3. 返回包含所有峰值的數組
     * @param {number} channel_idx
     * @param {number} start_sample
     * @param {number} end_sample
     * @param {number} target_width
     * @returns {Float32Array}
     */
    get_peaks_in_range(channel_idx, start_sample, end_sample, target_width) {
        const ret = wasm.waveformengine_get_peaks_in_range(this.__wbg_ptr, channel_idx, start_sample, end_sample, target_width);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * 創建新的 WaveformEngine 實例
     */
    constructor() {
        const ret = wasm.waveformengine_new();
        this.__wbg_ptr = ret >>> 0;
        WaveformEngineFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * 清除所有音頻數據
     */
    clear() {
        wasm.waveformengine_clear(this.__wbg_ptr);
    }
    /**
     * 預分配指定數量的通道
     *
     * # Arguments
     * * `num_channels` - 音頻通道數量
     * @param {number} num_channels
     */
    resize(num_channels) {
        wasm.waveformengine_resize(this.__wbg_ptr, num_channels);
    }
}
if (Symbol.dispose) WaveformEngine.prototype[Symbol.dispose] = WaveformEngine.prototype.free;

/**
 * 計算 Power Spectrum (使用 FFT，支持 Overlap)
 *
 * # Arguments
 * * `audio_data` - 音頻數據 (Float32Array)
 * * `sample_rate` - 採樣率 (Hz)
 * * `fft_size` - FFT 大小
 * * `window_type` - 窗函數類型 (hann, hamming, blackman, gauss, rectangular, triangular)
 * * `overlap_percent` - 重疊百分比 (0-99, 或 null/0 表示自動 75%)
 *
 * # Returns
 * 頻域功率譜 (dB 值)
 * @param {Float32Array} audio_data
 * @param {number} sample_rate
 * @param {number} fft_size
 * @param {string} window_type
 * @param {number | null} [overlap_percent]
 * @returns {Float32Array}
 */
export function compute_power_spectrum(audio_data, sample_rate, fft_size, window_type, overlap_percent) {
    const ptr0 = passArrayF32ToWasm0(audio_data, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(window_type, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.compute_power_spectrum(ptr0, len0, sample_rate, fft_size, ptr1, len1, isLikeNone(overlap_percent) ? 0x100000001 : Math.fround(overlap_percent));
    var v3 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v3;
}

/**
 * 計算波形峰值用於可視化
 *
 * 該函數對音頻通道進行下采樣，將其縮放為指定數量的峰值點。
 * 每個峰值點代表相應範圍內樣本的最大絕對值。
 *
 * # Arguments
 * * `channel_data` - 音頻通道數據 (原始 float32 樣本)
 * * `num_peaks` - 所需的峰值點數量（目標寬度）
 *
 * # Returns
 * 包含 num_peaks 個絕對最大值的 Vec<f32>
 *
 * # Performance
 * 使用迭代器進行優化，避免不必要的數組複製。
 * 對於長音頻文件，此函數比 JavaScript 實現快 5-10 倍。
 * @param {Float32Array} channel_data
 * @param {number} num_peaks
 * @returns {Float32Array}
 */
export function compute_wave_peaks(channel_data, num_peaks) {
    const ptr0 = passArrayF32ToWasm0(channel_data, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.compute_wave_peaks(ptr0, len0, num_peaks);
    var v2 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v2;
}

/**
 * 找到整個音頻緩衝區的全局最大值（用於標準化）
 *
 * # Arguments
 * * `channel_data` - 音頻通道數據
 *
 * # Returns
 * 整個通道的最大絕對值
 * @param {Float32Array} channel_data
 * @returns {number}
 */
export function find_global_max(channel_data) {
    const ptr0 = passArrayF32ToWasm0(channel_data, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.find_global_max(ptr0, len0);
    return ret;
}

/**
 * 從 Power Spectrum 中找到峰值頻率
 *
 * # Arguments
 * * `spectrum` - Power Spectrum (dB 值)
 * * `sample_rate` - 採樣率
 * * `fft_size` - FFT 大小
 * * `flow_hz` - 最低頻率 (Hz)
 * * `fhigh_hz` - 最高頻率 (Hz)
 *
 * # Returns
 * 峰值頻率 (Hz)，如果未找到返回 0
 * @param {Float32Array} spectrum
 * @param {number} sample_rate
 * @param {number} fft_size
 * @param {number} flow_hz
 * @param {number} fhigh_hz
 * @returns {number}
 */
export function find_peak_frequency_from_spectrum(spectrum, sample_rate, fft_size, flow_hz, fhigh_hz) {
    const ptr0 = passArrayF32ToWasm0(spectrum, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.find_peak_frequency_from_spectrum(ptr0, len0, sample_rate, fft_size, flow_hz, fhigh_hz);
    return ret;
}

const EXPECTED_RESPONSE_TYPES = new Set(['basic', 'cors', 'default']);

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = module.ok && EXPECTED_RESPONSE_TYPES.has(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else {
                    throw e;
                }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }
}

function __wbg_get_imports() {
    const imports = {};
    imports.wbg = {};
    imports.wbg.__wbg___wbindgen_throw_dd24417ed36fc46e = function(arg0, arg1) {
        throw new Error(getStringFromWasm0(arg0, arg1));
    };
    imports.wbg.__wbindgen_init_externref_table = function() {
        const table = wasm.__wbindgen_externrefs;
        const offset = table.grow(4);
        table.set(0, undefined);
        table.set(offset + 0, undefined);
        table.set(offset + 1, null);
        table.set(offset + 2, true);
        table.set(offset + 3, false);
    };

    return imports;
}

function __wbg_finalize_init(instance, module) {
    wasm = instance.exports;
    __wbg_init.__wbindgen_wasm_module = module;
    cachedFloat32ArrayMemory0 = null;
    cachedUint16ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;


    wasm.__wbindgen_start();
    return wasm;
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (typeof module !== 'undefined') {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (typeof module_or_path !== 'undefined') {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (typeof module_or_path === 'undefined') {
        module_or_path = new URL('spectrogram_wasm_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync };
export default __wbg_init;
