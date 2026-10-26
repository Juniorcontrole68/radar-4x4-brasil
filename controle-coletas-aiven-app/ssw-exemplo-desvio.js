'use strict';
// Carregado (node --require) só no processo de leitura de uma empresa de EXEMPLO da demonstração,
// a que entrou sem o login do SSW: as chamadas ao SSW e à WebAPI do BI2 vão para o SSW de exemplo
// local (ssw-exemplo.js, endereço em SSW_EXEMPLO_URL). Nunca é carregado na produção.
const http = require('http'), https = require('https');
const ALVO = String(process.env.SSW_EXEMPLO_URL || '');
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(ALVO)) throw new Error('SSW_EXEMPLO_URL inválida.');
const HOSTS = ['https://sistema.ssw.inf.br', 'https://ssw.inf.br'];
const desvio = url => { const h = typeof url === 'string' && HOSTS.find(x => url.startsWith(x + '/')); return h ? ALVO + url.slice(h.length) : null; };
const real = globalThis.fetch;
globalThis.fetch = function (input, init) {
  const url = typeof input === 'string' ? input : (input instanceof URL ? input.toString() : input && input.url);
  const alvo = desvio(url);
  return alvo ? real(alvo, init) : real(input, init);
};
const realGet = https.get;
https.get = function (url, opts, cb) {
  const alvo = desvio(typeof url === 'string' ? url : (url instanceof URL ? url.toString() : null));
  if (!alvo) return realGet.apply(this, arguments);
  if (typeof opts === 'function') { cb = opts; opts = {}; }
  return http.get(alvo, opts || {}, cb);
};
// https.request com objeto de opções (token da API do SSW): vai para o SSW de exemplo também.
const realRequest = https.request;
https.request = function (opts, cb) {
  const host = opts && typeof opts === 'object' && !(opts instanceof URL) ? String(opts.hostname || opts.host || '') : '';
  if (!/(^|\.)ssw\.inf\.br$/i.test(host)) return realRequest.apply(this, arguments);
  const a = new URL(ALVO);
  const { protocol, hostname, host: _h, port, agent, ...resto } = opts;
  return http.request({ ...resto, hostname: a.hostname, port: a.port }, cb);
};
