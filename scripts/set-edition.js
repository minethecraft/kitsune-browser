// Usage: node scripts/set-edition.js full|lite  -> writes edition.json (bundled into the app)
const fs = require('fs'), path = require('path');
const e = process.argv[2] === 'lite' ? 'lite' : 'full';
fs.writeFileSync(path.join(__dirname, '..', 'edition.json'), JSON.stringify({ edition: e }) + '\n');
console.log('edition =', e);
