import init, { SpectrogramEngine } from './spectrogram_wasm.js';

// ===== COLOR MAP DEFAULTS =====
export const COLOR_MAP_DEFAULTS = {
    'mono_light': { brightness: 0.10, contrast: 1.25, gain: 0.75 },
    'mono_dark': { brightness: 0.00, contrast: 1.65, gain: 0.85 },   
    'viridis': { brightness: 0.00, contrast: 1.30, gain: 1.00 },
    'inferno': { brightness: 0.00, contrast: 1.00, gain: 1.00 },
    'sonoradar': { brightness: 0.00, contrast: 1.10, gain: 1.00 },
    'kaleidoscope': { brightness: 0.00, contrast: 1.00, gain: 0.75 },
    'rainbow': { brightness: 0.00, contrast: 1.00, gain: 0.90 },
    'iron': { brightness: 0.00, contrast: 1.00, gain: 0.80 },      
    'default': { brightness: 0.00, contrast: 1.00, gain: 1.00 }
};

export function getColorMapDefaults(name) {
    return COLOR_MAP_DEFAULTS[name] || COLOR_MAP_DEFAULTS['default'];
}

// WASM 初始化 Promise
let wasmReady = init();

function t(t, e, s, r) {
    return new (s || (s = Promise))((function(i, a) {
        function n(t) {
            try {
                o(r.next(t))
            } catch (t) {
                a(t)
            }
        }
        function h(t) {
            try {
                o(r.throw(t))
            } catch (t) {
                a(t)
            }
        }
        function o(t) {
            var e;
            t.done ? i(t.value) : (e = t.value,
            e instanceof s ? e : new s((function(t) {
                t(e)
            }
            ))).then(n, h)
        }
        o((r = r.apply(t, e || [])).next())
    }
    ))
}
"function" == typeof SuppressedError && SuppressedError;
class e {
    constructor() {
        this.listeners = {}
    }
    on(t, e, s) {
        if (this.listeners[t] || (this.listeners[t] = new Set),
        this.listeners[t].add(e),
        null == s ? void 0 : s.once) {
            const s = () => {
                this.un(t, s),
                this.un(t, e)
            }
            ;
            return this.on(t, s),
            s
        }
        return () => this.un(t, e)
    }
    un(t, e) {
        var s;
        null === (s = this.listeners[t]) || void 0 === s || s.delete(e)
    }
    once(t, e) {
        return this.on(t, e, {
            once: !0
        })
    }
    unAll() {
        this.listeners = {}
    }
    emit(t, ...e) {
        this.listeners[t] && this.listeners[t].forEach((t => t(...e)))
    }
}
class s extends e {
    constructor(t) {
        super(),
        this.subscriptions = [],
        this.options = t
    }
    onInit() {}
    _init(t) {
        this.wavesurfer = t,
        this.onInit()
    }
    destroy() {
        this.emit("destroy"),
        this.subscriptions.forEach((t => t()))
    }
}
function r(t, e) {
    const s = e.xmlns ? document.createElementNS(e.xmlns, t) : document.createElement(t);
    for (const [t,i] of Object.entries(e))
        if ("children" === t)
            for (const [t,i] of Object.entries(e))
                "string" == typeof i ? s.appendChild(document.createTextNode(i)) : s.appendChild(r(t, i));
        else
            "style" === t ? Object.assign(s.style, i) : "textContent" === t ? s.textContent = i : s.setAttribute(t, i.toString());
    return s
}
function i(t, e, s) {
    const i = r(t, e || {});
    return null == s || s.appendChild(i),
    i
}
function a(t, e, s, r) {
    switch (this.bufferSize = t,
    this.sampleRate = e,
    this.bandwidth = 2 / t * (e / 2),
    this.sinTable = new Float32Array(t),
    this.cosTable = new Float32Array(t),
    this.windowValues = new Float32Array(t),
    this.reverseTable = new Uint32Array(t),
    this.peakBand = 0,
    this.peak = 0,
    s) {
    case "bartlett":
        for (i = 0; i < t; i++)
            this.windowValues[i] = 2 / (t - 1) * ((t - 1) / 2 - Math.abs(i - (t - 1) / 2));
        break;
    case "bartlettHann":
        for (i = 0; i < t; i++)
            this.windowValues[i] = .62 - .48 * Math.abs(i / (t - 1) - .5) - .38 * Math.cos(2 * Math.PI * i / (t - 1));
        break;
    case "blackman":
        for (r = r || .16,
        i = 0; i < t; i++)
            this.windowValues[i] = (1 - r) / 2 - .5 * Math.cos(2 * Math.PI * i / (t - 1)) + r / 2 * Math.cos(4 * Math.PI * i / (t - 1));
        break;
    case "cosine":
        for (i = 0; i < t; i++)
            this.windowValues[i] = Math.cos(Math.PI * i / (t - 1) - Math.PI / 2);
        break;
    case "gauss":
        for (r = r || .25,
        i = 0; i < t; i++)
            this.windowValues[i] = Math.pow(Math.E, -.5 * Math.pow((i - (t - 1) / 2) / (r * (t - 1) / 2), 2));
        break;
    case "hamming":
        for (i = 0; i < t; i++)
            this.windowValues[i] = .54 - .46 * Math.cos(2 * Math.PI * i / (t - 1));
        break;
    case "hann":
    case void 0:
        for (i = 0; i < t; i++)
            this.windowValues[i] = .5 * (1 - Math.cos(2 * Math.PI * i / (t - 1)));
        break;
    case "lanczoz":
        for (i = 0; i < t; i++)
            this.windowValues[i] = Math.sin(Math.PI * (2 * i / (t - 1) - 1)) / (Math.PI * (2 * i / (t - 1) - 1));
        break;
    case "rectangular":
        for (i = 0; i < t; i++)
            this.windowValues[i] = 1;
        break;
    case "triangular":
        for (i = 0; i < t; i++)
            this.windowValues[i] = 2 / t * (t / 2 - Math.abs(i - (t - 1) / 2));
        break;
    default:
        throw Error("No such window function '" + s + "'")
    }
    for (var i, a = 1, n = t >> 1; a < t; ) {
        for (i = 0; i < a; i++)
            this.reverseTable[i + a] = this.reverseTable[i] + n;
        a <<= 1,
        n >>= 1
    }
    for (i = 0; i < t; i++)
        this.sinTable[i] = Math.sin(-Math.PI / i),
        this.cosTable[i] = Math.cos(-Math.PI / i);
    // allocate reusable temporary arrays to avoid per-call allocations
    this._o = new Float32Array(t);
    this._l = new Float32Array(t);
    this._f = new Float32Array(t >> 1);

    this.calculateSpectrum = function(t) {
        var e, s, r, i = this.bufferSize, a = this.cosTable, n = this.sinTable, h = this.reverseTable, o = this._o, l = this._l, c = 2 / this.bufferSize, u = Math.sqrt, f = this._f, p = Math.floor(Math.log(i) / Math.LN2);
        if (Math.pow(2, p) !== i)
            throw "Invalid buffer size, must be a power of 2.";
        if (i !== t.length)
            throw "Supplied buffer is not the same size as defined FFT. FFT Size: " + i + " Buffer Size: " + t.length;
        for (var d, w, g, b, M, m, y, v, T = 1, k = 0; k < i; k++)
            o[k] = t[h[k]] * this.windowValues[h[k]],
            l[k] = 0;
        for (; T < i; ) {
            d = a[T],
            w = n[T],
            g = 1,
            b = 0;
            for (var z = 0; z < T; z++) {
                for (k = z; k < i; )
                    m = g * o[M = k + T] - b * l[M],
                    y = g * l[M] + b * o[M],
                    o[M] = o[k] - m,
                    l[M] = l[k] - y,
                    o[k] += m,
                    l[k] += y,
                    k += T << 1;
                g = (v = g) * d - b * w,
                b = v * w + b * d
            }
            T <<= 1
        }
        k = 0;
        for (var F = i / 2; k < F; k++)
            (r = c * u((e = o[k]) * e + (s = l[k]) * s)) > this.peak && (this.peakBand = k,
            this.peak = r),
            f[k] = r;
        return f
    }
}

