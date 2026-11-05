const fs = require('fs'),
  path = require('path');
const root = process.cwd();
const modules = path.join(root, 'node_modules'),
  aliases = path.join(root, '.next', 'node_modules'),
  links = [];
function walk(dir) {
  for (const f of fs.readdirSync(dir)) {
    const entry = path.join(dir, f),
      target = fs.realpathSync(entry);
    if (target.startsWith(modules + path.sep)) {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(target, 'package.json'))
      );
      links.push({
        alias: path.relative(aliases, entry),
        target: path.relative(modules, target),
        name: pkg.name,
        version: pkg.version,
      });
    } else if (f.startsWith('@')) walk(entry);
    else throw Error('Unexpected alias ' + entry);
  }
}
walk(aliases);
fs.writeFileSync('../runtime-links.json', JSON.stringify(links));
console.log(links);
