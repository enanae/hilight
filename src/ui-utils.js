/**
 * Shared UI utilities used across modules.
 *
 * Consolidates functions that were previously duplicated:
 * - escapeHtml: was in highlighter.js (as escapeHtml) and vocab-browser.js (as esc)
 * - showUndoToast: was identical in main.js and vocab-browser.js
 * - showError: was in main.js only but needed by other modules
 */

/** Escape a string for safe insertion into HTML. */
export function escapeHtml(str) {
  const el = document.createElement('span');
  el.textContent = str;
  return el.innerHTML;
}

/**
 * Show a toast with an undo button.
 * Auto-dismisses after 6 seconds. Only one toast at a time.
 */
export function showUndoToast(message, onUndo) {
  const existing = document.querySelector('.undo-toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = 'undo-toast';
  toast.innerHTML = `<span>${message}</span><button class="undo-btn">Undo</button>`;
  const btn = toast.querySelector('.undo-btn');
  let dismissed = false;
  btn.addEventListener('click', async () => {
    if (dismissed) return;
    dismissed = true;
    toast.remove();
    try {
      await onUndo();
    } catch (err) {
      console.error('[hilight] Undo failed:', err);
      showError('Undo failed. Check the console for details.');
    }
  });
  document.getElementById('app').appendChild(toast);
  setTimeout(() => {
    dismissed = true;
    toast.remove();
  }, 6000);
}

/** Show an error toast that auto-dismisses after 5 seconds. */
export function showError(msg) {
  const existing = document.querySelector('.error-toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = 'error-toast';
  toast.textContent = msg;
  document.getElementById('app').appendChild(toast);
  setTimeout(() => toast.remove(), 5000);
}