// Color map generation - optimized for bioacoustics
function generateColorMapRGBA(mapName, gain = 1.0) {
    const lut = new Uint8ClampedArray(256 * 4);
    
    const colorMaps = {
        inferno: [
            { pos: 0.0, r: 0, g: 0, b: 0 },
            { pos: 0.15, r: 0, g: 0, b: 0 }, 
            { pos: 0.5, r: 87, g: 16, b: 109 },
            { pos: 0.75, r: 188, g: 48, b: 60 },
            { pos: 0.85, r: 253, g: 128, b: 25 },
            { pos: 1.0, r: 252, g: 255, b: 164 }
        ],
        viridis: [
            { pos: 0.0, r: 0, g: 0, b: 0 },
            { pos: 0.15, r: 0, g: 0, b: 0 }, 
            { pos: 0.45, r: 59, g: 82, b: 139 },
            { pos: 0.75, r: 33, g: 145, b: 140 },
            { pos: 0.85, r: 253, g: 231, b: 37 },
            { pos: 1.0, r: 255, g: 255, b: 0 }
        ],
        magma: [
            { pos: 0.0, r: 0, g: 0, b: 0 },
            { pos: 0.15, r: 0, g: 0, b: 0 },            
            { pos: 0.45, r: 86, g: 25, b: 114 },
            { pos: 0.75, r: 177, g: 60, b: 120 },
            { pos: 0.85, r: 250, g: 155, b: 135 },
            { pos: 1.0, r: 252, g: 253, b: 191 }
        ],
        sonoradar: [
            { pos: 0.0, r: 0, g: 0, b: 0 },       // 全黑背景
            { pos: 0.15, r: 45, g: 20, b: 5 },    // 深咖啡色：顯示極微弱信號 (Noise floor)
            { pos: 0.4, r: 180, g: 90, b: 10 },   // 焦糖橘色：中等強度過渡
            { pos: 0.7, r: 255, g: 215, b: 0 },   // 金色：主要信號
            { pos: 0.85, r: 255, g: 240, b: 150 }, // 淺鵝黃：強信號高光
            { pos: 1.0, r: 255, g: 255, b: 255 }  // 純白：過載/最強點
        ],
        mono_dark: [
            { pos: 0.0, r: 0, g: 0, b: 0 },
            { pos: 0.5, r: 137, g: 137, b: 137 },           
            { pos: 1.0, r: 255, g: 255, b: 255 }
        ],
        mono_light: [
            { pos: 0.0, r: 255, g: 255, b: 255 },
            { pos: 0.5, r: 137, g: 137, b: 137 },
            { pos: 1.0, r: 0, g: 0, b: 0 }
        ],
        kaleidoscope: [
            { pos: 0.0, r: 0, g: 0, b: 0 },
            { pos: 0.01, r: 0, g: 0, b: 3 },
            { pos: 0.15, r: 0, g: 0, b: 0 },
            { pos: 0.2, r: 0, g: 60, b: 90 },
            { pos: 0.5, r: 0, g: 180, b: 60 },
            { pos: 0.85, r: 255, g: 230, b: 0 },
            { pos: 1.0, r: 255, g: 40, b: 0 }
        ],
        iron: [
            { pos: 0.0, r: 0, g: 0, b: 0 },
            { pos: 0.15, r: 0, g: 0, b: 0 }, 
            { pos: 0.45, r: 0, g: 85, b: 175 },
            { pos: 0.6, r: 0, g: 255, b: 255 },
            { pos: 0.7, r: 0, g: 255, b: 0 },
            { pos: 0.8, r: 255, g: 255, b: 0 },         
            { pos: 1.0, r: 255, g: 0, b: 0 }
        ],
        rainbow: [
            { pos: 0.0, r: 255, g: 255, b: 255 },
            { pos: 0.25, r: 255, g: 255, b: 255 }, 
            { pos: 0.35, r: 255, g: 127, b: 128 },   // 噪聲起點 (Light Pinkish Red)
            { pos: 0.45, r: 255, g: 255, b: 0 },  // 外圍輪廓，訊號邊緣/過渡區 (Yellow)
            { pos: 0.65, r: 0, g: 255, b: 0 },   // 訊號主體 (Vibrant Green)
            { pos: 0.7, r: 0, g: 255, b: 255 },    // 強訊號區 (Cyan)
            { pos: 0.9, r: 0, g: 0, b: 175 },   // (Blue)
            { pos: 1.0, r: 0, g: 0, b: 39 }   // (Dark blue)
        ],
    };
    
    const keyframes = colorMaps[mapName] || colorMaps.viridis;
    
    // Apply gain transformation to keyframe positions (except 0.0 and 1.0 to preserve range limits)
    if (gain !== 1.0) {
        for (let k = 0; k < keyframes.length; k++) {
            if (keyframes[k].pos > 0.0 && keyframes[k].pos < 1.0) {
                keyframes[k].pos = Math.pow(keyframes[k].pos, gain);
            }
        }
    }
    
    // Interpolation Logic
    for (let i = 0; i < 256; i++) {
        const pos = i / 255;
        let lower = keyframes[0];
        let upper = keyframes[keyframes.length - 1];
        
        for (let j = 0; j < keyframes.length - 1; j++) {
            if (keyframes[j].pos <= pos && pos <= keyframes[j + 1].pos) {
                lower = keyframes[j];
                upper = keyframes[j + 1];
                break;
            }
        }
        
        const t = (pos - lower.pos) / (upper.pos - lower.pos);
        const r = Math.round(lower.r + t * (upper.r - lower.r));
        const g = Math.round(lower.g + t * (upper.g - lower.g));
        const b = Math.round(lower.b + t * (upper.b - lower.b));
        
        lut[i * 4] = r;
        lut[i * 4 + 1] = g;
        lut[i * 4 + 2] = b;
        lut[i * 4 + 3] = 255;
    }
    return lut;
}

