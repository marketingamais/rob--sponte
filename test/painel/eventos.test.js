const test = require('node:test');
const assert = require('node:assert');
const { normalizarEvento, validarCopia } = require('../../n8n/painel/eventos.js');

const ID = '3f2b8c1e-9a4d-4c2b-8f1a-2b3c4d5e6f70';
const AGORA = '2026-09-24T12:00:00.000Z';
const LINHA = '00190000090312106800500162741177415950000017999';
const copia = (o = {}) => Object.assign({ tipo: 'copiou_linha', consulta_id: ID, cpf: '061.407.073-23', modo: 'debito', num_parcela: '8', vencimento: '10/09/2026', valor: '179,9900', linha: LINHA }, o);

test('copiou_linha valido gera log sem CPF e conferencia com CPF', () => {
    const r = normalizarEvento(copia(), AGORA);
    assert.strictEqual(r.tipo, 'copiou_linha');
    assert.deepStrictEqual(r.log, { quando: AGORA, tipo: 'copiou_linha', consulta_id: ID, modo: 'debito', valor: 179.99, chave: `copiou_linha|${ID}|8|10/09/2026` });
    assert.ok(!JSON.stringify(r.log).includes('06140707323'));
    assert.deepStrictEqual(r.conferencia, { consulta_id: ID, cpf: '06140707323', modo: 'debito', num_parcela: '8', vencimento: '10/09/2026',
        linha: LINHA, valor: 179.99, copiado_em: AGORA, etapa: 1, proxima_conferencia: '2026-09-25T16:00:00.000Z' });
});
test('modo so aceita debito|antecipacao', () => {
    assert.strictEqual(normalizarEvento(copia({ modo: 'antecipacao' }), AGORA).log.modo, 'antecipacao');
    assert.strictEqual(normalizarEvento(copia({ modo: '<script>' }), AGORA).log.modo, 'debito');
});
test('clicou_amais e clicou_antecipar: sem conferencia, chave por consulta', () => {
    const a = normalizarEvento({ tipo: 'clicou_amais', consulta_id: ID }, AGORA);
    assert.deepStrictEqual(a.log, { quando: AGORA, tipo: 'clicou_amais', consulta_id: ID, modo: '', valor: 0, chave: `clicou_amais|${ID}||` });
    assert.strictEqual(a.conferencia, null);
    assert.strictEqual(normalizarEvento({ tipo: 'clicou_antecipar', consulta_id: ID }, AGORA).log.modo, 'antecipacao');
});
test('ignora evento invalido ou forjado', () => {
    for (const [b, motivo] of [
        [{ tipo: 'clicou_amais', consulta_id: 'nao-uuid' }, 'consulta_id'],
        [{ tipo: 'hack', consulta_id: ID }, 'tipo'],
        [copia({ cpf: '123' }), 'cpf'],
        [copia({ linha: '123' }), 'linha'],
        [copia({ vencimento: '2026-09-10' }), 'vencimento'],
        [copia({ num_parcela: '' }), 'parcela'],
        [null, 'tipo']]) {
        const r = normalizarEvento(b, AGORA);
        assert.deepStrictEqual(r, { ignorar: true, motivo }, JSON.stringify(b));
    }
});
test('validarCopia exige consulta recente e parcela em aberto no cache', () => {
    const conf = normalizarEvento(copia(), AGORA).conferencia;
    const consulta = { consulta_id: ID, quando: '2026-09-24T11:30:00.000Z' };
    const cacheRow = { status_sponte: 'pagar_atrasados', proximo_boleto: JSON.stringify({ alunos: [{ status: 'pagar_atrasados', boletos: [{ numParcela: '8', dataVencimento: '10/09/2026', linhaDigitavel: LINHA }] }] }) };
    assert.deepStrictEqual(validarCopia({ consulta, cacheRow, conferencia: conf, agoraIso: AGORA }), { ok: true, motivo: '' });
    assert.strictEqual(validarCopia({ consulta: null, cacheRow, conferencia: conf, agoraIso: AGORA }).motivo, 'consulta_inexistente');
    assert.strictEqual(validarCopia({ consulta: { consulta_id: ID, quando: '2026-09-24T09:00:00.000Z' }, cacheRow, conferencia: conf, agoraIso: AGORA }).motivo, 'consulta_antiga');
    assert.strictEqual(validarCopia({ consulta, cacheRow: null, conferencia: conf, agoraIso: AGORA }).motivo, 'sem_cache');
    assert.strictEqual(validarCopia({ consulta, cacheRow: { proximo_boleto: '[]' }, conferencia: conf, agoraIso: AGORA }).motivo, 'parcela_nao_encontrada');
});
