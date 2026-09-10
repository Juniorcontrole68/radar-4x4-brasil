const fs=require('fs');
const src=fs.readFileSync(require('path').join(__dirname,'..','contas-online.js'),'utf8');
eval(src);
