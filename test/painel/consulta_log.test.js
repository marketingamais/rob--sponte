const test = require('node:test');
const assert = require('node:assert');
const { classificarConsulta, motivoESolucao, linhaPlanilhaErro } = require('../../n8n/painel/consulta_log.js');

const bol = (linha) => ({ numParcela: '1', dataVencimento: '10/10/2026', valor: '179,99', linhaDigitavel: linha });

test('debito: pagar_atrasados com linha', () => {
    const r = classificarConsulta({ status: 'pagar_atrasados', cache: true, alunos: [{ status: 'pagar_atrasados', boletos: [bol('123'), bol('456')] }] });
    assert.deepStrictEqual(r, { resultado: 'debito', tela: 'Boletos vencidos', code: '', origem: 'cache', qtd_boletos: 2, valor_debito: 359.98 });
});

test('atrasado sem linha liberada', () => {
    const r = classificarConsulta({ status: 'pagar_atrasados', cache: false, alunos: [{ status: 'pagar_atrasados', boletos: [bol(null)] }] });
    assert.strictEqual(r.resultado, 'atrasado_sem_linha');
    assert.strictEqual(r.origem, 'ao_vivo');
    assert.strictEqual(r.qtd_boletos, 0);
});

test('encaminhamento: status geral negociar vence (2 filhos) - Review Focus 1', () => {
    const r = classificarConsulta({ status: 'negociar', cache: true, alunos: [
        { status: 'negociar', boletos: [] }, { status: 'pagar_atrasados', boletos: [bol('9')] }] });
    assert.strictEqual(r.resultado, 'encaminhamento');
    assert.strictEqual(r.tela, 'Negociar com a Amais');
});

test('em dia com e sem boleto; cache antigo', () => {
    assert.strictEqual(classificarConsulta({ status: 'em_dia', cache: true, alunos: [{ status: 'em_dia', boletos: [bol('1')] }] }).resultado, 'em_dia_boleto');
    const s = classificarConsulta({ status: 'em_dia', cache: true, cacheDesatualizado: true, alunos: [] });
    assert.strictEqual(s.resultado, 'em_dia_sem_boleto');
    assert.strictEqual(s.tela, 'Em dia');
    assert.strictEqual(s.origem, 'cache_antigo');
});

test('formato legado sem alunos usa proximoBoleto/parcelas', () => {
    assert.strictEqual(classificarConsulta({ status: 'em_dia', cache: false, proximoBoleto: bol('1') }).resultado, 'em_dia_boleto');
    assert.strictEqual(classificarConsulta({ status: 'pagar_atrasados', cache: false, parcelas: [bol('1')] }).resultado, 'debito');
});

test('erros por code', () => {
    const casos = [
        ['nao_encontrado', 'CPF não encontrado'], ['instabilidade', 'Sistema fora do ar'],
        ['timeout_navegador', 'Sistema instável'], ['sem_senha', 'Sem senha no portal'],
        ['cpf_invalido', 'CPF inválido'], ['qualquer', 'Erro desconhecido'], [undefined, 'Erro desconhecido']
    ];
    for (const [code, tela] of casos) {
        const r = classificarConsulta({ status: 'erro', code });
        assert.strictEqual(r.resultado, 'erro');
        assert.strictEqual(r.tela, tela, String(code));
        assert.strictEqual(r.origem, 'sem_dados');
        assert.strictEqual(r.code, code || 'desconhecido');
    }
});

test('entrada vazia/lixo nao quebra', () => {
    assert.strictEqual(classificarConsulta(null).resultado, 'erro');
    assert.strictEqual(classificarConsulta({ status: 'xyz' }).tela, 'Erro desconhecido');
});

test('motivoESolucao cobre todos os codes e detalhe de instabilidade', () => {
    for (const c of ['nao_encontrado', 'instabilidade', 'sem_senha', 'timeout_navegador', 'cpf_invalido', 'desconhecido']) {
        const m = motivoESolucao(c);
        assert.ok(m.erro && m.motivo && m.solucao, c);
    }
    assert.match(motivoESolucao('instabilidade', 'api_sponte').erro, /API da Sponte/);
    assert.match(motivoESolucao('instabilidade', 'robo').erro, /Robô/);
    assert.match(motivoESolucao('instabilidade').erro, /Robô/);
    // dado salvo vencido (export falhou) + Sponte fora: o site diz "fora do ar" em vez de mostrar dado antigo
    assert.match(motivoESolucao('instabilidade', 'cache_vencido').erro, /fora do ar/);
    assert.match(motivoESolucao('instabilidade', 'cache_vencido').solucao, /export/i);
    assert.match(motivoESolucao('timeout_navegador').motivo, /210 s/);
});

test('linhaPlanilhaErro formata data em SP e CPF', () => {
    const l = linhaPlanilhaErro({ quando: '2026-09-24T02:30:00.000Z', cpf: '06140707323', tela: 'CPF não encontrado', code: 'nao_encontrado' });
    assert.strictEqual(l['Data/hora'], '23/09/2026 23:30:00');
    assert.strictEqual(l['CPF'], '061.407.073-23');
    assert.strictEqual(l['Tela do erro'], 'CPF não encontrado');
    assert.strictEqual(l['Erro'], motivoESolucao('nao_encontrado').erro);
    assert.deepStrictEqual(Object.keys(l), ['Data/hora', 'CPF', 'Tela do erro', 'Erro', 'Motivo do erro', 'Possível solução']);
});

test('linhaPlanilhaErro com CPF vazio ou incompleto mantem o que veio', () => {
    assert.strictEqual(linhaPlanilhaErro({ quando: '2026-09-24T02:30:00.000Z', cpf: '123', tela: 'CPF inválido', code: 'cpf_invalido' })['CPF'], '123');
    assert.strictEqual(linhaPlanilhaErro({ quando: '2026-09-24T02:30:00.000Z', cpf: '', tela: 'x', code: 'x' })['CPF'], '');
});

test('classificarConsulta devolve valor_debito so das parcelas vencidas', () => {
    const r = { status: 'pagar_atrasados', alunos: [
        { status: 'pagar_atrasados', boletos: [{ valor: '100,00', linhaDigitavel: '1' }, { valor: '50,5000', linhaDigitavel: '2' }] },
        { status: 'em_dia', boletos: [{ valor: '999,00', linhaDigitavel: '3' }] }] };
    assert.strictEqual(classificarConsulta(r).valor_debito, 150.5);
    assert.strictEqual(classificarConsulta({ status: 'em_dia', alunos: [{ status: 'em_dia', boletos: [{ valor: '10,00' }] }] }).valor_debito, 0);
    assert.strictEqual(classificarConsulta({ status: 'pagar_atrasados', parcelas: [{ valor: '20,00', linhaDigitavel: 'x' }] }).valor_debito, 20);
    assert.strictEqual(classificarConsulta({ status: 'erro', code: 'nao_encontrado' }).valor_debito, 0);
});
