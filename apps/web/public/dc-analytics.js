/* Public-site GA4 only. Keep copies identical; configure via script data attributes.
 * Enhanced measurement must be OFF for this stream. Never read forms or content.
 */
(() => {
  const w = window, d = document;
  const script = d.currentScript || d.querySelector('script[data-ga-id]');
  if (!script || w.__dcSiteAnalytics) return;
  const { gaId: id, site, hosts = '' } = script.dataset;
  if (!/^G-[A-Z0-9]+$/.test(id || '') || !/^[a-z0-9-]+$/.test(site || '')) return;
  const optedOut = () => {
    try {
      const choice = JSON.parse(w.localStorage.getItem('dc-analytics-consent-v1') || 'null');
      return choice === 'denied' || choice?.value === 'denied' || choice?.status === 'denied';
    } catch { return false; }
  };
  const allowed = () => hosts.split(',').includes(w.location.hostname)
    && w.navigator.doNotTrack !== '1' && w.doNotTrack !== '1'
    && w.navigator.globalPrivacyControl !== true && !optedOut();
  if (!allowed()) return;
  w.__dcSiteAnalytics = true;
  const page = () => {
    const p = w.location.pathname.replace(/\/$/, '') || '/';
    return /^\/(?:en|zh|privacy|privacy\.html|terms|terms\.html|notices\.html|about|pricing|docs)?$/.test(p)
      ? p : '/other';
  };
  const referrer = () => {
    try { const u = new URL(d.referrer); return /^https?:$/.test(u.protocol) ? u.origin + '/' : ''; }
    catch { return ''; }
  };
  w.dataLayer = w.dataLayer || [];
  let commands = 0;
  function tag() {
    if (commands < 100 && w.dataLayer.length < 100) {
      commands += 1;
      w.dataLayer.push(arguments);
    }
  }
  const context = () => ({
    page_location: w.location.origin + page(), page_referrer: referrer(),
    page_title: site + ' ' + page(), site, product_id: site,
    language: /^\/en(?:\/|$)/.test(w.location.pathname) ? 'en'
      : /^\/zh(?:\/|$)/.test(w.location.pathname) ? 'zh' : (d.documentElement?.lang || 'und'),
  });
  const campaign = {};
  for (const key of ['source', 'medium', 'campaign', 'content']) {
    const value = w.location.searchParams?.get('utm_' + key)
      || new URL(w.location.href).searchParams.get('utm_' + key);
    if (value && /^[a-zA-Z][a-zA-Z0-9_-]{0,49}$/.test(value) && !/\d{7,}/.test(value)) {
      campaign[key === 'campaign' ? 'campaign_name' : 'campaign_' + key] = value;
    }
  }
  tag('js', new Date());
  tag('config', id, { send_page_view: false, allow_google_signals: false,
    allow_ad_personalization_signals: false, cookie_domain: w.location.hostname,
    cookie_prefix: 'dc_' + site, cookie_expires: 180 * 86400, ...context(), ...campaign });
  let previous;
  function view() {
    if (!allowed()) { w['ga-disable-' + id] = true; return; }
    if (previous === w.location.pathname) return;
    previous = w.location.pathname;
    tag('set', context());
    tag('event', 'page_view', { send_to: id, ...context() });
  }
  view();
  const loader = d.createElement('script');
  loader.async = true;
  loader.src = 'https://www.googletagmanager.com/gtag/js?id=' + id;
  d.head.appendChild(loader);
  // Observe actual SPA route transitions, not query strings or in-page anchors.
  for (const method of ['pushState', 'replaceState']) {
    const original = w.history[method];
    w.history[method] = function () {
      const result = original.apply(this, arguments);
      w.setTimeout(view, 0);
      return result;
    };
  }
  w.addEventListener('popstate', view);
  w.addEventListener('storage', () => { if (!allowed()) w['ga-disable-' + id] = true; });
})();
