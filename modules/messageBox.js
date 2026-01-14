// modules/messageBox.js

export function showMessageBox({
  message = '',
  title = '',
  confirmText = 'OK',
  cancelText = null,
  onConfirm,
  onCancel,
  width = 420,
  // new options for input field
  input = false,
  inputType = 'text', // 'text' | 'password'
  inputPlaceholder = '',
  inputValue = '',
  // new options for custom buttons
  customButtons = [] // array of { text, callback }
} = {}) {
  const popup = document.createElement('div');
  // [修改] 將 map-popup 改為 general-popup
  popup.className = 'general-popup modal-popup';
  popup.style.width = `${width}px`;

  const dragBar = document.createElement('div');
  // [修改] 將 popup-drag-bar 改為 general-popup-header
  dragBar.className = 'general-popup-header';
  
  if (title) {
    const titleSpan = document.createElement('span');
    // [修改] 將 popup-title 改為 general-popup-title
    titleSpan.className = 'general-popup-title';
    titleSpan.textContent = title;
    dragBar.appendChild(titleSpan);
  }
  
  const closeBtn = document.createElement('button');
  // [修改] 將 popup-close-btn 改為 general-popup-close
  closeBtn.className = 'general-popup-close';
  closeBtn.title = 'Close';
  closeBtn.innerHTML = '&times;';
  dragBar.appendChild(closeBtn);
  popup.appendChild(dragBar);

  const content = document.createElement('div');
  content.className = 'message-box-content';
  // allow message + optional input field
  const msgNode = document.createElement('div');
  msgNode.textContent = message;
  content.appendChild(msgNode);

  let inputEl = null;
  if (input) {
    inputEl = document.createElement('input');
    inputEl.type = inputType || 'text';
    inputEl.placeholder = inputPlaceholder || '';
    inputEl.value = inputValue || '';
    inputEl.style.marginTop = '8px';
    inputEl.style.width = '100%';
    inputEl.style.boxSizing = 'border-box';
    inputEl.style.border = '1px solid #ccc';
    inputEl.style.borderRadius = '4px';
    inputEl.style.boxShadow = 'inset 0 1px 2px rgba(0, 0, 0, 0.05)';
    inputEl.style.padding = '4px 10px';
    // apply common input styling via existing CSS rules (input[type=text], input[type=password])
    content.appendChild(inputEl);
    setTimeout(() => { inputEl.focus(); }, 10);
  }
  popup.appendChild(content);

  const actions = document.createElement('div');
  actions.className = 'message-box-actions';

  function close(result) {
    popup.remove();
    if (result === 'confirm' && typeof onConfirm === 'function') {
      try {
        if (inputEl) onConfirm(inputEl.value);
        else onConfirm();
      } catch (e) {
        onConfirm();
      }
    } else if (result === 'cancel' && typeof onCancel === 'function') {
      onCancel();
    }
  }

  const confirmBtn = document.createElement('button');
  confirmBtn.className = 'flat-icon-button';
  confirmBtn.textContent = confirmText;
  confirmBtn.addEventListener('click', () => close('confirm'));
  actions.appendChild(confirmBtn);

  // Add custom buttons if provided
  if (customButtons && customButtons.length > 0) {
    customButtons.forEach(({ text, callback }) => {
      const btn = document.createElement('button');
      btn.className = 'flat-icon-button';
      btn.textContent = text;
      btn.addEventListener('click', () => {
        popup.remove();
        if (typeof callback === 'function') {
          callback();
        }
      });
      actions.appendChild(btn);
    });
  }

  let cancelBtn = null;
  if (cancelText) {
    cancelBtn = document.createElement('button');
    cancelBtn.className = 'flat-icon-button';
    cancelBtn.textContent = cancelText;
    cancelBtn.addEventListener('click', () => close('cancel'));
    actions.appendChild(cancelBtn);
  }
  popup.appendChild(actions);

  closeBtn.addEventListener('click', () => close('close'));

  if (inputEl) {
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        close('confirm');
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        close('cancel');
      }
    });
  }

  document.body.appendChild(popup);
}