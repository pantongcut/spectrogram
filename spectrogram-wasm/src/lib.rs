use wasm_bindgen::prelude::*;
use rustfft::FftPlanner;
use num_complex::Complex;
use std::f32::consts::PI;

/// SpectrogramEngine: 處理音頻頻譜圖計算
/// 將 FFT、窗函數應用、濾波器組應用和 dB 轉換從 JavaScript 移到 Rust
#[wasm_bindgen]
pub struct SpectrogramEngine {
    fft_size: usize,
    _window_func: String,  // 保留用於調試
    window_values: Vec<f32>,
    planner: FftPlanner<f32>,
    scratch_buffer: Vec<Complex<f32>>,
    _output_buffer: Vec<f32>,  // 保留用於未來擴展
    _alpha: f32,  // 保留用於未來擴展
    // 濾波器組相關字段
    // 扁平化的濾波器組矩陣 (行優先順序)
    // 維度: num_filters x (fft_size / 2 + 1)
    filter_bank: Vec<f32>,
    num_filters: usize,
    use_filter_bank: bool,
    // 內部緩衝區：存儲最後計算的線性幅度值 (用於峰值檢測)
    last_magnitude_buffer: Vec<f32>,
    last_num_frames: usize,
    last_global_max: f32,
    // 色彩映射：256 種顏色的 RGBA 值 (u32 packed)
    color_map: Vec<u32>,
    // 配置存儲
    current_scale: String,  // "linear", "mel", "log", "bark", "erb"
    freq_min: f32,
    freq_max: f32,
    // 輸出緩衝區 (避免每次分配)
    image_buffer: Vec<u8>,
}

#[wasm_bindgen]
impl SpectrogramEngine {
    /// 創建新的 SpectrogramEngine 實例
    /// 
    /// # Arguments
    /// * `fft_size` - FFT 大小（必須是 2 的冪）
    /// * `window_func` - 窗函數名稱 (hann, hamming, bartlett, blackman, etc.)
    /// * `alpha` - 某些窗函數的 alpha 參數（可選）
    #[wasm_bindgen(constructor)]
    pub fn new(fft_size: usize, window_func: String, alpha: Option<f32>) -> SpectrogramEngine {
        let alpha = alpha.unwrap_or(0.16);
        
        // 計算窗函數值
        let window_values = create_window(&window_func, fft_size, alpha);
        
        // 創建 FFT 規劃器
        let planner = FftPlanner::new();
        
        // 預分配緩衝區
        let scratch_buffer = vec![Complex::default(); fft_size];
        let output_buffer = vec![0.0; fft_size / 2];
        
        SpectrogramEngine {
            fft_size,
            _window_func: window_func,
            window_values,
            planner,
            scratch_buffer,
            _output_buffer: output_buffer,
            _alpha: alpha,
            filter_bank: Vec::new(),
            num_filters: 0,
            use_filter_bank: false,
            last_magnitude_buffer: Vec::new(),
            last_num_frames: 0,
            last_global_max: 0.0,
            color_map: Vec::new(),  // 256 * 4 bytes
            current_scale: "linear".to_string(),
            freq_min: 0.0,
            freq_max: 0.0,
            image_buffer: Vec::new(),
        }
    }

    /// 載入濾波器組矩陣
    /// 
    /// # Arguments
    /// * `flat_weights` - 扁平化的濾波器組權重矩陣 (Float32Array)
    /// * `num_filters` - 濾波器數量
    /// 
    /// 矩陣順序: 行優先 (row-major)
    /// 每行長度: fft_size / 2 + 1
    #[wasm_bindgen]
    pub fn load_filter_bank(&mut self, flat_weights: &[f32], num_filters: usize) {
        self.filter_bank = flat_weights.to_vec();
        self.num_filters = num_filters;
        self.use_filter_bank = true;
    }

    /// 清除濾波器組 (禁用濾波)
    #[wasm_bindgen]
    pub fn clear_filter_bank(&mut self) {
        self.filter_bank.clear();
        self.num_filters = 0;
        self.use_filter_bank = false;
    }

