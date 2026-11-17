/**
 * Classic boot — dashboard button always works.
 */
(function bootPopup() {
  function openDashboard() {
    try {
      chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
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
  });
})();
