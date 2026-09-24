const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('child_process');
const path = require('path');

const CLI = path.join(__dirname, '../../n8n/painel/gerar-codigo-no.js');
const gerar = (no) => execFileSync(process.execPath, [CLI, no], { encoding: 'utf8' });

for (const no of ['registrar-consulta', 'registrar-evento-front', 'montar-dashboard', 'painel-api', 'validar-copia']) {
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

test('painel-api: usuarios_criar nao reaproveita conta de Auth existente (sem-fallback-takeover)', () => {
    const codigo = gerar('painel-api');
    assert.ok(!/reaproveita/.test(codigo), 'nao pode reaproveitar conta existente do Auth');
    assert.match(codigo, /Já existe uma conta de login com esse e-mail/);
});

test('registrar-consulta grava consulta_id e valor_debito', () => {
    const codigo = gerar('registrar-consulta');
    assert.match(codigo, /consulta_id/);
    assert.match(codigo, /valor_debito: c\.valor_debito/);
    assert.match(codigo, /function paraNumero/);
});

test('registrar-evento-front roteia evento novo, erro antigo e ignorado', () => {
    const codigo = gerar('registrar-evento-front');
    const fn = new Function('$json', `return (async () => { ${codigo} })()`);
    const ID = '3f2b8c1e-9a4d-4c2b-8f1a-2b3c4d5e6f70';
    return Promise.all([
        fn({ body: { tipo: 'clicou_amais', consulta_id: ID } }).then(r => assert.strictEqual(r[0].json.rota, 'evento')),
        fn({ body: { code: 'cpf_invalido', cpf: '123' } }).then(r => assert.strictEqual(r[0].json.rota, 'erro')),
        fn({ body: { tipo: 'clicou_amais', consulta_id: 'x' } }).then(r => assert.strictEqual(r[0].json.rota, 'ignorar'))
    ]);
});

test('montar-dashboard filtra KPIs pelo usuario', () => {
    const codigo = gerar('montar-dashboard');
    assert.match(codigo, /filtrarKpis\(/);
    assert.match(codigo, /kpisPermitidos\(/);
    assert.match(codigo, /__SUPABASE_SERVICE_KEY__/);
    assert.match(codigo, /dashboard: pedido\.usuario && pedido\.usuario\.papel === 'super_admin' \? d : undefined/);
});
