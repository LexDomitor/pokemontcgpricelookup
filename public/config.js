// GitHub Pages is static, so its entry point uses the existing public pricing API.
// Set apiBase to your own deployed Cloudflare API origin to make hosting independent.
// Local Node and Cloudflare hosting use their included same-origin backend.
window.PRICE_LOOKUP_CONFIG = {
  apiBase: document.documentElement.dataset.hosting === 'github-pages'
    ? 'https://arcane9labs.pages.dev' : ''
};
