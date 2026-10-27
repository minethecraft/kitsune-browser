// node scripts/build.js <win|mac|linux|all> [full|lite|both]
// Builds unpacked apps with electron-builder (no wine needed), then packages:
//  Win Full  -> Kitsune-Setup-<v>.exe  (real NSIS installer via makensis, per-user, shortcuts, uninstaller, default-browser entry)
//  Win Lite  -> Kitsune-Lite-Portable-<v>.exe (single exe, no install; data in KitsuneData beside it)
//  Mac       -> Kitsune[-Lite]-<v>-mac-<arch>.zip (.app inside)
// Real NSIS .exe / .dmg builds: see .github/workflows/build.yml
const { spawnSync } = require('child_process'); const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const root = path.join(__dirname, '..'); const out = process.env.OUT_DIR ? path.resolve(process.env.OUT_DIR) : path.join(root, '..', 'releases');
const plat = process.argv[2] || 'all', which = process.argv[3] || 'both';
const ver = require('../package.json').version;
const sh = (c, a, o = {}) => { const r = spawnSync(c, a, { stdio: 'inherit', ...o }); if (r.status) process.exit(r.status); };
const eb = a => sh('npx', ['electron-builder', ...a, '--publish', 'never'], { cwd: root, env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' } });
const zip = (dir, name, cwd) => { const f = path.join(out, name); fs.rmSync(f, { force: true }); sh('zip', ['-qry', f, dir], { cwd }); };
fs.mkdirSync(out, { recursive: true });
const eds = which === 'both' ? ['full', 'lite'] : [which];
const plats = plat === 'all' ? ['win', 'mac', 'linux'] : [plat];
for (const ed of eds) for (const p of plats) {
  sh('node', ['scripts/set-edition.js', ed], { cwd: root });
  const dist = path.join(root, 'dist-' + ed + '-' + p); fs.rmSync(dist, { recursive: true, force: true });
  const L = ed === 'lite' ? 'Lite' : '';
  if (p === 'win') {
    eb(['--win', 'dir', '--x64', '--config.directories.output=' + dist]);
    const un = path.join(dist, 'win-unpacked');
    const ico = path.join(root, 'build', 'icon.ico');
    if (ed === 'full') sh('makensis', ['-V2', `-DAPPDIR=${un}`, `-DOUT=${path.join(out, `Kitsune-Setup-${ver}.exe`)}`, `-DVER=${ver}`, `-DICON=${ico}`, path.join(root, 'scripts', 'win', 'installer.nsi')]);
    else sh('makensis', ['-V2', `-DAPPDIR=${un}`, `-DOUT=${path.join(out, `Kitsune-Lite-Portable-${ver}.exe`)}`, `-DVER=${ver}`, `-DICON=${ico}`, path.join(root, 'scripts', 'win', 'portable.nsi')]);
  } else if (p === 'linux') {
    // AppImage through electron-builder; .deb assembled directly with dpkg-deb (no extra tooling).
    const an = `Kitsune${L ? '-Lite' : ''}-${ver}-linux-x64.AppImage`;
    eb(['--linux', 'AppImage', '--x64', '--config.directories.output=' + dist, '--config.linux.artifactName=' + an.replace(ver, '${version}')]);
    const made = fs.readdirSync(dist).find(f => /\.AppImage$/.test(f)); if (made) fs.copyFileSync(path.join(dist, made), path.join(out, an));
    if (ed === 'full') {
      const un = path.join(dist, 'linux-unpacked'); const root2 = path.join(dist, 'deb'); const inst = path.join(root2, 'opt', 'Kitsune');
      fs.rmSync(root2, { recursive: true, force: true }); fs.mkdirSync(path.dirname(inst), { recursive: true }); fs.cpSync(un, inst, { recursive: true, verbatimSymlinks: true });
      for (const d of ['usr/bin', 'usr/share/applications', 'usr/share/icons/hicolor/512x512/apps', 'DEBIAN']) fs.mkdirSync(path.join(root2, d), { recursive: true });
      fs.symlinkSync('/opt/Kitsune/kitsune', path.join(root2, 'usr/bin/kitsune'));
      fs.copyFileSync(path.join(root, 'build', 'icon.png'), path.join(root2, 'usr/share/icons/hicolor/512x512/apps/kitsune.png'));
      fs.writeFileSync(path.join(root2, 'usr/share/applications/kitsune.desktop'), '[Desktop Entry]\nName=Kitsune\nComment=Light, animated, anime-themed browser\nExec=/opt/Kitsune/kitsune %U\nIcon=kitsune\nTerminal=false\nType=Application\nCategories=Network;WebBrowser;\nMimeType=x-scheme-handler/http;x-scheme-handler/https;text/html;\nStartupWMClass=Kitsune\n');
      const kb = Math.round(+spawnSync('du', ['-sk', root2]).stdout.toString().split('\t')[0]);
      fs.writeFileSync(path.join(root2, 'DEBIAN/control'), `Package: kitsune\nVersion: ${ver}\nSection: web\nPriority: optional\nArchitecture: amd64\nInstalled-Size: ${kb}\nMaintainer: Kitsune <noreply@kitsune.app>\nDepends: libgtk-3-0, libnss3, libxss1, libasound2 | libasound2t64, libgbm1, xdg-utils\nHomepage: https://kitsune.zeabur.app\nDescription: Kitsune, a light, animated, anime-themed web browser\n`);
      fs.writeFileSync(path.join(root2, 'DEBIAN/postinst'), '#!/bin/sh\nchmod 4755 /opt/Kitsune/chrome-sandbox 2>/dev/null || true\nupdate-alternatives --install /usr/bin/x-www-browser x-www-browser /usr/bin/kitsune 80 2>/dev/null || true\nexit 0\n', { mode: 0o755 });
      fs.writeFileSync(path.join(root2, 'DEBIAN/postrm'), '#!/bin/sh\nupdate-alternatives --remove x-www-browser /usr/bin/kitsune 2>/dev/null || true\nexit 0\n', { mode: 0o755 });
      sh('dpkg-deb', ['--root-owner-group', '-Zxz', '-b', root2, path.join(out, `Kitsune-${ver}-linux-x64.deb`)]);
    }
  } else {
    eb(['--mac', 'dir', '--x64', '--arm64', '--config.directories.output=' + dist]);
    for (const [d, arch] of [['mac', 'x64'], ['mac-arm64', 'arm64']]) {
      const dd = path.join(dist, d); if (!fs.existsSync(dd)) continue;
      const stage = path.join(dist, 'stage-' + arch); fs.mkdirSync(stage, { recursive: true });
      const appName = ed === 'lite' ? 'Kitsune Lite.app' : 'Kitsune.app';
      fs.cpSync(path.join(dd, 'Kitsune.app'), path.join(stage, appName), { recursive: true, verbatimSymlinks: true });
      fs.writeFileSync(path.join(stage, 'READ ME FIRST.txt'), (ed === 'lite'
        ? 'Kitsune Lite (no install)\n\nKeep "Kitsune Lite.app" in any folder (Desktop, USB stick...) and open it from there. Your profile is stored in a KitsuneData folder next to the app.\n'
        : 'Kitsune\n\nDrag Kitsune.app into Applications and open it.\n') +
        '\nThe app is not notarized yet. First launch: right-click the app > Open > Open  (or run: xattr -dr com.apple.quarantine "<path to app>").\n');
      zip('.', `Kitsune${L ? '-Lite' : ''}-${ver}-mac-${arch}.zip`, stage);
    }
  }
}
sh('node', ['scripts/set-edition.js', 'full'], { cwd: root });
const files = fs.readdirSync(out).filter(f => /\.(exe|zip|dmg|AppImage|deb)$/.test(f));
const rel = { version: ver, built: new Date().toISOString(), files: files.map(f => { const b = fs.readFileSync(path.join(out, f)); return { file: f, size: b.length, sha256: crypto.createHash('sha256').update(b).digest('hex') }; }) };
fs.writeFileSync(path.join(out, 'releases.json'), JSON.stringify(rel, null, 2));
console.log(rel);
