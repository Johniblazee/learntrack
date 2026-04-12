// Runs before React mounts so we don't flash the wrong theme on first paint.
// Kept as an external script (not inline) so our CSP can drop
// 'unsafe-inline' from script-src without needing a nonce or hash.
(function () {
  try {
    var stored = localStorage.getItem('learntrack-theme');
    var theme = stored || 'light';
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  } catch (e) {
    // localStorage blocked or unavailable — default to light theme.
  }
})();
