// COPIA LITERAL do no n8n "Processar Regras e Matematica" (workflow W7tTXjTNvvO62wYO, 23/09/2026).
// Usada SO como referencia golden nos testes. Unicas mudancas: `new Date()` -> `__now` (deterministico).
/* eslint-disable */
module.exports = function n8nOriginal($input, __now) {
const items = $input.all();
const data = items.map(i => i.json);

let headerRowIndex = -1;
let columnMap = {};

for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const values = Object.values(row);
    if (values.includes('NumeroBoleto') && values.includes('CPFResponsavel')) {
        headerRowIndex = i;
        for (let key in row) {
            if (row[key]) columnMap[key] = row[key];
        }
        break;
    }
}

let abertos = [];

const ehAberto = (r) => r && r.Situacao && (r.Situacao === 'Pendente' || r.Situacao === 'Em Aberto' || r.Situacao === 'Aberto' || r.Situacao === 'Atrasada') && r.NumeroBoleto && r.NumeroBoleto !== '0' && r.Valor && r.CPFResponsavel && r.DataVencimento;

if (headerRowIndex !== -1) {
    for (let i = headerRowIndex + 1; i < data.length; i++) {
        const rawRow = data[i];
        let r = {};
        for (let key in rawRow) {
            if (columnMap[key]) r[columnMap[key]] = rawRow[key];
        }
        if (ehAberto(r)) abertos.push(r);
    }
} else {
    abertos = data.filter(ehAberto);
}

// FILTRO ANTI-FANTASMAS (dedupe por CPF + Aluno + Vencimento)
let abertosUnicos = new Map();
for (let r of abertos) {
    let cpf = r.CPFResponsavel.toString().replace(/[^0-9]/g, '');
    let sac = (r.Sacado || '').toString().trim();
    let chave = cpf + '_' + sac + '_' + r.DataVencimento;
    if (!abertosUnicos.has(chave)) {
        abertosUnicos.set(chave, r);
    } else {
        let existente = abertosUnicos.get(chave);
        let pNum = parseInt(r.NumeroParcela) || 0;
        let exNum = parseInt(existente.NumeroParcela) || 0;
        if (pNum > exNum) abertosUnicos.set(chave, r);
    }
}
abertos = Array.from(abertosUnicos.values());

const modulo10 = (str) => {
    let sum = 0, multiplier = 2;
    for (let i = str.length - 1; i >= 0; i--) {
        let val = parseInt(str[i]) * multiplier;
        if (val > 9) val = Math.floor(val / 10) + (val % 10);
        sum += val;
        multiplier = multiplier === 2 ? 1 : 2;
    }
    const rem = sum % 10;
    const digit = 10 - rem;
    return digit === 10 ? 0 : digit;
};

const modulo11 = (str) => {
    let sum = 0, multiplier = 2;
    for (let i = str.length - 1; i >= 0; i--) {
        sum += parseInt(str[i]) * multiplier;
        multiplier++;
        if (multiplier > 9) multiplier = 2;
    }
    const rem = sum % 11;
    const digit = 11 - rem;
    return digit === 0 || digit === 10 || digit === 11 ? 1 : digit;
};

const generateBBBarcode = (numeroBoleto, valorStr, dataVencimentoStr) => {
    try {
        const p = dataVencimentoStr.split(' ')[0].split('/');
        const day = p[0], month = p[1], year = p[2];
        if (!year) return null;
        const vencDate = new Date(year, month - 1, day);
        const baseDate = new Date(1997, 9, 7);
        let fatorVencimento = Math.floor((vencDate - baseDate) / (1000 * 60 * 60 * 24));
        if (fatorVencimento > 9999) {
            const baseRollover = new Date(2025, 1, 22);
            fatorVencimento = 1000 + Math.floor((vencDate - baseRollover) / (1000 * 60 * 60 * 24));
        }
        let valorClean = valorStr.split(',')[0] + (valorStr.split(',')[1] || '00').padEnd(2, '0').substring(0, 2);
        const valorPad = valorClean.padStart(10, '0');
        const convenio = '3121068';
        const nossoNumero = numeroBoleto.toString().padStart(10, '0');
        const carteira = '17';
        const campoLivre = '000000' + convenio + nossoNumero + carteira;
        const banco = '001';
        const moeda = '9';
        const barcodeWithoutDV = banco + moeda + fatorVencimento + valorPad + campoLivre;
        const dvGeral = modulo11(barcodeWithoutDV);
        const block1 = banco + moeda + campoLivre.substring(0, 5);
        const fb1 = block1 + modulo10(block1);
        const block2 = campoLivre.substring(5, 15);
        const fb2 = block2 + modulo10(block2);
        const block3 = campoLivre.substring(15, 25);
        const fb3 = block3 + modulo10(block3);
        const linha = fb1.substring(0,5) + '.' + fb1.substring(5,10) + ' ' + fb2.substring(0,5) + '.' + fb2.substring(5,11) + ' ' + fb3.substring(0,5) + '.' + fb3.substring(5,11) + ' ' + dvGeral + ' ' + fatorVencimento + valorPad;
        return linha.replace(/[^0-9]/g, '');
    } catch (e) { return null; }
};

