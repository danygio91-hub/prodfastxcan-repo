const fs = require('fs');
const data = JSON.parse(fs.readFileSync('tmp/eslint.json', 'utf8'));

let out = '';
for (const file of data) {
    if (file.errorCount > 0) {
        out += `FILE: ${file.filePath}\n`;
        const errors = file.messages.filter(m => m.severity === 2);
        for (const err of errors) {
            out += `  Line ${err.line}: ${err.message} (${err.ruleId})\n`;
        }
    }
}

fs.writeFileSync('tmp/clean_eslint.txt', out);
console.log('Done parsing eslint errors.');
