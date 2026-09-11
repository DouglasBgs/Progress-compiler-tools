// Cópia de assets sem comandos Unix: npm run build funciona no Windows.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
for (const [source, target] of [['src/dashboard/public', 'dist/dashboard/public'], ['scripts', 'dist/scripts']]) {
    fs.mkdirSync(path.join(root, target), { recursive: true });
    fs.cpSync(path.join(root, source), path.join(root, target), { recursive: true });
}
