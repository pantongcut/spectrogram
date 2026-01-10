/**
 * icons.js
 * 集中管理所有的 SVG Icons (Font Awesome 風格)
 * 統一使用 viewBox="0 0 512 512" 及 fill="currentColor"
 */

export const icons = {
    // 1. 自定義的 Split View (Sidebar Toggle) - 左實右空
    splitView: `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="1em" height="1em" fill="currentColor">
            <rect x="32" y="64" width="448" height="384" rx="48" ry="48" fill="none" stroke="currentColor" stroke-width="32" />
            <path d="M80 64 H160 V448 H80 C53.5 448 32 426.5 32 400 V112 C32 85.5 53.5 64 80 64 Z" />
        </svg>
    `,

    // 2. 排序 (Sort) - 上下箭頭
    sort: `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="1em" height="1em" fill="currentColor">
            <path d="M137.4 41.4c12.5-12.5 32.8-12.5 45.3 0l128 128c9.2 9.2 11.9 22.9 6.9 34.9s-16.6 19.8-29.6 19.8H32c-12.9 0-24.6-7.8-29.6-19.8s-2.2-25.7 6.9-34.9l128-128zm0 429.3l-128-128c-9.2-9.2-11.9-22.9-6.9-34.9s16.6-19.8 29.6-19.8H288c12.9 0 24.6 7.8 29.6 19.8s2.2 25.7-6.9 34.9l-128 128c-12.5 12.5-32.8 12.5-45.3 0z"/>
        </svg>
    `,

    // 3. 過濾 (Filter) - 漏斗形狀
    filter: `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="1em" height="1em" fill="currentColor">
            <path d="M3.9 54.9C10.5 40.9 24.5 32 40 32H472c15.5 0 29.5 8.9 36.1 22.9s4.6 30.5-5.2 42.5L320 320.9V448c0 12.1-6.8 23.2-17.7 28.6s-23.8 4.3-33.5-3l-64-48c-8.1-6-12.8-15.5-12.8-25.6V320.9L9 97.3C-.8 85.4-2.8 68.8 3.9 54.9z"/>
        </svg>
    `,

    // 4. 關閉 (Close/Times) - 用於 Popup 或 Modal
    close: `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="1em" height="1em" fill="currentColor">
            <path d="M342.6 150.6c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L192 210.7 86.6 105.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3L146.7 256 41.4 361.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L192 301.3 297.4 406.6c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L237.3 256 342.6 150.6z"/>
        </svg>
    `,

    // 5. 設定 (Settings/Gear)
    settings: `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="1em" height="1em" fill="currentColor">
            <path d="M495.9 166.6c3.2 8.7 .5 18.4-6.4 24.6l-43.3 39.4c1.1 8.3 1.7 16.8 1.7 25.4s-.6 17.1-1.7 25.4l43.3 39.4c6.9 6.2 9.6 15.9 6.4 24.6c-4.4 11.9-9.7 23.3-15.8 34.3l-4.7 8.1c-6.6 11-14 21.4-22.1 31.2c-5.9 7.2-15.7 9.6-24.5 6.8l-55.7-17.7c-13.4 10.3-28.2 18.9-44 25.4l-12.5 57.1c-2 9.1-9 16.3-18.2 17.8c-13.8 2.3-28 3.5-42.5 3.5s-28.7-1.2-42.5-3.5c-9.2-1.5-16.2-8.7-18.2-17.8l-12.5-57.1c-15.8-6.5-30.6-15.1-44-25.4L83.1 425.9c-8.8 2.8-18.6 .3-24.5-6.8c-8.1-9.8-15.5-20.2-22.1-31.2l-4.7-8.1c-6.1-11-11.4-22.4-15.8-34.3c-3.2-8.7-.5-18.4 6.4-24.6l43.3-39.4C64.6 273.1 64 264.6 64 256s.6-17.1 1.7-25.4L22.4 191.2c-6.9-6.2-9.6-15.9-6.4-24.6c4.4-11.9 9.7-23.3 15.8-34.3l4.7-8.1c6.6-11 14-21.4 22.1-31.2c5.9-7.2 15.7-9.6 24.5-6.8l55.7 17.7c13.4-10.3 28.2-18.9 44-25.4l12.5-57.1c2-9.1 9-16.3 18.2-17.8C227.3 1.2 241.5 0 256 0s28.7 1.2 42.5 3.5c9.2 1.5 16.2 8.7 18.2 17.8l12.5 57.1c15.8 6.5 30.6 15.1 44 25.4l55.7-17.7c8.8-2.8 18.6-.3 24.5 6.8c8.1 9.8 15.5 20.2 22.1 31.2l4.7 8.1c6.1 11 11.4 22.4 15.8 34.3zM256 336a80 80 0 1 0 0-160 80 80 0 1 0 0 160z"/>
        </svg>
    `,
    
    // 6. 10x Time Expansion - "10x" 字樣
    timeExpansion: `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="1.5em" height="1.5em" fill="currentColor">
            <path d="M48 128 h60 v256 h-60 z"/>
            <path d="M228 128 c60 0 90 48 90 128 c0 80 -30 128 -90 128 c-60 0 -90 -48 -90 -128 c0 -80 30 -128 90 -128 z m0 64 c-20 0 -30 30 -30 64 c0 34 10 64 30 64 c20 0 30 -30 30 -64 c0 -34 -10 -64 -30 -64 z"/>
            <path d="M370 230 l40 0 l30 50 l30 -50 l40 0 l-50 70 l50 70 l-40 0 l-30 -50 l-30 50 l-40 0 l50 -70 z"/>
        </svg>
    `
};

/**
 * 輔助函式：取得 Icon 的 HTML 字串
 * @param {string} iconName - icons 物件中的 key (例如 'splitView')
 * @param {string} className - 額外想加入的 CSS class (可選)
 * @returns {string} SVG HTML string
 */
export function getIconString(iconName, className = '') {
    const svg = icons[iconName];
    if (!svg) {
        console.warn(`Icon "${iconName}" not found.`);
        return '';
    }
    // 如果有指定 className，就注入到 svg 標籤內
    if (className) {
        return svg.replace('<svg', `<svg class="${className}"`);
    }
    return svg;
}

/**
 * 輔助函式：建立 Icon 的 DOM 元素 (適合用 appendChild)
 * @param {string} iconName 
 * @param {string} className 
 * @returns {HTMLElement} 
 */
export function createIconElement(iconName, className = '') {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = getIconString(iconName, className);
    return tempDiv.firstElementChild;
}