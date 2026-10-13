import json
shell=open('shell.html',encoding='utf-8').read()
mun=open('mun.txt',encoding='utf-8').read()
js='var MUN_DATA='+json.dumps(mun,ensure_ascii=False)+';\n'+open('engine.js',encoding='utf-8').read()+'\n'+open('demo.js',encoding='utf-8').read()+'\n'+open('app.js',encoding='utf-8').read()
assert '</script' not in js.lower()
out=shell+'\n<script>\n'+js+'\n</script>\n'
open('roteirizador.html','w',encoding='utf-8').write(out)
open('bundle.js','w',encoding='utf-8').write(js)
print(len(out)//1024,'KB')
# versão para o CONSTRULOG: documento completo + ponte rc-host.js
reset='<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>'
host=open('rc-host.js',encoding='utf-8').read()
assert '</script' not in host.lower()
import hashlib
versao=hashlib.sha1((host+js+shell).encode('utf-8')).hexdigest()[:12]
doc='<!doctype html>\n<html lang="pt-BR"><head><meta charset="utf-8"><meta name="rc-versao" content="'+versao+'"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'+reset+'</head><body>\n'+shell+'\n<script>\n'+host+'\n</script>\n<script>\n'+js+'\n</script>\n</body></html>\n'
open('roteirizador-cargas.html','w',encoding='utf-8').write(doc)
print('construlog', len(doc)//1024, 'KB')
