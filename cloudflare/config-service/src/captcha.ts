// Copyright 2026 Vesper contributors
// SPDX-License-Identifier: AGPL-3.0-only

export const CAPTCHA_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light dark" />
    <title>Vesper verification</title>
    <style>
      :root { font-family: Inter, system-ui, sans-serif; }
      body { align-items: center; display: flex; justify-content: center; margin: 0; min-height: 100vh; }
      main { padding: 2rem; text-align: center; }
      a { color: #7152ff; font-weight: 600; }
    </style>
    <script src="/captcha/vesper-captcha.js" defer></script>
    <script src="https://js.hcaptcha.com/1/api.js?onload=vesperCaptchaReady&render=explicit" async defer></script>
  </head>
  <body>
    <main>
      <h1>Vesper verification</h1>
      <div id="captcha"></div>
      <p id="status">Loading verification…</p>
    </main>
  </body>
</html>
`;

export const CAPTCHA_JAVASCRIPT = `// Copyright 2026 Vesper contributors
// SPDX-License-Identifier: AGPL-3.0-only

const siteKey = '5fad97ac-7d06-4e44-b18a-b950b20148ff';
const allowedSchemes = new Set([
  'signalcaptcha',
  'vespercaptcha',
  'vespercaptcha-development',
]);

function redirectToVesper(token) {
  const action = location.pathname.includes('/challenge/')
    ? 'challenge'
    : 'registration';
  const solution = ['signal-hcaptcha', siteKey, action, token].join('.');
  const requestedScheme = new URLSearchParams(location.search).get('scheme');
  const scheme = allowedSchemes.has(requestedScheme)
    ? requestedScheme
    : 'vespercaptcha';

  const target = \`\${scheme}://\${solution}\`;
  const link = document.createElement('a');
  link.href = target;
  link.textContent = 'Open Vesper';

  const status = document.querySelector('#status');
  status.replaceChildren(link);
  location.href = target;
}

window.vesperCaptchaReady = () => {
  window.hcaptcha.render('captcha', {
    sitekey: siteKey,
    theme: matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light',
    callback: redirectToVesper,
    'error-callback': () => {
      document.querySelector('#status').textContent =
        'Verification could not be loaded. Please try again.';
    },
  });
  document.querySelector('#status').textContent = '';
};
`;