    /// 計算 FFT 頻譜（返回幅度值，不進行 dB 轉換）
    ///
    /// # Arguments
    /// * `audio_data` - 音頻數據 (Float32Array)
    /// * `noverlap` - 重疊樣本數
    ///
    /// # Returns
    /// 平面的 Float32Array（頻率箱 * 時間步），包含幅度值
    #[wasm_bindgen]
    pub fn compute_spectrogram(
        &mut self,
        audio_data: &[f32],
        noverlap: usize,
    ) -> Vec<f32> {
        let step = self.fft_size - noverlap;
        let num_frames = if audio_data.len() >= self.fft_size {
            (audio_data.len() - self.fft_size) / step + 1
        } else {
            0
        };
        
        let freq_bins = self.fft_size / 2;
        let mut result = vec![0.0f32; freq_bins * num_frames];
        
        // 獲取 FFT 算法
        let fft = self.planner.plan_fft_forward(self.fft_size);
        
        let mut pos = 0;
        for frame_idx in 0..num_frames {
            if pos + self.fft_size > audio_data.len() {
                break;
            }
            
            // 應用窗函數並準備 FFT 輸入
            for i in 0..self.fft_size {
                let windowed = audio_data[pos + i] * self.window_values[i];
                self.scratch_buffer[i] = Complex {
                    re: windowed,
                    im: 0.0,
                };
            }
            
            // 執行 FFT
            fft.process(&mut self.scratch_buffer);
            
            // 計算幅度（不轉換為 dB，讓 JavaScript 處理）
            let scale = 2.0 / self.fft_size as f32;
            for i in 0..freq_bins {
                let c = self.scratch_buffer[i];
                let magnitude = (c.re * c.re + c.im * c.im).sqrt();
                result[frame_idx * freq_bins + i] = magnitude * scale;
            }
            
            pos += step;
        }
        
        result
    }

    /// 獲取窗函數值（用於調試/驗證）
    #[wasm_bindgen]
    pub fn get_window_values(&self) -> Vec<f32> {
        self.window_values.clone()
    }

    /// 獲取 FFT 大小
    #[wasm_bindgen]
    pub fn get_fft_size(&self) -> usize {
        self.fft_size
    }

    /// 獲取濾波器數量
    #[wasm_bindgen]
    pub fn get_num_filters(&self) -> usize {
        self.num_filters
    }

    /// 獲取頻率箱數
    #[wasm_bindgen]
    pub fn get_freq_bins(&self) -> usize {
        self.fft_size / 2
    }

    /// 計算頻譜圖並轉換為 u8 量化值 (0-255)
    /// 
    /// # Arguments
    /// * `audio_data` - 音頻數據 (Float32Array)
    /// * `noverlap` - 重疊樣本數
    /// * `gain_db` - 增益 dB 值（用於縮放）
    /// * `range_db` - 動態範圍 dB 值
    ///
    /// # Returns
    /// 扁平化的 Uint8Array (filter_nums * num_frames 或 freq_bins * num_frames)
    /// 包含映射到 0-255 範圍的頻譜數據
    #[wasm_bindgen]
    pub fn compute_spectrogram_u8(
        &mut self,
        audio_data: &[f32],
        noverlap: usize,
        gain_db: f32,
        range_db: f32,
    ) -> Vec<u8> {
        let step = self.fft_size - noverlap;
        let num_frames = if audio_data.len() >= self.fft_size {
            (audio_data.len() - self.fft_size) / step + 1
        } else {
            0
        };
        
        let fft = self.planner.plan_fft_forward(self.fft_size);
        let freq_bins = self.fft_size / 2;
        
        // 決定輸出大小
        let output_bins = if self.use_filter_bank && self.num_filters > 0 {
            self.num_filters
        } else {
            freq_bins
        };
        
        let mut result = vec![0u8; output_bins * num_frames];
        
        // 初始化內部緩衝區用於存儲所有時間幀的線性幅度值
        let mut all_magnitudes = vec![0.0f32; freq_bins * num_frames];
        let mut global_max = 0.0f32;
        
        let mut pos = 0;
        
        // 預計算 dB 範圍值，以優化迴圈
        let gain_db_neg = -gain_db;
        let range_db_reciprocal = 255.0 / range_db;
        
        for frame_idx in 0..num_frames {
            if pos + self.fft_size > audio_data.len() {
                break;
            }
            
            // 第一步: 應用窗函數並準備 FFT 輸入
            for i in 0..self.fft_size {
                let windowed = audio_data[pos + i] * self.window_values[i];
                self.scratch_buffer[i] = Complex {
                    re: windowed,
                    im: 0.0,
                };
            }
            
            // 第二步: 執行 FFT
            fft.process(&mut self.scratch_buffer);
            
            // 第三步: 計算線性幅度
            let scale = 2.0 / self.fft_size as f32;
            let mut magnitude = vec![0.0f32; freq_bins];
            for i in 0..freq_bins {
                let c = self.scratch_buffer[i];
                let mag = (c.re * c.re + c.im * c.im).sqrt() * scale;
                magnitude[i] = mag;
                
                // 更新全局最大值
                if mag > global_max {
                    global_max = mag;
                }
                
                // 保存到內部緩衝區
                all_magnitudes[frame_idx * freq_bins + i] = mag;
            }
            
            // 第四步: 應用濾波器組 (如果啟用)
            let filtered = if self.use_filter_bank && self.num_filters > 0 {
                self.apply_filter_bank(&magnitude)
            } else {
                magnitude.clone()
            };
            
            // 第五步: 轉換為 dB 並量化到 0-255
            for i in 0..filtered.len() {
                let mag = filtered[i];
                // 防止 log10(0)，使用最小值 1e-10
                let safe_mag = if mag > 1e-10 { mag } else { 1e-10 };
                let db = 20.0 * safe_mag.log10();
                
                // 映射到 0-255 範圍
                let u8_val = if db < gain_db_neg - range_db {
                    0
                } else if db > gain_db_neg {
                    255
                } else {
                    ((db - (gain_db_neg - range_db)) * range_db_reciprocal) as u8
                };
                
                result[frame_idx * output_bins + i] = u8_val;
            }
            
            pos += step;
        }
        
        // 保存最後的幅度值和幀數到內部狀態，供 get_peaks() 使用
        self.last_magnitude_buffer = all_magnitudes;
        self.last_num_frames = num_frames;
        self.last_global_max = global_max;
        
        result
    }

