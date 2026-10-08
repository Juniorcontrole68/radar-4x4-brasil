// Pré-carregado só no teste: desvia as chamadas fetch() ao SSW para o SSW de mentira local.
const real=globalThis.fetch,TARGET='http://127.0.0.1:'+(process.env.MOCK_PORT||10555);
globalThis.fetch=function(input,init){
  const url=typeof input==='string'?input:(input instanceof URL?input.toString():input?.url);
  if(typeof url==='string'&&url.startsWith('https://sistema.ssw.inf.br'))return real(TARGET+url.slice('https://sistema.ssw.inf.br'.length),init);
  return real(input,init);
};
