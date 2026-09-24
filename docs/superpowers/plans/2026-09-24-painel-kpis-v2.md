# Painel admin v2 (KPIs, pagamentos, permissões, visual): plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** registrar as ações das famílias no site, confirmar pagamentos em 28/48/72 h, calcular os KPIs novos com permissão por usuário e redesenhar o painel.

**Architecture:** a regra de negócio fica em módulos puros e testados em `n8n/painel/*.js`, no repo do robô. O jsCode dos nós do n8n é gerado por `node n8n/painel/gerar-codigo-no.js <no>`. Os dados ficam em Data Tables do n8n. O cache de parcelas vem do Supabase `alunos_cache`. O site e o painel são estáticos (repo `rob-sponte-2`, Vercel), em HTML/CSS/JS puro com gráficos em SVG próprio.

**Tech Stack:** Node 25 (`node --test`), n8n (MCP `n8n-mcp`), Supabase REST, HTML/CSS/JS sem build, Tabler Icons webfont 3.48.0.

**Spec:** `docs/superpowers/specs/2026-09-24-painel-kpis-v2-design.md`

## Global Constraints

- Repos públicos. Nunca gravar em arquivo versionado, relatório ou mensagem: a service key do Supabase, o sufixo do webhook de cache, senhas ou tokens. Os placeholders `__SUPABASE_SERVICE_KEY__` e `__PLANILHA_URL__` só são trocados no payload do MCP.
- Git: nunca usar `git add -A` ou `git add .`. Adicionar arquivos pelo nome. Trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Push: `git -c credential.https://github.com.helper= -c credential.https://github.com.helper=manager -c credential.interactive=never push origin main`. Se pedir login, parar e pedir ao usuário.
- n8n: `update_workflow` edita só o rascunho, então é preciso `publish_workflow`. Antes de mexer no PROD `W7tTXjTNvvO62wYO`, salvar backup em `backups/` e anotar o `activeVersionId` para reverter.
- Módulos em `n8n/painel/` não usam `require` no código colado. Uma dependência entre módulos só pode aparecer em linhas terminadas com `// @no-n8n`, que o gerador remove.
- O CPF só pode existir em `cia_pagamentos_a_conferir` e na planilha de erros. Nenhuma outra tabela, log ou resposta do dashboard leva CPF.
- A resposta de `buscar-boletos-novo` ao site não pode mudar (mesmo contrato).
- Visual: paleta CIA (`#23316E` como principal), light mode, ícones Tabler (`ti ti-*`, webfont 3.48.0), sem React e sem Tailwind.
- Etapas da conferência: 28 h, 48 h e 72 h depois de `copiado_em`.
- Chaves do catálogo de KPIs, exatamente estas: `consultas_total`, `consultas_em_dia`, `consultas_debito`, `encaminhamentos`, `comparativo_diario`, `funil_debito`, `funil_amais`, `funil_antecipar`, `valor_recuperado`, `valor_antecipado`, `reducao_inadimplencia`, `tempo_humano`, `erros_por_tela`, `origem_respostas`, `saude_sistema`.
- Padrão inicial de KPIs para membros: grupos Volume, Conversão e Operação.
- Testes: `npm test` no robô, que roda `node --test test/**/*.test.js`, e `node --test frontend/painel-f8ed7ba4777f/formatos.test.js` no site.

## Review Focus

1. **Família em "negociar" no cache:** o cache não lista os boletos, então a parcela "some". Isso não pode contar como pago. Teste: Task 2, `negociar nao conta como pago`.
2. **Mesmo clique enviado várias vezes, ou evento forjado:** `consulta_id` inválido, CPF inválido, linha curta ou `consulta_id` inexistente têm que ser ignorados, e a deduplicação usa uma chave estável. Testes: Task 3.
3. **Valores em formatos variados:** `"1.234,56"`, `"179,9900"`, `""`, `null`, `"R$ 10,00"`. Nunca pode sair NaN. Teste: Task 1.
4. **Período sem base:** nenhuma consulta com débito ou nenhuma consulta ao vivo tem que resultar em `null` ou `estimado: true`, nunca NaN ou Infinity. Testes: Task 4.
5. **Lista de KPIs de um membro** com chave inexistente, duplicada ou não-array: é filtrada ou rejeitada, e a resposta do dashboard nunca inclui chave não permitida. Testes: Tasks 4 e 5.

---

## File Structure

**Repo do robô (`D:\VIBE CODDING\CLAUDE CODE\BOLETO CIA - Copia`)**

| Arquivo | Responsabilidade |
|---|---|
| `n8n/painel/valores.js` (novo) | `paraNumero`, `somaValores` |
| `n8n/painel/pagamentos.js` (novo) | `parcelasEmAberto`, `mesmaParcela`, `proximaConferencia`, `decidirConferencia` |
| `n8n/painel/eventos.js` (novo) | `normalizarEvento`, `validarCopia` |
| `n8n/painel/kpis.js` (novo) | `KPIS`, `PADRAO_INICIAL`, `validarListaKpis`, `kpisPermitidos`, `agregarKpis`, `filtrarKpis` |
| `n8n/painel/consulta_log.js` | passa a devolver `valor_debito` |
| `n8n/painel/dashboard.js` | exporta `diaSP` e `diasEntre` |
| `n8n/painel/usuarios.js` | `kpis` no usuário e validação |
| `n8n/painel/painel_api_corpo.js` | ações novas e `kpis` |
| `n8n/painel/gerar-codigo-no.js` | remove linhas `@no-n8n`; nós novos |
| `test/painel/*.test.js` | um arquivo de teste por módulo |

**Repo do site (`D:\VIBE CODDING\CLAUDE CODE\rob-sponte-2`)**

| Arquivo | Responsabilidade |
|---|---|
| `frontend/script.js` | `consulta_id` e os eventos novos |
| `frontend/painel-f8ed7ba4777f/formatos.js` (+ teste) | `formatarMoeda`, `formatarHoras` |
| `frontend/painel-f8ed7ba4777f/graficos.js` | `areas()`, `barrasPar()` |
| `frontend/painel-f8ed7ba4777f/index.html`, `painel.css`, `painel.js` | layout v2 e tela de permissões |

---

### Task 1: `valores.js`, `valor_debito` no log e o gerador aceitando `@no-n8n`

**Files:**
- Create: `n8n/painel/valores.js`, `test/painel/valores.test.js`
- Modify: `n8n/painel/consulta_log.js` (função `classificarConsulta`), `n8n/painel/gerar-codigo-no.js` (função `mod`, `ADAPTADORES`, corpo `registrar-consulta`), `test/painel/consulta_log.test.js`, `test/painel/gerar_codigo_no.test.js`

**Interfaces:**
- Produces:
  - `paraNumero(v: any): number`, sempre finito, 0 quando inválido;
  - `somaValores(boletos: {valor}[]): number`, arredondado a 2 casas;
  - `classificarConsulta(r)` passa a devolver também `valor_debito: number`;
  - no gerador, `mod(f)` remove linhas que contêm `// @no-n8n`.

- [ ] **Step 1: Write the failing tests**

`test/painel/valores.test.js`:
```js
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
```

Acrescentar em `test/painel/consulta_log.test.js`:
```js
test('classificarConsulta devolve valor_debito so das parcelas vencidas', () => {
    const r = { status: 'pagar_atrasados', alunos: [
        { status: 'pagar_atrasados', boletos: [{ valor: '100,00', linhaDigitavel: '1' }, { valor: '50,5000', linhaDigitavel: '2' }] },
        { status: 'em_dia', boletos: [{ valor: '999,00', linhaDigitavel: '3' }] }] };
    assert.strictEqual(classificarConsulta(r).valor_debito, 150.5);
    assert.strictEqual(classificarConsulta({ status: 'em_dia', alunos: [{ status: 'em_dia', boletos: [{ valor: '10,00' }] }] }).valor_debito, 0);
    assert.strictEqual(classificarConsulta({ status: 'pagar_atrasados', parcelas: [{ valor: '20,00', linhaDigitavel: 'x' }] }).valor_debito, 20);
    assert.strictEqual(classificarConsulta({ status: 'erro', code: 'nao_encontrado' }).valor_debito, 0);
});
```

Acrescentar em `test/painel/gerar_codigo_no.test.js`:
```js
test('registrar-consulta grava consulta_id e valor_debito', () => {
    const codigo = gerar('registrar-consulta');
    assert.match(codigo, /consulta_id/);
    assert.match(codigo, /valor_debito: c\.valor_debito/);
    assert.match(codigo, /function paraNumero/);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test`
Expected: FAIL (`Cannot find module '../../n8n/painel/valores.js'` e asserts de `valor_debito`).

- [ ] **Step 3: Implement**

`n8n/painel/valores.js`:
```js
// Converte valores da Sponte ("179,9900", "1.234,56", "R$ 10,00") em numero. Autocontido (colado no n8n).

function paraNumero(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    if (v === null || v === undefined || typeof v === 'object') return 0;
    const s = String(v).replace(/[^\d,.-]/g, '');
    if (!s) return 0;
    const n = s.includes(',') ? Number(s.replace(/\./g, '').replace(',', '.')) : Number(s);
    return Number.isFinite(n) ? n : 0;
}

function somaValores(boletos) {
    const total = (Array.isArray(boletos) ? boletos : []).reduce((s, b) => s + paraNumero(b && b.valor), 0);
    return Math.round(total * 100) / 100;
}

module.exports = { paraNumero, somaValores };
```