    /// 內部方法: 應用濾波器組 (矩陣乘法)
    /// 
    /// magnitude: 線性幅度頻譜 (長度: freq_bins)
    /// 返回: 濾波後的幅度 (長度: num_filters)
    fn apply_filter_bank(&self, magnitude: &[f32]) -> Vec<f32> {
        let mut result = vec![0.0f32; self.num_filters];
        
        if self.filter_bank.is_empty() || magnitude.is_empty() {
            return result;
        }
        
        let freq_bins = magnitude.len();
        
        // 矩陣乘法: result[i] = sum(magnitude[j] * filter_bank[i * freq_bins + j])
        for i in 0..self.num_filters {
            let mut sum = 0.0f32;
            let row_start = i * freq_bins;
            
            for j in 0..freq_bins {
                if row_start + j < self.filter_bank.len() {
                    sum += magnitude[j] * self.filter_bank[row_start + j];
                }
            }
            
            result[i] = sum;
        }
        
        result
    }

    /// 獲取峰值檢測結果 (頻率 bin 索引)
    /// 
    /// 基於在最後一次 compute_spectrogram_u8 調用中計算的線性幅度值。
    /// 返回每個時間幀中超過閾值的峰值頻率 bin 索引。
    /// 
    /// # Arguments
    /// * `threshold_ratio` - 相對於全局最大值的閾值比率 (0.0-1.0, 典型值: 0.4)
    /// 
    /// # Returns
    /// Uint16Array，每個元素對應一個時間幀：
    /// - 如果超過閾值: 峰值所在的頻率 bin 索引 (0 到 fft_size/2-1)
    /// - 如果未超過閾值: u16::MAX (0xFFFF，表示無效)
    #[wasm_bindgen]
    pub fn get_peaks(&self, threshold_ratio: f32) -> Vec<u16> {
        if self.last_magnitude_buffer.is_empty() || self.last_global_max <= 0.0 {
            return Vec::new();
        }
        
        let freq_bins = self.fft_size / 2;
        let threshold = self.last_global_max * threshold_ratio;
        let mut peaks = vec![u16::MAX; self.last_num_frames];
        
        // 對於每個時間幀，找到超過閾值的最大值的 bin 索引
        for frame_idx in 0..self.last_num_frames {
            let frame_start = frame_idx * freq_bins;
            let frame_end = frame_start + freq_bins;
            
            if frame_end > self.last_magnitude_buffer.len() {
                break;
            }
            
            let frame_data = &self.last_magnitude_buffer[frame_start..frame_end];
            
            // 找到此幀中的最大值及其索引
            let (max_idx, max_val) = frame_data.iter()
                .enumerate()
                .fold((0, 0.0f32), |acc, (idx, &val)| {
                    if val > acc.1 {
                        (idx, val)
                    } else {
                        acc
                    }
                });
            
            // 僅當最大值超過閾值時才記錄峰值
            if max_val >= threshold {
                peaks[frame_idx] = max_idx as u16;
            }
        }
        
        peaks
    }

    /// 獲取每個時間幀的峰值幅度值
    /// 
    /// 基於在最後一次 compute_spectrogram_u8 調用中計算的線性幅度值。
    /// 返回每個時間幀中峰值 bin 的幅度值（線性，未轉換為 dB）。
    /// 
    /// # Returns
    /// Float32Array，其中每個元素是對應時間幀的峰值幅度值
    /// 如果該幀沒有有效的峰值，返回 0.0
    #[wasm_bindgen]
    pub fn get_peak_magnitudes(&self, threshold_ratio: f32) -> Vec<f32> {
        if self.last_magnitude_buffer.is_empty() || self.last_global_max <= 0.0 {
            return Vec::new();
        }
        
        let freq_bins = self.fft_size / 2;
        let threshold = self.last_global_max * threshold_ratio;
        let mut magnitudes = vec![0.0f32; self.last_num_frames];
        
        // 對於每個時間幀，找到超過閾值的最大值的幅度
        for frame_idx in 0..self.last_num_frames {
            let frame_start = frame_idx * freq_bins;
            let frame_end = frame_start + freq_bins;
            
            if frame_end > self.last_magnitude_buffer.len() {
                break;
            }
            
            let frame_data = &self.last_magnitude_buffer[frame_start..frame_end];
            
            // 找到此幀中的最大值
            let max_val = frame_data.iter()
                .fold(0.0f32, |acc, &val| {
                    if val > acc { val } else { acc }
                });
            
            // 僅當最大值超過閾值時才記錄幅度值
            if max_val >= threshold {
                magnitudes[frame_idx] = max_val;
            }
        }
        
        magnitudes
    }

