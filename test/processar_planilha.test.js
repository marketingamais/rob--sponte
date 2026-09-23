const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const XLSX = require('xlsx');
const n8nOriginal = require('./fixtures/n8n_original.js');
const { lerPlanilha, extrairLinhas, ehAberto, hojeSaoPaulo, montarCache } = require('../processar_planilha.js');

// 23/09/2026 12:00 em Sao Paulo
const AGORA = new Date('2026-09-23T15:00:00Z');
const HOJE = hojeSaoPaulo(AGORA);

function linha(o) {
    return Object.assign({
        Sacado: 'Aluno Teste', NomeResponsavel: 'Resp Teste', CPFResponsavel: '111.444.777-35',
        Situacao: 'Pendente', DataVencimento: '10/10/2026 00:00:00', Valor: '179,9900',
        NumeroBoleto: '162741', NumeroParcela: '8'
    }, o);
}

const CENARIO = [
    // em_dia: so parcela futura
    linha({}),
    // pagar_atrasados: 3 dias de atraso
    linha({ CPFResponsavel: '222.333.444-05', Sacado: 'Bia Atrasada', NomeResponsavel: 'Mae Bia', DataVencimento: '20/09/2026 00:00:00', NumeroBoleto: '40127', NumeroParcela: '7' }),
    linha({ CPFResponsavel: '222.333.444-05', Sacado: 'Bia Atrasada', NomeResponsavel: 'Mae Bia', DataVencimento: '20/10/2026 00:00:00', NumeroBoleto: '40128', NumeroParcela: '8' }),
    // negociar: 13 dias de atraso
    linha({ CPFResponsavel: '333.444.555-06', Sacado: 'Caio Devedor', DataVencimento: '10/09/2026 00:00:00', NumeroBoleto: '166083', NumeroParcela: '6' }),
    // dois filhos: um em dia, outro atrasado 2 dias -> geral pagar_atrasados
    linha({ CPFResponsavel: '444.555.666-07', Sacado: 'Filho Um', NomeResponsavel: 'Pai Dois', DataVencimento: '10/10/2026 00:00:00', NumeroBoleto: '5001', NumeroParcela: '3' }),
    linha({ CPFResponsavel: '444.555.666-07', Sacado: 'Filho Dois', NomeResponsavel: 'Pai Dois', DataVencimento: '21/09/2026 00:00:00', NumeroBoleto: '5002', NumeroParcela: '2' }),
    // duplicado (mesmo CPF+Sacado+Venc): mantem a maior parcela
    linha({ CPFResponsavel: '555.666.777-08', Sacado: 'Dup', DataVencimento: '10/11/2026 00:00:00', NumeroBoleto: '9001', NumeroParcela: '4' }),
    linha({ CPFResponsavel: '555.666.777-08', Sacado: 'Dup', DataVencimento: '10/11/2026 00:00:00', NumeroBoleto: '9002', NumeroParcela: '9' }),
    // ignorados: quitada, boleto 0, CPF curto
    linha({ CPFResponsavel: '666.777.888-09', Situacao: 'Quitada' }),
    linha({ CPFResponsavel: '777.888.999-10', NumeroBoleto: '0' }),
    linha({ CPFResponsavel: '123.456', NumeroBoleto: '777' }),
    // pendencia do ano passado -> negociar
    linha({ CPFResponsavel: '888.999.000-11', Sacado: 'Antigo', DataVencimento: '10/12/2025 00:00:00', NumeroBoleto: '1234', NumeroParcela: '12' })
];

test('montarCache e identico ao no n8n original (golden)', () => {
    const esperado = n8nOriginal({ all: () => CENARIO.map(json => ({ json })) }, AGORA)[0].json.payload;
    const obtido = montarCache(CENARIO, HOJE, AGORA.toISOString());
    assert.deepStrictEqual(obtido, esperado);
});

test('status por cenario', () => {
    const porCpf = Object.fromEntries(montarCache(CENARIO, HOJE, AGORA.toISOString()).map(i => [i.cpf, i]));
    assert.strictEqual(porCpf['111.444.777-35'].status_sponte, 'em_dia');
    assert.strictEqual(porCpf['111.444.777-35'].proximo_boleto.alunos[0].boletos[0].dataVencimento, '10/10/2026');
    assert.strictEqual(porCpf['222.333.444-05'].status_sponte, 'pagar_atrasados');
    assert.strictEqual(porCpf['222.333.444-05'].proximo_boleto.alunos[0].boletos.length, 1);
    assert.strictEqual(porCpf['333.444.555-06'].status_sponte, 'negociar');
    assert.strictEqual(porCpf['444.555.666-07'].status_sponte, 'pagar_atrasados');
    assert.strictEqual(porCpf['444.555.666-07'].proximo_boleto.alunos.length, 2);
    assert.strictEqual(porCpf['555.666.777-08'].proximo_boleto.alunos[0].boletos[0].numParcela, '9');
    assert.strictEqual(porCpf['888.999.000-11'].status_sponte, 'negociar');
    assert.ok(!porCpf['666.777.888-09'] && !porCpf['777.888.999-10']);
    assert.strictEqual(Object.keys(porCpf).length, 6);
    for (const i of Object.values(porCpf)) assert.strictEqual(i.data_atualizacao, AGORA.toISOString());
});