const n = 1e3 * Math.log(10) / 107.939;
class h extends s {
    static create(t) {
        return new h(t || {})
    }
    constructor(t) {
        var e, s;
        if (super(t),
        // Initialize colorMapName to track the current selection string
        this.colorMapName = (typeof t.colorMap === 'string') ? t.colorMap : 'viridis',
        this.frequenciesDataUrl = t.frequenciesDataUrl,
        this.container = "string" == typeof t.container ? document.querySelector(t.container) : t.container,
        t.colorMap && "string" != typeof t.colorMap) {
            if (t.colorMap.length < 256)
                throw new Error("Colormap must contain 256 elements");
            for (let e = 0; e < t.colorMap.length; e++) {
                if (4 !== t.colorMap[e].length)
                    throw new Error("ColorMap entries must contain 4 values")
            }
            this.colorMap = t.colorMap
        } else
            switch (this.colorMap = t.colorMap || "viridis",
            this.colorMap) {
            case "gray":
                this.colorMap = [];
                for (let t = 0; t < 256; t++) {
                    const e = (255 - t) / 256;
                    this.colorMap.push([e, e, e, 1])
                }
                break;
            case "igray":
                this.colorMap = [];
                for (let t = 0; t < 256; t++) {
                    const e = t / 256;
                    this.colorMap.push([e, e, e, 1])
                }
                break;
            case "inferno":
            case "viridis":
            case "magma":
            case "sonoradar":
            case "mono_dark":
            case "mono_light":
            case "kaleidoscope":
            case "iron":
            case "rainbow": {
                // Use generateColorMapRGBA function to generate color mapping
                const colorMapUint = generateColorMapRGBA(this.colorMap);
                this.colorMap = [];
                for (let i = 0; i < 256; i++) {
                    const r = colorMapUint[i * 4] / 255;
                    const g = colorMapUint[i * 4 + 1] / 255;
                    const b = colorMapUint[i * 4 + 2] / 255;
                    const a = colorMapUint[i * 4 + 3] / 255;
                    this.colorMap.push([r, g, b, a]);
                }
                break;
            }
            default:
                throw Error("No such colormap '" + this.colorMap + "'")
            }
        this.fftSamples = t.fftSamples || 512,
        this.height = t.height || 200,
        this.noverlap = t.noverlap || null,
        this.windowFunc = t.windowFunc || "hann",
        this.alpha = t.alpha,
        this.frequencyMin = t.frequencyMin || 0,
        this.frequencyMax = t.frequencyMax || 0,
        this.gainDB = null !== (e = t.gainDB) && void 0 !== e ? e : 20,
        this.rangeDB = null !== (s = t.rangeDB) && void 0 !== s ? s : 80,
        this.scale = t.scale || "mel",
        this.numMelFilters = this.fftSamples / 2,
        this.numLogFilters = this.fftSamples / 2,
        this.numBarkFilters = this.fftSamples / 2,
        this.numErbFilters = this.fftSamples / 2,
        this.createWrapper(),
        this.createCanvas();

        // WASM integration
        this._wasmEngine = null;
        this._wasmInitialized = false;
        this._wasmReady = wasmReady.then(() => {
            if (this._wasmInitialized) return;  // 防止重複初始化
            this._wasmInitialized = true;
            
            this._wasmEngine = new SpectrogramEngine(
                this.fftSamples,
                this.windowFunc,
                this.alpha
            );
            
            // 設置色彩映射到 WASM
            if (this._colorMapUint && this._colorMapUint.length === 1024) {
                this._wasmEngine.set_color_map(this._colorMapUint);
            }
            
            // 設置光譜配置
            this._wasmEngine.set_spectrum_config(
                this.scale,
                this.frequencyMin,
                this.frequencyMax
            );
            console.log('✅ [Spectrogram] WASM 引擎已初始化 - 使用預計算色彩映射渲染');
        });

        // 濾波器組相關字段
        this._filterBankMatrix = null;  // 當前濾波器組矩陣 (二維陣列)
        this._filterBankFlat = null;    // 扁平化的濾波器組 (Float32Array)
        this._lastFilterBankScale = null; // 用於檢測濾波器組是否需要更新

        // cache for filter banks to avoid rebuilding on each render
        this._filterBankCache = {};
        // 新增: 按完整 key 緩存濾波器組矩陣，避免重複計算
        this._filterBankCacheByKey = {};
        // 新增: 追蹤當前加載到 WASM 的濾波器組 key，避免重複加載
        this._loadedFilterBankKey = null;
        // cache for resample mappings keyed by inputLen:outputWidth
        this._resampleCache = {};
        
        // --- NEW: Image Enhancement State with Color Map Defaults ---
        const defaults = getColorMapDefaults(this.colorMapName);
        this.imgParams = { 
            brightness: defaults.brightness, 
            contrast: defaults.contrast, 
            gain: defaults.gain 
        };
        this._baseColorMapUint = new Uint8ClampedArray(256 * 4);   // Original pure colormap
        this._activeColorMapUint = new Uint8ClampedArray(256 * 4); // Processed (with B/C/G applied)
        
        // precomputed uint8 colormap (RGBA 0-255) - Now we populate _baseColorMapUint
        // Keep _colorMapUint for backward compatibility during transition
        this._colorMapUint = new Uint8ClampedArray(256 * 4);
        if (this.colorMap && this._colorMapUint) {
            for (let ii = 0; ii < 256; ii++) {
                const cc = this.colorMap[ii] || [0, 0, 0, 1];
                this._colorMapUint[ii * 4] = Math.round(255 * cc[0]);
                this._colorMapUint[ii * 4 + 1] = Math.round(255 * cc[1]);
                this._colorMapUint[ii * 4 + 2] = Math.round(255 * cc[2]);
                this._colorMapUint[ii * 4 + 3] = Math.round(255 * cc[3]);
            }
            // Copy to base colormap
            this._baseColorMapUint.set(this._colorMapUint);
        }
        
        // Generate initial active colormap with current enhancement params
        this._updateActiveColorMap();
    }
    
    // [NEW] Internal method to calculate the active colormap from base + image enhancement
    _updateActiveColorMap() {
        const { brightness, contrast, gain } = this.imgParams;

        // Regenerate the base map using the current gain value to modify keyframe distribution
        const newBaseMap = generateColorMapRGBA(this.colorMapName, gain);
        this._baseColorMapUint.set(newBaseMap);

        for (let i = 0; i < 256; i++) {
            const baseIdx = i * 4;
            
            // Process R, G, B channels
            for (let c = 0; c < 3; c++) {
                // Normalize 0-255 to 0.0-1.0
                let v = this._baseColorMapUint[baseIdx + c] / 255;

                // 1. Contrast (Expand from center 0.5)
                v = (v - 0.5) * contrast + 0.5;

                // 2. Brightness (Linear offset)
                v = v + brightness;

                // Clamp to 0.0-1.0
                v = Math.max(0, Math.min(1, v));

                // Store back to 0-255
                this._activeColorMapUint[baseIdx + c] = Math.round(v * 255);
            }
            
            // Preserve Alpha
            this._activeColorMapUint[baseIdx + 3] = this._baseColorMapUint[baseIdx + 3];
        }

        // Push to WASM engine
        if (this._wasmEngine && this._wasmEngine.set_color_map) {
            this._wasmEngine.set_color_map(this._activeColorMapUint);
        }

        // Redraw components
        this.drawColorMapBar();
        
        if (this.lastRenderData) {
            this.drawSpectrogram(this.lastRenderData);
        }
    }
    
    onInit() {
        this.container = this.container || this.wavesurfer.getWrapper(),
        this.container.appendChild(this.wrapper),
        this.wavesurfer.options.fillParent && Object.assign(this.wrapper.style, {
            width: "100%",
            overflowX: "hidden",
            overflowY: "hidden"
        }),
        this.subscriptions.push(this.wavesurfer.on("redraw", ( () => this.render()))),
        // 初始化後創建色圖下拉菜單並繪製 color-bar
        this._createColorMapDropdown(),
        this.drawColorMapBar()
    }
    destroy() {
        // Clean up event listeners for color bar and dropdown
        if (this._colorBarClickHandler) {
            const colorBarCanvas = document.getElementById("color-bar");
            if (colorBarCanvas) {
                colorBarCanvas.removeEventListener("click", this._colorBarClickHandler);
            }
            this._colorBarClickHandler = null;
        }
        
        if (this._documentClickHandler) {
            document.removeEventListener("click", this._documentClickHandler);
            this._documentClickHandler = null;
        }
        
        this.unAll(),
        this.wavesurfer.un("ready", this._onReady),
        this.wavesurfer.un("redraw", this._onRender),
        this.wavesurfer = null,
        this.util = null,
        this.options = null,
        this.wrapper && (this.wrapper.remove(),
        this.wrapper = null),
        super.destroy()
    }
    setColorMap(mapName) {
        this.colorMapName = mapName;
        
        // 1. Get and Apply Defaults
        const defaults = getColorMapDefaults(mapName);
        this.imgParams.brightness = defaults.brightness;
        this.imgParams.contrast = defaults.contrast;
        this.imgParams.gain = defaults.gain;

        // 2. Generate new base map with the default gain value
        const newBaseMap = generateColorMapRGBA(mapName, defaults.gain);
        this._baseColorMapUint.set(newBaseMap);
        this._colorMapUint.set(newBaseMap); // Keep backup for compatibility
        
        // 3. Re-apply active map with new params
        this._updateActiveColorMap();
        
        // 4. Update Dropdown UI (if exists)
        if (this.colorMapDropdown) {
            this.colorMapDropdown.querySelectorAll(".dropdown-item").forEach(el => {
                el.classList.toggle("selected", el.dataset.colorMapName === mapName);
            });
        }
        
        // 5. Emit event for Main.js to sync UI
        this.emit('colorMapChanged', {
            name: mapName,
            settings: defaults
        });
        
        console.log(`✅ [Spectrogram] Switched to ${mapName} with defaults:`, defaults);
    }
    
