// Developed for Arcane 9 Labs by Alex Puh and Kyle He
// The root static entry queries the public card API directly; npm start uses Node.
window.PRICE_LOOKUP_CONFIG = {
 mode: document.documentElement.dataset.hosting === 'github-pages' ? 'browser' : 'server'
};