    /// 獲取最後計算的全局最大幅度值
    /// 
    /// 此值在最後一次 compute_spectrogram_u8 調用時計算。
    /// 用於與閾值進行比較以進行峰值檢測。
    /// 
    /// # Returns
    /// 線性幅度值（未轉換為 dB）
    #[wasm_bindgen]
    pub fn get_global_max(&self) -> f32 {
        self.last_global_max
    }

    /// 設置 256 色的色彩映射 (RGBA)
    /// 
    /// # Arguments
    /// * `colors` - 256 * 4 字節的 RGBA 顏色數組
    #[wasm_bindgen]
    pub fn set_color_map(&mut self, colors: &[u8]) {
        // 預期大小：256 * 4 = 1024 字節
        if colors.len() != 1024 {
            return;  // 無效的色彩映射大小，跳過
        }
        
        // 轉換 [u8; 4] 成 u32 (RGBA 打包)
        self.color_map.clear();
        self.color_map.reserve(256);
        
        for i in 0..256 {
            let offset = i * 4;
            let r = colors[offset] as u32;
            let g = colors[offset + 1] as u32;
            let b = colors[offset + 2] as u32;
            let a = colors[offset + 3] as u32;
            
            // 打包為 u32 (RGBA 順序)
            let packed = (r << 24) | (g << 16) | (b << 8) | a;
            self.color_map.push(packed);
        }
    }

    /// 設置光譜配置 (用於記錄，但主要用於驗證)
    #[wasm_bindgen]
    pub fn set_spectrum_config(&mut self, scale: String, freq_min: f32, freq_max: f32) {
        self.current_scale = scale;
        self.freq_min = freq_min;
        self.freq_max = freq_max;
    }

    /// 計算完整的光譜圖像 (FFT -> 重採樣 -> 色彩化)
    /// 
    /// # Arguments
    /// * `audio_data` - 單通道音頻數據 (Float32Array)
    /// * `width` - 輸出圖像寬度 (時間軸)
    /// * `height` - 輸出圖像高度 (頻率軸)
    /// * `noverlap` - 窗重疊樣本數
    /// * `gain_db` - 增益 (dB)
    /// * `range_db` - 動態範圍 (dB)
    /// 
    /// # Returns
    /// RGBA 圖像數據 (Uint8ClampedArray) 大小：width * height * 4
    #[wasm_bindgen]
    pub fn compute_spectrogram_image(
        &mut self,
        audio_data: &[f32],
        width: usize,
        height: usize,
        noverlap: usize,
        gain_db: f32,
        range_db: f32,
    ) -> Vec<u8> {
        // 驗證參數
        if width == 0 || height == 0 || self.color_map.is_empty() {
            return vec![0; width * height * 4];
        }

        // 預分配輸出緩衝區
        let mut output = vec![0u8; width * height * 4];

        // 步驟 1: 計算完整光譜 (FFT -> u8 量化)
        let fft_size = self.fft_size;
        let freq_bins = fft_size / 2;
        
        // 計算窗函數與幀數
        let frame_step = fft_size - noverlap;
        let num_frames = if audio_data.len() >= fft_size {
            (audio_data.len() - noverlap) / frame_step
        } else {
            0
        };

        if num_frames == 0 {
            return output;
        }

        // 決定輸出大小：如果使用濾波器組，高度是 num_filters；否則是 freq_bins
        let spec_height = if self.use_filter_bank {
            self.num_filters
        } else {
            freq_bins
        };

        // 步驟 2: 計算重採樣映射
        // 源座標系統: (time_idx, freq_idx) -> time_idx in [0, num_frames), freq_idx in [0, spec_height)
        // 目標座標系統: (x, y) -> x in [0, width), y in [0, height)
        
        // 預計算時間和頻率的採樣因子
        let time_sample_step = num_frames as f32 / width as f32;
        let freq_sample_step = spec_height as f32 / height as f32;

        // 步驟 3: 處理每個輸出像素
        for y in 0..height {
            // 頻率軸採樣（從上到下對應從高到低頻率）
            let src_freq_idx = (height - 1 - y) as f32 * freq_sample_step;
            let src_freq_int = src_freq_idx.floor() as usize;
            let src_freq_frac = src_freq_idx - src_freq_int as f32;
            
            // 確保索引在範圍內
            let src_freq_idx0 = src_freq_int.min(spec_height - 1);
            let src_freq_idx1 = (src_freq_int + 1).min(spec_height - 1);

            for x in 0..width {
                // 時間軸採樣
                let src_time_idx = x as f32 * time_sample_step;
                let src_time_int = src_time_idx.floor() as usize;
                let src_time_frac = src_time_idx - src_time_int as f32;
                
                // 確保索引在範圍內
                let src_time_idx0 = src_time_int.min(num_frames - 1);
                let src_time_idx1 = (src_time_int + 1).min(num_frames - 1);

                // 執行雙線性插值以獲取幅度值
                let mut magnitude = 0.0f32;

                // 計算 4 個鄰近點的幅度值
                for &time_idx in &[src_time_idx0, src_time_idx1] {
                    for &freq_idx in &[src_freq_idx0, src_freq_idx1] {
                        // 計算該幀的 u8 頻譜
                        let frame_start = time_idx * frame_step;
                        let frame_end = (frame_start + fft_size).min(audio_data.len());
                        
                        if frame_end <= frame_start {
                            continue;
                        }

                        let frame = &audio_data[frame_start..frame_end];
                        
                        // 計算此幀的頻譜
                        let frame_spec = self.compute_frame_spectrum(frame, gain_db, range_db);
                        
                        if freq_idx < frame_spec.len() {
                            let val = frame_spec[freq_idx] as f32 / 255.0;  // 歸一化至 [0, 1]
                            
                            // 加權（雙線性）
                            let time_weight = if time_idx == src_time_idx0 {
                                1.0 - src_time_frac
                            } else {
                                src_time_frac
                            };
                            let freq_weight = if freq_idx == src_freq_idx0 {
                                1.0 - src_freq_frac
                            } else {
                                src_freq_frac
                            };
                            
                            magnitude += val * time_weight * freq_weight;
                        }
                    }
                }

                // 步驟 4: 色彩化
                let clamped_idx = (magnitude * 255.0).clamp(0.0, 255.0) as usize;
                let rgba = self.color_map.get(clamped_idx).copied().unwrap_or(0);

                // 解包 RGBA 並寫入輸出
                let pixel_idx = (y * width + x) * 4;
                output[pixel_idx] = (rgba >> 24) as u8;      // R
                output[pixel_idx + 1] = ((rgba >> 16) & 0xFF) as u8;  // G
                output[pixel_idx + 2] = ((rgba >> 8) & 0xFF) as u8;   // B
                output[pixel_idx + 3] = (rgba & 0xFF) as u8;          // A
            }
        }

        output
    }

