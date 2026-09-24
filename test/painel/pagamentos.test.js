const test = require('node:test');
const assert = require('node:assert');
const P = require('../../n8n/painel/pagamentos.js');

const COPIA = '2026-09-24T12:00:00.000Z';
const L = (o = {}) => Object.assign({ consulta_id: 'c1', cpf: '06140707323', modo: 'debito', num_parcela: '8', vencimento: '10/09/2026',
    linha: '00190000090312106800500162741177415950000017999', valor: 179.99, copiado_em: COPIA, etapa: 1 }, o);
const bol = (o = {}) => Object.assign({ numParcela: '8', dataVencimento: '10/09/2026', linhaDigitavel: '00190000090312106800500162741177415950000017999', valor: '179,9900' }, o);
const cache = (status, boletos, atualizado = '2026-09-25T06:10:00.000Z') =>
    ({ status_sponte: status, data_atualizacao: atualizado, proximo_boleto: JSON.stringify({ alunos: [{ nomeAluno: 'A', status, boletos }] }) });

test('proximaConferencia: 28h, 48h, 72h depois da copia', () => {
    assert.strictEqual(P.proximaConferencia(COPIA, 1), '2026-09-25T16:00:00.000Z');
    assert.strictEqual(P.proximaConferencia(COPIA, 2), '2026-09-26T12:00:00.000Z');
    assert.strictEqual(P.proximaConferencia(COPIA, 3), '2026-09-27T12:00:00.000Z');
});
test('parcelasEmAberto le alunos[] e formato legado', () => {
    assert.strictEqual(P.parcelasEmAberto(cache('pagar_atrasados', [bol(), bol({ numParcela: '9' })])).length, 2);
    assert.strictEqual(P.parcelasEmAberto({ proximo_boleto: [bol()] }).length, 1);
    assert.strictEqual(P.parcelasEmAberto({ proximo_boleto: JSON.stringify(bol()) }).length, 1);
    assert.deepStrictEqual(P.parcelasEmAberto({ proximo_boleto: null }), []);
    assert.deepStrictEqual(P.parcelasEmAberto({ proximo_boleto: '{quebrado' }), []);
});
test('mesmaParcela casa por linha (so digitos) ou por parcela+vencimento', () => {
    assert.ok(P.mesmaParcela(bol({ numParcela: 'x' }), L()));                                   // mesma linha
    assert.ok(P.mesmaParcela(bol({ linhaDigitavel: '0019 0000' }), L()));                       // mesma parcela+vencimento
    assert.ok(!P.mesmaParcela(bol({ linhaDigitavel: 'outra', numParcela: '9' }), L()));         // nada casa
});
test('parcela sumiu do cache atualizado: pago', () => {
    const d = P.decidirConferencia(L(), cache('pagar_atrasados', [bol({ numParcela: '9', linhaDigitavel: 'z' })]), '2026-09-25T16:05:00.000Z');
    assert.strictEqual(d.final, true);
    assert.strictEqual(d.resultado, 'pago');
    assert.deepStrictEqual(d.registro, { consulta_id: 'c1', modo: 'debito', valor: 179.99, copiado_em: COPIA, resultado: 'pago', confirmado_em: '2026-09-25T16:05:00.000Z', etapa: 1 });
    assert.ok(!('cpf' in d.registro));
});
test('parcela ainda em aberto: vai para a proxima etapa; na 3a vira nao_pago', () => {
    const d1 = P.decidirConferencia(L(), cache('pagar_atrasados', [bol()]), '2026-09-25T16:05:00.000Z');
    assert.deepStrictEqual(d1, { final: false, etapa: 2, proxima_conferencia: '2026-09-26T12:00:00.000Z' });
    const d3 = P.decidirConferencia(L({ etapa: 3 }), cache('pagar_atrasados', [bol()], '2026-09-27T06:10:00.000Z'), '2026-09-27T12:05:00.000Z');
    assert.strictEqual(d3.resultado, 'nao_pago');
});
test('cache nao atualizado depois da copia: nao conta a etapa; na 3a vira indeterminado', () => {
    const velho = cache('pagar_atrasados', [], '2026-09-24T06:00:00.000Z');
    assert.deepStrictEqual(P.decidirConferencia(L(), velho, '2026-09-25T16:05:00.000Z'), { final: false, etapa: 2, proxima_conferencia: '2026-09-26T12:00:00.000Z' });
    assert.strictEqual(P.decidirConferencia(L({ etapa: 3 }), velho, '2026-09-27T12:05:00.000Z').resultado, 'indeterminado');
});
test('negociar nao conta como pago (cache sem boletos)', () => {
    const d = P.decidirConferencia(L(), cache('negociar', []), '2026-09-25T16:05:00.000Z');
    assert.deepStrictEqual(d, { final: false, etapa: 2, proxima_conferencia: '2026-09-26T12:00:00.000Z' });
    assert.strictEqual(P.decidirConferencia(L({ etapa: 3 }), cache('negociar', []), '2026-09-27T12:05:00.000Z').resultado, 'nao_pago');
});
test('CPF fora do cache: indeterminado', () => {
    assert.strictEqual(P.decidirConferencia(L(), null, '2026-09-25T16:05:00.000Z').resultado, 'indeterminado');
});
test('antecipacao: pagou a proxima mensalidade quando ela troca no cache em_dia', () => {
    const d = P.decidirConferencia(L({ modo: 'antecipacao' }), cache('em_dia', [bol({ numParcela: '9', dataVencimento: '10/10/2026', linhaDigitavel: 'nova' })]), '2026-09-25T16:05:00.000Z');
    assert.strictEqual(d.resultado, 'pago');
    assert.strictEqual(d.registro.modo, 'antecipacao');
});
