// Processa o relatorio "Contas a Receber" da Sponte e monta as linhas do cache (Supabase alunos_cache).
// Porta fiel do no n8n "Processar Regras e Matematica" (ver test/fixtures/n8n_original.js).
const XLSX = require('xlsx');

const COLUNAS = ['Sacado', 'NomeResponsavel', 'CPFResponsavel', 'Situacao', 'DataVencimento', 'Valor', 'NumeroBoleto', 'NumeroParcela'];
const SITUACOES_ABERTAS = ['Pendente', 'Em Aberto', 'Aberto', 'Atrasada'];

function lerPlanilha(caminho) {
    const wb = XLSX.readFile(caminho, { dense: true, cellFormula: false, cellHTML: false, cellText: false });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const matriz = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    return extrairLinhas(matriz);
}

// Celulas numericas (Excel) -> mesmo texto que a Sponte exporta
function normalizar(coluna, v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') {
        if (coluna === 'DataVencimento') return XLSX.SSF.format('dd/mm/yyyy hh:mm:ss', v);
        if (coluna === 'Valor') return v.toFixed(2).replace('.', ',');
        if (coluna === 'CPFResponsavel') return String(Math.trunc(v)).padStart(11, '0');
    }
    return String(v).trim();
}

function extrairLinhas(matriz) {
    const h = matriz.findIndex(r => Array.isArray(r) && r.includes('NumeroBoleto') && r.includes('CPFResponsavel'));
    if (h === -1) return [];
    const idx = COLUNAS.map(c => matriz[h].indexOf(c));
    const linhas = [];
    for (let i = h + 1; i < matriz.length; i++) {
        const r = matriz[i];
        if (!Array.isArray(r)) continue;
        const o = {};
        COLUNAS.forEach((c, k) => { o[c] = idx[k] === -1 ? '' : normalizar(c, r[idx[k]]); });
        linhas.push(o);
    }
    return linhas;
}

const ehAberto = (r) => !!(r && r.Situacao && SITUACOES_ABERTAS.includes(r.Situacao) && r.NumeroBoleto && r.NumeroBoleto !== '0' && r.Valor && r.CPFResponsavel && r.DataVencimento);

