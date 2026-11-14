const fs = require('node:fs');
const roots = new Set(['package.json','pnpm-lock.yaml','seerr-api.yml','next.config.ts','next.config.mjs','next.config.js','next-env.d.ts','tsconfig.json','postcss.config.js','tailwind.config.js','bin/prepare.mjs']);
function allowed(file) {
 return typeof file === 'string' && !file.includes('..') && !file.includes('.test.') &&
 (roots.has(file) || /^(src|server)\/[\w/.\[\]-]+\.(tsx?|mts|mjs|js|json|css|html|pug)$/.test(file) || file === 'server/lib/data/UNICODE-LICENSE.txt');
}
function apply(root, entry, source) {
 const path = require('node:path'), dest = path.join(root, entry.file);
 if (!allowed(entry.file)) throw Error('Invalid source path');
 if (entry.afterHash === null) fs.rmSync(dest, {force:true});
 else { fs.mkdirSync(path.dirname(dest), {recursive:true}); fs.copyFileSync(path.join(source,entry.file),dest); }
}
module.exports = {allowed, apply};
