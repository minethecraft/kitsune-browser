'use strict';
// electron-builder afterPack hook: when building on the castlabs (Widevine) Electron with EVS credentials, VMP-sign the app
// so streaming services accept the CDM. Without EVS_ACCOUNT_NAME this does nothing.
const { spawnSync } = require('child_process');
exports.default = async function (ctx) {
  if (!process.env.EVS_ACCOUNT_NAME) return;
  const r = spawnSync(process.env.PYTHON || 'python3', ['-m', 'castlabs_evs.vmp', 'sign-pkg', ctx.appOutDir], { stdio: 'inherit' });
  if (r.status) throw new Error('EVS VMP signing failed (exit ' + r.status + ')');
};
