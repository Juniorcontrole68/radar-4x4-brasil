// Leitor dos dados da CNH (física fotografada, CNH digital em PDF ou print do app Carteira Digital de Trânsito).
// Recebe o texto já extraído do documento (camada de texto do PDF e/ou OCR) e devolve os campos do motorista.
// Roda no navegador (window.CnhLeitor, injetado na tela de coletas) e no Node (testes).
(function (root) {
  const norm = v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[ \t]+/g, ' ').trim();
  const digits = v => String(v || '').replace(/\D/g, '');
  const linhas = t => String(t || '').split(/\r?\n/).map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const titleCase = v => String(v || '').toLocaleLowerCase('pt-BR').replace(/(^|[\s\-'])\p{L}/gu, m => m.toLocaleUpperCase('pt-BR'))
    .replace(/\b(Da|De|Do|Das|Dos|E)\b/g, m => m.toLowerCase());

  function cpfValido(v) {
    const d = digits(v); if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
    let s = 0; for (let i = 0; i < 9; i++) s += Number(d[i]) * (10 - i);
    let x = (s * 10) % 11; if (x === 10) x = 0; if (x !== Number(d[9])) return false;
    s = 0; for (let i = 0; i < 10; i++) s += Number(d[i]) * (11 - i);
    x = (s * 10) % 11; if (x === 10) x = 0; return x === Number(d[10]);
  }
  // Dígitos verificadores do nº de registro da CNH (algoritmo do Denatran).
  function registroValido(v) {
    const d = digits(v); if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
    let s = 0; for (let i = 0; i < 9; i++) s += Number(d[i]) * (9 - i);
    let dv1 = s % 11, desc = 0; if (dv1 >= 10) { dv1 = 0; desc = 2 }
    s = 0; for (let i = 0; i < 9; i++) s += Number(d[i]) * (1 + i);
    const x = s % 11; let dv2 = x >= 10 ? 0 : x - desc; if (dv2 < 0) dv2 += 11; if (dv2 >= 10) dv2 = 0;
    return dv1 === Number(d[9]) && dv2 === Number(d[10]);
  }
  const formatCpf = d => d.slice(0, 3) + '.' + d.slice(3, 6) + '.' + d.slice(6, 9) + '-' + d.slice(9);

  function lerCpf(flat) {
    const re = /(\d{3})[.\s]?(\d{3})[.\s]?(\d{3})[\-\s.]?(\d{2})(?!\d)/g;
    const perto = flat.match(/\bCPF\b[^0-9]{0,40}(\d{3})[.\s]?(\d{3})[.\s]?(\d{3})[\-\s.]?(\d{2})(?!\d)/);
    if (perto) { const d = perto.slice(1, 5).join(''); if (cpfValido(d)) return d }
    for (const m of flat.matchAll(re)) { const d = m.slice(1, 5).join(''); if (cpfValido(d)) return d }
    return '';
  }

  function lerRegistro(flat, cpf) {
    // O valor pode vir depois de outros números da mesma linha (ex.: "CPF  Nº REGISTRO" / "529.982.247-25 04512345678").
    const p = flat.search(/\bREGISTRO\b/);
    if (p >= 0) {
      for (const m of flat.slice(p, p + 140).matchAll(/(?<![\d.\-])(\d{11})(?![\d.\-])/g)) if (m[1] !== cpf) return m[1];
    }
    for (const m of flat.matchAll(/(?<!\d)(\d{11})(?!\d)/g)) {
      if (m[1] !== cpf && registroValido(m[1]) && !cpfValido(m[1])) return m[1];
    }
    return '';
  }

  function datas(flat) {
    const out = [];
    for (const m of flat.matchAll(/(?<!\d)(\d{2})\s?[\/.\-]\s?(\d{2})\s?[\/.\-]\s?(\d{4})(?!\d)/g)) {
      const dd = Number(m[1]), mm = Number(m[2]), yy = Number(m[3]);
      if (dd < 1 || dd > 31 || mm < 1 || mm > 12 || yy < 1900 || yy > 2100) continue;
      out.push(m[3] + '-' + m[2] + '-' + m[1]);
    }
    return out;
  }
  // Validade é a data mais adiante do documento (nascimento, 1ª habilitação e emissão vêm antes).
  function lerValidade(flat) {
    const rot = flat.match(/\bVALIDADE\b[^0-9]{0,12}(\d{2})\s?[\/.\-]\s?(\d{2})\s?[\/.\-]\s?(\d{4})(?!\d)/);
    const todas = datas(flat).sort();
    const maior = todas[todas.length - 1] || '';
    if (rot) {
      const d = rot[3] + '-' + rot[2] + '-' + rot[1];
      if (!maior || d >= maior) return d;
    }
    return todas.length >= 2 && maior > todas[0] ? maior : '';
  }
  function lerNascimento(flat) {
    const todas = datas(flat).sort();
    return todas.length >= 2 ? todas[0] : '';
  }

  const CATS = '(ACC|AB|AC|AD|AE|A|B|C|D|E)';
  function lerCategoria(flat) {
    const m = flat.match(new RegExp('\\bCAT(?:EGORIA)?\\.?\\s*(?:DE\\s+)?(?:HAB(?:ILITACAO)?\\.?)?\\s*[:\\-]?\\s*' + CATS + '\\b'));
    if (m) return m[1];
    const p = flat.search(/\bCAT(?:EGORIA)?\.?\s*(?:DE\s+)?HAB/);
    if (p >= 0) {
      const perto = flat.slice(p, p + 160).match(/\b(ACC|AB|AD|AE)\b/);
      if (perto) return perto[1];
    }
    const solta = flat.match(/\b(AB|AD|AE)\b/);
    return solta ? solta[1] : '';
  }

  function lerRg(flat) {
    const p = flat.search(/\b(?:DOC(?:UMENTO)?\.?\s*(?:DE\s+)?IDENTIDADE|IDENTIDADE|RG)\b/);
    if (p < 0) return '';
    const trecho = flat.slice(p, p + 160).replace(/^.*?(?:IDENTIDADE|RG)\b/, '')
      .replace(/^[\s\/.]*(?:ORG(?:AO)?\.?\s*EMISSOR|ORG\.?\s*EXP(?:EDIDOR)?)?[\s\/.]*(?:UF)?[\s:\-]*/, '');
    const m = trecho.match(/(?<![\d\/])(\d[\d.\-]{3,16}[\dX])(?![\d\/])(?:\s*([A-Z]{2,7})\s*[\/\- ]?\s*([A-Z]{2})\b)?/);
    if (!m) return '';
    const num = m[1].replace(/[.\-]+$/, ''), d = digits(num);
    if (d.length < 5 || d.length > 14 || /^\d{2}[\/\-.]\d{2}[\/\-.]\d{4}$/.test(num)) return '';
    if (m[2] && m[3] && !/^(CPF|DATA|CAT|NOME|VALIDADE)$/.test(m[2])) return num + ' ' + m[2] + '/' + m[3];
    return num;
  }

  const NAO_NOME = /\b(?:CARTEIRA|HABILITACAO|REPUBLICA|FEDERATIVA|BRASIL|DETRAN|SECRETARIA|ASSINATURA|CONDUTOR|CPF|RG|REGISTRO|VALIDADE|CATEGORIA|IDENTIDADE|MINISTERIO|INFRAESTRUTURA|TRANSPORTES|TRANSITO|DEPARTAMENTO|NACIONAL|GOVERNO|ESTADO|DOCUMENTO|ORGAO|EMISSOR|FILIACAO|NASCIMENTO|PERMISSAO|OBSERVACOES|LOCAL|EMISSAO|DATA|NOME|SOBRENOME|SENATRAN|DENATRAN|DIGITAL|BRASILEIRO|BRASILEIRA|NACIONALIDADE|HAB)\b/;
  function limparNome(v) {
    return String(v || '').replace(/[^A-Za-zÀ-ÿ'\s]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function nomePlausivel(v) {
    const n = limparNome(v), partes = n.split(' ').filter(Boolean), u = norm(n);
    if (n.length < 6 || n.length > 90 || partes.length < 2 || partes.length > 8) return false;
    if (NAO_NOME.test(u)) return false;
    if (!partes.every(p => p.length >= 2 || /^[EeYy]$/.test(p))) return false;
    return partes.filter(p => p.length >= 3).length >= 2;
  }
  function lerNome(ls) {
    for (let i = 0; i < ls.length; i++) {
      const n = norm(ls[i]);
      if (!/^(?:[\d\s]+(?:E\s*\d+\s*)?)?NOME\b/.test(n) || /FILIA|\bPAI\b|\bMAE\b|NOME SOCIAL/.test(n)) continue;
      const resto = limparNome(n.replace(/^(?:[\d\s]+(?:E\s*\d+\s*)?)?NOME(?:\s+E\s+SOBRENOME|\s+DO\s+CONDUTOR|\s+COMPLETO)?\s*[:\-]?/, ''));
      if (nomePlausivel(resto)) return titleCase(resto);
      for (let j = i + 1; j < Math.min(ls.length, i + 3); j++) {
        const cand = limparNome(ls[j]);
        if (nomePlausivel(cand)) return titleCase(cand);
        if (NAO_NOME.test(norm(cand))) break;
      }
    }
    // OCR que junta tudo numa linha: pega as palavras depois do rótulo até o próximo rótulo.
    const flat = norm(ls.join(' '));
    for (const m of flat.matchAll(/\bNOME(?: E SOBRENOME| DO CONDUTOR| COMPLETO)?\b\s*[:\-]?\s*/g)) {
      if (/FILIA|\bPAI\b|\bMAE\b/.test(flat.slice(Math.max(0, m.index - 12), m.index))) continue;
      const palavras = [];
      for (const w of flat.slice(m.index + m[0].length).split(' ')) {
        if (!/^[A-Z']{1,30}$/.test(w) || NAO_NOME.test(w) || palavras.length >= 8) break;
        palavras.push(w);
      }
      const cand = palavras.join(' ');
      if (nomePlausivel(cand)) return titleCase(cand);
    }
    return '';
  }

  function ler(texto) {
    const ls = linhas(texto).map(norm);
    const flat = ls.join(' ');
    const cpf = lerCpf(flat);
    return {
      nome: lerNome(linhas(texto)),
      cpf: cpf ? formatCpf(cpf) : '',
      rg: lerRg(flat),
      registro: lerRegistro(flat, cpf),
      categoria: lerCategoria(flat),
      validade: lerValidade(flat),
      nascimento: lerNascimento(flat)
    };
  }

  const api = { ler, cpfValido, registroValido, nomePlausivel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CnhLeitor = api;
})(typeof window !== 'undefined' ? window : this);
