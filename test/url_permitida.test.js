const test = require('node:test');
const assert = require('node:assert');
const { urlPermitida } = require('../export_sponte.js');

test('urlPermitida aceita URL com o prefixo correto do webhook n8n', () => {
    assert.strictEqual(urlPermitida('https://n8n.amais.io/webhook/x'), true);
});

test('urlPermitida rejeita URLs fora do prefixo, dominios parecidos e valores invalidos', () => {
    assert.strictEqual(urlPermitida('http://n8n.amais.io/webhook/x'), false);
    assert.strictEqual(urlPermitida('https://n8n.amais.io.evil.com/webhook/x'), false);
    assert.strictEqual(urlPermitida('https://evil.com/?https://n8n.amais.io/webhook/'), false);
    assert.strictEqual(urlPermitida(undefined), false);
    assert.strictEqual(urlPermitida(''), false);
});
