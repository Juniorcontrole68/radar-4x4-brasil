# Gera ../roteirizador-cargas.html (página servida pelo CONSTRULOG) a partir destas fontes.
# Uso: cd controle-coletas-aiven-app/roteirizador-cargas-fonte && python3 build.py
import json, os
aqui = os.path.dirname(os.path.abspath(__file__))
L = lambda n: open(os.path.join(aqui, n), encoding='utf-8').read()
shell = L('shell.html')
js = 'var MUN_DATA=' + json.dumps(L('mun.txt'), ensure_ascii=False) + ';\n' + L('engine.js') + '\n' + L('demo.js') + '\n' + L('app.js')
host = L('rc-host.js')
assert '</script' not in (js + host).lower()
reset = '<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>'
doc = '<!doctype html>\n<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' + reset + '</head><body>\n' + shell + '\n<script>\n' + host + '\n</script>\n<script>\n' + js + '\n</script>\n</body></html>\n'
open(os.path.join(aqui, '..', 'roteirizador-cargas.html'), 'w', encoding='utf-8').write(doc)
print('roteirizador-cargas.html', len(doc) // 1024, 'KB')