    /// 輔助方法：計算單幀的頻譜 (返回 u8 值)
    fn compute_frame_spectrum(&mut self, frame: &[f32], gain_db: f32, range_db: f32) -> Vec<u8> {
        let fft_size = self.fft_size;
        let freq_bins = fft_size / 2;

        // 填充窗函數和 FFT
        let mut input = vec![Complex::default(); fft_size];
        for (i, val) in frame.iter().enumerate().take(fft_size) {
            input[i] = Complex::new(val * self.window_values[i], 0.0);
        }

        // 執行 FFT
        let fft = self.planner.plan_fft_forward(fft_size);
        let mut buffer = input;
        fft.process(&mut buffer);

        // 計算幅度
        let mut magnitudes = vec![0.0; freq_bins];
        for i in 0..freq_bins {
            let magnitude = (buffer[i].norm() * 2.0) / fft_size as f32;  // 歸一化
            magnitudes[i] = magnitude;
        }

        // 應用濾波器組（如果已加載）
        let output = if self.use_filter_bank && !self.filter_bank.is_empty() {
            let mut filtered = vec![0.0; self.num_filters];
            let filter_len = fft_size / 2 + 1;

            for (filter_idx, filtered_val) in filtered.iter_mut().enumerate() {
                let filter_row_start = filter_idx * filter_len;
                let filter_row_end = filter_row_start + filter_len.min(magnitudes.len());
                
                for (j, weight) in self.filter_bank[filter_row_start..filter_row_end].iter().enumerate() {
                    *filtered_val += magnitudes[j] * weight;
                }
            }
            filtered
        } else {
            magnitudes
        };

        // 轉換為 dB 並量化為 u8
        let mut result = vec![0u8; output.len()];
        for (i, &magnitude) in output.iter().enumerate() {
            let db = if magnitude > 0.0 {
                20.0 * magnitude.log10()
            } else {
                -80.0
            };
            
            // 應用增益和範圍
            let normalized = (db + range_db / 2.0 + gain_db) / range_db;
            let clamped = normalized.clamp(0.0, 1.0);
            result[i] = (clamped * 255.0) as u8;
        }

        result
    }
}


