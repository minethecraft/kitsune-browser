'use strict';
// Swap stock Electron for castlabs' Widevine-enabled "ECS" build of the same major version.
// Needs no account to build; to *play* Netflix-class DRM you must also VMP-sign (free castlabs EVS account, see README).
const { spawnSync } = require('child_process');
const v = require('../package.json').devDependencies.electron; const ver = require('electron/package.json').version;
const r = spawnSync('npm', ['install', '--no-save', `electron@github:castlabs/electron-releases#v${ver}+wvcus`], { stdio: 'inherit', shell: process.platform === 'win32' });
process.exit(r.status || 0);
