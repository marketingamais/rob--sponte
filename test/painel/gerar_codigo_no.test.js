const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('child_process');
const path = require('path');

const CLI = path.join(__dirname, '../../n8n/painel/gerar-codigo-no.js');
const gerar = (no) => execFileSync(process.execPath, [CLI, no], { encoding: 'utf8' });

for (const no of ['registrar-consulta', 'registrar-evento-front', 'montar-dashboard', 'painel-api']) {
    test(`gera codigo executavel para ${no}`, () => {
        const codigo = gerar(no);
        assert.ok(!/module\.exports/.test(codigo), 'nao pode ter module.exports');
        assert.ok(!/require\(/.test(codigo), 'nao pode ter require');
        // compila como corpo de funcao async (como o no Code do n8n)
        assert.doesNotThrow(() => new Function('$input', '$', '$json', 'DateTime', `return (async () => { ${codigo} })`));
    });
}

test('no desconhecido falha', () => {
    assert.throws(() => gerar('nao-existe'));
});
