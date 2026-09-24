const test = require('node:test');
const assert = require('node:assert');
const { agregarDashboard, avaliarSaude } = require('../../n8n/painel/dashboard.js');

const L = (quando, resultado, tela = 'x', origem = 'cache', duracao_ms = 1000) => ({ quando, resultado, tela, code: '', origem, duracao_ms });
const AGORA = new Date('2026-09-23T15:00:00Z');

test('periodo vazio: taxas null, dias com zero - Review Focus 2', () => {
    const d = agregarDashboard([], '2026-09-21', '2026-09-23', AGORA);
    assert.strictEqual(d.total, 0);
    assert.strictEqual(d.taxaResolucao, null);
    assert.strictEqual(d.taxaErros, null);
    assert.strictEqual(d.tempoMedioMs, null);
    assert.deepStrictEqual(d.porDia, [
        { dia: '2026-09-21', resolvidas: 0, erros: 0 },
        { dia: '2026-09-22', resolvidas: 0, erros: 0 },
        { dia: '2026-09-23', resolvidas: 0, erros: 0 }]);
    assert.deepStrictEqual(d.errosPorTela, []);
});

test('contagens, taxas, erros por tela e dia de SP - Review Focus 3', () => {
    const linhas = [
        L('2026-09-22T12:00:00Z', 'debito'),
        L('2026-09-22T13:00:00Z', 'encaminhamento'),
        L('2026-09-22T14:00:00Z', 'em_dia_boleto'),
        L('2026-09-22T15:00:00Z', 'em_dia_sem_boleto'),
        L('2026-09-22T16:00:00Z', 'atrasado_sem_linha'),
        L('2026-09-23T02:30:00Z', 'erro', 'CPF não encontrado', 'sem_dados', 3000), // 22/09 23:30 em SP
        L('2026-09-23T12:00:00Z', 'erro', 'Sistema instável', 'sem_dados', 5000),
        L('2026-09-23T13:00:00Z', 'erro', 'CPF não encontrado', 'sem_dados', 1000),
        L('2026-09-20T12:00:00Z', 'debito') // fora do periodo
    ];
    const d = agregarDashboard(linhas, '2026-09-22', '2026-09-23', AGORA);
    assert.strictEqual(d.total, 8);
    assert.strictEqual(d.debito, 1);
    assert.strictEqual(d.encaminhamento, 1);
    assert.strictEqual(d.emDiaBoleto, 1);
    assert.strictEqual(d.emDiaSemBoleto, 1);
    assert.strictEqual(d.atrasadoSemLinha, 1);
    assert.strictEqual(d.erros, 3);
    assert.strictEqual(d.taxaResolucao, 5 / 8);
    assert.strictEqual(d.taxaErros, 3 / 8);
    assert.deepStrictEqual(d.errosPorTela, [
        { tela: 'CPF não encontrado', qtd: 2, pct: 2 / 3 },
        { tela: 'Sistema instável', qtd: 1, pct: 1 / 3 }]);
    assert.deepStrictEqual(d.porDia, [
        { dia: '2026-09-22', resolvidas: 5, erros: 1 },
        { dia: '2026-09-23', resolvidas: 0, erros: 2 }]);
    assert.strictEqual(d.tempoMedioMs, 1750);
    assert.deepStrictEqual(d.porOrigem, { cache: 5, sem_dados: 3 });
});

test('erros24h usa as ultimas 24h a partir de agora, independente do periodo', () => {
    const linhas = [L('2026-09-23T14:00:00Z', 'erro', 'Sistema instável'), L('2026-09-23T10:00:00Z', 'debito'), L('2026-09-21T10:00:00Z', 'erro')];
    const d = agregarDashboard(linhas, '2026-09-01', '2026-09-01', AGORA);
    assert.deepStrictEqual(d.erros24h, { total: 2, erros: 1 });
});

test('avaliarSaude: niveis', () => {
    const ok = avaliarSaude({ robo: { ok: true, ms: 800, commit: 'abc1234def' }, ultimaIngestao: { quando: '2026-09-23T06:10:00Z', status: 'ok', cpfs: 1981, filtro: true },
        cacheAtualizadoEm: '2026-09-23T06:10:00Z', erros24h: { total: 100, erros: 5 } }, AGORA);
    assert.deepStrictEqual(ok.map(i => i.nivel), ['verde', 'verde', 'verde', 'verde']);
    assert.deepStrictEqual(ok.map(i => i.item), ['Robô', 'Último export', 'Idade do cache', 'Erros nas últimas 24h']);
    const ruim = avaliarSaude({ robo: { ok: true, ms: 30000, commit: 'x' }, ultimaIngestao: { quando: '2026-09-23T06:10:00Z', status: 'rejeitado', cpfs: 3, filtro: false },
        cacheAtualizadoEm: '2026-09-20T06:10:00Z', erros24h: { total: 10, erros: 2 } }, AGORA);
    assert.deepStrictEqual(ruim.map(i => i.nivel), ['amarelo', 'vermelho', 'vermelho', 'amarelo']);
    const pior = avaliarSaude({ robo: { ok: false }, ultimaIngestao: null, cacheAtualizadoEm: null, erros24h: { total: 4, erros: 2 } }, AGORA);
    assert.deepStrictEqual(pior.map(i => i.nivel), ['vermelho', 'vermelho', 'vermelho', 'vermelho']);
    const semConsulta = avaliarSaude({ robo: { ok: true, ms: 1 }, ultimaIngestao: null, cacheAtualizadoEm: null, erros24h: { total: 0, erros: 0 } }, AGORA);
    assert.strictEqual(semConsulta[3].nivel, 'verde');
});
