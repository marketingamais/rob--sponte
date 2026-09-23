const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { enviarResultados } = require('../export_sponte.js');

const linhasFake = () => [
    { Sacado: 'A', NomeResponsavel: 'R', CPFResponsavel: '111.444.777-35', Situacao: 'Pendente', DataVencimento: '10/10/2026 00:00:00', Valor: '179,9900', NumeroBoleto: '1', NumeroParcela: '1' },
    { Sacado: 'B', NomeResponsavel: 'R', CPFResponsavel: '222.333.444-05', Situacao: 'Quitada', DataVencimento: '10/08/2026 00:00:00', Valor: '179,9900', NumeroBoleto: '2', NumeroParcela: '1' }
];

function arquivoTemp() {
    const f = path.join(os.tmpdir(), `rel-${process.pid}-${Date.now()}.xls`);
    fs.writeFileSync(f, 'conteudo');
    return f;
}

test('envia o lote de cache ANTES do arquivo, com metadados', async () => {
    const chamadas = [];
    const post = async (url, body) => { chamadas.push({ url, body }); return { status: 200 }; };
    const agora = new Date('2026-09-23T06:05:00Z');
    const f = arquivoTemp();
    const r = await enviarResultados(f, { webhookUrl: 'http://n8n/arquivo', cacheWebhookUrl: 'http://n8n/cache' },
        { post, lerPlanilha: linhasFake, agora: () => agora, meta: { filtroSituacaoAplicado: true } });
    fs.unlinkSync(f);
    assert.deepStrictEqual(chamadas.map(c => c.url), ['http://n8n/cache', 'http://n8n/arquivo']);
    const b = chamadas[0].body;
    assert.strictEqual(b.geradoEm, agora.toISOString());
    assert.strictEqual(b.totalLinhas, 2);
    assert.strictEqual(b.totalPendentes, 1);
    assert.strictEqual(b.filtroSituacaoAplicado, true);
    assert.strictEqual(b.payload.length, 1);
    assert.strictEqual(b.payload[0].cpf, '111.444.777-35');
    assert.deepStrictEqual(r, { totalLinhas: 2, totalPendentes: 1, cpfs: 1 });
});

test('falha no envio do cache (erro de rede) esgota as 3 tentativas e NAO envia o arquivo', async () => {
    const urls = [];
    const post = async (url) => { urls.push(url); if (url.includes('cache')) throw new Error('network fail'); };
    const esperas = [];
    const esperar = async (ms) => { esperas.push(ms); };
    const f = arquivoTemp();
    await assert.rejects(
        enviarResultados(f, { webhookUrl: 'http://n8n/arquivo', cacheWebhookUrl: 'http://n8n/cache' },
            { post, lerPlanilha: linhasFake, esperar }),
        (err) => { assert.strictEqual(err.naoReexportar, true); return true; }
    );
    fs.unlinkSync(f);
    assert.deepStrictEqual(urls, ['http://n8n/cache', 'http://n8n/cache', 'http://n8n/cache']);
    assert.deepStrictEqual(esperas, [10000, 10000]);
});

test('sem cacheWebhookUrl envia so o arquivo', async () => {
    const urls = [];
    const post = async (url) => { urls.push(url); };
    const f = arquivoTemp();
    await enviarResultados(f, { webhookUrl: 'http://n8n/arquivo' }, { post, lerPlanilha: linhasFake });
    fs.unlinkSync(f);
    assert.deepStrictEqual(urls, ['http://n8n/arquivo']);
});

test('cache falha 2x com erro de rede e depois funciona (retry), depois envia arquivo', async () => {
    const chamadas = [];
    let tentativasCache = 0;
    const post = async (url) => {
        chamadas.push(url);
        if (url.includes('cache')) {
            tentativasCache++;
            if (tentativasCache < 3) throw new Error('network fail');
            return { status: 200 };
        }
        return { status: 200 };
    };
    const esperas = [];
    const esperar = async (ms) => { esperas.push(ms); };
    const f = arquivoTemp();
    const r = await enviarResultados(f, { webhookUrl: 'http://n8n/arquivo', cacheWebhookUrl: 'http://n8n/cache' },
        { post, lerPlanilha: linhasFake, esperar });
    fs.unlinkSync(f);
    assert.deepStrictEqual(chamadas, ['http://n8n/cache', 'http://n8n/cache', 'http://n8n/cache', 'http://n8n/arquivo']);
    assert.deepStrictEqual(esperas, [10000, 10000]);
    assert.strictEqual(r.totalLinhas, 2);
});

test('cache retorna 500 com "Lote rejeitado" no corpo -> nao reexporta, 1 tentativa so', async () => {
    const chamadas = [];
    const post = async (url) => {
        chamadas.push(url);
        const e = new Error('Request failed with status code 500');
        e.response = { status: 500, data: { message: 'Lote rejeitado: dados invalidos' } };
        throw e;
    };
    const esperas = [];
    const esperar = async (ms) => { esperas.push(ms); };
    const f = arquivoTemp();
    await assert.rejects(
        enviarResultados(f, { webhookUrl: 'http://n8n/arquivo', cacheWebhookUrl: 'http://n8n/cache' },
            { post, lerPlanilha: linhasFake, esperar }),
        (err) => { assert.strictEqual(err.naoReexportar, true); return true; }
    );
    fs.unlinkSync(f);
    assert.deepStrictEqual(chamadas, ['http://n8n/cache']);
    assert.deepStrictEqual(esperas, []);
});

test('falha ao enviar o arquivo (Drive) nao e fatal - resolve mesmo assim', async () => {
    const chamadas = [];
    const post = async (url) => {
        chamadas.push(url);
        if (url.includes('arquivo')) throw new Error('drive down');
        return { status: 200 };
    };
    const f = arquivoTemp();
    const r = await enviarResultados(f, { webhookUrl: 'http://n8n/arquivo', cacheWebhookUrl: 'http://n8n/cache' },
        { post, lerPlanilha: linhasFake });
    fs.unlinkSync(f);
    assert.deepStrictEqual(chamadas, ['http://n8n/cache', 'http://n8n/arquivo']);
    assert.strictEqual(r.totalLinhas, 2);
});