    // [NEW] Public API for brightness/contrast/gain control
    setImageEnhancement(brightness, contrast, gain) {
        this.imgParams.brightness = brightness;
        this.imgParams.contrast = contrast;
        this.imgParams.gain = gain;
        
        console.log('[Spectrogram] setImageEnhancement called:', { brightness, contrast, gain });
        
        this._updateActiveColorMap();
    }
    applyBrightnessFilter(brightnessColorMap) {
        // 應用亮度濾鏡到當前色彩映射
        // brightnessColorMap 是由 brightnessControl 生成的濾鏡色圖，用於調整亮度/增益/對比度
        if (!this._colorMapUint || !brightnessColorMap) {
            console.warn('[Spectrogram] applyBrightnessFilter: missing colorMap or filter');
            return;
        }
        
        console.log('[Spectrogram] applyBrightnessFilter called');
        
        // 創建濾鏡後的色圖
        const filtered = new Uint8ClampedArray(256 * 4);
        for (let i = 0; i < 256; i++) {
            // 獲取濾鏡值（0-1）
            const filterValue = brightnessColorMap[i][0];
            
            // 獲取原始色彩值
            const originalR = this._colorMapUint[i * 4];
            const originalG = this._colorMapUint[i * 4 + 1];
            const originalB = this._colorMapUint[i * 4 + 2];
            const originalA = this._colorMapUint[i * 4 + 3];
            
            // 應用濾鏡：乘法混合
            filtered[i * 4] = Math.round(originalR * filterValue);
            filtered[i * 4 + 1] = Math.round(originalG * filterValue);
            filtered[i * 4 + 2] = Math.round(originalB * filterValue);
            filtered[i * 4 + 3] = originalA;
        }
        
        // 將濾鏡後的色圖應用到 WASM 引擎
        if (this._wasmEngine && this._wasmEngine.set_color_map) {
            this._wasmEngine.set_color_map(filtered);
            console.log('[Spectrogram] Color map applied to WASM engine');
        }
        
        // 重新渲染頻譜
        if (this.lastRenderData) {
            this.drawSpectrogram(this.lastRenderData);
        }
        
        // 恢復原始色圖到 WASM 引擎（以備下次顏色切換）
        if (this._wasmEngine && this._wasmEngine.set_color_map) {
            this._wasmEngine.set_color_map(this._colorMapUint);
            console.log('[Spectrogram] Original color map restored');
        }
    }
    loadFrequenciesData(e) {
        return t(this, void 0, void 0, (function*() {
            const t = yield fetch(e);
            if (!t.ok)
                throw new Error("Unable to fetch frequencies data");
            const s = yield t.json();
            this.drawSpectrogram(s)
        }
        ))
    }
    createWrapper() {
        this.wrapper = i("div", {
            style: {
                display: "block",
                position: "relative",
                userSelect: "none"
            }
        }),
        this.options.labels && (this.labelsEl = i("canvas", {
            part: "spec-labels",
            style: {
                position: "absolute",
                zIndex: 9,
                width: "55px",
                height: "100%"
            }
        }, this.wrapper)),
        
        this.wrapper.addEventListener("click", this._onWrapperClick)
    }

    // Helper method to draw a preview canvas for a color map with its defaults applied
    _drawPreviewToCanvas(canvas, mapName) {
        if (!canvas) return;
        
        const defaults = getColorMapDefaults(mapName);
        const { brightness, contrast, gain } = defaults;
        
        // Generate base map with gain transformation
        const baseMap = generateColorMapRGBA(mapName, gain);
        
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        
        const width = canvas.width || 300;
        const height = canvas.height || 20;
        const imageData = ctx.createImageData(width, height);
        const data = imageData.data;
        
        // Fill the canvas with the color map with brightness and contrast applied
        for (let x = 0; x < width; x++) {
            const colorIdx = Math.floor((x / width) * 255);
            const baseIdx = colorIdx * 4;
            
            // Extract base color values
            let r = baseMap[baseIdx] / 255;
            let g = baseMap[baseIdx + 1] / 255;
            let b = baseMap[baseIdx + 2] / 255;
            
            // Apply Contrast (expand from center 0.5)
            r = (r - 0.5) * contrast + 0.5;
            g = (g - 0.5) * contrast + 0.5;
            b = (b - 0.5) * contrast + 0.5;
            
            // Apply Brightness (linear offset)
            r = r + brightness;
            g = g + brightness;
            b = b + brightness;
            
            // Clamp to 0.0-1.0
            r = Math.max(0, Math.min(1, r));
            g = Math.max(0, Math.min(1, g));
            b = Math.max(0, Math.min(1, b));
            
            // Convert back to 0-255 and fill all rows with this color
            const pixelR = Math.round(r * 255);
            const pixelG = Math.round(g * 255);
            const pixelB = Math.round(b * 255);
            
            for (let y = 0; y < height; y++) {
                const idx = (y * width + x) * 4;
                data[idx] = pixelR;
                data[idx + 1] = pixelG;
                data[idx + 2] = pixelB;
                data[idx + 3] = 255;
            }
        }
        
        ctx.putImageData(imageData, 0, 0);
    }