Em `n8n/painel/consulta_log.js`, no topo, logo após o comentário de cabeçalho:
```js
const { somaValores } = require('./valores.js'); // @no-n8n
```
Em `classificarConsulta`, calcular antes dos `return`:
```js
    const boletosDebito = Array.isArray(r.alunos)
        ? r.alunos.filter(a => a && a.status === 'pagar_atrasados').reduce((acc, a) => acc.concat(a.boletos || []), [])
        : (r.status === 'pagar_atrasados' ? (r.parcelas || []) : []);
    const valor_debito = r.status === 'pagar_atrasados' ? somaValores(boletosDebito) : 0;
```
O `return` de erro passa a incluir `valor_debito: 0`, e o `return` final passa a incluir `valor_debito`.

Em `n8n/painel/gerar-codigo-no.js`:
```js
const mod = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8')
    .split('\n').filter(l => !l.includes('// @no-n8n')).join('\n')
    .replace(/^module\.exports\s*=.*$/m, '').trim();
```
`ADAPTADORES['registrar-consulta']` e `ADAPTADORES['registrar-evento-front']` passam a ser `['valores.js', 'consulta_log.js']`. No corpo `registrar-consulta`, a linha do `log` fica:
```js
const consultaId = String($('Validar CPF').first().json.consulta_id || '');
const log = { quando, resultado: c.resultado, tela: c.tela, code: c.code, origem: c.origem,
  duracao_ms: inicio ? Date.now() - inicio : null, qtd_boletos: c.qtd_boletos, consulta_id: consultaId, valor_debito: c.valor_debito };
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm test`
Expected: PASS em todos os testes (incluindo os 48 existentes).

- [ ] **Step 5: Commit**
```bash
git add n8n/painel/valores.js n8n/painel/consulta_log.js n8n/painel/gerar-codigo-no.js test/painel/valores.test.js test/painel/consulta_log.test.js test/painel/gerar_codigo_no.test.js
git commit -m "feat(painel): valor_debito e consulta_id no log de consultas; gerador ignora linhas @no-n8n"
```

---

### Task 2: `pagamentos.js` (decisão da conferência)

**Files:**
- Create: `n8n/painel/pagamentos.js`, `test/painel/pagamentos.test.js`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `ETAPAS_H = [28, 48, 72]`;
  - `parcelasEmAberto(cacheRow): boleto[]`;
  - `mesmaParcela(boleto, conferencia): boolean`;
  - `proximaConferencia(copiadoEmIso: string, etapa: 1|2|3): string` (ISO);
  - `decidirConferencia(linha, cacheRow|null, agoraIso)`, que devolve `{ final: false, etapa, proxima_conferencia }` ou `{ final: true, resultado: 'pago'|'nao_pago'|'indeterminado', registro: { consulta_id, modo, valor, copiado_em, resultado, confirmado_em, etapa } }`.
  - `linha` tem o formato `{ consulta_id, cpf, modo, num_parcela, vencimento, linha, valor, copiado_em, etapa }`, e `cacheRow`, o formato `{ status_sponte, data_atualizacao, proximo_boleto }`.

- [ ] **Step 1: Write the failing test**

`test/painel/pagamentos.test.js`:
```js
const test = require('node:test');
const assert = require('node:assert');
const P = require('../../n8n/painel/pagamentos.js');

const COPIA = '2026-09-24T12:00:00.000Z';
const L = (o = {}) => Object.assign({ consulta_id: 'c1', cpf: '06140707323', modo: 'debito', num_parcela: '8', vencimento: '10/09/2026',
    linha: '00190000090312106800500162741177415950000017999', valor: 179.99, copiado_em: COPIA, etapa: 1 }, o);
const bol = (o = {}) => Object.assign({ numParcela: '8', dataVencimento: '10/09/2026', linhaDigitavel: '00190000090312106800500162741177415950000017999', valor: '179,9900' }, o);
const cache = (status, boletos, atualizado = '2026-09-25T06:10:00.000Z') =>
    ({ status_sponte: status, data_atualizacao: atualizado, proximo_boleto: JSON.stringify({ alunos: [{ nomeAluno: 'A', status, boletos }] }) });

test('proximaConferencia: 28h, 48h, 72h depois da copia', () => {
    assert.strictEqual(P.proximaConferencia(COPIA, 1), '2026-09-25T16:00:00.000Z');
    assert.strictEqual(P.proximaConferencia(COPIA, 2), '2026-09-26T12:00:00.000Z');
    assert.strictEqual(P.proximaConferencia(COPIA, 3), '2026-09-27T12:00:00.000Z');
});
test('parcelasEmAberto le alunos[] e formato legado', () => {
    assert.strictEqual(P.parcelasEmAberto(cache('pagar_atrasados', [bol(), bol({ numParcela: '9' })])).length, 2);
    assert.strictEqual(P.parcelasEmAberto({ proximo_boleto: [bol()] }).length, 1);
    assert.strictEqual(P.parcelasEmAberto({ proximo_boleto: JSON.stringify(bol()) }).length, 1);
    assert.deepStrictEqual(P.parcelasEmAberto({ proximo_boleto: null }), []);
    assert.deepStrictEqual(P.parcelasEmAberto({ proximo_boleto: '{quebrado' }), []);
});
test('mesmaParcela casa por linha (so digitos) ou por parcela+vencimento', () => {
    assert.ok(P.mesmaParcela(bol({ numParcela: 'x' }), L()));                                   // mesma linha
    assert.ok(P.mesmaParcela(bol({ linhaDigitavel: '0019 0000' }), L()));                       // mesma parcela+vencimento
    assert.ok(!P.mesmaParcela(bol({ linhaDigitavel: 'outra', numParcela: '9' }), L()));         // nada casa
});
test('parcela sumiu do cache atualizado: pago', () => {
    const d = P.decidirConferencia(L(), cache('pagar_atrasados', [bol({ numParcela: '9', linhaDigitavel: 'z' })]), '2026-09-25T16:05:00.000Z');
    assert.strictEqual(d.final, true);
    assert.strictEqual(d.resultado, 'pago');
    assert.deepStrictEqual(d.registro, { consulta_id: 'c1', modo: 'debito', valor: 179.99, copiado_em: COPIA, resultado: 'pago', confirmado_em: '2026-09-25T16:05:00.000Z', etapa: 1 });
    assert.ok(!('cpf' in d.registro));
});
test('parcela ainda em aberto: vai para a proxima etapa; na 3a vira nao_pago', () => {
    const d1 = P.decidirConferencia(L(), cache('pagar_atrasados', [bol()]), '2026-09-25T16:05:00.000Z');
    assert.deepStrictEqual(d1, { final: false, etapa: 2, proxima_conferencia: '2026-09-26T12:00:00.000Z' });
    const d3 = P.decidirConferencia(L({ etapa: 3 }), cache('pagar_atrasados', [bol()], '2026-09-27T06:10:00.000Z'), '2026-09-27T12:05:00.000Z');
    assert.strictEqual(d3.resultado, 'nao_pago');
});
test('cache nao atualizado depois da copia: nao conta a etapa; na 3a vira indeterminado', () => {
    const velho = cache('pagar_atrasados', [], '2026-09-24T06:00:00.000Z');
    assert.deepStrictEqual(P.decidirConferencia(L(), velho, '2026-09-25T16:05:00.000Z'), { final: false, etapa: 2, proxima_conferencia: '2026-09-26T12:00:00.000Z' });
    assert.strictEqual(P.decidirConferencia(L({ etapa: 3 }), velho, '2026-09-27T12:05:00.000Z').resultado, 'indeterminado');
});
test('negociar nao conta como pago (cache sem boletos)', () => {
    const d = P.decidirConferencia(L(), cache('negociar', []), '2026-09-25T16:05:00.000Z');
    assert.deepStrictEqual(d, { final: false, etapa: 2, proxima_conferencia: '2026-09-26T12:00:00.000Z' });
    assert.strictEqual(P.decidirConferencia(L({ etapa: 3 }), cache('negociar', []), '2026-09-27T12:05:00.000Z').resultado, 'nao_pago');
});
test('CPF fora do cache: indeterminado', () => {
    assert.strictEqual(P.decidirConferencia(L(), null, '2026-09-25T16:05:00.000Z').resultado, 'indeterminado');
});
test('antecipacao: pagou a proxima mensalidade quando ela troca no cache em_dia', () => {
    const d = P.decidirConferencia(L({ modo: 'antecipacao' }), cache('em_dia', [bol({ numParcela: '9', dataVencimento: '10/10/2026', linhaDigitavel: 'nova' })]), '2026-09-25T16:05:00.000Z');
    assert.strictEqual(d.resultado, 'pago');
    assert.strictEqual(d.registro.modo, 'antecipacao');
});
```
- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL (`Cannot find module '../../n8n/painel/pagamentos.js'`).

