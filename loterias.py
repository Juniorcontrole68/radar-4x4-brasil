#!/usr/bin/env python3
"""
Loterias - Mega-Sena e Quina
App local: baixa resultados oficiais da Caixa, calcula estatisticas
(ultimos 25/50/100 concursos), gera jogos, salva e confere.

Uso: python loterias.py      (abre o navegador em http://127.0.0.1:8765)
Requer apenas Python 3.8+ (nenhuma biblioteca extra).
"""
import json
import os
import sys
import threading
import time
import urllib.request
import urllib.error
import webbrowser
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

# No Render (nuvem) a porta vem da variavel PORT; no computador usa 8765.
NUVEM = "PORT" in os.environ
PORTA = int(os.environ.get("PORT") or os.environ.get("LOTERIAS_PORTA", "8765"))
ESTATICOS = {
    "/manifest.webmanifest": "application/manifest+json",
    "/sw.js": "text/javascript; charset=utf-8",
    "/icone-192.png": "image/png",
    "/icone-512.png": "image/png",
    "/icone-180.png": "image/png",
}
BASE = os.path.dirname(os.path.abspath(__file__))
DADOS = os.path.join(BASE, "dados")
os.makedirs(DADOS, exist_ok=True)
ARQ_JOGOS = os.path.join(DADOS, "jogos_salvos.json")
JOGOS_VALIDOS = ("megasena", "quina")
TRAVA = threading.Lock()

FONTES = [
    # API oficial do Portal de Loterias da Caixa
    "https://servicebus2.caixa.gov.br/portaldeloterias/api/{jogo}/{num}",
    # Espelho comunitario (usado so se a Caixa nao responder)
    "https://loteriascaixa-api.herokuapp.com/api/{jogo}/{num}",
]
CABECALHOS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Referer": "https://loterias.caixa.gov.br/",
}


def _baixar_json(url, tentativas=3):
    erro = None
    for i in range(tentativas):
        try:
            req = urllib.request.Request(url, headers=CABECALHOS)
            with urllib.request.urlopen(req, timeout=20) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:  # noqa: BLE001
            erro = e
            time.sleep(0.6 * (i + 1))
    raise erro


def _normalizar(d):
    """Converte o JSON da Caixa (ou do espelho) num formato unico."""
    if "numero" in d:  # formato Caixa
        dezenas = d.get("listaDezenas") or d.get("dezenasSorteadasOrdemSorteio") or []
        faixas = [
            {"descricao": f.get("descricaoFaixa", ""),
             "ganhadores": f.get("numeroDeGanhadores", 0),
             "premio": f.get("valorPremio", 0)}
            for f in d.get("listaRateioPremio") or []
        ]
        return {
            "concurso": int(d["numero"]),
            "data": d.get("dataApuracao", ""),
            "dezenas": sorted(int(x) for x in dezenas),
            "acumulado": bool(d.get("acumulado")),
            "faixas": faixas,
            "proximo": {
                "concurso": d.get("numeroConcursoProximo"),
                "data": d.get("dataProximoConcurso"),
                "estimativa": d.get("valorEstimadoProximoConcurso"),
            },
        }
    # formato do espelho comunitario
    faixas = [
        {"descricao": f.get("descricao", ""),
         "ganhadores": f.get("ganhadores", 0),
         "premio": f.get("valorPremio", 0)}
        for f in d.get("premiacoes") or []
    ]
    return {
        "concurso": int(d["concurso"]),
        "data": d.get("data", ""),
        "dezenas": sorted(int(x) for x in d.get("dezenas", [])),
        "acumulado": bool(d.get("acumulou")),
        "faixas": faixas,
        "proximo": {
            "concurso": d.get("proximoConcurso"),
            "data": d.get("dataProximoConcurso"),
            "estimativa": d.get("valorEstimadoProximoConcurso"),
        },
    }


def buscar_concurso(jogo, num=""):
    erros = []
    for modelo in FONTES:
        url = modelo.format(jogo=jogo, num=num).rstrip("/") + ("" if num else "/")
        if "herokuapp" in url and not num:
            url = url.rstrip("/") + "/latest"
        try:
            return _normalizar(_baixar_json(url))
        except Exception as e:  # noqa: BLE001
            erros.append(f"{url}: {e}")
    raise RuntimeError("Nao foi possivel obter resultados. " + " | ".join(erros))


def _arq_cache(jogo):
    return os.path.join(DADOS, f"resultados_{jogo}.json")


def ler_cache(jogo):
    try:
        with open(_arq_cache(jogo), encoding="utf-8") as f:
            return json.load(f)
    except Exception:  # noqa: BLE001
        return {"atualizado": None, "ultimo": None, "concursos": {}}


def gravar_cache(jogo, cache):
    tmp = _arq_cache(jogo) + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False)
    os.replace(tmp, _arq_cache(jogo))


