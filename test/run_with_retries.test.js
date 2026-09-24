const test = require('node:test');
const assert = require('node:assert');
const { runWithRetries } = require('../export_sponte.js');

// Dependências falsas: sem Puppeteer, sem rede, sem espera real
function deps(resultados) {
    const chamadas = { exportar: 0, erros: [] };
    return {
        chamadas,
        d: {
            exportar: async () => {
                const r = resultados[chamadas.exportar++];
                if (r instanceof Error) throw r;
                return r;
            },
            notificarErro: async (url, e) => { chamadas.erros.push({ url, msg: String(e) }); },
            esperar: async () => {}
        }
    };
}

test('falha na 1a tentativa e sucesso na 2a: nao avisa erro ao n8n', async () => {
    const { chamadas, d } = deps([new Error("Attempted to use detached Frame 'X'"), { success: true }]);
    await runWithRetries('https://n8n.amais.io/webhook/a', null, d);
    assert.strictEqual(chamadas.exportar, 2);
    assert.deepStrictEqual(chamadas.erros, []);
});

test('3 falhas: avisa o erro uma unica vez, com a ultima mensagem', async () => {
    const { chamadas, d } = deps([new Error('e1'), new Error('e2'), new Error('e3')]);
    await runWithRetries('https://n8n.amais.io/webhook/a', null, d);
    assert.strictEqual(chamadas.exportar, 3);
    assert.strictEqual(chamadas.erros.length, 1);
    assert.match(chamadas.erros[0].msg, /e3/);
    assert.strictEqual(chamadas.erros[0].url, 'https://n8n.amais.io/webhook/a');
});

test('erro nao-reexportavel: para na hora e avisa uma vez', async () => {
    const e = new Error('lote rejeitado'); e.naoReexportar = true;
    const { chamadas, d } = deps([e]);
    await runWithRetries('https://n8n.amais.io/webhook/a', null, d);
    assert.strictEqual(chamadas.exportar, 1);
    assert.strictEqual(chamadas.erros.length, 1);
});