/// 根據名稱創建窗函數
fn create_window(window_name: &str, size: usize, alpha: f32) -> Vec<f32> {
    let mut window = vec![0.0; size];
    
    match window_name {
        "bartlett" => {
            for i in 0..size {
                window[i] = 2.0 / (size as f32 - 1.0)
                    * ((size as f32 - 1.0) / 2.0 - (i as f32 - (size as f32 - 1.0) / 2.0).abs());
            }
        }
        "bartlettHann" => {
            for i in 0..size {
                let ni = i as f32 / (size as f32 - 1.0);
                window[i] = 0.62
                    - 0.48 * (ni - 0.5).abs()
                    - 0.38 * (2.0 * PI * ni).cos();
            }
        }
        "blackman" => {
            for i in 0..size {
                window[i] = (1.0 - alpha) / 2.0
                    - 0.5 * (2.0 * PI * i as f32 / (size as f32 - 1.0)).cos()
                    + alpha / 2.0 * (4.0 * PI * i as f32 / (size as f32 - 1.0)).cos();
            }
        }
        "cosine" => {
            for i in 0..size {
                window[i] = (PI * i as f32 / (size as f32 - 1.0) - PI / 2.0).cos();
            }
        }
        "gauss" => {
            let sigma = 0.25 * (size as f32 - 1.0) / 2.0;
            for i in 0..size {
                let x = (i as f32 - (size as f32 - 1.0) / 2.0) / sigma;
                window[i] = (-0.5 * x * x).exp();
            }
        }
        "hamming" => {
            for i in 0..size {
                window[i] = 0.54 - 0.46 * (2.0 * PI * i as f32 / (size as f32 - 1.0)).cos();
            }
        }
        "hann" => {
            for i in 0..size {
                window[i] = 0.5 * (1.0 - (2.0 * PI * i as f32 / (size as f32 - 1.0)).cos());
            }
        }
        "lanczos" => {
            for i in 0..size {
                let x = 2.0 * i as f32 / (size as f32 - 1.0) - 1.0;
                let pi_x = PI * x;
                window[i] = if pi_x.abs() < 1e-6 {
                    1.0
                } else {
                    pi_x.sin() / pi_x
                };
            }
        }
        "rectangular" => {
            for i in 0..size {
                window[i] = 1.0;
            }
        }
        "triangular" => {
            for i in 0..size {
                window[i] = 2.0 / size as f32
                    * (size as f32 / 2.0 - (i as f32 - (size as f32 - 1.0) / 2.0).abs());
            }
        }
        _ => {
            // 默認為 Hann 窗
            for i in 0..size {
                window[i] = 0.5 * (1.0 - (2.0 * PI * i as f32 / (size as f32 - 1.0)).cos());
            }
        }
    }
    
    window
}

/// 計算波形峰值用於可視化
/// 
/// 該函數對音頻通道進行下采樣，將其縮放為指定數量的峰值點。
/// 每個峰值點代表相應範圍內樣本的最大絕對值。
/// 
/// # Arguments
/// * `channel_data` - 音頻通道數據 (原始 float32 樣本)
/// * `num_peaks` - 所需的峰值點數量（目標寬度）
/// 
/// # Returns
/// 包含 num_peaks 個絕對最大值的 Vec<f32>
/// 
/// # Performance
/// 使用迭代器進行優化，避免不必要的數組複製。
/// 對於長音頻文件，此函數比 JavaScript 實現快 5-10 倍。
#[wasm_bindgen]
pub fn compute_wave_peaks(channel_data: &[f32], num_peaks: usize) -> Vec<f32> {
    if num_peaks == 0 || channel_data.is_empty() {
        return Vec::new();
    }
    
    let data_len = channel_data.len();
    let step_size = data_len as f32 / num_peaks as f32;
    
    let mut peaks = Vec::with_capacity(num_peaks);
    
    // 迭代每個峰值點
    for peak_idx in 0..num_peaks {
        let start = (peak_idx as f32 * step_size) as usize;
        let end = (((peak_idx + 1) as f32 * step_size).ceil() as usize).min(data_len);
        
        // 找到該段中的最大絕對值
        let max_val = if start < end {
            channel_data[start..end]
                .iter()
                .copied()
                .map(|x| x.abs())
                .fold(0.0f32, f32::max)
        } else {
            0.0
        };
        
        peaks.push(max_val);
    }
    
    peaks
}

/// 找到整個音頻緩衝區的全局最大值（用於標準化）
/// 
/// # Arguments
/// * `channel_data` - 音頻通道數據
/// 
/// # Returns
/// 整個通道的最大絕對值
#[wasm_bindgen]
pub fn find_global_max(channel_data: &[f32]) -> f32 {
    channel_data
        .iter()
        .copied()
        .map(|x| x.abs())
        .fold(0.0f32, f32::max)
}

/// WaveformEngine: 實現波形下採樣和峰值提取
/// 用於在縮放和滾動時高效渲染波形，避免重複計算
#[wasm_bindgen]
pub struct WaveformEngine {
    /// 存儲完整的音頻數據，按通道組織
    /// 索引: channels[channel_idx][sample_idx]
    channels: Vec<Vec<f32>>,
}

#[wasm_bindgen]
impl WaveformEngine {
    /// 創建新的 WaveformEngine 實例
    #[wasm_bindgen(constructor)]
    pub fn new() -> WaveformEngine {
        WaveformEngine {
            channels: Vec::new(),
        }
    }
    
