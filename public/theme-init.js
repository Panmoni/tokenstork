// Pre-hydration theme bootstrap. Sets `dark` class on <html> before
// body paints so dark-mode users don't see a light flash.
(function () {
	try {
		var stored = localStorage.getItem('tokenstork-theme');
		var theme =
			stored === 'light' || stored === 'dark'
				? stored
				: window.matchMedia('(prefers-color-scheme: dark)').matches
					? 'dark'
					: 'light';
		var root = document.documentElement;
		if (theme === 'dark') root.classList.add('dark');
		root.setAttribute('data-theme', theme);
	} catch (e) {
		/* localStorage disabled — fall back to default light */
	}
})();
