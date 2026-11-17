'use strict';
// Small fetch helper with retries. Node 20+ has fetch built in.

async function fetchJSON(url, { headers = {}, tries = 3 } = {}) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'scout-desk', ...headers } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (i >= tries) throw new Error(`${url.split('?')[0]}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 1500 * i));
    }
  }
}

module.exports = { fetchJSON };