    /// 預分配指定數量的通道
    /// 
    /// # Arguments
    /// * `num_channels` - 音頻通道數量
    #[wasm_bindgen]
    pub fn resize(&mut self, num_channels: usize) {
        self.channels.clear();
        self.channels.resize(num_channels, Vec::new());
    }
    
    /// 加載單個通道的完整音頻數據
    /// 
    /// # Arguments
    /// * `channel_idx` - 通道索引
    /// * `data` - 音頻樣本數據 (Float32Array)
    /// 
    /// 此方法在音頻加載時調用一次，存儲完整的音頻數據供後續查詢使用
    #[wasm_bindgen]
    pub fn load_channel(&mut self, channel_idx: usize, data: &[f32]) {
        if channel_idx >= self.channels.len() {
            return;
        }
        
        // 複製音頻數據到 Rust 向量
        self.channels[channel_idx] = data.to_vec();
    }
    
    /// 在指定範圍內獲取波形峰值
    /// 
    /// # Arguments
    /// * `channel_idx` - 通道索引
    /// * `start_sample` - 起始樣本索引
    /// * `end_sample` - 結束樣本索引（不包含）
    /// * `target_width` - 目標寬度（輸出峰值數量）
    /// 
    /// # Returns
    /// Float32Array，長度為 target_width，包含每個像素的峰值（絕對值最大值）
    /// 
    /// 邏輯:
    /// 1. 計算每個像素對應的樣本數: step = (end_sample - start_sample) / target_width
    /// 2. 對於每個像素，在對應的樣本區間內找到最大絕對值
    /// 3. 返回包含所有峰值的數組
    #[wasm_bindgen]
    pub fn get_peaks_in_range(
        &self,
        channel_idx: usize,
        start_sample: usize,
        end_sample: usize,
        target_width: usize,
    ) -> Vec<f32> {
        // 邊界檢查
        if channel_idx >= self.channels.len() || target_width == 0 {
            return vec![0.0; target_width.max(1)];
        }
        
        let channel_data = &self.channels[channel_idx];
        let data_len = channel_data.len();
        
        // 修正 end_sample，確保不超過數據長度
        let end_sample = end_sample.min(data_len);
        let sample_range = end_sample.saturating_sub(start_sample);
        
        if sample_range == 0 {
            return vec![0.0; target_width];
        }
        
        let mut peaks = vec![0.0f32; target_width];
        
        // 計算每個像素對應的樣本步長
        let step = sample_range as f32 / target_width as f32;
        
        // 對於每個像素，計算峰值
        for pixel_idx in 0..target_width {
            let pixel_start = (pixel_idx as f32 * step) as usize;
            let pixel_end = ((pixel_idx as f32 + 1.0) * step).ceil() as usize;
            
            // 計算此像素在原始數據中的實際位置
            let chunk_start = (start_sample + pixel_start).min(data_len);
            let chunk_end = (start_sample + pixel_end).min(data_len);
            
            // 如果範圍有效，找到最大絕對值
            if chunk_start < chunk_end && chunk_start < data_len {
                let chunk = &channel_data[chunk_start..chunk_end];
                let max_val = chunk
                    .iter()
                    .copied()
                    .map(|x| x.abs())
                    .fold(0.0f32, f32::max);
                
                peaks[pixel_idx] = max_val;
            }
        }
        
        peaks
    }
    
    /// 獲取指定通道的樣本總數
    /// 
    /// # Arguments
    /// * `channel_idx` - 通道索引
    /// 
    /// # Returns
    /// 該通道的樣本數
    #[wasm_bindgen]
    pub fn get_channel_length(&self, channel_idx: usize) -> usize {
        if channel_idx < self.channels.len() {
            self.channels[channel_idx].len()
        } else {
            0
        }
    }
    
    /// 獲取通道數量
    /// 
    /// # Returns
    /// 當前加載的通道數量
    #[wasm_bindgen]
    pub fn get_num_channels(&self) -> usize {
        self.channels.len()
    }
    
    /// 清除所有音頻數據
    #[wasm_bindgen]
    pub fn clear(&mut self) {
        self.channels.clear();
    }
}

// ============================================================
// 獨立的 Power Spectrum 計算函數（2025 優化）
// 用於 JavaScript powerSpectrum.js 的 WASM 加速版本
// ============================================================