    _createColorMapDropdown() {
        // Get the static dropdown container from HTML
        const colorBarCanvas = document.getElementById("color-bar");
        this.colorMapDropdown = document.getElementById("color-map-dropdown");
        
        if (!colorBarCanvas || !this.colorMapDropdown) {
            console.warn("⚠️ [Spectrogram] color-bar or color-map-dropdown not found");
            return;
        }
        
        // Clear any existing content
        this.colorMapDropdown.innerHTML = '';
        
        // Color map options
        const colorMapOptions = [
            { name: "inferno", label: "Inferno" },
            { name: "viridis", label: "Viridis" },
            { name: "magma", label: "Magma" },
            { name: "sonoradar", label: "SonoRadar" },
            { name: "mono_dark", label: "Mono Dark" },
            { name: "mono_light", label: "Mono Light" },
            { name: "kaleidoscope", label: "Kaleidoscope" },
            { name: "iron", label: "Iron" },
            { name: "rainbow", label: "Rainbow" }
        ];
        
        // Create menu items for each option with preview canvases
        colorMapOptions.forEach((option, index) => {
            const item = document.createElement("div");
            item.className = "colormap-option";
            item.dataset.colorMapName = option.name;
            item.dataset.index = index;
            
            // Create name label
            const nameSpan = document.createElement("span");
            nameSpan.className = "colormap-name";
            nameSpan.textContent = option.label;
            item.appendChild(nameSpan);
            
            // Create preview canvas
            const previewCanvas = document.createElement("canvas");
            previewCanvas.className = "colormap-preview";
            previewCanvas.width = 300;
            previewCanvas.height = 20;
            item.appendChild(previewCanvas);
            
            // Draw the preview immediately
            this._drawPreviewToCanvas(previewCanvas, option.name);
            
            // Apply selected class if this is the currently active color map
            if (option.name === this.colorMapName) {
                item.classList.add('selected');
            }
            
            // Click event: switch color map
            item.addEventListener("click", (e) => {
                e.stopPropagation();
                this.setColorMap(option.name);
                // Update selected state
                this.colorMapDropdown.querySelectorAll(".colormap-option").forEach((el, idx) => {
                    el.classList.toggle("selected", idx === index);
                });
            });
            
            this.colorMapDropdown.appendChild(item);
        });
        
        // Store reference to the click handler so we can remove it later
        this._colorBarClickHandler = (e) => {
            e.stopPropagation();
            const isOpen = this.colorMapDropdown.style.display !== "none";
            if (isOpen) {
                this.colorMapDropdown.style.display = "none";
            } else {
                this.colorMapDropdown.style.display = "block";
            }
        };
        
        // Store reference to the document click handler so we can remove it later
        this._documentClickHandler = (e) => {
            if (!this.colorMapDropdown.contains(e.target) && e.target !== colorBarCanvas) {
                this.colorMapDropdown.style.display = "none";
            }
        };
        
        // Attach click listeners
        colorBarCanvas.addEventListener("click", this._colorBarClickHandler);
        document.addEventListener("click", this._documentClickHandler);
    }
    drawColorMapBar() {
        // 將當前色圖繪製到 color-bar canvas (使用處理後的活躍色圖)
        const canvas = document.getElementById("color-bar");
        if (!canvas || !this._activeColorMapUint) return;
        
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        
        const imageData = ctx.createImageData(canvas.width, canvas.height);
        const data = imageData.data;
        
        // 橫向填充色圖 256 色到 canvas 寬度
        const step = 256 / canvas.width;
        for (let x = 0; x < canvas.width; x++) {
            const colorIdx = Math.floor(x * step);
            const r = this._activeColorMapUint[colorIdx * 4];
            const g = this._activeColorMapUint[colorIdx * 4 + 1];
            const b = this._activeColorMapUint[colorIdx * 4 + 2];
            const a = this._activeColorMapUint[colorIdx * 4 + 3];
            
            // 填充此列的所有像素
            for (let y = 0; y < canvas.height; y++) {
                const idx = (y * canvas.width + x) * 4;
                data[idx] = r;
                data[idx + 1] = g;
                data[idx + 2] = b;
                data[idx + 3] = a;
            }
        }
        
        ctx.putImageData(imageData, 0, 0);
    }
    createCanvas() {
        this.canvas = i("canvas", {
            style: {
                position: "absolute",
                left: 0,
                top: 0,
                width: "100%",
                height: "100%",
                zIndex: 4
            }
        }, this.wrapper),
        this.spectrCc = this.canvas.getContext("2d")
    }
    async render() {
        var t;
        if (this.frequenciesDataUrl)
            this.loadFrequenciesData(this.frequenciesDataUrl);
        else {
            const e = null === (t = this.wavesurfer) || void 0 === t ? void 0 : t.getDecodedData();
            if (e) {
                const frequencies = await this.getFrequencies(e);
                if (frequencies) {
                    this.drawSpectrogram(frequencies);
                }
            }
        }
    }

    // [NEW] 設置平滑渲染模式
    setSmoothMode(isSmooth) {
        this.smoothMode = isSmooth;
        // 如果有緩存的數據，立即重繪
        if (this.lastRenderData) {
            this.drawSpectrogram(this.lastRenderData);
        }
    }

