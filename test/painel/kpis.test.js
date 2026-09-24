const test = require('node:test');
const assert = require('node:assert');
const K = require('../../n8n/painel/kpis.js');

const C = (quando, resultado, o = {}) => Object.assign({ quando, resultado, origem: 'cache', duracao_ms: 2000, consulta_id: '', valor_debito: 0 }, o);
const E = (tipo, consulta_id, o = {}) => Object.assign({ quando: '2026-09-23T15:00:00Z', tipo, consulta_id, modo: '', valor: 0 }, o);
const base = { de: '2026-09-22', ate: '2026-09-23', agora: new Date('2026-09-24T12:00:00Z') };

test('catalogo tem as 15 chaves e o padrao inicial', () => {
    assert.deepStrictEqual(K.KPIS.map(k => k.chave), ['consultas_total', 'consultas_em_dia', 'consultas_debito', 'encaminhamentos', 'comparativo_diario',
        'funil_debito', 'funil_amais', 'funil_antecipar', 'valor_recuperado', 'valor_antecipado', 'reducao_inadimplencia', 'tempo_humano',
        'erros_por_tela', 'origem_respostas', 'saude_sistema']);
    assert.deepStrictEqual(K.PADRAO_INICIAL, ['consultas_total', 'consultas_em_dia', 'consultas_debito', 'encaminhamentos', 'comparativo_diario',
        'funil_debito', 'funil_amais', 'funil_antecipar', 'erros_por_tela', 'origem_respostas', 'saude_sistema']);
});
test('volume sai direto do campo resultado', () => {
    const consultas = [C('2026-09-22T13:00:00Z', 'em_dia_boleto'), C('2026-09-22T14:00:00Z', 'em_dia_sem_boleto'), C('2026-09-23T13:00:00Z', 'debito'),
        C('2026-09-23T14:00:00Z', 'atrasado_sem_linha'), C('2026-09-23T15:00:00Z', 'encaminhamento'), C('2026-09-23T16:00:00Z', 'erro'), C('2026-09-20T13:00:00Z', 'debito')];
    const k = K.agregarKpis({ ...base, consultas, eventos: [], resultados: [], aConferir: [] });
    assert.deepStrictEqual([k.consultas_total.valor, k.consultas_em_dia.valor, k.consultas_debito.valor, k.encaminhamentos.valor], [6, 2, 2, 1]);
    assert.deepStrictEqual(k.comparativo_diario.dias, [
        { dia: '2026-09-22', total: 2, emDia: 2, debito: 0, encaminhamentos: 0 },
        { dia: '2026-09-23', total: 4, emDia: 0, debito: 2, encaminhamentos: 1 }]);
});
test('funis contam consulta_id distinto que agiu, limitado a base', () => {
    const consultas = [C('2026-09-23T13:00:00Z', 'debito', { consulta_id: 'a' }), C('2026-09-23T13:00:00Z', 'debito', { consulta_id: 'b' }),
        C('2026-09-23T13:00:00Z', 'encaminhamento', { consulta_id: 'c' }), C('2026-09-23T13:00:00Z', 'em_dia_boleto', { consulta_id: 'd' })];
    const eventos = [E('copiou_linha', 'a', { modo: 'debito' }), E('copiou_linha', 'a', { modo: 'debito' }), E('copiou_linha', 'zz', { modo: 'debito' }),
        E('clicou_amais', 'c'), E('clicou_antecipar', 'd'), E('copiou_linha', 'd', { modo: 'antecipacao' })];
    const k = K.agregarKpis({ ...base, consultas, eventos, resultados: [], aConferir: [] });
    assert.deepStrictEqual([k.funil_debito.base, k.funil_debito.agiram, k.funil_debito.taxa], [2, 1, 0.5]);
    assert.deepStrictEqual([k.funil_amais.base, k.funil_amais.agiram, k.funil_amais.taxa], [1, 1, 1]);
    assert.deepStrictEqual([k.funil_antecipar.base, k.funil_antecipar.agiram], [1, 1]);
    assert.deepStrictEqual(k.funil_debito.dias.find(d => d.dia === '2026-09-23'), { dia: '2026-09-23', base: 2, agiram: 1 });
});
test('financeiro: so pagos entram; em conferencia separado; inadimplencia com e sem base', () => {
    const consultas = [C('2026-09-23T13:00:00Z', 'debito', { valor_debito: 400 }), C('2026-09-23T14:00:00Z', 'debito', { valor_debito: 100 })];
    const resultados = [
        { copiado_em: '2026-09-23T13:10:00Z', modo: 'debito', valor: 150, resultado: 'pago' },
        { copiado_em: '2026-09-23T13:10:00Z', modo: 'debito', valor: 999, resultado: 'nao_pago' },
        { copiado_em: '2026-09-23T13:10:00Z', modo: 'antecipacao', valor: 80, resultado: 'pago' },
        { copiado_em: '2026-09-10T13:10:00Z', modo: 'debito', valor: 70, resultado: 'pago' }];
    const aConferir = [{ copiado_em: '2026-09-23T20:00:00Z', modo: 'debito', valor: 42 }];
    const k = K.agregarKpis({ ...base, consultas, eventos: [], resultados, aConferir });
    assert.deepStrictEqual(k.valor_recuperado, { valor: 150, qtdPagos: 1, emConferencia: 42, qtdEmConferencia: 1 });
    assert.deepStrictEqual(k.valor_antecipado, { valor: 80, qtdPagos: 1, emConferencia: 0, qtdEmConferencia: 0 });
    assert.deepStrictEqual(k.reducao_inadimplencia, { taxa: 0.3, recuperado: 150, baseDebito: 500 });
    const vazio = K.agregarKpis({ ...base, consultas: [], eventos: [], resultados: [], aConferir: [] });
    assert.strictEqual(vazio.reducao_inadimplencia.taxa, null);
    assert.strictEqual(vazio.funil_debito.taxa, null);
});
test('tempo humano: 2x o robo ao vivo; fallbacks 30 dias e 60 s', () => {
    const consultas = [C('2026-09-23T13:00:00Z', 'debito', { origem: 'ao_vivo', duracao_ms: 30000 }),
        C('2026-09-23T14:00:00Z', 'em_dia_boleto', { duracao_ms: 1000 }), C('2026-09-23T15:00:00Z', 'erro', { duracao_ms: 5000 })];
    const k = K.agregarKpis({ ...base, consultas, eventos: [], resultados: [], aConferir: [] }).tempo_humano;
    assert.strictEqual(k.tempoHumanoMs, 60000);
    assert.strictEqual(k.semHumano, 2);
    assert.strictEqual(k.horasEconomizadas, 2 * 60000 / 3600000);
    assert.strictEqual(k.tempoMedioSiteMs, 12000);
    assert.strictEqual(k.reducao, 1 - 12000 / 60000);
    assert.strictEqual(k.estimado, false);
    const hist = [C('2026-09-05T13:00:00Z', 'debito', { origem: 'ao_vivo', duracao_ms: 10000 }), C('2026-09-23T14:00:00Z', 'debito')];
    assert.strictEqual(K.agregarKpis({ ...base, consultas: hist, eventos: [], resultados: [], aConferir: [] }).tempo_humano.tempoHumanoMs, 20000);
    const sem = K.agregarKpis({ ...base, consultas: [C('2026-09-23T14:00:00Z', 'debito')], eventos: [], resultados: [], aConferir: [] }).tempo_humano;
    assert.deepStrictEqual([sem.tempoHumanoMs, sem.estimado], [120000, true]);
    const nada = K.agregarKpis({ ...base, consultas: [], eventos: [], resultados: [], aConferir: [] }).tempo_humano;
    assert.deepStrictEqual([nada.horasEconomizadas, nada.reducao, nada.tempoMedioSiteMs], [0, null, null]);
});
test('permissoes: super admin tudo; membro lista propria filtrada; senao padrao', () => {
    const todas = K.KPIS.map(k => k.chave);
    assert.deepStrictEqual(K.kpisPermitidos({ papel: 'super_admin', kpis: ['consultas_total'] }), todas);
    assert.deepStrictEqual(K.kpisPermitidos({ papel: 'membro', kpis: ['consultas_total', 'nao_existe', 'consultas_total'] }), ['consultas_total']);
    assert.deepStrictEqual(K.kpisPermitidos({ papel: 'membro' }, ['valor_recuperado']), ['valor_recuperado']);
    assert.deepStrictEqual(K.kpisPermitidos({ papel: 'membro' }, 'lixo'), K.PADRAO_INICIAL);
    assert.deepStrictEqual(K.kpisPermitidos({ papel: 'membro', kpis: [] }), []);
});
test('validarListaKpis e filtrarKpis', () => {
    assert.strictEqual(K.validarListaKpis(['consultas_total', 'tempo_humano']), true);
    for (const v of [null, 'consultas_total', ['x'], ['consultas_total', 'consultas_total'], [1]]) assert.strictEqual(K.validarListaKpis(v), false);
    assert.deepStrictEqual(K.filtrarKpis({ consultas_total: { valor: 1 }, valor_recuperado: { valor: 9 } }, ['consultas_total']), { consultas_total: { valor: 1 } });
});