def resultados(jogo, quantidade=100, atualizar=True):
    with TRAVA:
        cache = ler_cache(jogo)
        aviso = None
        if atualizar:
            try:
                ultimo = buscar_concurso(jogo)
                cache["ultimo"] = ultimo
                cache["concursos"][str(ultimo["concurso"])] = ultimo
                n = ultimo["concurso"]
                faltando = [c for c in range(n, max(0, n - quantidade), -1)
                            if str(c) not in cache["concursos"]]

                def pega(c):
                    try:
                        return buscar_concurso(jogo, c)
                    except Exception:  # noqa: BLE001
                        return None

                with ThreadPoolExecutor(max_workers=10) as ex:
                    for r in ex.map(pega, faltando):
                        if r:
                            cache["concursos"][str(r["concurso"])] = r
                cache["atualizado"] = time.strftime("%d/%m/%Y %H:%M")
                gravar_cache(jogo, cache)
                falhas = [c for c in faltando if str(c) not in cache["concursos"]]
                if falhas:
                    aviso = f"{len(falhas)} concurso(s) nao baixaram; tente atualizar de novo."
            except Exception as e:  # noqa: BLE001
                if not cache["concursos"]:
                    raise
                aviso = ("Sem conexao com a Caixa agora; mostrando os resultados salvos "
                         f"em {cache.get('atualizado')}. ({e})")
        lista = sorted(cache["concursos"].values(), key=lambda r: -r["concurso"])
        return {"jogo": jogo, "atualizado": cache.get("atualizado"),
                "ultimo": cache.get("ultimo"), "aviso": aviso,
                "concursos": lista[:max(quantidade, 1)]}


def ler_jogos():
    try:
        with open(ARQ_JOGOS, encoding="utf-8") as f:
            return json.load(f)
    except Exception:  # noqa: BLE001
        return []


def gravar_jogos(lista):
    tmp = ARQ_JOGOS + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(lista, f, ensure_ascii=False, indent=1)
    os.replace(tmp, ARQ_JOGOS)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _enviar(self, codigo, corpo, tipo="application/json; charset=utf-8"):
        dados = corpo if isinstance(corpo, bytes) else json.dumps(corpo, ensure_ascii=False).encode("utf-8")
        self.send_response(codigo)
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Length", str(len(dados)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(dados)

    def _corpo(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n).decode("utf-8") or "null")

    def do_GET(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        if u.path in ("/", "/index.html"):
            with open(os.path.join(BASE, "index.html"), "rb") as f:
                return self._enviar(200, f.read(), "text/html; charset=utf-8")
        if u.path in ESTATICOS:
            with open(os.path.join(BASE, u.path.lstrip("/")), "rb") as f:
                return self._enviar(200, f.read(), ESTATICOS[u.path])
        if u.path == "/saude":
            return self._enviar(200, {"ok": True})
        if u.path == "/api/resultados":
            jogo = q.get("jogo", ["megasena"])[0]
            if jogo not in JOGOS_VALIDOS:
                return self._enviar(400, {"erro": "jogo invalido"})
            qtd = max(1, min(500, int(q.get("qtd", ["100"])[0])))
            atualizar = q.get("atualizar", ["1"])[0] == "1"
            try:
                return self._enviar(200, resultados(jogo, qtd, atualizar))
            except Exception as e:  # noqa: BLE001
                return self._enviar(502, {"erro": str(e)})
        if u.path == "/api/jogos":
            # na nuvem os jogos ficam so no aparelho de cada pessoa
            return self._enviar(200, [] if NUVEM else ler_jogos())
        self._enviar(404, {"erro": "nao encontrado"})

    def do_POST(self):
        if NUVEM or urlparse(self.path).path != "/api/jogos":
            return self._enviar(404, {"erro": "nao encontrado"})
        novos = self._corpo() or []
        with TRAVA:
            lista = ler_jogos()
            lista.extend(novos)
            gravar_jogos(lista)
        self._enviar(200, {"ok": True, "total": len(lista)})

    def do_DELETE(self):
        u = urlparse(self.path)
        if NUVEM or u.path != "/api/jogos":
            return self._enviar(404, {"erro": "nao encontrado"})
        ids = set(parse_qs(u.query).get("id", []))
        with TRAVA:
            lista = [j for j in ler_jogos() if j.get("id") not in ids]
            gravar_jogos(lista)
        self._enviar(200, {"ok": True, "total": len(lista)})


def main():
    srv = ThreadingHTTPServer(("0.0.0.0" if NUVEM else "127.0.0.1", PORTA), Handler)
    url = f"http://127.0.0.1:{PORTA}/"
    print("=" * 56)
    print("  Loterias - Mega-Sena e Quina")
    print(f"  Aberto em: {url}")
    print("  Deixe esta janela aberta enquanto usa o app.")
    print("  Para fechar: Ctrl+C ou feche esta janela.")
    print("=" * 56)
    if not NUVEM and "--sem-navegador" not in sys.argv:
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
