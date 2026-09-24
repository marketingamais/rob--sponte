const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('child_process');
const path = require('path');

const CLI = path.join(__dirname, '../../n8n/painel/gerar-codigo-no.js');
const gerar = (no) => execFileSync(process.execPath, [CLI, no], { encoding: 'utf8' });

for (const no of ['registrar-consulta', 'registrar-evento-front', 'montar-dashboard', 'painel-api', 'validar-copia', 'conferir-pagamento', 'filtrar-conferencias']) {
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

test('painel-api tem as acoes de padrao de KPIs e grava kpis no app_metadata', () => {
    const codigo = gerar('painel-api');
    assert.match(codigo, /kpis_padrao_ler/);
    assert.match(codigo, /kpis_padrao_salvar/);
    assert.match(codigo, /salvarConfig/);
    assert.match(codigo, /meta\.kpis|kpis: pedido\.kpis/);
    assert.match(codigo, /\$\('Webhook API'\)\.first\(\)\.json/);
});

test('conferir-pagamento: pareia por pairedItem, pula erro do Supabase, CPF ausente vira indeterminado', async () => {
    const codigo = gerar('conferir-pagamento');
    assert.ok(!/SUPABASE_SERVICE_KEY|httpRequest/.test(codigo));
    const L = (id, cpf) => ({ id, cpf, consulta_id: 'c' + id, modo: 'debito', num_parcela: '8', vencimento: '10/09/2026',
        linha: '00190000090312106800500162741177415950000017999', valor: 10, copiado_em: '2026-09-20T12:00:00.000Z', etapa: 1, proxima_conferencia: '2026-09-21T16:00:00.000Z' });
    const linhas = [L(1, '11111111111'), L(2, '22222222222'), L(3, '33333333333')];
    const cacheSemParcela = { cpf: '111.111.111-11', status_sponte: 'em_dia', data_atualizacao: '2026-09-21T06:00:00.000Z', proximo_boleto: '[]' };
    const saidasCache = [
        { json: cacheSemParcela, pairedItem: { item: 0 } },          // linha 1: parcela sumiu -> pago
        { json: { error: 'timeout' }, pairedItem: { item: 1 } }      // linha 2: erro -> pula
    ];                                                                // linha 3: sem saida -> indeterminado
    const $ = (no) => ({ all: () => no === 'Filtrar Vencidas' ? linhas.map(json => ({ json })) : saidasCache });
    const out = await new Function('$', `return (async () => { ${codigo} })()`)($);
    assert.deepStrictEqual(out.map(o => [o.json.id, o.json.final, o.json.registro && o.json.registro.resultado]), [[1, true, 'pago'], [3, true, 'indeterminado']]);
});

test('validar-copia le o cache do no Buscar Cache e o de existentes, sem chave no codigo', () => {
    const codigo = gerar('validar-copia');
    assert.match(codigo, /\$\('Buscar Cache'\)/);
    assert.match(codigo, /\$\('Buscar Existente'\)/);
    assert.ok(!/SUPABASE_SERVICE_KEY|httpRequest/.test(codigo));
});

test('painel-api: kpis null vira null explicito no app_metadata (usar o padrao)', () => {
    const codigo = gerar('painel-api');
    assert.match(codigo, /pedido\.kpis === null \? null/);
});

test('painel-api: 403 de kpis_padrao_* tem texto proprio', () => {
    const codigo = gerar('painel-api');
    assert.match(codigo, /Apenas o super administrador pode alterar o padrão de KPIs\./);
});
