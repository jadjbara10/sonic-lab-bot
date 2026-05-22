const fs = require('fs');
let c = fs.readFileSync('src/index.js', 'utf8');
c = c.replace(
  'if (APP_SECRET) {g,
  "if (APP_SECRET && !APP_SECRET.startsWith('PLACEHOLDER')) {"
);
fs.writeFileSync('src/index.js', c);
console.log('DONE');
