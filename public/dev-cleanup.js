(function () {
  try {
    if (location.hostname === 'localhost') {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations()
          .then((regs) => regs.forEach((r) => r.unregister()))
          .catch(() => {});
      }
      if ('caches' in window) {
        caches.keys()
          .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
          .catch(() => {});
      }
    }
  } catch (_) {
    // swallow
  }
})();