test('linha digitavel tem 47 digitos', () => {
    const it = montarCache([linha({})], HOJE, AGORA.toISOString())[0];
    assert.match(it.proximo_boleto.alunos[0].boletos[0].linhaDigitavel, /^\d{47}$/);
});

test('ehAberto', () => {
    assert.ok(ehAberto(linha({})));
    assert.ok(!ehAberto(linha({ Situacao: 'Cancelada' })));
    assert.ok(!ehAberto(linha({ NumeroBoleto: '0' })));
    assert.ok(!ehAberto(linha({ Valor: '' })));
});

test('extrairLinhas acha o cabecalho deslocado e ignora colunas extras', () => {
    const matriz = [
        ['Relatorio Contas a Receber'], [''], ['Periodo x'],
        ['NumeroParcela', 'Sacado', 'Extra', 'CPFResponsavel', 'NomeResponsavel', 'Situacao', 'DataVencimento', 'Valor', 'NumeroBoleto'],
        ['8', 'Aluno', 'lixo', '111.444.777-35', 'Resp', 'Pendente', '10/10/2026 00:00:00', '179,9900', 162741]
    ];
    const [l] = extrairLinhas(matriz);
    assert.deepStrictEqual(l, {
        Sacado: 'Aluno', NomeResponsavel: 'Resp', CPFResponsavel: '111.444.777-35', Situacao: 'Pendente',
        DataVencimento: '10/10/2026 00:00:00', Valor: '179,9900', NumeroBoleto: '162741', NumeroParcela: '8'
    });
});

test('extrairLinhas sem cabecalho devolve lista vazia', () => {
    assert.deepStrictEqual(extrairLinhas([['a', 'b'], ['c', 'd']]), []);
});

// Review Focus 1, 2, 3: celulas numericas
test('normaliza data serial do Excel, valor numerico e CPF sem zero a esquerda', () => {
    const serial10out2026 = 46305; // 10/10/2026
    const matriz = [
        ['NumeroParcela', 'Sacado', 'CPFResponsavel', 'NomeResponsavel', 'Situacao', 'DataVencimento', 'Valor', 'NumeroBoleto'],
        [8, 'Gabi', 6140707323, 'Resp', 'Pendente', serial10out2026, 179.99, 162741]
    ];
    const [l] = extrairLinhas(matriz);
    assert.strictEqual(l.CPFResponsavel, '06140707323');
    assert.strictEqual(l.DataVencimento, '10/10/2026 00:00:00');
    assert.strictEqual(l.Valor, '179,99');
    const texto = montarCache([linha({ CPFResponsavel: '061.407.073-23', Valor: '179,9900' })], HOJE, 'x')[0];
    const numerico = montarCache([l], HOJE, 'x')[0];
    assert.strictEqual(numerico.cpf, '061.407.073-23');
    assert.strictEqual(numerico.proximo_boleto.alunos[0].boletos[0].linhaDigitavel,
        texto.proximo_boleto.alunos[0].boletos[0].linhaDigitavel);
});

test('lerPlanilha le um .xlsx de verdade', () => {
    const tmp = path.join(os.tmpdir(), `plan-${process.pid}.xlsx`);
    const ws = XLSX.utils.aoa_to_sheet([
        ['Titulo'],
        ['NumeroParcela', 'Sacado', 'CPFResponsavel', 'NomeResponsavel', 'Situacao', 'DataVencimento', 'Valor', 'NumeroBoleto'],
        ['8', 'Aluno', '111.444.777-35', 'Resp', 'Pendente', '10/10/2026 00:00:00', '179,9900', '162741']
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Contas a Receber');
    XLSX.writeFile(wb, tmp);
    try {
        const linhas = lerPlanilha(tmp);
        assert.strictEqual(linhas.length, 1);
        assert.strictEqual(linhas[0].NumeroBoleto, '162741');
    } finally { fs.unlinkSync(tmp); }
});

test('hojeSaoPaulo usa o dia de Sao Paulo', () => {
    const d = hojeSaoPaulo(new Date('2026-09-24T02:30:00Z')); // 23/09 23:30 em SP
    assert.strictEqual(d.getDate(), 23);
    assert.strictEqual(d.getHours(), 0);
});