    drawSpectrogram(t) {
        // 保存最後的渲染數據，用於色彩映射切換時快速重新渲染
        this.lastRenderData = t;
        
        // 檢查 wrapper 和 canvas 是否已被清空
        if (!this.wrapper || !this.canvas) {
            return;
        }
        
        // 確保 t 是二維陣列 (每個通道一行)
        isNaN(t[0][0]) || (t = [t]);
        
        this.wrapper.style.height = this.height * t.length + "px";
        this.canvas.width = this.getWidth();
        this.canvas.height = this.height * t.length;
        
        const canvasCtx = this.spectrCc;
        if (!canvasCtx || !this._wasmEngine) {
            return;
        }

        // [NEW] 根據 Smooth Mode 設定 Canvas 的平滑屬性
        // 這會啟用 GPU 的雙線性插值，讓邊緣變平滑
        const isSmooth = this.smoothMode || false;
        canvasCtx.imageSmoothingEnabled = isSmooth;
        canvasCtx.imageSmoothingQuality = isSmooth ? 'high' : 'low';

        // 使用 WASM 渲染每個通道
        for (let channelIdx = 0; channelIdx < t.length; channelIdx++) {
            const channelData = t[channelIdx];  // Uint8Array with frame spectrum data
            
            // 根據當前配置確定頻率軸高度
            const specHeight = this._wasmEngine.get_num_filters() > 0 && this.scale !== "linear"
                ? this._wasmEngine.get_num_filters()
                : (this.fftSamples / 2);
            
            const canvasWidth = this.getWidth();
            const canvasHeight = this.height;
            
            // ============================================================
            // 核心差異：Smooth Mode vs Pixelated Mode
            // ============================================================
            let renderPixels;
            
            if (isSmooth) {
                // [Smooth Mode]: 
                // 1. 跳過 CPU resample，直接使用原始 FFT 數據 (channelData)
                // 2. 這提高了效率，因為不需要執行昂貴的重採樣算法
                // 3. 繪製時會由 drawImage 自動進行拉伸和平滑
                renderPixels = channelData;
            } else {
                // [Default Mode]: 
                // 1. 使用現有的 resample 函數將數據調整為屏幕寬度
                // 2. 這會產生銳利的像素感 (一格一格)
                renderPixels = this.resample(channelData);
            }
            
            // 獲取圖像尺寸
            // 在 Smooth Mode 下，width 是原始 FFT 幀數；在 Default Mode 下，width 是 canvasWidth
            const imgWidth = Array.isArray(renderPixels) && renderPixels[0] 
                ? renderPixels.length 
                : renderPixels.length;
            const imgHeight = Array.isArray(renderPixels) && renderPixels[0]
                ? renderPixels[0].length
                : 1;

            // 創建 ImageData
            const imgData = new ImageData(imgWidth, imgHeight);
            
            // 填充 ImageData (使用緩存的色彩映射)
            if (this._activeColorMapUint && this._activeColorMapUint.length === 1024) {
                // 使用處理後的活躍色彩映射 (已套用亮度/對比度/增益)
                if (Array.isArray(renderPixels) && renderPixels[0]) {
                    // 2D array case
                    for (let x = 0; x < renderPixels.length; x++) {
                        for (let y = 0; y < renderPixels[x].length; y++) {
                            let intensity = renderPixels[x][y];
                            if (intensity < 0) intensity = 0;
                            else if (intensity > 255) intensity = 255;
                            
                            const cmapIdx = intensity * 4;
                            const pixelIdx = (((renderPixels[x].length - 1 - y) * imgWidth + x)) * 4;
                            
                            imgData.data[pixelIdx] = this._activeColorMapUint[cmapIdx];
                            imgData.data[pixelIdx + 1] = this._activeColorMapUint[cmapIdx + 1];
                            imgData.data[pixelIdx + 2] = this._activeColorMapUint[cmapIdx + 2];
                            imgData.data[pixelIdx + 3] = this._activeColorMapUint[cmapIdx + 3];
                        }
                    }
                } else {
                    // 1D array case (Smooth Mode with Uint8Array)
                    for (let i = 0; i < renderPixels.length; i++) {
                        let intensity = renderPixels[i];
                        if (intensity < 0) intensity = 0;
                        else if (intensity > 255) intensity = 255;
                        
                        const cmapIdx = intensity * 4;
                        const pixelIdx = i * 4;
                        
                        imgData.data[pixelIdx] = this._activeColorMapUint[cmapIdx];
                        imgData.data[pixelIdx + 1] = this._activeColorMapUint[cmapIdx + 1];
                        imgData.data[pixelIdx + 2] = this._activeColorMapUint[cmapIdx + 2];
                        imgData.data[pixelIdx + 3] = this._activeColorMapUint[cmapIdx + 3];
                    }
                }
            } else {
                // 備用方法: 直接使用灰度值 (如果色彩映射未初始化)
                if (Array.isArray(renderPixels) && renderPixels[0]) {
                    for (let x = 0; x < renderPixels.length; x++) {
                        for (let y = 0; y < renderPixels[x].length; y++) {
                            let intensity = renderPixels[x][y];
                            if (intensity < 0) intensity = 0;
                            else if (intensity > 255) intensity = 255;
                            
                            const pixelIdx = (((renderPixels[x].length - 1 - y) * imgWidth + x)) * 4;
                            imgData.data[pixelIdx] = intensity;
                            imgData.data[pixelIdx + 1] = intensity;
                            imgData.data[pixelIdx + 2] = intensity;
                            imgData.data[pixelIdx + 3] = 255;
                        }
                    }
                } else {
                    for (let i = 0; i < renderPixels.length; i++) {
                        let intensity = renderPixels[i];
                        const pixelIdx = i * 4;
                        imgData.data[pixelIdx] = intensity;
                        imgData.data[pixelIdx + 1] = intensity;
                        imgData.data[pixelIdx + 2] = intensity;
                        imgData.data[pixelIdx + 3] = 255;
                    }
                }
            }
            
            // 使用 createImageBitmap + drawImage 的非同步渲染
            const sampleRate = this.buffer.sampleRate / 2;
            const freqMin = this.frequencyMin;
            const freqMax = this.frequencyMax;
            const u = this.hzToScale(freqMin) / this.hzToScale(sampleRate);
            const f = this.hzToScale(freqMax) / this.hzToScale(sampleRate);
            const p = Math.min(1, f);
            
            const sourceHeight = Math.round(imgHeight * (p - u));
            const sourceY = Math.round(imgHeight * (1 - p));
            
            createImageBitmap(imgData, 0, sourceY, imgWidth, sourceHeight).then((bitmap => {
                const drawY = this.height * (channelIdx + 1 - p / f);
                const drawH = this.height * p / f;
                
                // 繪製 Bitmap
                // Canvas 會自動處理縮放：
                // 如果是 Smooth Mode: imgWidth (原始幀數) -> canvasWidth (屏幕寬度) [GPU 插值]
                // 如果是 Default Mode: imgWidth (屏幕寬度) -> canvasWidth (屏幕寬度) [1:1 繪製]
                canvasCtx.drawImage(bitmap, 0, drawY, canvasWidth, drawH);

                // Peak Mode 疊加層 (保持不變)
                // 因為 Peak 數據是基於原始 FFT bin 的，所以此處邏輯無需更改
                if (this.options && this.options.peakMode && this.peakBandArrayPerChannel && this.peakBandArrayPerChannel[channelIdx]) {
                    const peaks = this.peakBandArrayPerChannel[channelIdx];
                    
                    // Get View Range (Hz)
                    const viewMinHz = this.frequencyMin || 0;
                    const viewMaxHz = this.frequencyMax || (this.buffer.sampleRate / 2);
                    const viewRangeHz = viewMaxHz - viewMinHz;
                    
                    // Get Nyquist (Max Freq of Data)
                    const nyquistHz = this.buffer.sampleRate / 2;
                    
                    // Total Bins in the underlying data (0 to Nyquist)
                    const totalBins = (this.scale !== "linear" && this._wasmEngine.get_num_filters() > 0) 
                        ? this._wasmEngine.get_num_filters() 
                        : (this.fftSamples / 2);

                    const xStep = canvasWidth / peaks.length;
                    
                    // Use Cyan for high contrast
                    canvasCtx.fillStyle = "rgba(0, 255, 255, 0.9)"; 
                    
                    for (let i = 0; i < peaks.length; i++) {
                        const peakData = peaks[i];
                        if (peakData && peakData.bin !== undefined) {
                            let peakFreqHz;
                            
                            // Calculate Hz based on scale type
                            if (this.scale === 'linear') {
                                // Linear: Bin index maps linearly to 0..Nyquist
                                peakFreqHz = (peakData.bin / totalBins) * nyquistHz;
                            } else {
                                // Non-linear fallback: Assume bins map to view range (simplified)
                                peakFreqHz = viewMinHz + (peakData.bin / totalBins) * viewRangeHz;
                            }
                            
                            // Only draw if within the current visible frequency range
                            if (peakFreqHz >= viewMinHz && peakFreqHz <= viewMaxHz) {
                                // Map Hz to Canvas Y (0Hz is Bottom, MaxHz is Top)
                                const yFraction = (peakFreqHz - viewMinHz) / viewRangeHz;
                                const yPos = drawY + drawH - (yFraction * drawH);
                                
                                const xPos = i * xStep;
                                canvasCtx.fillRect(xPos, yPos - 1, Math.max(1.5, xStep), 3);
                            }
                        }
                    }
                }
            }));
        }
        
        // Label rendering
        if (this.options.labels) {
            this.loadLabels(
                this.options.labelsBackground,
                "12px", "12px", "",
                this.options.labelsColor,
                this.options.labelsHzColor || this.options.labelsColor,
                "center",
                "#specLabels",
                t.length
            );
        }
        
        this.emit("ready");
    }
    createFilterBank(t, e, s, r) {
                // cache by scale name + params to avoid rebuilding
                // Include frequency range in cache key for optimization
                const freqMinStr = this.frequencyMin || "0";
                const freqMaxStr = this.frequencyMax || "0";
                const cacheKey = `${this.scale}:${t}:${e}:${this.fftSamples}:${freqMinStr}:${freqMaxStr}`;
                if (this._filterBankCache[cacheKey])
                        return this._filterBankCache[cacheKey];

                const i = s(0)
                    , a = s(e / 2);
                
                // Optimize: Only create filters for the specified frequency range
                const fMin = this.frequencyMin > 0 ? s(this.frequencyMin) : i;
                const fMax = this.frequencyMax > 0 && this.frequencyMax < e / 2 ? s(this.frequencyMax) : a;
                
                const n = Array.from({
                        length: t
                }, ( () => {
                    const fftHalfSize = this.fftSamples / 2 + 1;
                    const arr = new Float32Array(fftHalfSize);
                    arr.fill(0);
                    return arr;
                }));
                const h = e / this.fftSamples;
        for (let e = 0; e < t; e++) {
            let s = r(fMin + e / t * (fMax - fMin))
              , o = Math.floor(s / h)
              , l = o * h
              , c = (s - l) / ((o + 1) * h - l);
            if (o >= 0 && o < n[e].length) n[e][o] = 1 - c;
            if (o + 1 >= 0 && o + 1 < n[e].length) n[e][o + 1] = c;
        }
        this._filterBankCache[cacheKey] = n;
        return n
    }
    hzToMel(t) {
        return 2595 * Math.log10(1 + t / 700)
    }
    melToHz(t) {
        return 700 * (Math.pow(10, t / 2595) - 1)
    }
    createMelFilterBank(t, e) {
        return this.createFilterBank(t, e, this.hzToMel, this.melToHz)
    }
    hzToLog(t) {
        return Math.log10(Math.max(1, t))
    }
    logToHz(t) {
        return Math.pow(10, t)
    }
    createLogFilterBank(t, e) {
        return this.createFilterBank(t, e, this.hzToLog, this.logToHz)
    }
    hzToBark(t) {
        let e = 26.81 * t / (1960 + t) - .53;
        return e < 2 && (e += .15 * (2 - e)),
        e > 20.1 && (e += .22 * (e - 20.1)),
        e
    }
    barkToHz(t) {
        return t < 2 && (t = (t - .3) / .85),
        t > 20.1 && (t = (t + 4.422) / 1.22),
        (t + .53) / (26.28 - t) * 1960
    }
    createBarkFilterBank(t, e) {
        return this.createFilterBank(t, e, this.hzToBark, this.barkToHz)
    }
    hzToErb(t) {
        return n * Math.log10(1 + .00437 * t)
    }
    erbToHz(t) {
        return (Math.pow(10, t / n) - 1) / .00437
    }
    createErbFilterBank(t, e) {
        return this.createFilterBank(t, e, this.hzToErb, this.erbToHz)
    }
    hzToScale(t) {
        switch (this.scale) {
        case "mel":
            return this.hzToMel(t);
        case "logarithmic":
            return this.hzToLog(t);
        case "bark":
            return this.hzToBark(t);
        case "erb":
            return this.hzToErb(t)
        }
        return t
    }
    scaleToHz(t) {
        switch (this.scale) {
        case "mel":
            return this.melToHz(t);
        case "logarithmic":
            return this.logToHz(t);
        case "bark":
            return this.barkToHz(t);
        case "erb":
            return this.erbToHz(t)
        }
        return t
    }
    applyFilterBank(t, e) {
        const s = e.length
          , r = Float32Array.from({
            length: s
        }, ( () => 0));
        for (let i = 0; i < s; i++)
            for (let s = 0; s < t.length; s++)
                r[i] += t[s] * e[i][s];
        return r
    }
    
