/* tslint:disable */
/* eslint-disable */

export class SpectrogramEngine {
  free(): void;
  [Symbol.dispose](): void;
  /**
   * 獲取 FFT 大小
   */
  get_fft_size(): number;
  /**
   * 獲取頻率箱數
   */
  get_freq_bins(): number;
  /**
   * 設置 256 色的色彩映射 (RGBA)
   * 
   * # Arguments
   * * `colors` - 256 * 4 字節的 RGBA 顏色數組
   */
  set_color_map(colors: Uint8Array): void;
  /**
   * 獲取最後計算的全局最大幅度值
   * 
   * 此值在最後一次 compute_spectrogram_u8 調用時計算。
   * 用於與閾值進行比較以進行峰值檢測。
   * 
   * # Returns
   * 線性幅度值（未轉換為 dB）
   */
  get_global_max(): number;
  /**
   * 獲取濾波器數量
   */
  get_num_filters(): number;
  /**
   * 載入濾波器組矩陣
   * 
   * # Arguments
   * * `flat_weights` - 扁平化的濾波器組權重矩陣 (Float32Array)
   * * `num_filters` - 濾波器數量
   * 
   * 矩陣順序: 行優先 (row-major)
   * 每行長度: fft_size / 2 + 1
   */
  load_filter_bank(flat_weights: Float32Array, num_filters: number): void;
  /**
   * 清除濾波器組 (禁用濾波)
   */
  clear_filter_bank(): void;
  /**
   * 獲取窗函數值（用於調試/驗證）
   */
  get_window_values(): Float32Array;
  /**
   * 計算 FFT 頻譜（返回幅度值，不進行 dB 轉換）
   *
   * # Arguments
   * * `audio_data` - 音頻數據 (Float32Array)
   * * `noverlap` - 重疊樣本數
   *
   * # Returns
   * 平面的 Float32Array（頻率箱 * 時間步），包含幅度值
   */
  compute_spectrogram(audio_data: Float32Array, noverlap: number): Float32Array;
  /**
   * 獲取每個時間幀的峰值幅度值
   * 
   * 基於在最後一次 compute_spectrogram_u8 調用中計算的線性幅度值。
   * 返回每個時間幀中峰值 bin 的幅度值（線性，未轉換為 dB）。
   * 
   * # Returns
   * Float32Array，其中每個元素是對應時間幀的峰值幅度值
   * 如果該幀沒有有效的峰值，返回 0.0
   */
  get_peak_magnitudes(threshold_ratio: number): Float32Array;
  /**
   * 設置光譜配置 (用於記錄，但主要用於驗證)
   */
  set_spectrum_config(scale: string, freq_min: number, freq_max: number): void;
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
   */
  compute_spectrogram_u8(audio_data: Float32Array, noverlap: number, gain_db: number, range_db: number): Uint8Array;
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
   */
  compute_spectrogram_image(audio_data: Float32Array, width: number, height: number, noverlap: number, gain_db: number, range_db: number): Uint8Array;
  /**
   * 創建新的 SpectrogramEngine 實例
   * 
   * # Arguments
   * * `fft_size` - FFT 大小（必須是 2 的冪）
   * * `window_func` - 窗函數名稱 (hann, hamming, bartlett, blackman, etc.)
   * * `alpha` - 某些窗函數的 alpha 參數（可選）
   */
  constructor(fft_size: number, window_func: string, alpha?: number | null);
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
   */
  get_peaks(threshold_ratio: number): Uint16Array;
}