function hojeSaoPaulo(agora = new Date()) {
    const hoje = new Date(agora.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    hoje.setHours(0, 0, 0, 0);
    return hoje;
}

const modulo10 = (str) => {
    let sum = 0, multiplier = 2;
    for (let i = str.length - 1; i >= 0; i--) {
        let val = parseInt(str[i]) * multiplier;
        if (val > 9) val = Math.floor(val / 10) + (val % 10);
        sum += val;
        multiplier = multiplier === 2 ? 1 : 2;
    }
    const digit = 10 - (sum % 10);
    return digit === 10 ? 0 : digit;
};

const modulo11 = (str) => {
    let sum = 0, multiplier = 2;
    for (let i = str.length - 1; i >= 0; i--) {
        sum += parseInt(str[i]) * multiplier;
        multiplier++;
        if (multiplier > 9) multiplier = 2;
    }
    const digit = 11 - (sum % 11);
    return digit === 0 || digit === 10 || digit === 11 ? 1 : digit;
};

// Linha digitavel Banco do Brasil (convenio 3121068, carteira 17)
function linhaDigitavelBB(numeroBoleto, valorStr, dataVencimentoStr) {
    try {
        const [day, month, year] = dataVencimentoStr.split(' ')[0].split('/');
        if (!year) return null;
        const vencDate = new Date(year, month - 1, day);
        let fator = Math.floor((vencDate - new Date(1997, 9, 7)) / 86400000);
        if (fator > 9999) fator = 1000 + Math.floor((vencDate - new Date(2025, 1, 22)) / 86400000);
        const valorClean = valorStr.split(',')[0] + (valorStr.split(',')[1] || '00').padEnd(2, '0').substring(0, 2);
        const valorPad = valorClean.padStart(10, '0');
        const campoLivre = '000000' + '3121068' + numeroBoleto.toString().padStart(10, '0') + '17';
        const dvGeral = modulo11('001' + '9' + fator + valorPad + campoLivre);
        const b1 = '0019' + campoLivre.substring(0, 5);
        const b2 = campoLivre.substring(5, 15);
        const b3 = campoLivre.substring(15, 25);
        return (b1 + modulo10(b1)) + (b2 + modulo10(b2)) + (b3 + modulo10(b3)) + dvGeral + fator + valorPad;
    } catch (e) { return null; }
}

const mkParcela = (b, atrasada) => ({
    title: atrasada ? 'Atrasada' : 'Pendente',
    valor: b.r.Valor.toString(),
    isVencida: atrasada,
    diasAtraso: atrasada ? b.diffDays : 0,
    isPendente: true,
    numParcela: b.r.NumeroParcela || '1',
    dataVencimento: b.r.DataVencimento.toString().split(' ')[0],
    linhaDigitavel: linhaDigitavelBB(b.r.NumeroBoleto.toString(), b.r.Valor.toString(), b.r.DataVencimento.toString())
});

function calcAluno(boletos) {
    const atrasados = boletos.filter(b => b.diffDays > 0);
    if (atrasados.length > 0) {
        const maxAtraso = Math.max(...atrasados.map(b => b.diffDays));
        if (maxAtraso >= 6) return { status: 'negociar', boletos: [] };
        return { status: 'pagar_atrasados', boletos: atrasados.map(b => mkParcela(b, true)).filter(p => p.linhaDigitavel) };
    }
    boletos.sort((a, b) => a.vencDate - b.vencDate);
    const pr = mkParcela(boletos[0], false);
    return { status: 'em_dia', boletos: pr.linhaDigitavel ? [pr] : [] };
}

function montarCache(linhas, hoje, agoraIso) {
    // Dedupe CPF + Sacado + Vencimento, mantendo a maior parcela
    const unicos = new Map();
    for (const r of linhas.filter(ehAberto)) {
        const chave = r.CPFResponsavel.replace(/[^0-9]/g, '') + '_' + (r.Sacado || '').trim() + '_' + r.DataVencimento;
        const ex = unicos.get(chave);
        if (!ex || (parseInt(r.NumeroParcela) || 0) > (parseInt(ex.NumeroParcela) || 0)) unicos.set(chave, r);
    }

    const respMap = new Map();
    for (const r of unicos.values()) {
        const cpfLimpo = r.CPFResponsavel.replace(/[^0-9]/g, '');
        if (cpfLimpo.length !== 11) continue;
        const cpf = cpfLimpo.replace(/([0-9]{3})([0-9]{3})([0-9]{3})([0-9]{2})/, '$1.$2.$3-$4');
        const partes = r.DataVencimento.split(' ')[0].split('/');
        if (!partes[2]) continue;
        const vencDate = new Date(partes[2], partes[1] - 1, partes[0]);
        const diffDays = Math.ceil((hoje - vencDate) / 86400000);
        const sacado = (r.Sacado || 'Aluno').trim();
        if (!respMap.has(cpf)) respMap.set(cpf, { nomeResp: r.NomeResponsavel || '', alunos: new Map() });
        const resp = respMap.get(cpf);
        if (!resp.alunos.has(sacado)) resp.alunos.set(sacado, []);
        resp.alunos.get(sacado).push({ r, vencDate, diffDays });
    }

    const payload = [];
    for (const [cpf, resp] of respMap.entries()) {
        const alunos = [];
        for (const [sacado, boletos] of resp.alunos.entries()) {
            const c = calcAluno(boletos);
            alunos.push({ nomeAluno: sacado, status: c.status, boletos: c.boletos });
        }
        let overall = 'em_dia';
        if (alunos.some(a => a.status === 'negociar')) overall = 'negociar';
        else if (alunos.some(a => a.status === 'pagar_atrasados')) overall = 'pagar_atrasados';

        let legacy = null;
        if (overall === 'pagar_atrasados') legacy = alunos.filter(a => a.status === 'pagar_atrasados').reduce((acc, a) => acc.concat(a.boletos), []);
        else if (overall === 'em_dia') { const p = alunos.find(a => a.boletos.length > 0); legacy = p ? p.boletos[0] : null; }

        payload.push({ cpf, status_sponte: overall, nome_formatado: resp.nomeResp, data_atualizacao: agoraIso, proximo_boleto: { alunos, legacy } });
    }
    return payload;
}

module.exports = { lerPlanilha, extrairLinhas, ehAberto, hojeSaoPaulo, montarCache, linhaDigitavelBB };
