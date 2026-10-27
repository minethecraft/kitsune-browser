// dev helper: stitch smoke-test layer captures into one screenshot per step (plain node + sharp)
const fs = require('fs'), path = require('path'), sharp = require('sharp');
(async () => {
  const dir = process.argv[2];
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.json'))) {
    const m = JSON.parse(fs.readFileSync(path.join(dir, f)));
    const [W, H] = m.size;
    const layers = [];
    for (const l of m.layers) {
      const buf = await sharp(path.join(dir, l.file)).resize(l.bounds.width, l.bounds.height, { fit: 'fill' }).png().toBuffer();
      layers.push({ input: buf, left: Math.max(0, l.bounds.x), top: Math.max(0, l.bounds.y) });
    }
    await sharp({ create: { width: W, height: H, channels: 4, background: '#1c1c1c' } }).composite(layers).png().toFile(path.join(dir, f.replace('.json', '.png')));
    console.log('composed', f);
  }
})();