const strBR = __now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' });
const hoje = new Date(strBR);
hoje.setHours(0, 0, 0, 0);

// Agrupa por responsavel -> aluno
const respMap = new Map();
for (let r of abertos) {
    let cpfLimpo = r.CPFResponsavel.toString().replace(/[^0-9]/g, '');
    if (cpfLimpo.length !== 11) continue;
    let cpfFormatado = cpfLimpo.replace(/([0-9]{3})([0-9]{3})([0-9]{3})([0-9]{2})/, '$1.$2.$3-$4');
    let partes = r.DataVencimento.toString().split(' ')[0].split('/');
    if (!partes[2]) continue;
    let vencDate = new Date(partes[2], partes[1] - 1, partes[0]);
    let diffDays = Math.ceil((hoje - vencDate) / (1000 * 60 * 60 * 24));
    let boletoObj = { r, vencDate, diffDays };
    let sacado = (r.Sacado || 'Aluno').toString().trim();
    if (!respMap.has(cpfFormatado)) respMap.set(cpfFormatado, { nomeResp: (r.NomeResponsavel || '').toString(), alunos: new Map() });
    let resp = respMap.get(cpfFormatado);
    if (!resp.alunos.has(sacado)) resp.alunos.set(sacado, []);
    resp.alunos.get(sacado).push(boletoObj);
}

const mkParcela = (b, atrasada) => ({
    title: atrasada ? 'Atrasada' : 'Pendente',
    valor: b.r.Valor.toString(),
    isVencida: atrasada,
    diasAtraso: atrasada ? b.diffDays : 0,
    isPendente: true,
    numParcela: b.r.NumeroParcela || '1',
    dataVencimento: b.r.DataVencimento.toString().split(' ')[0],
    linhaDigitavel: generateBBBarcode(b.r.NumeroBoleto.toString(), b.r.Valor.toString(), b.r.DataVencimento.toString())
});

function calcAluno(boletos) {
    let atrasados = boletos.filter(b => b.diffDays > 0);
    if (atrasados.length > 0) {
        let maxAtraso = Math.max(...atrasados.map(b => b.diffDays));
        if (maxAtraso >= 6) return { status: 'negociar', boletos: [] };
        let parcelas = atrasados.map(b => mkParcela(b, true)).filter(p => p.linhaDigitavel);
        return { status: 'pagar_atrasados', boletos: parcelas };
    }
    boletos.sort((a, b) => a.vencDate - b.vencDate);
    let pr = mkParcela(boletos[0], false);
    return { status: 'em_dia', boletos: pr.linhaDigitavel ? [pr] : [] };
}

const payload = [];
const nowIso = __now.toISOString();

for (let [cpf, resp] of respMap.entries()) {
    let alunosArr = [];
    for (let [sacado, boletos] of resp.alunos.entries()) {
        let c = calcAluno(boletos);
        alunosArr.push({ nomeAluno: sacado, status: c.status, boletos: c.boletos });
    }
    if (alunosArr.length === 0) continue;

    let overall = 'em_dia';
    if (alunosArr.some(a => a.status === 'negociar')) overall = 'negociar';
    else if (alunosArr.some(a => a.status === 'pagar_atrasados')) overall = 'pagar_atrasados';

    let legacy = null;
    if (overall === 'pagar_atrasados') legacy = alunosArr.filter(a => a.status === 'pagar_atrasados').reduce((acc, a) => acc.concat(a.boletos), []);
    else if (overall === 'em_dia') { let prim = alunosArr.find(a => a.boletos.length > 0); legacy = prim ? prim.boletos[0] : null; }

    payload.push({
        cpf: cpf,
        status_sponte: overall,
        nome_formatado: resp.nomeResp,
        data_atualizacao: nowIso,
        proximo_boleto: { alunos: alunosArr, legacy: legacy }
    });
}

return [{ json: { payload } }];
};
