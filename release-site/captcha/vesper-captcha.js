// Copyright 2026 Vesper contributors
// SPDX-License-Identifier: AGPL-3.0-only

const siteKey = '5fad97ac-7d06-4e44-b18a-b950b20148ff';

function redirectToVesper(token) {
  const action = location.pathname.includes('/challenge/')
    ? 'challenge'
    : 'registration';
  const solution = ['signal-hcaptcha', siteKey, action, token].join('.');
  const requestedScheme = new URLSearchParams(location.search).get('scheme');
  const scheme =
    requestedScheme === 'vespercaptcha-development'
      ? requestedScheme
      : 'vespercaptcha';
  const target = `${scheme}://${solution}`;
  const link = document.createElement('a');
  link.href = target;
  link.textContent = 'Open Vesper';

  const status = document.querySelector('#status');
  status.textContent = '';
  status.append(link);
  location.href = target;
}

window.vesperCaptchaReady = () => {
  window.hcaptcha.render('captcha', {
    sitekey: siteKey,
    theme: matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light',
    callback: redirectToVesper,
  });
  document.querySelector('#status').textContent = '';
};
