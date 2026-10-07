// Developed for Arcane 9 Labs by Alex Puh and Kyle He
// GitHub Pages calls this project's independent public pricing backend.
// Direct Cloudflare and local Node hosting use the bundled same-origin API.
window.PRICE_LOOKUP_CONFIG = {
  apiBase: document.documentElement.dataset.hosting === 'github-pages'
    ? 'https://pokemontcgpricelookup.pages.dev' : ''
};
