// node scripts/build.js <win|mac|all> [full|lite|both]
// Builds unpacked apps with electron-builder (no wine needed), then packages:
//  Win Full  -> Kitsune-Setup-<v>.zip  (app + Install.bat/Install.ps1 -> per-user install, shortcuts, uninstaller)
//  Win Lite  -> Kitsune-Lite-Portable-<v>.zip (run Kitsune.exe straight from the folder; data in KitsuneData)
//  Mac       -> Kitsune[-Lite]-<v>-mac-<arch>.zip (.app inside)
// Real NSIS .exe / .dmg builds: see .github/workflows/build.yml
const { spawnSync } = require('child_process'); const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const root = path.join(__dirname, '..'); const out = path.join(root, '..', 'releases');
const plat = process.argv[2] || 'all', which = process.argv[3] || 'both';
const ver = require('../package.json').version;
const sh = (c, a, o = {}) => { const r = spawnSync(c, a, { stdio: 'inherit', ...o }); if (r.status) process.exit(r.status); };
const eb = a => sh('npx', ['electron-builder', ...a, '--publish', 'never'], { cwd: root, env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' } });
const zip = (dir, name, cwd) => { const f = path.join(out, name); fs.rmSync(f, { force: true }); sh('zip', ['-qry', f, dir], { cwd }); };
fs.mkdirSync(out, { recursive: true });
const eds = which === 'both' ? ['full', 'lite'] : [which];
const plats = plat === 'all' ? ['win', 'mac'] : [plat];
for (const ed of eds) for (const p of plats) {
  sh('node', ['scripts/set-edition.js', ed], { cwd: root });
  const dist = path.join(root, 'dist-' + ed + '-' + p); fs.rmSync(dist, { recursive: true, force: true });
  const L = ed === 'lite' ? 'Lite' : '';
  if (p === 'win') {
    eb(['--win', 'dir', '--x64', '--config.directories.output=' + dist]);
    const un = path.join(dist, 'win-unpacked');
    const top = ed === 'lite' ? 'Kitsune-Lite' : 'Kitsune';
    const stage = path.join(dist, 'stage'); fs.mkdirSync(stage, { recursive: true });
    fs.cpSync(un, path.join(stage, top), { recursive: true });
    if (ed === 'full') {
      fs.copyFileSync(path.join(root, 'scripts', 'win', 'Install.bat'), path.join(stage, 'Install.bat'));
      fs.copyFileSync(path.join(root, 'scripts', 'win', 'Install.ps1'), path.join(stage, 'Install.ps1'));
      zip('.', `Kitsune-Setup-${ver}.zip`, stage);
    } else {
      fs.writeFileSync(path.join(stage, 'README.txt'), 'Kitsune Lite (portable)\r\n\r\nUnzip anywhere (USB stick, Desktop...) and run Kitsune-Lite\\Kitsune.exe.\r\nNothing is installed. Your profile lives in Kitsune-Lite\\KitsuneData - delete the folder to remove everything.\r\n');
      zip('.', `Kitsune-Lite-Portable-${ver}.zip`, stage);
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
const files = fs.readdirSync(out).filter(f => /\.(exe|zip|dmg|AppImage)$/.test(f));
const rel = { version: ver, built: new Date().toISOString(), files: files.map(f => { const b = fs.readFileSync(path.join(out, f)); return { file: f, size: b.length, sha256: crypto.createHash('sha256').update(b).digest('hex') }; }) };
fs.writeFileSync(path.join(out, 'releases.json'), JSON.stringify(rel, null, 2));
console.log(rel);
