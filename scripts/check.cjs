const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');

const root = resolve(__dirname, '..');
const context = vm.createContext({});
for (const file of ['config.example.gs', 'gmail2obsidian.gs']) {
  const script = new vm.Script(readFileSync(resolve(root, file), 'utf8'), {
    filename: file,
  });
  script.runInContext(context);
}
vm.runInContext('validateConfig_(CONFIG)', context);
JSON.parse(readFileSync(resolve(root, 'appsscript.json'), 'utf8'));
console.log('Apps Script syntax, example configuration, and manifest JSON are valid.');