    /// 輔助方法：將二維濾波器組矩陣扁平化並加載到 WASM
    /// 
    /// # Arguments
    /// * `filterBankMatrix` - 二維濾波器組矩陣 (Float32Array[])
    /// 
    /// 此方法將 2D 矩陣 (num_filters x freq_bins) 轉換為扁平化的 Float32Array (行優先)
    /// 優化: 只在濾波器組實際改變時才執行扁平化和 WASM 調用
    flattenAndLoadFilterBank(filterBankMatrix) {
        if (!filterBankMatrix || filterBankMatrix.length === 0) {
            // 清除濾波器組
            if (this._wasmEngine && this._filterBankFlat !== null) {
                this._wasmEngine.clear_filter_bank();
            }
            this._filterBankMatrix = null;
            this._filterBankFlat = null;
            return;
        }
        
        const numFilters = filterBankMatrix.length;
        const freqBins = filterBankMatrix[0].length;
        
        // 建立扁平化陣列 (行優先順序)
        // 優化: 使用 subarray 批量複製，而不是逐個元素複製
        const flatArray = new Float32Array(numFilters * freqBins);
        for (let i = 0; i < numFilters; i++) {
            const row = filterBankMatrix[i];
            flatArray.set(row, i * freqBins);  // 更快的批量複製
        }
        
        // 保存並加載到 WASM
        this._filterBankMatrix = filterBankMatrix;
        this._filterBankFlat = flatArray;
        
        if (this._wasmEngine) {
            this._wasmEngine.load_filter_bank(flatArray, numFilters);
        }
    }
    getWidth() {
        return this.wavesurfer.getWrapper().offsetWidth
    }
    
    /// 清除濾波器組緩存 (當 FFT 大小或頻率範圍改變時調用)
    clearFilterBankCache() {
        this._filterBankCache = {};
        this._filterBankCacheByKey = {};
        this._loadedFilterBankKey = null;
        this._filterBankMatrix = null;
        this._filterBankFlat = null;
    }
    async getFrequencies(t) {
        // 檢查 this.options 是否為 null（在 destroy 或 selection mode 切換時可能發生）
        if (!this.options || !t) {
            return;
        }
        
        var e, s;
        const r = this.fftSamples
          , i = (null !== (e = this.options.splitChannels) && void 0 !== e ? e : null === (s = this.wavesurfer) || void 0 === s ? void 0 : s.options.splitChannels) ? t.numberOfChannels : 1;
        if (this.frequencyMax = this.frequencyMax || t.sampleRate / 2,
        !t)
            return;
        this.buffer = t;
        const n = t.sampleRate
          , h = [];
        let o = this.noverlap;
        if (!o) {
            const e = t.length / this.canvas.width;
            // Calculate a safety floor (e.g., 5% of fftSamples) to prevent artifacts on dense files
            const minOverlap = Math.floor(r * 0.05);
            // Dynamic calc, but clamped to the safety floor
            o = Math.max(minOverlap, Math.round(r - e));
        }
        
        // OPTIMIZATION: Calculate frequency range bin indices once
        const minBinFull = Math.floor(this.frequencyMin * r / n);
        const maxBinFull = Math.ceil(this.frequencyMax * r / n);
        const binRangeSize = maxBinFull - minBinFull;
        
        // Wait for WASM to be ready
        await this._wasmReady;
        
        // 檢查是否需要重新計算濾波器組
        // 根據 scale、sampleRate 等決定是否需要更新
        let filterBankMatrix = null;
        const currentFilterBankKey = `${this.scale}:${n}:${this.frequencyMin}:${this.frequencyMax}`;
        
        if (this.scale !== "linear") {
            // 如果濾波器組需要更新，則計算新的濾波器組
            if (this._lastFilterBankScale !== currentFilterBankKey) {
                let c;
                let numFilters;
                
                // 首先檢查是否已緩存此配置的濾波器組
                if (this._filterBankCacheByKey[currentFilterBankKey]) {
                    c = this._filterBankCacheByKey[currentFilterBankKey];
                    // Using cached filter bank
                } else {
                    // 計算新的濾波器組並緩存
                    const filterBankStartTime = performance.now();
                    switch (this.scale) {
                    case "mel":
                        numFilters = this.numMelFilters;
                        c = this.createFilterBank(numFilters, n, this.hzToMel, this.melToHz);
                        break;
                    case "logarithmic":
                        numFilters = this.numLogFilters;
                        c = this.createFilterBank(numFilters, n, this.hzToLog, this.logToHz);
                        break;
                    case "bark":
                        numFilters = this.numBarkFilters;
                        c = this.createFilterBank(numFilters, n, this.hzToBark, this.barkToHz);
                        break;
                    case "erb":
                        numFilters = this.numErbFilters;
                        c = this.createFilterBank(numFilters, n, this.hzToErb, this.erbToHz);
                        break;
                    }
                    const filterBankTime = performance.now() - filterBankStartTime;
                    
                    // 緩存計算結果，以便後續使用
                    this._filterBankCacheByKey[currentFilterBankKey] = c;
                    // Filter bank computed
                }
                
                // 只在濾波器組實際改變時加載到 WASM (關鍵優化)
                if (this._loadedFilterBankKey !== currentFilterBankKey) {
                    const wasmLoadStartTime = performance.now();
                    this.flattenAndLoadFilterBank(c);
                    const wasmLoadTime = performance.now() - wasmLoadStartTime;
                    this._loadedFilterBankKey = currentFilterBankKey;
                    // WASM loading completed
                } else {
                    // Filter bank already loaded to WASM
                }
                
                this._lastFilterBankScale = currentFilterBankKey;
            }
        } else {
            // Linear scale: 清除濾波器組
            if (this._loadedFilterBankKey !== null) {
                this.flattenAndLoadFilterBank(null);
                this._loadedFilterBankKey = null;
            }
        }
        
        this.peakBandArrayPerChannel = [];
        
        if (this.options && this.options.peakMode) {
            // Peak Mode: 使用新的 WASM API (get_peaks) 進行峰值檢測
            // 峰值檢測現在在 WASM 中進行，這大大加速了計算（避免了雙重掃描）
            const peakThresholdMultiplier = this.options.peakThreshold !== undefined ? this.options.peakThreshold : 0.4;
            
            // 對每個通道進行峰值檢測
            for (let e = 0; e < i; e++) {
                const s = t.getChannelData(e)
                  , channelFrames = []
                  , channelPeakBands = [];
                let a = 0;
                
                // 計算完整通道的幅度數據（這會在 WASM 內部存儲所有幀的幅度值）
                // 為了獲得完整的幀數據，我們先計算整個通道的頻譜
                const fullU8Spectrum = this._wasmEngine.compute_spectrogram_u8(
                    s,
                    o,
                    this.gainDB,
                    this.rangeDB
                );
                
                // 現在 WASM 已經計算了所有幀的幅度值，我們可以獲取峰值信息
                const peakIndices = this._wasmEngine.get_peaks(peakThresholdMultiplier);
                const peakMagnitudes = this._wasmEngine.get_peak_magnitudes(peakThresholdMultiplier);
                const globalMaxValue = this._wasmEngine.get_global_max();
                const highPeakThreshold = globalMaxValue * 0.7;
                
                // 計算幀數（根據 WASM 存儲的幀數）
                const freq_bins = this.fftSamples / 2;
                const numFilters = this._wasmEngine.get_num_filters();
                const outputSize = this.scale !== "linear" && numFilters > 0 ? numFilters : freq_bins;
                const numFrames = Math.floor(fullU8Spectrum.length / outputSize);
                
                // 將 u8 頻譜數據按幀拆分
                for (let frameIdx = 0; frameIdx < numFrames; frameIdx++) {
                    const outputFrame = new Uint8Array(outputSize);
                    const frameStartIdx = frameIdx * outputSize;
                    for (let k = 0; k < outputSize; k++) {
                        outputFrame[k] = fullU8Spectrum[frameStartIdx + k];
                    }
                    channelFrames.push(outputFrame);
                }
                
                // 轉換峰值索引為 channelPeakBands 格式
                for (let frameIdx = 0; frameIdx < peakIndices.length && frameIdx < channelFrames.length; frameIdx++) {
                    const peakBinIndex = peakIndices[frameIdx];
                    
                    if (peakBinIndex !== 0xFFFF) {
                        // 有效的峰值（超過閾值）
                        // 使用峰值幅度值判定是否超過 70% 全局最大值
                        const peakMagnitude = peakMagnitudes[frameIdx] || 0;
                        const isHigh = peakMagnitude >= highPeakThreshold;
                        
                        channelPeakBands.push({
                            bin: peakBinIndex,
                            isHigh: isHigh
                        });
                    } else {
                        // 無效的峰值（未超過閾值）
                        channelPeakBands.push(null);
                    }
                }
                
                this.peakBandArrayPerChannel.push(channelPeakBands);
                h.push(channelFrames)
            }
        } else {
            // Peak Mode 禁用時：直接使用新 API
            for (let e = 0; e < i; e++) {
                const s = t.getChannelData(e)
                  , i = [];
                let a = 0;
                for (; a + r < s.length; ) {
                    const tSlice = s.subarray(a, a + r);
                    
                    // 使用新 API 獲得 u8 頻譜（包含濾波器組處理和 dB 轉換）
                    const u8Spectrum = this._wasmEngine.compute_spectrogram_u8(
                        tSlice,
                        o,
                        this.gainDB,
                        this.rangeDB
                    );
                    
                    // 決定輸出大小（與 WASM 端的輸出大小一致）
                    const numFilters = this._wasmEngine.get_num_filters();
                    const outputSize = this.scale !== "linear" && numFilters > 0 ? numFilters : (r / 2);
                    
                    const outputFrame = new Uint8Array(outputSize);
                    for (let k = 0; k < Math.min(outputSize, u8Spectrum.length); k++) {
                        outputFrame[k] = u8Spectrum[k];
                    }
                    
                    i.push(outputFrame);
                    a += r - o
                }
                h.push(i)
            }
        }
        return h
    }
    
