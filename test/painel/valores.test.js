const test = require('node:test');
const assert = require('node:assert');
const { paraNumero, somaValores } = require('../../n8n/painel/valores.js');

test('paraNumero aceita formatos pt-BR e nunca devolve NaN', () => {
    assert.strictEqual(paraNumero('179,9900'), 179.99);
    assert.strictEqual(paraNumero('1.234,56'), 1234.56);
    assert.strictEqual(paraNumero('R$ 10,00'), 10);
    assert.strictEqual(paraNumero(42.5), 42.5);
    for (const v of ['', null, undefined, 'abc', NaN, Infinity, {}]) assert.strictEqual(paraNumero(v), 0, String(v));
});
test('somaValores soma com 2 casas', () => {
    assert.strictEqual(somaValores([{ valor: '179,9900' }, { valor: '0,01' }, {}, null]), 180);
    assert.strictEqual(somaValores(undefined), 0);
});