export class WaveformEngine {
  free(): void;
  [Symbol.dispose](): void;
  /**
   * 加載單個通道的完整音頻數據
   * 
   * # Arguments
   * * `channel_idx` - 通道索引
   * * `data` - 音頻樣本數據 (Float32Array)
   * 
   * 此方法在音頻加載時調用一次，存儲完整的音頻數據供後續查詢使用
   */
  load_channel(channel_idx: number, data: Float32Array): void;
  /**
   * 獲取通道數量
   * 
   * # Returns
   * 當前加載的通道數量
   */
  get_num_channels(): number;
  /**
   * 獲取指定通道的樣本總數
   * 
   * # Arguments
   * * `channel_idx` - 通道索引
   * 
   * # Returns
   * 該通道的樣本數
   */
  get_channel_length(channel_idx: number): number;
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
   */
  get_peaks_in_range(channel_idx: number, start_sample: number, end_sample: number, target_width: number): Float32Array;
  /**
   * 創建新的 WaveformEngine 實例
   */
  constructor();
  /**
   * 清除所有音頻數據
   */
  clear(): void;
  /**
   * 預分配指定數量的通道
   * 
   * # Arguments
   * * `num_channels` - 音頻通道數量
   */
  resize(num_channels: number): void;
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
 */
export function compute_wave_peaks(channel_data: Float32Array, num_peaks: number): Float32Array;

/**
 * 找到整個音頻緩衝區的全局最大值（用於標準化）
 * 
 * # Arguments
 * * `channel_data` - 音頻通道數據
 * 
 * # Returns
 * 整個通道的最大絕對值
 */
export function find_global_max(channel_data: Float32Array): number;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly __wbg_spectrogramengine_free: (a: number, b: number) => void;
  readonly __wbg_waveformengine_free: (a: number, b: number) => void;
  readonly compute_wave_peaks: (a: number, b: number, c: number) => [number, number];
  readonly find_global_max: (a: number, b: number) => number;
  readonly spectrogramengine_clear_filter_bank: (a: number) => void;
  readonly spectrogramengine_compute_spectrogram: (a: number, b: number, c: number, d: number) => [number, number];
  readonly spectrogramengine_compute_spectrogram_image: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number];
  readonly spectrogramengine_compute_spectrogram_u8: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
  readonly spectrogramengine_get_fft_size: (a: number) => number;
  readonly spectrogramengine_get_freq_bins: (a: number) => number;
  readonly spectrogramengine_get_global_max: (a: number) => number;
  readonly spectrogramengine_get_num_filters: (a: number) => number;
  readonly spectrogramengine_get_peak_magnitudes: (a: number, b: number) => [number, number];
  readonly spectrogramengine_get_peaks: (a: number, b: number) => [number, number];
  readonly spectrogramengine_get_window_values: (a: number) => [number, number];
  readonly spectrogramengine_load_filter_bank: (a: number, b: number, c: number, d: number) => void;
  readonly spectrogramengine_new: (a: number, b: number, c: number, d: number) => number;
  readonly spectrogramengine_set_color_map: (a: number, b: number, c: number) => void;
  readonly spectrogramengine_set_spectrum_config: (a: number, b: number, c: number, d: number, e: number) => void;
  readonly waveformengine_clear: (a: number) => void;
  readonly waveformengine_get_channel_length: (a: number, b: number) => number;
  readonly waveformengine_get_num_channels: (a: number) => number;
  readonly waveformengine_get_peaks_in_range: (a: number, b: number, c: number, d: number, e: number) => [number, number];
  readonly waveformengine_load_channel: (a: number, b: number, c: number, d: number) => void;
  readonly waveformengine_new: () => number;
  readonly waveformengine_resize: (a: number, b: number) => void;
  readonly __wbindgen_externrefs: WebAssembly.Table;
  readonly __wbindgen_malloc: (a: number, b: number) => number;
  readonly __wbindgen_free: (a: number, b: number, c: number) => void;
  readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
  readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
* Instantiates the given `module`, which can either be bytes or
* a precompiled `WebAssembly.Module`.
*
* @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
*
* @returns {InitOutput}
*/
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
* If `module_or_path` is {RequestInfo} or {URL}, makes a request and
* for everything else, calls `WebAssembly.instantiate` directly.
*
* @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
*
* @returns {Promise<InitOutput>}
*/
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