    freqType(t) {
        return t >= 1e3 ? (t / 1e3).toFixed(1) : Math.round(t)
    }
    unitType(t) {
        return t >= 1e3 ? "kHz" : "Hz"
    }
    getLabelFrequency(t, e) {
        const s = this.hzToScale(this.frequencyMin)
          , r = this.hzToScale(this.frequencyMax);
        return this.scaleToHz(s + t / e * (r - s))
    }
    loadLabels(t, e, s, r, i, a, n, h, o) {
        t = t || "rgba(68,68,68,0)",
        e = e || "12px",
        s = s || "12px",
        r = r || "Helvetica",
        i = i || "#fff",
        a = a || "#fff",
        n = n || "center";
        const l = this.height || 512
          , c = l / 256 * 5;
        this.frequencyMin;
        this.frequencyMax;
        const u = this.labelsEl.getContext("2d")
          , f = window.devicePixelRatio;
        if (this.labelsEl.height = this.height * o * f,
        this.labelsEl.width = 55 * f,
        u.scale(f, f),
        u)
            for (let h = 0; h < o; h++) {
                let o;
                for (u.fillStyle = t,
                u.fillRect(0, h * l, 55, (1 + h) * l),
                u.fill(),
                o = 0; o <= c; o++) {
                    u.textAlign = n,
                    u.textBaseline = "middle";
                    const t = this.getLabelFrequency(o, c)
                      , f = this.freqType(t)
                      , p = this.unitType(t)
                      , d = 16;
                    let w = (1 + h) * l - o / c * l;
                    w = Math.min(Math.max(w, h * l + 10), (1 + h) * l - 10),
                    u.fillStyle = a,
                    u.font = s + " " + r,
                    u.fillText(p, d + 24, w),
                    u.fillStyle = i,
                    u.font = e + " " + r,
                    u.fillText(f, d, w)
                }
            }
    }
    resample(t) {
        const outW = this.getWidth()
          , out = []
          , invIn = 1 / t.length;

        const cacheKey = `${t.length}:${outW}`;
        let mapping = this._resampleCache[cacheKey];
        if (!mapping) {
            mapping = new Array(outW);
            const invOut = 1 / outW;
            for (let a = 0; a < outW; a++) {
                const contrib = [];
                for (let n = 0; n < t.length; n++) {
                    const s = n * invIn;
                    const h = s + invIn;
                    const o = a * invOut;
                    const l = o + invOut;
                    const c = Math.max(0, Math.min(h, l) - Math.max(s, o));
                    if (c > 0)
                        contrib.push([n, c / invOut]);
                }
                mapping[a] = contrib;
            }
            this._resampleCache[cacheKey] = mapping;
        }

        for (let a = 0; a < outW; a++) {
            const accum = new Array(t[0].length);
            const contrib = mapping[a];
            for (let j = 0; j < contrib.length; j++) {
                const nIdx = contrib[j][0];
                const weight = contrib[j][1];
                const src = t[nIdx];
                for (let u = 0; u < src.length; u++) {
                    if (accum[u] == null)
                        accum[u] = 0;
                    accum[u] += weight * src[u];
                }
            }
            const outArr = new Uint8Array(t[0].length);
            for (let o = 0; o < t[0].length; o++)
                outArr[o] = accum[o];
            out.push(outArr);
        }
        return out
    }
}

// 暴露 WASM 波形峰值計算函數給 wavesurfer
// 這允許 wavesurfer 在沒有直接導入 WASM 模塊的情況下使用 WASM 優化
wasmReady.then(() => {
    // 動態導入 WASM 函數並暴露到全局作用域
    try {
        // 導入計算波形峰值的函數
        const initModule = async () => {
            const wasmModule = await import('./spectrogram_wasm.js');
            if (wasmModule && wasmModule.compute_wave_peaks && wasmModule.find_global_max) {
                window.__spectrogramWasmFuncs = {
                    compute_wave_peaks: wasmModule.compute_wave_peaks,
                    find_global_max: wasmModule.find_global_max
                };
                // WASM waveform peaks function loaded
            }
        };
        initModule().catch(err => {
            // WASM waveform peaks initialization failed, will use JS fallback
        });
    } catch (e) {
        // WASM function exposure failed, will use JS fallback
    }
}).catch(err => {
    // WASM initialization failed, will use JS fallback
});

export {h as default};