- [ ] **Step 3: Implement** `n8n/painel/pagamentos.js`:
```js
// Conferencia de pagamento: a parcela copiada saiu das parcelas em aberto do cache? Autocontido (colado no n8n).

const ETAPAS_H = [28, 48, 72];
const HORA = 3600 * 1000;

function lerJson(v) {
    if (typeof v !== 'string') return v;
    try { return JSON.parse(v); } catch (e) { return null; }
}

function parcelasEmAberto(cacheRow) {
    const pb = lerJson(cacheRow && cacheRow.proximo_boleto);
    if (!pb) return [];
    if (Array.isArray(pb)) return pb.filter(Boolean);
    if (Array.isArray(pb.alunos)) return pb.alunos.reduce((acc, a) => acc.concat((a && a.boletos) || []), []).filter(Boolean);
    return [pb];
}

const digitos = (s) => String(s || '').replace(/\D/g, '');

function mesmaParcela(b, c) {
    if (!b || !c) return false;
    const lb = digitos(b.linhaDigitavel), lc = digitos(c.linha);
    if (lb && lc && lb === lc) return true;
    return String(b.numParcela || '') === String(c.num_parcela || '') && String(b.dataVencimento || '') === String(c.vencimento || '');
}

function proximaConferencia(copiadoEmIso, etapa) {
    return new Date(Date.parse(copiadoEmIso) + ETAPAS_H[etapa - 1] * HORA).toISOString();
}

function decidirConferencia(linha, cacheRow, agoraIso) {
    const etapa = Number(linha.etapa) || 1;
    const fim = (resultado) => ({ final: true, resultado, registro: {
        consulta_id: linha.consulta_id, modo: linha.modo, valor: linha.valor, copiado_em: linha.copiado_em,
        resultado, confirmado_em: agoraIso, etapa } });
    const seguir = () => ({ final: false, etapa: etapa + 1, proxima_conferencia: proximaConferencia(linha.copiado_em, etapa + 1) });

    if (!cacheRow) return fim('indeterminado');
    const atualizado = Date.parse(cacheRow.data_atualizacao) > Date.parse(linha.copiado_em);
    if (!atualizado) return etapa >= 3 ? fim('indeterminado') : seguir();

    // "negociar" nao lista boletos: a parcela sumir nao prova pagamento
    const emAberto = cacheRow.status_sponte === 'negociar' || parcelasEmAberto(cacheRow).some(b => mesmaParcela(b, linha));
    if (!emAberto) return fim('pago');
    return etapa >= 3 ? fim('nao_pago') : seguir();
}

module.exports = { ETAPAS_H, parcelasEmAberto, mesmaParcela, proximaConferencia, decidirConferencia };
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test`. Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add n8n/painel/pagamentos.js test/painel/pagamentos.test.js
git commit -m "feat(painel): decisao da conferencia de pagamento (28/48/72h)"
```

---

### Task 3: `eventos.js` (normalização, deduplicação e travas da cópia)

**Files:**
- Create: `n8n/painel/eventos.js`, `test/painel/eventos.test.js`
- Modify: `n8n/painel/gerar-codigo-no.js` (novo corpo `registrar-evento-front` e nó `validar-copia`), `test/painel/gerar_codigo_no.test.js`

**Interfaces:**
- Consumes:
  - `paraNumero` (Task 1);
  - `parcelasEmAberto`, `mesmaParcela`, `proximaConferencia` (Task 2).
- Produces:
  - `normalizarEvento(body, agoraIso)`, que devolve `{ ignorar: true, motivo }` ou `{ tipo, log: { quando, tipo, consulta_id, modo, valor, chave }, conferencia: {...}|null }`;
  - `validarCopia({ consulta, cacheRow, conferencia, agoraIso })`, que devolve `{ ok: boolean, motivo: string }`;
  - `TIPOS_EVENTO = ['copiou_linha', 'clicou_amais', 'clicou_antecipar']`.

- [ ] **Step 1: Write the failing test**

`test/painel/eventos.test.js`:
```js
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
```

Em `test/painel/gerar_codigo_no.test.js`, acrescentar `'validar-copia'` à lista do laço `for`. A Task 6 acrescenta `'conferir-pagamento'`.

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`. Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Implement** `n8n/painel/eventos.js`:
```js
// Eventos de acao do site (copiou linha, clicou Amais, clicou antecipar). Autocontido (colado no n8n).
const { paraNumero } = require('./valores.js'); // @no-n8n
const { parcelasEmAberto, mesmaParcela, proximaConferencia } = require('./pagamentos.js'); // @no-n8n

const TIPOS_EVENTO = ['copiou_linha', 'clicou_amais', 'clicou_antecipar'];
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const JANELA_CONSULTA_MS = 2 * 3600 * 1000;

function normalizarEvento(body, agoraIso) {
    const b = body || {};
    const ignorar = (motivo) => ({ ignorar: true, motivo });
    if (!TIPOS_EVENTO.includes(b.tipo)) return ignorar('tipo');
    const consulta_id = String(b.consulta_id || '');
    if (!RE_UUID.test(consulta_id)) return ignorar('consulta_id');

    if (b.tipo !== 'copiou_linha') {
        const modo = b.tipo === 'clicou_antecipar' ? 'antecipacao' : '';
        return { tipo: b.tipo, conferencia: null,
            log: { quando: agoraIso, tipo: b.tipo, consulta_id, modo, valor: 0, chave: `${b.tipo}|${consulta_id}||` } };
    }

    const cpf = String(b.cpf || '').replace(/\D/g, '');
    if (cpf.length !== 11) return ignorar('cpf');
    const linha = String(b.linha || '').replace(/\D/g, '');
    if (linha.length < 44 || linha.length > 48) return ignorar('linha');
    const vencimento = String(b.vencimento || '');
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(vencimento)) return ignorar('vencimento');
    const num_parcela = String(b.num_parcela || '').slice(0, 10);
    if (!num_parcela) return ignorar('parcela');
    const modo = b.modo === 'antecipacao' ? 'antecipacao' : 'debito';
    const valor = paraNumero(b.valor);
    return {
        tipo: 'copiou_linha',
        log: { quando: agoraIso, tipo: 'copiou_linha', consulta_id, modo, valor, chave: `copiou_linha|${consulta_id}|${num_parcela}|${vencimento}` },
        conferencia: { consulta_id, cpf, modo, num_parcela, vencimento, linha, valor, copiado_em: agoraIso, etapa: 1,
            proxima_conferencia: proximaConferencia(agoraIso, 1) }
    };
}

function validarCopia({ consulta, cacheRow, conferencia, agoraIso }) {
    const nao = (motivo) => ({ ok: false, motivo });
    if (!consulta || consulta.consulta_id !== conferencia.consulta_id) return nao('consulta_inexistente');
    if (Math.abs(Date.parse(agoraIso) - Date.parse(consulta.quando)) > JANELA_CONSULTA_MS) return nao('consulta_antiga');
    if (!cacheRow) return nao('sem_cache');
    if (!parcelasEmAberto(cacheRow).some(b => mesmaParcela(b, conferencia))) return nao('parcela_nao_encontrada');
    return { ok: true, motivo: '' };
}

module.exports = { TIPOS_EVENTO, normalizarEvento, validarCopia };
```

Em `gerar-codigo-no.js`:
- `ADAPTADORES['registrar-evento-front'] = ['valores.js', 'consulta_log.js', 'pagamentos.js', 'eventos.js']`
- `ADAPTADORES['validar-copia'] = ['valores.js', 'pagamentos.js', 'eventos.js']`

Novo corpo `registrar-evento-front`, que substitui o atual. Ele trata os erros antigos e os eventos novos, e o campo `rota` decide o caminho no workflow:
```js
const b = $json.body || {};
const quando = new Date().toISOString();
if (b.tipo) {
  const e = normalizarEvento(b, quando);
  if (e.ignorar) return [{ json: { rota: 'ignorar', motivo: e.motivo } }];
  return [{ json: { rota: 'evento', tipo: e.tipo, log: e.log, conferencia: e.conferencia } }];
}
const CODES = ['cpf_invalido', 'timeout_navegador', 'desconhecido'];
const code = CODES.includes(b.code) ? b.code : 'desconhecido';
const cpf = String(b.cpf || '').replace(/\D/g, '').slice(0, 11);
const c = classificarConsulta({ status: 'erro', code });
const duracao = Number(b.duracao_ms);
const log = { quando, resultado: 'erro', tela: c.tela, code, origem: 'navegador',
  duracao_ms: Number.isFinite(duracao) && duracao >= 0 && duracao < 600000 ? Math.round(duracao) : null, qtd_boletos: 0 };
return [{ json: { rota: 'erro', log, planilha: linhaPlanilhaErro({ quando, cpf, tela: c.tela, code }) } }];
```
Novo corpo `validar-copia`. Entrada: o item do evento, com `$('Registrar Evento')`, e as leituras anteriores `$('Buscar Consulta')` e o cache HTTP:
```js
const ev = $('Registrar Evento').first().json;
const consulta = $('Buscar Consulta').all().map(i => i.json).find(r => r && r.consulta_id === ev.conferencia.consulta_id) || null;
const SERVICE_KEY = '__SUPABASE_SERVICE_KEY__';
const cpfFmt = ev.conferencia.cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
let cacheRow = null;
try {
  const r = await this.helpers.httpRequest({ method: 'GET', json: true, timeout: 15000,
    url: 'https://udvkjlnvcttzrhscsecg.supabase.co/rest/v1/alunos_cache?select=status_sponte,data_atualizacao,proximo_boleto&cpf=eq.' + encodeURIComponent(cpfFmt),
    headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY } });
  cacheRow = Array.isArray(r) && r[0] ? r[0] : null;
} catch (e) { cacheRow = null; }
const v = validarCopia({ consulta, cacheRow, conferencia: ev.conferencia, agoraIso: new Date().toISOString() });
return [{ json: { ok: v.ok, motivo: v.motivo, conferencia: ev.conferencia } }];
```

