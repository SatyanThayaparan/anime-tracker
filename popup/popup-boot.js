/**
 * Classic script boot — must not use imports.
 * Guarantees the dashboard button works even if popup.js module fails.
 */
(function bootPopup() {
  function openDashboard() {
    try {
      const url = chrome.runtime.getURL('dashboard/dashboard.html');
      chrome.tabs.create({ url });
      window.close();
    } catch (error) {
      console.error('[Anime Tracker] open dashboard failed', error);
    }
  }

  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else {
      fn();
    }
  }

  ready(() => {
    const btn = document.getElementById('openDashboard');
    if (btn && !btn.dataset.bootBound) {
      btn.dataset.bootBound = '1';
      btn.addEventListener('click', openDashboard);
    }

    // If the module never paints, escape the infinite Loading state.
    setTimeout(() => {
      const box = document.getElementById('currentWatching');
      if (!box) return;
      if (box.querySelector('.loading')) {
        box.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon">⚠️</div>
            <div class="empty-state-title">Popup script stalled</div>
            <div class="empty-state-subtitle">Use View Full Dashboard, or reload the extension on chrome://extensions</div>
          </div>
        `;
      }
    }, 3000);
  });
})();