/// 計算 Power Spectrum (使用 FFT，支持 Overlap)
/// 
/// # Arguments
/// * `audio_data` - 音頻數據 (Float32Array)
/// * `sample_rate` - 採樣率 (Hz)
/// * `fft_size` - FFT 大小
/// * `window_type` - 窗函數類型 (hann, hamming, blackman, gauss, rectangular, triangular)
/// * `overlap_percent` - 重疊百分比 (0-99, 或 null/0 表示自動 75%)
/// 
/// # Returns
/// 頻域功率譜 (dB 值)
#[wasm_bindgen]
pub fn compute_power_spectrum(
    audio_data: &[f32],
    sample_rate: u32,
    fft_size: usize,
    window_type: &str,
    overlap_percent: Option<f32>,
) -> Vec<f32> {
    if audio_data.is_empty() {
        return Vec::new();
    }

    // 確定 hop size (每幀之間的步長)
    let overlap = overlap_percent.unwrap_or(0.0);
    let hop_size = if overlap <= 0.0 || overlap >= 100.0 {
        // Auto mode: 使用 75% overlap
        (fft_size as f32 * 0.25) as usize
    } else {
        (fft_size as f32 * (1.0 - overlap / 100.0)) as usize
    };
    let hop_size = hop_size.max(1); // 至少 1

    // 創建窗函數
    let window = create_window(window_type, fft_size, 0.16);

    // 計算頻率解析度
    let freq_resolution = sample_rate as f32 / fft_size as f32;
    let max_freq = sample_rate as f32 / 2.0; // Nyquist
    let num_bins = ((max_freq / freq_resolution) as usize) + 1;

    // 初始化累積能量譜
    let mut spectrum = vec![0.0f32; num_bins];
    let mut frame_count = 0usize;

    // 創建 FFT 規劃器
    let mut planner = FftPlanner::new();
    let fft = planner.plan_fft_forward(fft_size);

    // 分幀處理音頻
    let mut offset = 0;
    while offset + fft_size <= audio_data.len() {
        // 提取幀
        let frame = &audio_data[offset..offset + fft_size];

        // 應用窗函數
        let mut windowed = vec![0.0f32; fft_size];
        for i in 0..fft_size {
            windowed[i] = frame[i] * window[i];
        }

        // 移除 DC 偏移
        let mut dc_sum = 0.0f32;
        for &val in &windowed {
            dc_sum += val;
        }
        let dc_offset = dc_sum / fft_size as f32;
        for val in &mut windowed {
            *val -= dc_offset;
        }

        // 準備 FFT 輸入 (Complex 數據)
        let mut fft_input: Vec<Complex<f32>> = windowed
            .iter()
            .map(|&v| Complex::new(v, 0.0))
            .collect();

        // 執行 FFT
        fft.process(&mut fft_input);

        // 提取功率譜並累積
        for bin in 0..num_bins {
            if bin < fft_input.len() {
                let magnitude = fft_input[bin].norm();
                let power = magnitude * magnitude;
                spectrum[bin] += power;
            }
        }

        frame_count += 1;
        offset += hop_size;
    }

    // 如果幀數為 0，返回空
    if frame_count == 0 {
        return Vec::new();
    }

    // 計算平均能量並轉換為 dB
    let frame_count_f = frame_count as f32;
    for i in 0..spectrum.len() {
        let avg_power = spectrum[i] / frame_count_f;
        // RMS
        let rms = avg_power.sqrt();
        // PSD = (RMS^2) / fft_size
        let psd = (rms * rms) / fft_size as f32;
        // 轉換為 dB
        spectrum[i] = 10.0 * psd.max(1e-16).log10();
    }

    spectrum
}

/// 從 Power Spectrum 中找到峰值頻率
/// 
/// # Arguments
/// * `spectrum` - Power Spectrum (dB 值)
/// * `sample_rate` - 採樣率
/// * `fft_size` - FFT 大小
/// * `flow_hz` - 最低頻率 (Hz)
/// * `fhigh_hz` - 最高頻率 (Hz)
/// 
/// # Returns
/// 峰值頻率 (Hz)，如果未找到返回 0
#[wasm_bindgen]
pub fn find_peak_frequency_from_spectrum(
    spectrum: &[f32],
    sample_rate: u32,
    fft_size: usize,
    flow_hz: f32,
    fhigh_hz: f32,
) -> f32 {
    if spectrum.is_empty() {
        return 0.0;
    }

    let freq_resolution = sample_rate as f32 / fft_size as f32;
    let min_bin = ((flow_hz / freq_resolution) as usize).max(0);
    let max_bin = ((fhigh_hz / freq_resolution) as usize)
        .min(spectrum.len().saturating_sub(1));

    if min_bin >= max_bin {
        return 0.0;
    }

    // 找到最大值 bin
    let mut peak_bin = min_bin;
    let mut peak_db = spectrum[min_bin];

    for i in (min_bin + 1)..=max_bin {
        if spectrum[i] > peak_db {
            peak_db = spectrum[i];
            peak_bin = i;
        }
    }

    // 如果峰值在中間，進行拋物線插值
    if peak_bin > min_bin && peak_bin < max_bin {
        let db0 = spectrum[peak_bin - 1];
        let db1 = spectrum[peak_bin];
        let db2 = spectrum[peak_bin + 1];

        let a = (db2 - 2.0 * db1 + db0) / 2.0;
        if a.abs() > 1e-10 {
            let bin_correction = (db0 - db2) / (4.0 * a);
            let refined_bin = peak_bin as f32 + bin_correction;
            return refined_bin * freq_resolution;
        }
    }

    // 無插值，直接返回
    peak_bin as f32 * freq_resolution
}