Acrescentar em `test/painel/gerar_codigo_no.test.js`:
```js
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test`. Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add n8n/painel/eventos.js n8n/painel/gerar-codigo-no.js test/painel/eventos.test.js test/painel/gerar_codigo_no.test.js
git commit -m "feat(painel): eventos de acao do site com dedupe e travas contra copia forjada"
```

---

### Task 4: `kpis.js` (catálogo, agregação, permissões e filtro)

**Files:**
- Create: `n8n/painel/kpis.js`, `test/painel/kpis.test.js`
- Modify: `n8n/painel/dashboard.js` (exportar `diaSP` e `diasEntre`), `n8n/painel/gerar-codigo-no.js` (novo `montar-dashboard`), `test/painel/gerar_codigo_no.test.js`

**Interfaces:**
- Consumes: `diaSP` e `diasEntre` (de `dashboard.js`), `agregarDashboard` e `avaliarSaude`.
- Produces:
  - `KPIS: {chave, grupo, rotulo}[]` (as 15 chaves das Global Constraints);
  - `GRUPOS = ['volume', 'conversao', 'financeiro', 'eficiencia', 'operacao']`;
  - `PADRAO_INICIAL: string[]`;
  - `validarListaKpis(lista): boolean`;
  - `kpisPermitidos(usuario: {papel, kpis?}, padrao?: string[]): string[]`;
  - `agregarKpis({ consultas, eventos, resultados, aConferir, de, ate, agora })`, que devolve um objeto com as chaves de volume, conversão, financeiro e eficiência (formas abaixo);
  - `filtrarKpis(obj, permitidos)`, que devolve um objeto só com as chaves permitidas.

Formas devolvidas por `agregarKpis`:
- `consultas_total | consultas_em_dia | consultas_debito | encaminhamentos`: `{ valor: number }`
- `comparativo_diario`: `{ dias: [{ dia, total, emDia, debito, encaminhamentos }] }`
- `funil_debito | funil_amais | funil_antecipar`: `{ base, agiram, taxa: number|null, dias: [{ dia, base, agiram }] }`
- `valor_recuperado | valor_antecipado`: `{ valor, qtdPagos, emConferencia, qtdEmConferencia }`
- `reducao_inadimplencia`: `{ taxa: number|null, recuperado, baseDebito }`
- `tempo_humano`: `{ horasEconomizadas, reducao: number|null, tempoHumanoMs, tempoMedioSiteMs: number|null, semHumano, estimado: boolean }`

- [ ] **Step 1: Write the failing test**

`test/painel/kpis.test.js`:
```js
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
```

Acrescentar `'montar-dashboard'` à lista do laço em `gerar_codigo_no.test.js`. Ele já está lá, mas o corpo muda. Acrescentar também:
```js
test('montar-dashboard filtra KPIs pelo usuario', () => {
    const codigo = gerar('montar-dashboard');
    assert.match(codigo, /filtrarKpis\(/);
    assert.match(codigo, /kpisPermitidos\(/);
    assert.match(codigo, /__SUPABASE_SERVICE_KEY__/);
});
```

- [ ] **Step 2: Run to verify it fails.** Run: `npm test`. Expected: FAIL.

- [ ] **Step 3: Implement**

Em `n8n/painel/dashboard.js`, trocar a última linha por:
`module.exports = { agregarDashboard, avaliarSaude, diaSP, diasEntre };`

`n8n/painel/kpis.js`:
```js
// KPIs do painel v2 + permissoes. Autocontido no n8n (colado depois de dashboard.js, que da diaSP/diasEntre).
const { diaSP, diasEntre } = require('./dashboard.js'); // @no-n8n

const KPIS = [
    { chave: 'consultas_total', grupo: 'volume', rotulo: 'Consultas totais' },
    { chave: 'consultas_em_dia', grupo: 'volume', rotulo: 'Consultas em dia' },
    { chave: 'consultas_debito', grupo: 'volume', rotulo: 'Consultas com débito' },
    { chave: 'encaminhamentos', grupo: 'volume', rotulo: 'Encaminhamentos para a Amais' },
    { chave: 'comparativo_diario', grupo: 'volume', rotulo: 'Comparativo diário' },
    { chave: 'funil_debito', grupo: 'conversao', rotulo: 'Débito × copiou a linha' },
    { chave: 'funil_amais', grupo: 'conversao', rotulo: 'Encaminhados × falou com a Amais' },
    { chave: 'funil_antecipar', grupo: 'conversao', rotulo: 'Em dia × antecipou' },
    { chave: 'valor_recuperado', grupo: 'financeiro', rotulo: 'Valor recuperado' },
    { chave: 'valor_antecipado', grupo: 'financeiro', rotulo: 'Valor antecipado' },
    { chave: 'reducao_inadimplencia', grupo: 'financeiro', rotulo: 'Redução de inadimplência' },
    { chave: 'tempo_humano', grupo: 'eficiencia', rotulo: 'Tempo humano economizado' },
    { chave: 'erros_por_tela', grupo: 'operacao', rotulo: 'Erros por tela' },
    { chave: 'origem_respostas', grupo: 'operacao', rotulo: 'Origem das respostas' },
    { chave: 'saude_sistema', grupo: 'operacao', rotulo: 'Saúde do sistema' }
];
const GRUPOS = ['volume', 'conversao', 'financeiro', 'eficiencia', 'operacao'];
const CHAVES = KPIS.map(k => k.chave);
const PADRAO_INICIAL = KPIS.filter(k => ['volume', 'conversao', 'operacao'].includes(k.grupo)).map(k => k.chave);
const EM_DIA = ['em_dia_boleto', 'em_dia_sem_boleto'];
const DEBITO = ['debito', 'atrasado_sem_linha'];
const TEMPO_PADRAO_MS = 60000;
const DIA_MS = 24 * 3600 * 1000;

function validarListaKpis(lista) {
    return Array.isArray(lista) && lista.every(k => CHAVES.includes(k)) && new Set(lista).size === lista.length;
}

function kpisPermitidos(usuario, padrao) {
    if (usuario && usuario.papel === 'super_admin') return CHAVES.slice();
    const lista = Array.isArray(usuario && usuario.kpis) ? usuario.kpis : (Array.isArray(padrao) ? padrao : PADRAO_INICIAL);
    return CHAVES.filter(k => lista.includes(k));
}

function filtrarKpis(obj, permitidos) {
    const out = {};
    for (const k of permitidos) if (obj && k in obj) out[k] = obj[k];
    return out;
}

const media = (xs) => xs.length ? xs.reduce((s, n) => s + n, 0) / xs.length : null;
const duracoesValidas = (ls) => ls.map(l => Number(l.duracao_ms)).filter(n => Number.isFinite(n) && n >= 0);
const soma2 = (xs) => Math.round(xs.reduce((s, n) => s + (Number(n) || 0), 0) * 100) / 100;

function agregarKpis({ consultas, eventos, resultados, aConferir, de, ate, agora }) {
    const noPeriodo = (iso) => { if (!iso) return false; const d = diaSP(iso); return d >= de && d <= ate; };
    const todas = (consultas || []).filter(l => l && l.quando);
    const cons = todas.filter(l => noPeriodo(l.quando));
    const dias = diasEntre(de, ate);
    const eh = (grupo) => (l) => grupo.includes(l.resultado);

    const comparativo = dias.map(dia => {
        const doDia = cons.filter(l => diaSP(l.quando) === dia);
        return { dia, total: doDia.length, emDia: doDia.filter(eh(EM_DIA)).length, debito: doDia.filter(eh(DEBITO)).length,
            encaminhamentos: doDia.filter(l => l.resultado === 'encaminhamento').length };
    });

    const evs = (eventos || []).filter(e => e && e.consulta_id);
    const funil = (filtroBase, tipo, modo) => {
        const baseLs = cons.filter(filtroBase);
        const ids = new Set(evs.filter(e => e.tipo === tipo && (!modo || e.modo === modo)).map(e => e.consulta_id));
        const agiu = (l) => l.consulta_id && ids.has(l.consulta_id);
        const agiram = baseLs.filter(agiu).length;
        return { base: baseLs.length, agiram, taxa: baseLs.length ? agiram / baseLs.length : null,
            dias: dias.map(dia => { const d = baseLs.filter(l => diaSP(l.quando) === dia); return { dia, base: d.length, agiram: d.filter(agiu).length }; }) };
    };

    const res = (resultados || []).filter(r => r && noPeriodo(r.copiado_em));
    const conf = (aConferir || []).filter(r => r && noPeriodo(r.copiado_em));
    const financeiro = (modo) => {
        const pagos = res.filter(r => r.modo === modo && r.resultado === 'pago');
        const emConf = conf.filter(r => r.modo === modo);
        return { valor: soma2(pagos.map(r => r.valor)), qtdPagos: pagos.length, emConferencia: soma2(emConf.map(r => r.valor)), qtdEmConferencia: emConf.length };
    };
    const recuperado = financeiro('debito');
    const baseDebito = soma2(cons.filter(eh(DEBITO)).map(l => l.valor_debito));

    const aoVivo = duracoesValidas(cons.filter(l => l.origem === 'ao_vivo'));
    const inicio30 = Date.parse(de + 'T00:00:00Z') - 30 * DIA_MS;
    const aoVivo30 = duracoesValidas(todas.filter(l => l.origem === 'ao_vivo' && Date.parse(l.quando) >= inicio30 && diaSP(l.quando) <= ate));
    const roboMs = media(aoVivo) ?? media(aoVivo30);
    const estimado = roboMs === null;
    const tempoHumanoMs = 2 * (estimado ? TEMPO_PADRAO_MS : roboMs);
    const semHumano = cons.filter(l => l.resultado !== 'erro').length;
    const tempoMedioSiteMs = media(duracoesValidas(cons));

    return {
        consultas_total: { valor: cons.length },
        consultas_em_dia: { valor: cons.filter(eh(EM_DIA)).length },
        consultas_debito: { valor: cons.filter(eh(DEBITO)).length },
        encaminhamentos: { valor: cons.filter(l => l.resultado === 'encaminhamento').length },
        comparativo_diario: { dias: comparativo },
        funil_debito: funil(eh(DEBITO), 'copiou_linha', 'debito'),
        funil_amais: funil(l => l.resultado === 'encaminhamento', 'clicou_amais'),
        funil_antecipar: funil(eh(EM_DIA), 'clicou_antecipar'),
        valor_recuperado: recuperado,
        valor_antecipado: financeiro('antecipacao'),
        reducao_inadimplencia: { taxa: baseDebito > 0 ? Math.round((recuperado.valor / baseDebito) * 10000) / 10000 : null, recuperado: recuperado.valor, baseDebito },
        tempo_humano: {
            horasEconomizadas: semHumano * tempoHumanoMs / 3600000,
            reducao: tempoMedioSiteMs === null ? null : Math.min(1, Math.max(0, 1 - tempoMedioSiteMs / tempoHumanoMs)),
            tempoHumanoMs, tempoMedioSiteMs, semHumano, estimado
        }
    };
}

module.exports = { KPIS, GRUPOS, PADRAO_INICIAL, validarListaKpis, kpisPermitidos, filtrarKpis, agregarKpis };
```

Em `gerar-codigo-no.js`:
- `ADAPTADORES['montar-dashboard'] = ['dashboard.js', 'kpis.js']`
- no corpo `montar-dashboard`, depois de `const d = agregarDashboard(...)`, inserir:
```js
const ler = (no) => { try { return $(no).all().map(i => i.json).filter(x => x && (x.quando || x.copiado_em)); } catch (e) { return []; } };
const cfg = (() => { try { return $('Ler Config').all().map(i => i.json).find(r => r && r.chave === 'kpis_padrao'); } catch (e) { return null; } })();
let padrao = null; try { padrao = cfg ? JSON.parse(cfg.valor) : null; } catch (e) { padrao = null; }
const permitidos = kpisPermitidos(pedido.usuario, padrao);
const kpis = filtrarKpis(agregarKpis({ consultas: linhas, eventos: ler('Ler Eventos'), resultados: ler('Ler Resultados'),
  aConferir: ler('Ler A Conferir'), de: pedido.de, ate: pedido.ate, agora }), permitidos);
```
- o `return` final passa a ser:
```js
const operacao = filtrarKpis({ erros_por_tela: d.errosPorTela, origem_respostas: { porOrigem: d.porOrigem, tempoMedioMs: d.tempoMedioMs } }, permitidos);
return [{ json: { status: 200, corpo: { ok: true, kpis: permitidos, dados: Object.assign({}, kpis, operacao),
  saude: permitidos.includes('saude_sistema') ? saude : null, ultimaIngestao: permitidos.includes('saude_sistema') ? u : null,
  periodo: d.periodo, planilhaUrl: pedido.planilhaUrl, usuario: pedido.usuario } } }];
```
O campo `dashboard` antigo deixa de ser enviado. O front v2 (Task 11) consome `kpis` e `dados`.

- [ ] **Step 4: Run to verify it passes.** Run: `npm test`. Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add n8n/painel/kpis.js n8n/painel/dashboard.js n8n/painel/gerar-codigo-no.js test/painel/kpis.test.js test/painel/gerar_codigo_no.test.js
git commit -m "feat(painel): KPIs v2 (volume, funis, valores, tempo humano) com permissao por usuario"
```

---

### Task 5: Usuários com `kpis` e ações de padrão na API

**Files:**
- Modify: `n8n/painel/usuarios.js`, `n8n/painel/painel_api_corpo.js`, `n8n/painel/gerar-codigo-no.js` (`ADAPTADORES['painel-api'] = ['kpis.js', 'usuarios.js']`), `test/painel/usuarios.test.js`, `test/painel/gerar_codigo_no.test.js`

**Interfaces:**
- Consumes: `validarListaKpis`, `kpisPermitidos`, `PADRAO_INICIAL` (Task 4).
- Produces:
  - `usuarioDoAuth(u)` devolve também `kpis: string[] | null`;
  - `validarAlteracaoUsuario` rejeita `kpis` inválido com `'Lista de KPIs inválida.'`;
  - na API:
    - `usuarios_listar` inclui `kpis`;
    - `usuarios_criar` e `usuarios_atualizar` aceitam `kpis`;
    - `kpis_padrao_ler` devolve `{ ok, padrao: string[], catalogo: KPIS }`;
    - `kpis_padrao_salvar {padrao}` devolve `{ salvarConfig: { chave: 'kpis_padrao', valor: string }, status: 200, corpo: { ok: true } }`;
    - `eu` inclui `catalogo: KPIS`.

- [ ] **Step 1: Write the failing test.** Acrescentar em `test/painel/usuarios.test.js`:
```js
test('usuarioDoAuth traz kpis quando for array', () => {
    assert.deepStrictEqual(usuarioDoAuth({ id: '1', email: 'a@x.com', app_metadata: { painel: true, papel: 'membro', ativo: true, kpis: ['consultas_total'] } }).kpis, ['consultas_total']);
    assert.strictEqual(usuarioDoAuth({ id: '1', email: 'a@x.com', app_metadata: { painel: true, papel: 'membro', ativo: true, kpis: 'x' } }).kpis, null);
});
test('kpis invalido e rejeitado em criar e atualizar', () => {
    const r1 = validarAlteracaoUsuario(BASE, 'chefe@x.com', { tipo: 'criar', email: 'n@x.com', nome: 'N', papel: 'membro', senha: '1234567890', kpis: ['nao_existe'] });
    assert.deepStrictEqual(r1, { ok: false, erro: 'Lista de KPIs inválida.' });
    const r2 = validarAlteracaoUsuario(BASE, 'chefe@x.com', { tipo: 'atualizar', email: 'm@x.com', kpis: 'consultas_total' });
    assert.deepStrictEqual(r2, { ok: false, erro: 'Lista de KPIs inválida.' });
    assert.deepStrictEqual(validarAlteracaoUsuario(BASE, 'chefe@x.com', { tipo: 'atualizar', email: 'm@x.com', kpis: ['consultas_total'] }), { ok: true });
});
```
Acrescentar em `test/painel/gerar_codigo_no.test.js`:
```js
test('painel-api tem as acoes de padrao de KPIs e grava kpis no app_metadata', () => {
    const codigo = gerar('painel-api');
    assert.match(codigo, /kpis_padrao_ler/);
    assert.match(codigo, /kpis_padrao_salvar/);
    assert.match(codigo, /salvarConfig/);
    assert.match(codigo, /meta\.kpis|kpis: pedido\.kpis/);
    assert.match(codigo, /\$\('Webhook API'\)\.first\(\)\.json/);
});
```

- [ ] **Step 2: Run to verify it fails.** `npm test` → FAIL.

- [ ] **Step 3: Implement**

`usuarios.js`:
- no topo: `const { validarListaKpis } = require('./kpis.js'); // @no-n8n`
- em `usuarioDoAuth`, somar `kpis: Array.isArray(m.kpis) ? m.kpis : null` ao objeto devolvido;
- em `validarAlteracaoUsuario`, logo após o bloco `const ator...` e antes de `if (p.tipo === 'criar')`:
```js
    if (p.kpis !== undefined && !validarListaKpis(p.kpis)) return falha('Lista de KPIs inválida.');
```

`painel_api_corpo.js`:
- `usuarios_listar`: acrescentar `kpis: u.kpis` no `map`.
- `usuarios_criar`: `const meta = { painel: true, papel: pedido.papel, nome: String(pedido.nome).trim(), ativo: true };` e em seguida `if (Array.isArray(pedido.kpis)) meta.kpis = pedido.kpis;`.
- `usuarios_atualizar`: depois de montar `meta`, fazer `meta.kpis = pedido.kpis !== undefined ? pedido.kpis : (alvo.kpis || undefined);`.
- `eu`: `return resp(200, { ok: true, usuario, planilhaUrl: PLANILHA_URL, catalogo: KPIS });`
- trocar `const req = $json;` por `const req = $('Webhook API').first().json;`, porque na Task 11 o nó `Ler Config` passa a ficar entre o webhook e este nó.
- `dashboard`: o `usuario` enviado adiante passa a ser `{ email, nome, papel, kpis: eu.kpis }`.
- Antes de `if (!acao.startsWith('usuarios_'))`:
```js
if (acao === 'kpis_padrao_ler' || acao === 'kpis_padrao_salvar') {
  if (eu.papel !== 'super_admin') return resp(403, { ok: false, erro: 'Apenas o super administrador pode gerenciar usuários.' });
  if (acao === 'kpis_padrao_ler') {
    let padrao = PADRAO_INICIAL;
    try { const c = $('Ler Config').all().map(i => i.json).find(r => r && r.chave === 'kpis_padrao'); if (c) padrao = JSON.parse(c.valor); } catch (e) {}
    return resp(200, { ok: true, padrao: kpisPermitidos({ papel: 'membro' }, padrao), catalogo: KPIS });
  }
  if (!validarListaKpis(body.padrao)) return resp(400, { ok: false, erro: 'Lista de KPIs inválida.' });
  return [{ json: { salvarConfig: { chave: 'kpis_padrao', valor: JSON.stringify(body.padrao) }, status: 200, corpo: { ok: true } } }];
}
```

- [ ] **Step 4: Run to verify it passes.** `npm test` → PASS.

- [ ] **Step 5: Commit**
```bash
git add n8n/painel/usuarios.js n8n/painel/painel_api_corpo.js n8n/painel/gerar-codigo-no.js test/painel/usuarios.test.js test/painel/gerar_codigo_no.test.js
git commit -m "feat(painel): kpis por usuario e padrao de KPIs na API"
```

---

### Task 6: Data Tables e gerador do nó `conferir-pagamento`

**Files:**
- Modify: `n8n/painel/gerar-codigo-no.js` (`ADAPTADORES['conferir-pagamento'] = ['pagamentos.js']` e corpo), `test/painel/gerar_codigo_no.test.js`, `backups/painel-ids.json` (gitignored)

**Interfaces:**
- Produces: tabelas `cia_eventos_log`, `cia_pagamentos_a_conferir`, `cia_pagamentos_resultado`, `cia_painel_config`; colunas novas em `cia_consultas_log` (`consulta_id`, `valor_debito`); os ids novos em `backups/painel-ids.json` (`eventosLogId`, `aConferirId`, `resultadoId`, `configId`).

- [ ] **Step 1: Teste do gerador.** Acrescentar `'conferir-pagamento'` à lista do laço e:
```js
test('conferir-pagamento decide e separa final de proxima etapa', () => {
    const codigo = gerar('conferir-pagamento');
    assert.match(codigo, /decidirConferencia\(/);
    assert.match(codigo, /__SUPABASE_SERVICE_KEY__/);
});
```
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3: Corpo `conferir-pagamento`** (o nó Code roda uma vez para todos os itens lidos de `cia_pagamentos_a_conferir`):
```js
const SERVICE_KEY = '__SUPABASE_SERVICE_KEY__';
const agora = new Date().toISOString();
const linhas = $input.all().map(i => i.json).filter(l => l && l.id && l.cpf && l.proxima_conferencia && l.proxima_conferencia <= agora);
const out = [];
for (const l of linhas) {
  const cpfFmt = String(l.cpf).replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  let cacheRow = null;
  try {
    const r = await this.helpers.httpRequest({ method: 'GET', json: true, timeout: 15000,
      url: 'https://udvkjlnvcttzrhscsecg.supabase.co/rest/v1/alunos_cache?select=status_sponte,data_atualizacao,proximo_boleto&cpf=eq.' + encodeURIComponent(cpfFmt),
      headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY } });
    cacheRow = Array.isArray(r) && r[0] ? r[0] : null;
  } catch (e) { continue; } // Supabase fora: tenta na proxima hora, sem decidir
  const d = decidirConferencia(l, cacheRow, agora);
  out.push({ json: d.final ? { id: l.id, final: true, registro: d.registro } : { id: l.id, final: false, etapa: d.etapa, proxima_conferencia: d.proxima_conferencia } });
}
return out;
```
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5: Criar as tabelas no n8n** (MCP `create_data_table`, projeto `WqOqk61ZzmyASX4J`):
  - `cia_eventos_log`: `quando` date, `tipo` string, `consulta_id` string, `modo` string, `valor` number, `chave` string
  - `cia_pagamentos_a_conferir`: `consulta_id` string, `cpf` string, `modo` string, `num_parcela` string, `vencimento` string, `linha` string, `valor` number, `copiado_em` date, `etapa` number, `proxima_conferencia` string (ISO, para comparar como texto)
  - `cia_pagamentos_resultado`: `consulta_id` string, `modo` string, `valor` number, `copiado_em` date, `resultado` string, `confirmado_em` date, `etapa` number
  - `cia_painel_config`: `chave` string, `valor` string
  - `add_data_table_column` em `cia_consultas_log` (`0xrb1cufhD17HkAs`): `consulta_id` string, `valor_debito` number

  Confirmar com `search_data_tables` e gravar os ids em `backups/painel-ids.json`.
- [ ] **Step 6: Commit** (só o código; `backups/` é gitignored)
```bash
git add n8n/painel/gerar-codigo-no.js test/painel/gerar_codigo_no.test.js
git commit -m "feat(painel): no conferir-pagamento e tabelas do painel v2"
```

---

### Task 7: n8n PROD, com `consulta_id` e `valor_debito` no log

**Files:** workflow `W7tTXjTNvvO62wYO` (sem arquivos versionados).

**Interfaces:** Consumes o corpo `registrar-consulta` (Task 1) e a tabela `cia_consultas_log` com as colunas novas (Task 6).

- [ ] **Step 1:** Backup (`get_workflow_details` → `backups/W7tTXjTNvvO62wYO-<data>-kpis.json`) e anotar o `activeVersionId`.
- [ ] **Step 2:** `update_workflow` com `setNodeParameter`. O `Validar CPF` recebe o `/jsCode` abaixo, e o `Registrar Consulta` recebe a saída de `node n8n/painel/gerar-codigo-no.js registrar-consulta`:
```js
const body = $json.body || {};
const cpf = (body.cpf || '').toString().replace(/\D/g, '');
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const consulta_id = RE_UUID.test(String(body.consulta_id || '')) ? String(body.consulta_id) : '';
if (cpf.length !== 11) {
    return [{ json: { cpf: cpf.slice(0, 20), error: true, message: 'CPF invalido', inicioMs: Date.now(), consulta_id } }];
}
let formattedCpf = cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
return [{ json: { cpf: formattedCpf, error: false, inicioMs: Date.now(), consulta_id } }];
```
- [ ] **Step 3:** No nó `Gravar Log Consulta` (Data Table insert), mapear também `consulta_id = {{ $json.log.consulta_id }}` e `valor_debito = {{ $json.log.valor_debito }}`. Ler o nó antes de mudar, para seguir o formato do mapeamento existente.
- [ ] **Step 4:** `publish_workflow` e testar:
```bash
curl -s -X POST https://n8n.amais.io/webhook/buscar-boletos-novo -H 'Content-Type: application/json' -d '{"cpf":"61600960367","consulta_id":"3f2b8c1e-9a4d-4c2b-8f1a-2b3c4d5e6f70"}' | head -c 200
curl -s -X POST https://n8n.amais.io/webhook/buscar-boletos-novo -H 'Content-Type: application/json' -d '{"cpf":"07667401373"}' | head -c 200
curl -s -X POST https://n8n.amais.io/webhook/buscar-boletos-novo -H 'Content-Type: application/json' -d '{"cpf":"123"}'
```
Expected: o mesmo formato de resposta de antes. Na execução (`get_execution`, nó `Gravar Log Consulta`), a 1ª tem `consulta_id` preenchido e a 2ª tem `consulta_id: ''`. Se algo falhar, `publish_workflow` com o `activeVersionId` anotado.

---

### Task 8: Workflow "Eventos do Site" com eventos novos, deduplicação e travas

**Files:** workflow `vQ3YTmcK3zPalgwY`.

**Interfaces:** Consumes os corpos `registrar-evento-front` e `validar-copia` (Task 3), e as tabelas da Task 6.

- [ ] **Step 1:** Backup e `activeVersionId`.
- [ ] **Step 2:** `update_workflow`:
  - `Registrar Evento.jsCode` = saída de `gerar-codigo-no.js registrar-evento-front`;
  - adicionar o nó Switch `Rota`, depois de `Registrar Evento`, com as saídas `erro` (`$json.rota === 'erro'`) e `evento` (`$json.rota === 'evento'`). O caso `ignorar` não tem saída e termina ali;
  - mover as conexões existentes (`Gravar Log`, que leva a `Anotar Planilha`) para a saída `erro`.

  Na saída `evento`:
    1. `Buscar Duplicado`: Data Table get em `cia_eventos_log`, filtro `chave` eq `{{ $json.log.chave }}`, `alwaysOutputData: true`.
    2. `É Novo?`: IF `{{ !$json.chave }}`. Se estiver vazio, é novo.
    3. `Gravar Evento`: insert em `cia_eventos_log` com os campos de `$('Registrar Evento').first().json.log`.
    4. `É Cópia?`: IF `{{ $('Registrar Evento').first().json.tipo === 'copiou_linha' }}`.
    5. `Buscar Consulta`: Data Table get em `cia_consultas_log`, filtro `consulta_id` eq `{{ $('Registrar Evento').first().json.log.consulta_id }}`, `alwaysOutputData: true`.
    6. `Validar Cópia`: Code, jsCode = `gerar-codigo-no.js validar-copia` com `__SUPABASE_SERVICE_KEY__` trocado, no payload MCP.
    7. `Cópia OK?`: IF `{{ $json.ok === true }}`.
    8. `Gravar Conferência`: insert em `cia_pagamentos_a_conferir` com os campos de `$json.conferencia`.
- [ ] **Step 3:** `publish_workflow` e testar os quatro casos:
```bash
ID=$(node -e "console.log(require('crypto').randomUUID())")
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://n8n.amais.io/webhook/registrar-evento-front -H 'Content-Type: text/plain' -d "{\"tipo\":\"clicou_amais\",\"consulta_id\":\"$ID\"}"
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://n8n.amais.io/webhook/registrar-evento-front -H 'Content-Type: text/plain' -d "{\"tipo\":\"clicou_amais\",\"consulta_id\":\"$ID\"}"
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://n8n.amais.io/webhook/registrar-evento-front -H 'Content-Type: text/plain' -d "{\"tipo\":\"copiou_linha\",\"consulta_id\":\"$ID\",\"cpf\":\"06140707323\",\"modo\":\"debito\",\"num_parcela\":\"8\",\"vencimento\":\"10/09/2026\",\"valor\":\"1,00\",\"linha\":\"00190000090312106800500162741177415950000017999\"}"
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://n8n.amais.io/webhook/registrar-evento-front -H 'Content-Type: text/plain' -d '{"code":"cpf_invalido","cpf":"123"}'
```
Expected (verificar pelas execuções):
  - 1º `clicou_amais`: grava 1 linha;
  - 2º `clicou_amais` com o mesmo ID: é descartado como duplicado;
  - `copiou_linha` com `consulta_id` inexistente: `Validar Cópia` responde `ok: false` com `consulta_inexistente`, e nada entra em `cia_pagamentos_a_conferir`;
  - erro antigo: continua indo para o log e a planilha.

  Depois, apagar as linhas de teste de `cia_eventos_log`.

---

### Task 9: Site com `consulta_id` e os três eventos

**Files:**
- Modify: `D:\VIBE CODDING\CLAUDE CODE\rob-sponte-2\frontend\script.js`

**Interfaces:** Produces os eventos com os campos exatos da Task 3.

- [ ] **Step 1: Implementar.** Perto de `const URL_EVENTO`:
```js
let consultaAtual = { id: '', cpf: '' };
let modoLinhaAtual = 'debito';
let parcelaAtual = null; // { linha, numParcela, dataVencimento, valor }
function novoConsultaId() {
    try { return crypto.randomUUID(); } catch (e) { return ''; }
}
function registrarAcao(tipo, extra) {
    if (!consultaAtual.id) return;
    const corpo = JSON.stringify(Object.assign({ tipo, consulta_id: consultaAtual.id }, extra || {}));
    try { if (navigator.sendBeacon && navigator.sendBeacon(URL_EVENTO, corpo)) return; } catch (e) {}
    try { fetch(URL_EVENTO, { method: 'POST', body: corpo, keepalive: true }); } catch (e) {}
}
```
- Em `handleFormSubmit`, logo após a validação do CPF, fazer `consultaAtual = { id: novoConsultaId(), cpf };`. No `fetch` do webhook, o body passa a ser `JSON.stringify({ cpf, consulta_id: consultaAtual.id })`. Ler o trecho e manter o resto do objeto de opções igual.
- `showLinhaDigitavel(linha, numParcela, dataVencimento, valor, modo)`: guardar `parcelaAtual = { linha, numParcela, dataVencimento, valor }` e `modoLinhaAtual = modo || 'debito'`. Os chamadores passam a enviar o valor e o modo:
  - botão "Pagar" das parcelas vencidas: `showLinhaDigitavel('${p.linhaDigitavel}', '${p.numParcela}', '${p.dataVencimento}', '${p.valor || ''}', 'debito')` (nos dois lugares que renderizam parcelas);
  - "Pagar próximo boleto": `registrarAcao('clicou_antecipar'); showLinhaDigitavel(currentProximoBoleto.linhaDigitavel, currentProximoBoleto.numParcela, currentProximoBoleto.dataVencimento, currentProximoBoleto.valor, 'antecipacao');`.
- `copyLinhaDigitavel`: dentro do `.then(() => {`, acrescentar:
```js
        if (parcelaAtual) registrarAcao('copiou_linha', { cpf: consultaAtual.cpf, modo: modoLinhaAtual, num_parcela: parcelaAtual.numParcela,
            vencimento: parcelaAtual.dataVencimento, valor: parcelaAtual.valor, linha: parcelaAtual.linha });
```
- Links "Falar com a Amais": o card por aluno (`href="${WA_NEGOCIAR}"`) ganha `onclick="registrarAcao('clicou_amais')"`, e o link do `modalNegociar` no `index.html` também. Ler o HTML para achar o `<a>` dele.
- [ ] **Step 2: Verificar.** `node -e "new Function(require('fs').readFileSync('frontend/script.js','utf8'))"`. Expected: sem erro.
- [ ] **Step 3: Commit e push** (repo `rob-sponte-2`):
```bash
git add frontend/script.js frontend/index.html
git commit -m "feat(site): consulta_id e eventos de acao (copiou linha, falou com Amais, antecipou)"
```
Push com o comando das Global Constraints. Ele depende da Task 8 estar publicada, porque a ordem importa: com o n8n antigo, os eventos novos caem no caminho de erro `desconhecido`.

---

### Task 10: Workflow "[CIA] Conferir Pagamentos"

**Files:** workflow novo, criado via `create_workflow_from_code` no projeto `WqOqk61ZzmyASX4J`.

**Interfaces:** Consumes o corpo `conferir-pagamento` (Task 6) e as tabelas da Task 6.

- [ ] **Step 1:** Criar o workflow:
  1. `A cada hora`: Schedule, a cada 1 hora.
  2. `Ler A Conferir`: Data Table get em `cia_pagamentos_a_conferir`, com `returnAll` e `alwaysOutputData: true`.
  3. `Conferir`: Code, com o jsCode `gerar-codigo-no.js conferir-pagamento` e a chave trocada no payload.
  4. `Final?`: IF `{{ $json.final === true }}`.
     - true: `Gravar Resultado` (insert em `cia_pagamentos_resultado` com os campos de `$json.registro`) e depois `Apagar Conferência` (delete em `cia_pagamentos_a_conferir` onde `id` eq `{{ $('Conferir').item.json.id }}`);
     - false: `Próxima Etapa` (update em `cia_pagamentos_a_conferir` onde `id` eq `{{ $json.id }}`, com `etapa` e `proxima_conferencia`).
- [ ] **Step 2:** Rodar `validate_workflow`, depois `create_workflow_from_code` e `publish_workflow`. Nas configurações do workflow, avisar o usuário para marcar "Do not save" nas execuções, porque elas carregam CPF.
- [ ] **Step 3: Testar** com `test_workflow`, fixando (`pinData`) `Ler A Conferir` com 3 linhas vencidas, e deixando o Code chamar o Supabase real:
  - uma com a linha de uma parcela que existe no cache de `06140707323`, que deve seguir para a próxima etapa;
  - uma com a linha `'1'.repeat(47)`, que deve dar `pago`;
  - uma com `cpf` `00000000000`, que deve dar `indeterminado`.

  Conferir com `get_execution`. Depois, apagar as linhas de teste de `cia_pagamentos_resultado`.

---

### Task 11: painel-api com KPIs v2, permissões e padrão

> **Ordem de publicação:** a resposta nova (`kpis` e `dados`) quebra o front v1. Faça a Task 12 antes, validando pela prévia local com a API simulada. Depois, publique esta task e dê o push da Task 12 em seguida, numa janela de minutos. O painel só é usado pela administração.

**Files:** workflow `rtNm8aq1cWyYS9Ej`.

**Interfaces:** Consumes os corpos `painel-api` (Task 5) e `montar-dashboard` (Task 4), e as tabelas da Task 6.

- [ ] **Step 1:** Backup e `activeVersionId`.
- [ ] **Step 2:** `update_workflow`:
  - novo nó `Ler Config` (Data Table get em `cia_painel_config`, `returnAll`, `alwaysOutputData`, `executeOnce`) entre `Webhook API` e `Autenticar e Rotear`. Reconectar: `Webhook API` → `Ler Config` → `Autenticar e Rotear`. O `Autenticar e Rotear` já lê de `$('Webhook API')`, desde a Task 5;
  - `Autenticar e Rotear.jsCode` = saída de `gerar-codigo-no.js painel-api`, com os placeholders trocados;
  - no ramo do dashboard, depois de `Ler Log Ingestoes`: `Ler Eventos` (`cia_eventos_log`), `Ler Resultados` (`cia_pagamentos_resultado`) e `Ler A Conferir` (`cia_pagamentos_a_conferir`), todos com `returnAll`, `alwaysOutputData` e `executeOnce`, encadeados antes de `Montar Dashboard`;
  - `Montar Dashboard.jsCode` = saída de `gerar-codigo-no.js montar-dashboard`, com a chave trocada;
  - no ramo false de `É Dashboard?`, inserir o IF `Salvar Config?` (`{{ !!$json.salvarConfig }}`):
    - true: `Gravar Config` (upsert em `cia_painel_config` com a chave `chave`, campos de `$json.salvarConfig`) e depois `Responder API`;
    - false: `Responder API`.
- [ ] **Step 3:** `publish_workflow`. Em seguida, rodar o contrato: reaproveitar `scratchpad/contrato.js`, ou criar outro fora do repo, com um membro temporário criado pela admin API (padrão `membro-tmp.js`). Checar:
  1. Super admin `dashboard`: `kpis` com 15 chaves, e `dados` com `valor_recuperado` e `tempo_humano`.
  2. Membro criado com `kpis: ['consultas_total']`: o `dashboard` tem `kpis = ['consultas_total']`, `dados` só com essa chave e `saude: null`.
  3. `usuarios_atualizar` com `kpis: ['xx']` → 400 `Lista de KPIs inválida.`
  4. `kpis_padrao_salvar` com `padrao: ['consultas_total','saude_sistema']` → 200. Depois disso, `kpis_padrao_ler` devolve essa lista, e o membro sem `kpis` passa a receber essa lista no dashboard.
  5. Membro chamando `kpis_padrao_ler` → 403.
  6. Restaurar o padrão inicial (`kpis_padrao_salvar` com `PADRAO_INICIAL`) e apagar o membro temporário.

---

### Task 12: Front do painel v2 (layout e permissões)

**Files:**
- Modify: `rob-sponte-2/frontend/painel-f8ed7ba4777f/formatos.js`, `formatos.test.js`, `graficos.js`, `index.html`, `painel.css`, `painel.js`

**Interfaces:**
- Consumes a resposta de `dashboard`: `{ kpis: string[], dados: {...formas da Task 4}, saude, ultimaIngestao, periodo, planilhaUrl }`, e as ações `eu` (com `catalogo`), `kpis_padrao_ler` e `kpis_padrao_salvar`, e `usuarios_*` com `kpis`.
- Produces:
  - `formatarMoeda(n): string` (`"R$ 1.234,56"`, `"—"` para null);
  - `formatarHoras(h): string` (`"12,4 h"`; abaixo de 1 h, `"35 min"`);
  - `Graficos.areas(alvo, dias, series)`;
  - `Graficos.barrasPar(alvo, dias, {corBase, corAcao})`.

- [ ] **Step 1: Testes de formatos** (em `formatos.test.js`):
```js
test('formatarMoeda e formatarHoras', () => {
    assert.strictEqual(F.formatarMoeda(1234.56).replace(/\s/g, ' '), 'R$ 1.234,56');
    assert.strictEqual(F.formatarMoeda(0).replace(/\s/g, ' '), 'R$ 0,00');
    assert.strictEqual(F.formatarMoeda(null), '—');
    assert.strictEqual(F.formatarHoras(12.44), '12,4 h');
    assert.strictEqual(F.formatarHoras(0.5), '30 min');
    assert.strictEqual(F.formatarHoras(0), '0 min');
    assert.strictEqual(F.formatarHoras(null), '—');
});
```
- [ ] **Step 2:** `node --test frontend/painel-f8ed7ba4777f/formatos.test.js` → FAIL.
- [ ] **Step 3: Implementar em `formatos.js`**:
```js
    function formatarMoeda(n) {
        if (n === null || n === undefined || Number.isNaN(Number(n))) return '—';
        return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(n));
    }
    function formatarHoras(h) {
        if (h === null || h === undefined || Number.isNaN(Number(h))) return '—';
        if (h < 1) return Math.round(h * 60) + ' min';
        return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(h) + ' h';
    }
```
Exportar ambas em `api`. Rodar o teste → PASS.

- [ ] **Step 4: Gráficos novos em `graficos.js`**, reaproveitando `base`, `cor`, `rotulosX`, `mostrarDica` e `vazio`:
  - `areas(alvo, dias, series)`:
    - `dias` = `[{rotulo, titulo, valores:{chave:n}}]`;
    - `series` = `[{chave, nome, cor}]`;
    - curva suave: `M` e, entre pontos, `C` com controles nos terços horizontais (`cx1 = x0 + (x1-x0)/3`, `cx2 = x1 - (x1-x0)/3`, y dos extremos);
    - preenchimento até a base, com degradê vertical de opacidade 0.35 → 0 da cor da série, e traço de 2 px;
    - 5 linhas de grade horizontais; margens 12, 12, 8 e 28;
    - a dica ao passar o mouse lista todas as séries do dia.
  - `barrasPar(alvo, dias, { corBase, corAcao, nomeBase, nomeAcao })`:
    - `dias` = `[{rotulo, titulo, base, agiram}]`;
    - por dia, duas barras lado a lado com cantos de 3 px (`rx=3`), a escura com `base` e a clara com `agiram`, na mesma escala (`Formatos.escalaMax` do maior `base`);
    - largura do par = 70% da faixa;
    - a dica mostra "Consultaram n · Agiram m".
- [ ] **Step 5: Layout** (`index.html` e `painel.css`), seguindo a seção 7 da spec:
  - **Tokens** novos em `:root`: `--superficie: #F7F8FB`, `--borda-card: #E6E8F0`, `--rotulo: #8A90A6`, `--raio-card: 24px`, `--verde-fundo: #ECFDF5`, `--verde: #059669`, `--vermelho-fundo: #FFF1F2`, `--vermelho: #E11D48`.
  - **`.grade`** passa a ser `display: grid; gap: 16px; grid-template-columns: repeat(12, minmax(0,1fr))`, sem o fundo de hairline. Até 767 px, `grid-template-columns: 1fr` e todos os cards com `grid-column: 1 / -1`.
  - **Classes:**
    - `.kpi-card`: 3 colunas no desktop, 6 no tablet; raio 16 px, padding 24 px e fundo `--superficie`. Hover com `border-color` verde ou vermelho conforme `data-tendencia`.
    - `.card-v2`: raio `--raio-card`, borda `--borda-card`, fundo `--superficie`, padding 28 px.
    - `.card-destaque`: fundo `#23316E`, texto branco e sombra `0 10px 30px -12px rgba(35,49,110,.45)`; barra de progresso de 6 px com trilho `rgba(255,255,255,.15)` e preenchimento branco.
    - `.rotulo`: 11 px, maiúsculas, `letter-spacing: .12em`, cor `--rotulo`, peso 700.
    - `.valor-grande`: 28 px, peso 800, `letter-spacing: -.02em`, `tabular-nums`.
    - `.pilula-sobe` e `.pilula-desce` (12 px, peso 700, padding 2 px por 6 px, raio 6 px).
    - `.lista-metricas li`: ícone Tabler de 20 px, rótulo, valor 18 px peso 600 e seta num círculo de 28 px (`.seta-sobe` e `.seta-desce`).
    - Animação `@keyframes entrar { from { opacity: 0; transform: translateY(8px) } }` aplicada com `animation: entrar .4s ease both` e `animation-delay: calc(var(--i) * 40ms)`. Com `@media (prefers-reduced-motion: reduce)`, sem animação.
  - **Estrutura de `#viewDashboard`**, com cada bloco levando `data-kpi="<chave>"` (o JS remove os não permitidos):
    - linha 1: 4 `.kpi-card` (`consultas_total`, `consultas_em_dia`, `consultas_debito`, `encaminhamentos`);
    - linha 2: `.card-v2` `comparativo_diario` com 8 colunas (`#graficoComparativo`, legenda em quadradinhos). Na coluna de 4, um `.card-destaque` `reducao_inadimplencia` e, abaixo, um `.card-v2` `tempo_humano`;
    - linha 3: três `.card-v2` com 4 colunas cada (`funil_debito`, `funil_amais`, `funil_antecipar`), cada um com ícone (`ti-copy`, `ti-brand-whatsapp`, `ti-calendar-dollar`), valor grande (quem agiu), % de conversão com seta e `.barras-par`;
    - linha 4: dois `.card-v2` com 6 colunas (`valor_recuperado` com `ti-cash`, `valor_antecipado` com `ti-calendar-up`), com a linha "+ R$ X em conferência (n)";
    - linha 5: três `.card-v2` com 4 colunas (`erros_por_tela`, `origem_respostas`, `saude_sistema`) em `.lista-metricas`.
  - **Tela de Usuários:** na coluna de ações de cada membro, um botão "KPIs" (`data-acao="kpis"`), e no cabeçalho da view, o botão "Padrão para novos membros". Os dois abrem o diálogo `#dlgKpis`, com `<fieldset>` por grupo, `<legend>` com o nome do grupo e um checkbox por KPI (`value` = chave), mais os botões "Cancelar" e "Salvar".
- [ ] **Step 6: Lógica (`painel.js`):**
  - Ao carregar o dashboard: em cada `[data-kpi]`, `el.hidden = !r.kpis.includes(el.dataset.kpi)`. A variação usa a segunda chamada (período anterior), já existente: `F.variacao(d.consultas_total.valor, ant.consultas_total.valor)` e equivalentes; para o valor recuperado, `F.variacao(d.valor_recuperado.valor, ant.valor_recuperado.valor)`.
  - Destaque:
    - `reducao_inadimplencia.taxa` → `F.formatarPct`, com a largura da barra = `min(100, taxa*100)%`;
    - texto de apoio: `Recuperado ${F.formatarMoeda(recuperado)} de ${F.formatarMoeda(baseDebito)} em débito consultado`.
  - Tempo humano:
    - `F.formatarHoras(horasEconomizadas)` como valor principal;
    - linha de apoio: `${F.formatarPct(reducao)} menos tempo · ${F.formatarNumero(semHumano)} consultas sem atendimento`;
    - se `estimado`, acrescentar `· tempo do robô estimado (sem consultas ao vivo)`.
  - Funis: o valor principal é `agiram`; a pílula é `F.formatarPct(taxa)`; o texto é `de ${base} consultas`. O gráfico é `G.barrasPar(alvo, dias.map(x => ({ rotulo: F.formatarDia(x.dia), titulo: F.formatarDia(x.dia), base: x.base, agiram: x.agiram })), { corBase: 'var(--primary)', corAcao: '#9AA6D6', nomeBase: 'Consultaram', nomeAcao: 'Agiram' })`.
  - Comparativo: `G.areas(alvo, dias, [{chave:'total',nome:'Consultas',cor:'var(--primary)'},{chave:'emDia',nome:'Em dia',cor:'#10B981'},{chave:'debito',nome:'Com débito',cor:'#F59E0B'},{chave:'encaminhamentos',nome:'Encaminhados',cor:'#E11D48'}])`.
  - Erros por tela, origem e saúde: os mesmos dados de antes, lidos agora de `r.dados.erros_por_tela`, `r.dados.origem_respostas` e `r.saude`.
  - Diálogo de KPIs:
    - catálogo vindo de `eu`, em cache após o login;
    - no modo membro, marca `u.kpis` ou o padrão, e ao salvar chama `usuarios_atualizar {email, kpis}`;
    - no modo padrão, lê com `kpis_padrao_ler` e salva com `kpis_padrao_salvar {padrao}`;
    - toast "KPIs atualizados.".
- [ ] **Step 7: Verificação visual** com a prévia local e a API simulada (padrão já usado em `scratchpad/previa`). Uma captura em 1440 px e uma em 360 px (`scrollWidth === 360`). Ajustes de uma rodada.
- [ ] **Step 8: Commit e push** (repo `rob-sponte-2`, arquivos pelo nome).

---

### Task 13: E2E, revisão final e memória

- [ ] **Step 1: E2E com agent-browser em produção:**
  - consulta de um CPF em débito no site, clique em "Pagar" e em "Copiar"; conferir as linhas novas em `cia_eventos_log` e em `cia_pagamentos_a_conferir`, e o `consulta_id` igual ao do log de consultas;
  - painel com super admin: todos os blocos visíveis, e o funil de débito com `agiram ≥ 1`;
  - membro temporário com 2 KPIs: só 2 blocos aparecem, e o DOM não tem os outros valores;
  - 360 px sem rolagem horizontal.
- [ ] **Step 2: Limpeza:** apagar as linhas de teste (eventos, conferências e resultados do CPF de teste) e o membro temporário.
- [ ] **Step 3: Revisão final** do branch inteiro, com o revisor no modelo mais capaz.
- [ ] **Step 4: Memória:** atualizar `painel-admin.md` com as tabelas novas, o workflow Conferir Pagamentos e as chaves de KPI. Atualizar o ledger.
