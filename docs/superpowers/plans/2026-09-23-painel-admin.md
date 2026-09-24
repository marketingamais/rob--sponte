# Painel de Administração — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Painel privado (login e-mail+senha, super admin gerencia membros) com dashboard de métricas de consulta e saúde, mais uma planilha Google com cada erro de consulta.

**Architecture:** Segredos ficam só no n8n. O site e o painel (estáticos na Vercel) falam com webhooks do n8n. As consultas são registradas num Data Table do n8n (sem CPF) e os erros vão para uma planilha Google (com CPF). As credenciais dos admins ficam no Supabase Auth; papel e ativo ficam em `app_metadata`. A lógica de negócio fica em módulos JS puros testados em `n8n/painel/` e é colada literalmente nos nós Code.

**Tech Stack:** Node 20+ (`node:test`), n8n (MCP: `update_workflow`, `create_workflow_from_code`, `create_data_table`, `publish_workflow`, `execute_workflow`), Supabase Auth REST (`/auth/v1/*`), Google Sheets (n8n), HTML/CSS/JS vanilla + Chart.js 4 (jsDelivr), agent-browser (Vercel) para E2E.

**Spec:** `docs/superpowers/specs/2026-09-23-painel-admin-design.md`

## Global Constraints

- Repo do robô (módulos puros + testes): `D:\VIBE CODDING\CLAUDE CODE\BOLETO CIA - Copia`, branch `main`, `npm test` = `node --test test/**/*.test.js`. Os testes do painel ficam em `test/painel/*.test.js` (cobertos pelo glob).
- Repo do site: `D:\VIBE CODDING\CLAUDE CODE\rob-sponte-2`, branch `main`. Commitar **só** arquivos de `frontend/` e `vercel.json`. **Os dois repos são PÚBLICOS**: nenhum segredo, chave ou sufixo de webhook em arquivo versionado.
- Nunca `git add -A` / `git add .`. Trailer exato: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Push: `git -c credential.https://github.com.helper= -c credential.https://github.com.helper=manager -c credential.interactive=never push origin main` (o helper `gh` tem token inválido).
- n8n: projeto `WqOqk61ZzmyASX4J`. Workflow de consulta PROD `W7tTXjTNvvO62wYO`. Edições via MCP ficam em **rascunho**; só valem depois de `publish_workflow`. Antes de editar o PROD, salvar o JSON atual em `backups/` (gitignored) como `W7tTXjTNvvO62wYO-<AAAA-MM-DD-HHmm>.json`.
- Supabase: `https://udvkjlnvcttzrhscsecg.supabase.co`. A service key é a mesma dos nós `Upsert Supabase`/`Reconciliar Ausentes` do workflow PROD e só pode ser colada em payloads MCP (nós Code/HTTP). Nunca em arquivo do repo nem em relatório.
- Google Sheets: credencial n8n `[AMAIS] GOOGLE SHEETS` (id `LU6wtO2xAV2RTwgO`). Google Drive: `CRESCIMENTO` (id `0nnJpmlAlgX7vw6y`).
- Painel: `https://rob-sponte-2.vercel.app/painel-f8ed7ba4777f/`. Super admin inicial: `matheusalencar@amais.io`.
- Fuso: `America/Sao_Paulo`. Datas de filtro no formato `AAAA-MM-DD`.
- Nomes fixos:

  | Item | Nome |
  |---|---|
  | Data Table de consultas | `cia_consultas_log` |
  | Data Table de ingestões | `cia_ingestoes_log` |
  | Webhook da API do painel | `painel-api` |
  | Webhook de eventos do site | `registrar-evento-front` |
  | Workflow da API | `[CIA] Painel Admin [PROD]` |
  | Workflow de eventos | `[CIA] Eventos do Site [PROD]` |
  | Planilha | `Erros - Consulta Boletos CIA`, aba `Erros` |

- CORS do painel: `Access-Control-Allow-Origin: https://rob-sponte-2.vercel.app`.
- Papéis: `super_admin` e `membro`. Senha com no mínimo 10 caracteres.

## Review Focus

1. **Consulta com 2+ filhos, um em `negociar` e outro com débito:** a métrica usa o status geral (`encaminhamento`), sem contar em dobro. Teste na Task 1 (`classificarConsulta`).
2. **Período sem nenhuma consulta:** os cards mostram "—" nas taxas, sem NaN nem divisão por zero, e o gráfico mostra todos os dias com 0. Teste na Task 1 (`agregarDashboard`) e na Task 7 (`formatarPct`).
3. **Consulta às 23:30 de São Paulo** (02:30 UTC do dia seguinte) conta no dia certo de SP. Teste na Task 1.
4. **Super admin tentando se remover, rebaixar ou desativar, ou remover o último super admin:** a API recusa com mensagem clara. Teste na Task 1 (`validarAlteracaoUsuario`) e na Task 5 (curl).
5. **Falha ao gravar log ou planilha** (Google fora, Data Table cheio): a pessoa que consulta recebe a resposta normalmente. Teste na Task 3 (resposta enviada antes do log; nós de log com `continueRegularOutput`).

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `n8n/painel/consulta_log.js` | `classificarConsulta`, `motivoESolucao`, `linhaPlanilhaErro`: transformam uma resposta de consulta em linha de log / linha de planilha |
| `n8n/painel/dashboard.js` | `agregarDashboard`, `avaliarSaude`: números e níveis do dashboard |
| `n8n/painel/usuarios.js` | `usuarioDoAuth`, `validarAlteracaoUsuario`, `validarNovaSenha`: regras de membros |
| `n8n/painel/gerar-codigo-no.js` | CLI que imprime o jsCode de cada nó Code a partir dos módulos (fonte única) |
| `test/painel/*.test.js` | testes dos módulos |
| n8n `W7tTXjTNvvO62wYO` | consulta com Respond to Webhook + log + planilha; ingestão com log |
| n8n `[CIA] Eventos do Site [PROD]` | recebe beacons de erro do navegador |
| n8n `[CIA] Painel Admin [PROD]` | API do painel |
| `rob-sponte-2/frontend/script.js` | beacons de erro do navegador |
| `rob-sponte-2/vercel.json` | rota explícita do painel |
| `rob-sponte-2/frontend/painel-f8ed7ba4777f/{index.html,painel.css,painel.js,api.js,formatos.js}` | painel |
| `rob-sponte-2/frontend/painel-f8ed7ba4777f/formatos.test.js` | teste de formatos (roda com `node --test`; arquivo é servido mas inofensivo) |

**Tracks paralelas:**
- **A** (Task 1 → 2 → 3 → 4 → 5): n8n e módulos.
- **B** (Task 6): beacons no site. Independente.
- **C** (Task 7): frontend do painel. Depende só do contrato da API (§ Task 5 "Interfaces"), então pode rodar em paralelo com a A.
- A **Task 8** (deploy + E2E) espera todas.

---

### Task 1: Módulos puros do painel + testes

**Files:**
- Create: `n8n/painel/consulta_log.js`, `n8n/painel/dashboard.js`, `n8n/painel/usuarios.js`, `n8n/painel/gerar-codigo-no.js`
- Create: `test/painel/consulta_log.test.js`, `test/painel/dashboard.test.js`, `test/painel/usuarios.test.js`, `test/painel/gerar_codigo_no.test.js`

**Interfaces (produz):**
- `classificarConsulta(resposta: object) => { resultado, tela, code, origem, qtd_boletos }`
  - `resultado` ∈ `debito | encaminhamento | em_dia_boleto | em_dia_sem_boleto | atrasado_sem_linha | erro`
  - `origem` ∈ `cache | cache_antigo | ao_vivo | sem_dados`
- `motivoESolucao(code: string, detalhe?: string) => { erro, motivo, solucao }`
- `linhaPlanilhaErro({ quando: ISO, cpf: string, tela, code, detalhe }) => { 'Data/hora', 'CPF', 'Tela do erro', 'Erro', 'Motivo do erro', 'Possível solução' }`
- `agregarDashboard(linhas: LogRow[], de: 'AAAA-MM-DD', ate: 'AAAA-MM-DD', agora: Date) => Dashboard`
  - `LogRow = { quando: ISO, resultado, tela, code, origem, duracao_ms }`
- `avaliarSaude({ robo: {ok, ms, commit}, ultimaIngestao: {quando, status, cpfs, filtro} | null, cacheAtualizadoEm: ISO | null, erros24h: {total, erros} }, agora: Date) => [{ item, nivel: 'verde'|'amarelo'|'vermelho', detalhe }]`
- `usuarioDoAuth(authUser) => { id, email, nome, papel, ativo } | null` (`null` se não for usuário do painel)
- `validarAlteracaoUsuario(usuarios, atorEmail, pedido) => { ok: true } | { ok: false, erro: string }`
- `validarNovaSenha(senha) => { ok } | { ok:false, erro }`

- [ ] **Step 1: Escrever os testes (RED)**

`test/painel/consulta_log.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const { classificarConsulta, motivoESolucao, linhaPlanilhaErro } = require('../../n8n/painel/consulta_log.js');

const bol = (linha) => ({ numParcela: '1', dataVencimento: '10/10/2026', valor: '179,99', linhaDigitavel: linha });

test('debito: pagar_atrasados com linha', () => {
    const r = classificarConsulta({ status: 'pagar_atrasados', cache: true, alunos: [{ status: 'pagar_atrasados', boletos: [bol('123'), bol('456')] }] });
    assert.deepStrictEqual(r, { resultado: 'debito', tela: 'Boletos vencidos', code: '', origem: 'cache', qtd_boletos: 2 });
});

test('atrasado sem linha liberada', () => {
    const r = classificarConsulta({ status: 'pagar_atrasados', cache: false, alunos: [{ status: 'pagar_atrasados', boletos: [bol(null)] }] });
    assert.strictEqual(r.resultado, 'atrasado_sem_linha');
    assert.strictEqual(r.origem, 'ao_vivo');
    assert.strictEqual(r.qtd_boletos, 0);
});

test('encaminhamento: status geral negociar vence (2 filhos) - Review Focus 1', () => {
    const r = classificarConsulta({ status: 'negociar', cache: true, alunos: [
        { status: 'negociar', boletos: [] }, { status: 'pagar_atrasados', boletos: [bol('9')] }] });
    assert.strictEqual(r.resultado, 'encaminhamento');
    assert.strictEqual(r.tela, 'Negociar com a Amais');
});

test('em dia com e sem boleto; cache antigo', () => {
    assert.strictEqual(classificarConsulta({ status: 'em_dia', cache: true, alunos: [{ status: 'em_dia', boletos: [bol('1')] }] }).resultado, 'em_dia_boleto');
    const s = classificarConsulta({ status: 'em_dia', cache: true, cacheDesatualizado: true, alunos: [] });
    assert.strictEqual(s.resultado, 'em_dia_sem_boleto');
    assert.strictEqual(s.tela, 'Em dia');
    assert.strictEqual(s.origem, 'cache_antigo');
});

test('formato legado sem alunos usa proximoBoleto/parcelas', () => {
    assert.strictEqual(classificarConsulta({ status: 'em_dia', cache: false, proximoBoleto: bol('1') }).resultado, 'em_dia_boleto');
    assert.strictEqual(classificarConsulta({ status: 'pagar_atrasados', cache: false, parcelas: [bol('1')] }).resultado, 'debito');
});

test('erros por code', () => {
    const casos = [
        ['nao_encontrado', 'CPF não encontrado'], ['instabilidade', 'Sistema instável'],
        ['timeout_navegador', 'Sistema instável'], ['sem_senha', 'Sem senha no portal'],
        ['cpf_invalido', 'CPF inválido'], ['qualquer', 'Erro desconhecido'], [undefined, 'Erro desconhecido']
    ];
    for (const [code, tela] of casos) {
        const r = classificarConsulta({ status: 'erro', code });
        assert.strictEqual(r.resultado, 'erro');
        assert.strictEqual(r.tela, tela, String(code));
        assert.strictEqual(r.origem, 'sem_dados');
        assert.strictEqual(r.code, code || 'desconhecido');
    }
});

test('entrada vazia/lixo nao quebra', () => {
    assert.strictEqual(classificarConsulta(null).resultado, 'erro');
    assert.strictEqual(classificarConsulta({ status: 'xyz' }).tela, 'Erro desconhecido');
});

test('motivoESolucao cobre todos os codes e detalhe de instabilidade', () => {
    for (const c of ['nao_encontrado', 'instabilidade', 'sem_senha', 'timeout_navegador', 'cpf_invalido', 'desconhecido']) {
        const m = motivoESolucao(c);
        assert.ok(m.erro && m.motivo && m.solucao, c);
    }
    assert.match(motivoESolucao('instabilidade', 'api_sponte').erro, /API da Sponte/);
    assert.match(motivoESolucao('instabilidade', 'robo').erro, /Robô/);
    assert.match(motivoESolucao('instabilidade').erro, /Robô/);
});

test('linhaPlanilhaErro formata data em SP e CPF', () => {
    const l = linhaPlanilhaErro({ quando: '2026-09-24T02:30:00.000Z', cpf: '06140707323', tela: 'CPF não encontrado', code: 'nao_encontrado' });
    assert.strictEqual(l['Data/hora'], '23/09/2026 23:30:00');
    assert.strictEqual(l['CPF'], '061.407.073-23');
    assert.strictEqual(l['Tela do erro'], 'CPF não encontrado');
    assert.strictEqual(l['Erro'], motivoESolucao('nao_encontrado').erro);
    assert.deepStrictEqual(Object.keys(l), ['Data/hora', 'CPF', 'Tela do erro', 'Erro', 'Motivo do erro', 'Possível solução']);
});

test('linhaPlanilhaErro com CPF vazio ou incompleto mantem o que veio', () => {
    assert.strictEqual(linhaPlanilhaErro({ quando: '2026-09-24T02:30:00.000Z', cpf: '123', tela: 'CPF inválido', code: 'cpf_invalido' })['CPF'], '123');
    assert.strictEqual(linhaPlanilhaErro({ quando: '2026-09-24T02:30:00.000Z', cpf: '', tela: 'x', code: 'x' })['CPF'], '');
});
```

`test/painel/dashboard.test.js`:

```js
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
```

`test/painel/usuarios.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const { usuarioDoAuth, validarAlteracaoUsuario, validarNovaSenha } = require('../../n8n/painel/usuarios.js');

const U = (email, papel, ativo = true) => ({ id: email, email, nome: email, papel, ativo });
const BASE = [U('chefe@x.com', 'super_admin'), U('outro@x.com', 'super_admin'), U('m@x.com', 'membro')];

test('usuarioDoAuth', () => {
    assert.deepStrictEqual(usuarioDoAuth({ id: '1', email: 'A@X.com', app_metadata: { painel: true, papel: 'membro', nome: 'Ana', ativo: true } }),
        { id: '1', email: 'a@x.com', nome: 'Ana', papel: 'membro', ativo: true });
    assert.strictEqual(usuarioDoAuth({ id: '2', email: 'b@x.com', app_metadata: {} }), null);
    assert.strictEqual(usuarioDoAuth(null), null);
    assert.strictEqual(usuarioDoAuth({ id: '3', email: 'c@x.com', app_metadata: { painel: true, papel: 'membro', ativo: false } }).ativo, false);
    assert.strictEqual(usuarioDoAuth({ id: '4', email: 'd@x.com', app_metadata: { painel: true, papel: 'membro' } }).ativo, true);
});

test('validarNovaSenha', () => {
    assert.deepStrictEqual(validarNovaSenha('1234567890'), { ok: true });
    assert.strictEqual(validarNovaSenha('123').ok, false);
    assert.strictEqual(validarNovaSenha(undefined).ok, false);
});

test('ator precisa ser super_admin ativo', () => {
    assert.strictEqual(validarAlteracaoUsuario(BASE, 'm@x.com', { tipo: 'remover', email: 'outro@x.com' }).ok, false);
    assert.strictEqual(validarAlteracaoUsuario([U('chefe@x.com', 'super_admin', false), U('m@x.com', 'membro')], 'chefe@x.com', { tipo: 'remover', email: 'm@x.com' }).ok, false);
    assert.strictEqual(validarAlteracaoUsuario(BASE, 'ninguem@x.com', { tipo: 'remover', email: 'm@x.com' }).ok, false);
});

test('nao pode alterar a si mesmo (remover, rebaixar, desativar) - Review Focus 4', () => {
    for (const p of [{ tipo: 'remover', email: 'chefe@x.com' }, { tipo: 'atualizar', email: 'chefe@x.com', papel: 'membro' }, { tipo: 'atualizar', email: 'chefe@x.com', ativo: false }]) {
        const r = validarAlteracaoUsuario(BASE, 'chefe@x.com', p);
        assert.strictEqual(r.ok, false, JSON.stringify(p));
        assert.match(r.erro, /você mesmo/);
    }
    assert.deepStrictEqual(validarAlteracaoUsuario(BASE, 'chefe@x.com', { tipo: 'atualizar', email: 'chefe@x.com', nome: 'Novo' }), { ok: true });
});

test('ultimo super admin ativo nao pode sair', () => {
    const dois = [U('chefe@x.com', 'super_admin'), U('outro@x.com', 'super_admin', false), U('m@x.com', 'membro')];
    // "outro" esta inativo: o unico ativo e o proprio ator, que ja e barrado pela regra de si mesmo;
    // ativar/desativar o inativo e permitido.
    assert.deepStrictEqual(validarAlteracaoUsuario(dois, 'chefe@x.com', { tipo: 'atualizar', email: 'outro@x.com', ativo: true }), { ok: true });
    assert.deepStrictEqual(validarAlteracaoUsuario(BASE, 'chefe@x.com', { tipo: 'atualizar', email: 'outro@x.com', papel: 'membro' }), { ok: true });
    assert.deepStrictEqual(validarAlteracaoUsuario(BASE, 'chefe@x.com', { tipo: 'remover', email: 'outro@x.com' }), { ok: true });
});

test('criar: valida email, papel, senha, duplicado', () => {
    assert.deepStrictEqual(validarAlteracaoUsuario(BASE, 'chefe@x.com', { tipo: 'criar', email: 'novo@x.com', nome: 'Novo', papel: 'membro', senha: '1234567890' }), { ok: true });
    assert.strictEqual(validarAlteracaoUsuario(BASE, 'chefe@x.com', { tipo: 'criar', email: 'M@x.com', nome: 'X', papel: 'membro', senha: '1234567890' }).erro, 'Já existe um usuário com esse e-mail.');
    assert.strictEqual(validarAlteracaoUsuario(BASE, 'chefe@x.com', { tipo: 'criar', email: 'invalido', nome: 'X', papel: 'membro', senha: '1234567890' }).ok, false);
    assert.strictEqual(validarAlteracaoUsuario(BASE, 'chefe@x.com', { tipo: 'criar', email: 'a@b.com', nome: 'X', papel: 'dono', senha: '1234567890' }).ok, false);
    assert.strictEqual(validarAlteracaoUsuario(BASE, 'chefe@x.com', { tipo: 'criar', email: 'a@b.com', nome: 'X', papel: 'membro', senha: 'curta' }).ok, false);
    assert.strictEqual(validarAlteracaoUsuario(BASE, 'chefe@x.com', { tipo: 'criar', email: 'a@b.com', nome: '', papel: 'membro', senha: '1234567890' }).ok, false);
});

test('alvo inexistente e tipo invalido', () => {
    assert.strictEqual(validarAlteracaoUsuario(BASE, 'chefe@x.com', { tipo: 'remover', email: 'zz@x.com' }).erro, 'Usuário não encontrado.');
    assert.strictEqual(validarAlteracaoUsuario(BASE, 'chefe@x.com', { tipo: 'explodir', email: 'm@x.com' }).ok, false);
    assert.strictEqual(validarAlteracaoUsuario(BASE, 'chefe@x.com', { tipo: 'atualizar', email: 'm@x.com', papel: 'dono' }).ok, false);
    assert.strictEqual(validarAlteracaoUsuario(BASE, 'chefe@x.com', { tipo: 'redefinir_senha', email: 'm@x.com', senha: 'curta' }).ok, false);
    assert.deepStrictEqual(validarAlteracaoUsuario(BASE, 'chefe@x.com', { tipo: 'redefinir_senha', email: 'm@x.com', senha: '1234567890' }), { ok: true });
});
```

`test/painel/gerar_codigo_no.test.js`:

```js
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL com `Cannot find module '../../n8n/painel/consulta_log.js'` (e os demais).

- [ ] **Step 3: Implementar `n8n/painel/consulta_log.js`**

```js
// Classifica uma resposta de consulta (a mesma que o site recebe) para o log e a planilha de erros.
// Arquivo autocontido: e colado no no Code do n8n por gerar-codigo-no.js (sem require).

const TELA_POR_RESULTADO = {
    debito: 'Boletos vencidos',
    atrasado_sem_linha: 'Boletos vencidos',
    encaminhamento: 'Negociar com a Amais',
    em_dia_boleto: 'Em dia',
    em_dia_sem_boleto: 'Em dia'
};

const TELA_POR_CODE = {
    nao_encontrado: 'CPF não encontrado',
    instabilidade: 'Sistema instável',
    timeout_navegador: 'Sistema instável',
    sem_senha: 'Sem senha no portal',
    cpf_invalido: 'CPF inválido'
};

const MOTIVOS = {
    nao_encontrado: {
        erro: 'Nenhum aluno ou responsável com esse CPF',
        motivo: 'O CPF não é de aluno cadastrado na Sponte (8731/70532) e não aparece como CPFResponsavel no relatório de Contas a Receber',
        solucao: 'Conferir o CPF com o responsável; verificar na Sponte se o aluno/responsável está cadastrado com esse CPF'
    },
    instabilidade_robo: {
        erro: 'Robô não respondeu',
        motivo: 'O robô ao vivo falhou ou demorou nas 5 tentativas e não havia cache',
        solucao: 'Tentar de novo em alguns minutos; ver "Saúde do sistema" no painel'
    },
    instabilidade_api_sponte: {
        erro: 'API da Sponte indisponível',
        motivo: 'A consulta de alunos na Sponte retornou erro',
        solucao: 'Aguardar a Sponte normalizar; se persistir, contatar suporte Sponte'
    },
    sem_senha: {
        erro: 'Aluno sem senha no Portal',
        motivo: 'O aluno não tem senha do Portal do Aluno cadastrada na Sponte',
        solucao: 'Cadastrar a senha do Portal do Aluno na Sponte'
    },
    timeout_navegador: {
        erro: 'Tempo esgotado no site',
        motivo: 'O site esperou 150 s sem resposta, ou a rede falhou',
        solucao: 'Tentar de novo; se repetir, ver "Saúde do sistema"'
    },
    cpf_invalido: {
        erro: 'CPF inválido',
        motivo: 'O CPF digitado não passa na verificação de dígitos',
        solucao: 'Orientar a pessoa a conferir o CPF digitado'
    },
    desconhecido: {
        erro: 'Erro desconhecido',
        motivo: 'Resposta inesperada do sistema',
        solucao: 'Ver a execução no n8n pelo horário'
    }
};

function contarLinhas(boletos) {
    return (Array.isArray(boletos) ? boletos : []).filter(b => b && b.linhaDigitavel).length;
}

function classificarConsulta(resposta) {
    const r = resposta || {};
    const origem = r.status === 'erro' || !r.status ? 'sem_dados'
        : r.cacheDesatualizado ? 'cache_antigo'
        : r.cache === true ? 'cache' : 'ao_vivo';

    if (r.status === 'erro' || !TELA_POR_RESULTADO[mapearStatus(r)]) {
        const code = r.code || 'desconhecido';
        return { resultado: 'erro', tela: TELA_POR_CODE[code] || 'Erro desconhecido', code, origem: 'sem_dados', qtd_boletos: 0 };
    }

    const alunos = Array.isArray(r.alunos) ? r.alunos : null;
    let resultado, qtd = 0;
    if (r.status === 'negociar') {
        resultado = 'encaminhamento';
    } else if (r.status === 'pagar_atrasados') {
        qtd = alunos
            ? alunos.filter(a => a && a.status === 'pagar_atrasados').reduce((s, a) => s + contarLinhas(a.boletos), 0)
            : contarLinhas(r.parcelas);
        resultado = qtd > 0 ? 'debito' : 'atrasado_sem_linha';
    } else {
        qtd = alunos ? alunos.reduce((s, a) => s + contarLinhas(a && a.boletos), 0) : contarLinhas(r.proximoBoleto ? [r.proximoBoleto] : []);
        resultado = qtd > 0 ? 'em_dia_boleto' : 'em_dia_sem_boleto';
    }
    return { resultado, tela: TELA_POR_RESULTADO[resultado], code: '', origem, qtd_boletos: qtd };
}

// status valido -> chave que existe em TELA_POR_RESULTADO (so para decidir se e erro)
function mapearStatus(r) {
    if (r.status === 'negociar') return 'encaminhamento';
    if (r.status === 'pagar_atrasados') return 'debito';
    if (r.status === 'em_dia') return 'em_dia_boleto';
    return '';
}

function motivoESolucao(code, detalhe) {
    if (code === 'instabilidade') return MOTIVOS[detalhe === 'api_sponte' ? 'instabilidade_api_sponte' : 'instabilidade_robo'];
    return MOTIVOS[code] || MOTIVOS.desconhecido;
}

function formatarCpf(cpf) {
    const d = String(cpf || '').replace(/\D/g, '');
    return d.length === 11 ? d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : String(cpf || '');
}

function dataHoraSP(iso) {
    const p = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(new Date(iso));
    const v = t => p.find(x => x.type === t).value;
    return `${v('day')}/${v('month')}/${v('year')} ${v('hour')}:${v('minute')}:${v('second')}`;
}

function linhaPlanilhaErro({ quando, cpf, tela, code, detalhe }) {
    const m = motivoESolucao(code, detalhe);
    return {
        'Data/hora': dataHoraSP(quando),
        'CPF': formatarCpf(cpf),
        'Tela do erro': tela,
        'Erro': m.erro,
        'Motivo do erro': m.motivo,
        'Possível solução': m.solucao
    };
}

module.exports = { classificarConsulta, motivoESolucao, linhaPlanilhaErro };
```

- [ ] **Step 4: Implementar `n8n/painel/dashboard.js`**

```js
// Agrega o log de consultas para o dashboard e avalia a saude do sistema. Autocontido (colado no n8n).

const RESOLVIDOS = ['debito', 'encaminhamento', 'em_dia_boleto', 'em_dia_sem_boleto', 'atrasado_sem_linha'];

function diaSP(iso) {
    return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }); // AAAA-MM-DD
}

function diasEntre(de, ate) {
    const out = [];
    const d = new Date(de + 'T12:00:00Z');
    const fim = new Date(ate + 'T12:00:00Z');
    while (d <= fim && out.length < 400) {
        out.push(d.toISOString().slice(0, 10));
        d.setUTCDate(d.getUTCDate() + 1);
    }
    return out;
}

function agregarDashboard(linhas, de, ate, agora) {
    const todas = Array.isArray(linhas) ? linhas.filter(l => l && l.quando) : [];
    const noPeriodo = todas.filter(l => { const d = diaSP(l.quando); return d >= de && d <= ate; });
    const conta = (res) => noPeriodo.filter(l => l.resultado === res).length;

    const total = noPeriodo.length;
    const erros = conta('erro');
    const resolvidas = noPeriodo.filter(l => RESOLVIDOS.includes(l.resultado)).length;

    const porTela = {};
    for (const l of noPeriodo) if (l.resultado === 'erro') porTela[l.tela] = (porTela[l.tela] || 0) + 1;
    const errosPorTela = Object.entries(porTela)
        .map(([tela, qtd]) => ({ tela, qtd, pct: qtd / erros }))
        .sort((a, b) => b.qtd - a.qtd || a.tela.localeCompare(b.tela));

    const porDia = diasEntre(de, ate).map(dia => ({ dia, resolvidas: 0, erros: 0 }));
    const idx = Object.fromEntries(porDia.map((d, i) => [d.dia, i]));
    for (const l of noPeriodo) {
        const i = idx[diaSP(l.quando)];
        if (i === undefined) continue;
        if (l.resultado === 'erro') porDia[i].erros++; else if (RESOLVIDOS.includes(l.resultado)) porDia[i].resolvidas++;
    }

    const duracoes = noPeriodo.map(l => Number(l.duracao_ms)).filter(n => Number.isFinite(n) && n >= 0);
    const porOrigem = {};
    for (const l of noPeriodo) porOrigem[l.origem] = (porOrigem[l.origem] || 0) + 1;

    const limite24h = agora.getTime() - 24 * 3600 * 1000;
    const ult24 = todas.filter(l => { const t = new Date(l.quando).getTime(); return t >= limite24h && t <= agora.getTime(); });

    return {
        periodo: { de, ate },
        total,
        debito: conta('debito'),
        encaminhamento: conta('encaminhamento'),
        emDiaBoleto: conta('em_dia_boleto'),
        emDiaSemBoleto: conta('em_dia_sem_boleto'),
        atrasadoSemLinha: conta('atrasado_sem_linha'),
        erros,
        taxaResolucao: total ? resolvidas / total : null,
        taxaErros: total ? erros / total : null,
        errosPorTela,
        porDia,
        tempoMedioMs: duracoes.length ? Math.round(duracoes.reduce((s, n) => s + n, 0) / duracoes.length) : null,
        porOrigem,
        erros24h: { total: ult24.length, erros: ult24.filter(l => l.resultado === 'erro').length }
    };
}

function horasDesde(iso, agora) {
    return iso ? (agora.getTime() - new Date(iso).getTime()) / 3600000 : Infinity;
}

function avaliarSaude({ robo, ultimaIngestao, cacheAtualizadoEm, erros24h }, agora) {
    const itens = [];
    if (!robo || !robo.ok) itens.push({ item: 'Robô', nivel: 'vermelho', detalhe: 'Não respondeu' });
    else if (robo.ms < 5000) itens.push({ item: 'Robô', nivel: 'verde', detalhe: `No ar (versão ${String(robo.commit || '').slice(0, 7)})` });
    else itens.push({ item: 'Robô', nivel: 'amarelo', detalhe: `Acordando (${Math.round(robo.ms / 1000)} s)` });

    const hIng = horasDesde(ultimaIngestao && ultimaIngestao.quando, agora);
    if (ultimaIngestao && ultimaIngestao.status === 'ok' && hIng < 26) {
        itens.push({ item: 'Último export', nivel: 'verde', detalhe: `${ultimaIngestao.cpfs} CPFs há ${Math.round(hIng)} h` });
    } else if (ultimaIngestao) {
        itens.push({ item: 'Último export', nivel: 'vermelho', detalhe: ultimaIngestao.status === 'ok' ? `Há ${Math.round(hIng)} h` : `Rejeitado (${ultimaIngestao.cpfs} CPFs)` });
    } else {
        itens.push({ item: 'Último export', nivel: 'vermelho', detalhe: 'Nenhum registro' });
    }

    const hCache = horasDesde(cacheAtualizadoEm, agora);
    itens.push(hCache < 26
        ? { item: 'Idade do cache', nivel: 'verde', detalhe: `${Math.round(hCache)} h` }
        : { item: 'Idade do cache', nivel: 'vermelho', detalhe: cacheAtualizadoEm ? `${Math.round(hCache)} h` : 'Desconhecida' });

    const tx = erros24h && erros24h.total ? erros24h.erros / erros24h.total : 0;
    itens.push({ item: 'Erros nas últimas 24h', nivel: tx < 0.10 ? 'verde' : tx <= 0.25 ? 'amarelo' : 'vermelho',
        detalhe: `${erros24h ? erros24h.erros : 0} de ${erros24h ? erros24h.total : 0}` });
    return itens;
}

module.exports = { agregarDashboard, avaliarSaude };
```

- [ ] **Step 5: Implementar `n8n/painel/usuarios.js`**

```js
// Regras de usuarios do painel. Usuario do painel = usuario do Supabase Auth com app_metadata.painel === true.

const PAPEIS = ['super_admin', 'membro'];

function usuarioDoAuth(u) {
    if (!u || !u.app_metadata || u.app_metadata.painel !== true) return null;
    const m = u.app_metadata;
    return { id: u.id, email: String(u.email || '').toLowerCase(), nome: m.nome || '', papel: m.papel, ativo: m.ativo !== false };
}

function validarNovaSenha(senha) {
    return typeof senha === 'string' && senha.length >= 10 ? { ok: true } : { ok: false, erro: 'A senha precisa ter pelo menos 10 caracteres.' };
}

const falha = (erro) => ({ ok: false, erro });

function validarAlteracaoUsuario(usuarios, atorEmail, pedido) {
    const lista = Array.isArray(usuarios) ? usuarios : [];
    const ator = lista.find(u => u.email === String(atorEmail || '').toLowerCase());
    if (!ator || !ator.ativo || ator.papel !== 'super_admin') return falha('Apenas o super administrador pode gerenciar usuários.');
    const p = pedido || {};
    const email = String(p.email || '').trim().toLowerCase();

    if (p.tipo === 'criar') {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return falha('E-mail inválido.');
        if (!String(p.nome || '').trim()) return falha('Informe o nome.');
        if (!PAPEIS.includes(p.papel)) return falha('Papel inválido.');
        const s = validarNovaSenha(p.senha); if (!s.ok) return s;
        if (lista.some(u => u.email === email)) return falha('Já existe um usuário com esse e-mail.');
        return { ok: true };
    }

    const alvo = lista.find(u => u.email === email);
    if (!['atualizar', 'remover', 'redefinir_senha'].includes(p.tipo)) return falha('Ação inválida.');
    if (!alvo) return falha('Usuário não encontrado.');

    if (p.tipo === 'redefinir_senha') return validarNovaSenha(p.senha);

    const ehVoceMesmo = alvo.email === ator.email;
    const rebaixa = p.tipo === 'atualizar' && p.papel !== undefined && p.papel !== 'super_admin';
    const desativa = p.tipo === 'atualizar' && p.ativo === false;
    if (p.tipo === 'atualizar' && p.papel !== undefined && !PAPEIS.includes(p.papel)) return falha('Papel inválido.');
    if (ehVoceMesmo && (p.tipo === 'remover' || rebaixa || desativa)) return falha('Você não pode remover, rebaixar ou desativar você mesmo.');

    const tiraSuper = alvo.papel === 'super_admin' && alvo.ativo && (p.tipo === 'remover' || rebaixa || desativa);
    const superAtivos = lista.filter(u => u.papel === 'super_admin' && u.ativo).length;
    if (tiraSuper && superAtivos <= 1) return falha('Precisa sobrar pelo menos um super administrador ativo.');
    return { ok: true };
}

module.exports = { usuarioDoAuth, validarAlteracaoUsuario, validarNovaSenha };
```

- [ ] **Step 6: Implementar `n8n/painel/gerar-codigo-no.js`**

Ele monta o jsCode de cada nó Code: o corpo dos módulos (sem `module.exports`) mais um "adaptador" do nó. `SERVICE_KEY` aparece como o placeholder literal `'__SUPABASE_SERVICE_KEY__'`, que o executor da Task 3/5 troca pela chave real só no payload MCP.

```js
#!/usr/bin/env node
// Uso: node n8n/painel/gerar-codigo-no.js <no>  -> imprime o jsCode do no Code do n8n
const fs = require('fs');
const path = require('path');

const mod = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8').replace(/^module\.exports\s*=.*$/m, '').trim();

const ADAPTADORES = {
    // Workflow de consulta: roda depois de "Responder ao Site". Entrada: a resposta enviada ao site.
    'registrar-consulta': ['consulta_log.js'], 
    'registrar-evento-front': ['consulta_log.js'],
    'montar-dashboard': ['dashboard.js'],
    'painel-api': ['usuarios.js']
};

const CORPOS = {
    'registrar-consulta': `
const resposta = $json;
const inicio = $('Validar CPF').first().json.inicioMs;
const cpf = String($('Validar CPF').first().json.cpf || '').replace(/\\D/g, '');
const quando = new Date().toISOString();
const c = classificarConsulta(resposta);
const log = { quando, resultado: c.resultado, tela: c.tela, code: c.code, origem: c.origem,
  duracao_ms: inicio ? Date.now() - inicio : null, qtd_boletos: c.qtd_boletos };
const planilha = c.resultado === 'erro' ? linhaPlanilhaErro({ quando, cpf, tela: c.tela, code: c.code, detalhe: resposta.detalhe }) : null;
return [{ json: { log, planilha } }];`,
    'registrar-evento-front': `
const b = $json.body || {};
const CODES = ['cpf_invalido', 'timeout_navegador', 'desconhecido'];
const code = CODES.includes(b.code) ? b.code : 'desconhecido';
const cpf = String(b.cpf || '').replace(/\\D/g, '').slice(0, 11);
const quando = new Date().toISOString();
const c = classificarConsulta({ status: 'erro', code });
const duracao = Number(b.duracao_ms);
const log = { quando, resultado: 'erro', tela: c.tela, code, origem: 'navegador',
  duracao_ms: Number.isFinite(duracao) && duracao >= 0 && duracao < 600000 ? Math.round(duracao) : null, qtd_boletos: 0 };
return [{ json: { log, planilha: linhaPlanilhaErro({ quando, cpf, tela: c.tela, code }) } }];`,
    'montar-dashboard': `
const pedido = $('Autenticar e Rotear').first().json;
const linhas = $('Ler Log Consultas').all().map(i => i.json).filter(l => l && l.quando);
const ingestoes = $('Ler Log Ingestoes').all().map(i => i.json).filter(l => l && l.quando)
  .sort((a, b) => String(b.quando).localeCompare(String(a.quando)));
const agora = new Date();
const d = agregarDashboard(linhas, pedido.de, pedido.ate, agora);
const SERVICE_KEY = '__SUPABASE_SERVICE_KEY__';
let robo = { ok: false };
try {
  const t0 = Date.now();
  const v = await this.helpers.httpRequest({ method: 'GET', url: 'https://rob-sponte-r2vk.onrender.com/versao', json: true, timeout: 60000 });
  robo = { ok: true, ms: Date.now() - t0, commit: v && v.commit };
} catch (e) { robo = { ok: false }; }
let cacheAtualizadoEm = null;
try {
  const r = await this.helpers.httpRequest({ method: 'GET', json: true, timeout: 15000,
    url: 'https://udvkjlnvcttzrhscsecg.supabase.co/rest/v1/alunos_cache?select=data_atualizacao&order=data_atualizacao.desc&limit=1',
    headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY } });
  cacheAtualizadoEm = r && r[0] ? r[0].data_atualizacao : null;
} catch (e) {}
const u = ingestoes[0] || null;
const saude = avaliarSaude({ robo, cacheAtualizadoEm, erros24h: d.erros24h,
  ultimaIngestao: u ? { quando: u.quando, status: u.status, cpfs: u.cpfs, filtro: u.filtro } : null }, agora);
return [{ json: { status: 200, corpo: { ok: true, dashboard: d, saude, ultimaIngestao: u, planilhaUrl: pedido.planilhaUrl, usuario: pedido.usuario } } }];`,
    'painel-api': fs.readFileSync(path.join(__dirname, 'painel_api_corpo.js'), 'utf8')
};

const no = process.argv[2];
if (!ADAPTADORES[no]) { console.error('No desconhecido: ' + no + '. Use: ' + Object.keys(ADAPTADORES).join(', ')); process.exit(1); }
process.stdout.write(ADAPTADORES[no].map(mod).join('\n\n') + '\n\n' + CORPOS[no].trim() + '\n');
```

E criar `n8n/painel/painel_api_corpo.js`. É o corpo do nó `Autenticar e Rotear` da Task 5, com as funções de `usuarios.js` já em escopo. Ele não usa `require` e não tem `module.exports` (é só corpo de nó):

```js
// Corpo do no "Autenticar e Rotear" (workflow [CIA] Painel Admin [PROD]). Funcoes de usuarios.js ja estao em escopo.
const SUPA = 'https://udvkjlnvcttzrhscsecg.supabase.co';
const SERVICE_KEY = '__SUPABASE_SERVICE_KEY__';
const PLANILHA_URL = '__PLANILHA_URL__';
const req = $json;
const body = req.body || {};
const acao = String(body.acao || '');
const auth = String((req.headers && (req.headers.authorization || req.headers.Authorization)) || '');
const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
const admin = { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY };
const http = (o) => this.helpers.httpRequest(Object.assign({ json: true, timeout: 20000 }, o));
const resp = (status, corpo) => [{ json: { status, corpo } }];
const erroGenericoLogin = () => resp(401, { ok: false, erro: 'E-mail ou senha inválidos.' });

async function listarUsuarios() {
  const r = await http({ method: 'GET', url: SUPA + '/auth/v1/admin/users?per_page=1000', headers: admin });
  return (r.users || []).map(usuarioDoAuth).filter(Boolean);
}
async function sessao(grant, dados) {
  let r;
  try {
    r = await http({ method: 'POST', url: SUPA + '/auth/v1/token?grant_type=' + grant, headers: { apikey: SERVICE_KEY }, body: dados });
  } catch (e) { return erroGenericoLogin(); }
  const u = usuarioDoAuth(r.user);
  if (!u || !u.ativo) return erroGenericoLogin();
  return resp(200, { ok: true, access_token: r.access_token, refresh_token: r.refresh_token, expires_at: r.expires_at,
    usuario: { email: u.email, nome: u.nome, papel: u.papel } });
}

if (acao === 'login') return await sessao('password', { email: String(body.email || '').trim().toLowerCase(), password: String(body.senha || '') });
if (acao === 'refresh') return await sessao('refresh_token', { refresh_token: String(body.refresh_token || '') });

// Demais acoes: exige sessao valida de usuario ativo do painel
let eu;
try {
  const r = await http({ method: 'GET', url: SUPA + '/auth/v1/user', headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + token } });
  eu = usuarioDoAuth(r);
} catch (e) { eu = null; }
if (!token || !eu || !eu.ativo) return resp(401, { ok: false, erro: 'sessao_expirada' });
const usuario = { email: eu.email, nome: eu.nome, papel: eu.papel };

if (acao === 'dashboard') {
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const ok = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''));
  const ate = ok(body.ate) ? body.ate : hoje;
  const de = ok(body.de) ? body.de : new Date(Date.parse(ate + 'T12:00:00Z') - 6 * 86400000).toISOString().slice(0, 10);
  if (de > ate) return resp(400, { ok: false, erro: 'Período inválido.' });
  // dia anterior em UTC cobre o fuso de SP no filtro do Data Table
  const desdeIso = new Date(Date.parse(de + 'T00:00:00Z') - 86400000).toISOString();
  return [{ json: { precisaDashboard: true, de, ate, desdeIso, usuario, planilhaUrl: PLANILHA_URL } }];
}

if (acao === 'eu') return resp(200, { ok: true, usuario, planilhaUrl: PLANILHA_URL });

if (acao === 'trocar_senha') {
  const v = validarNovaSenha(body.senha_nova);
  if (!v.ok) return resp(400, { ok: false, erro: v.erro });
  await http({ method: 'PUT', url: SUPA + '/auth/v1/user', headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + token }, body: { password: body.senha_nova } });
  return resp(200, { ok: true });
}

if (!acao.startsWith('usuarios_')) return resp(400, { ok: false, erro: 'Ação inválida.' });
if (eu.papel !== 'super_admin') return resp(403, { ok: false, erro: 'Apenas o super administrador pode gerenciar usuários.' });

const usuarios = await listarUsuarios();
if (acao === 'usuarios_listar') return resp(200, { ok: true, usuarios: usuarios.map(u => ({ email: u.email, nome: u.nome, papel: u.papel, ativo: u.ativo })) });

const TIPO = { usuarios_criar: 'criar', usuarios_atualizar: 'atualizar', usuarios_remover: 'remover', usuarios_redefinir_senha: 'redefinir_senha' }[acao];
if (!TIPO) return resp(400, { ok: false, erro: 'Ação inválida.' });
const pedido = Object.assign({}, body, { tipo: TIPO, email: String(body.email || '').trim().toLowerCase() });
const v = validarAlteracaoUsuario(usuarios, eu.email, pedido);
if (!v.ok) return resp(400, { ok: false, erro: v.erro });
const alvo = usuarios.find(u => u.email === pedido.email);

if (TIPO === 'criar') {
  const meta = { painel: true, papel: pedido.papel, nome: String(pedido.nome).trim(), ativo: true };
  try {
    await http({ method: 'POST', url: SUPA + '/auth/v1/admin/users', headers: admin,
      body: { email: pedido.email, password: pedido.senha, email_confirm: true, app_metadata: meta } });
  } catch (e) {
    // e-mail ja existe no Auth (mas nao no painel): reaproveita
    const r = await http({ method: 'GET', url: SUPA + '/auth/v1/admin/users?per_page=1000', headers: admin });
    const existente = (r.users || []).find(x => String(x.email).toLowerCase() === pedido.email);
    if (!existente) return resp(500, { ok: false, erro: 'Não foi possível criar o usuário.' });
    await http({ method: 'PUT', url: SUPA + '/auth/v1/admin/users/' + existente.id, headers: admin,
      body: { password: pedido.senha, email_confirm: true, app_metadata: meta, ban_duration: 'none' } });
  }
  return resp(200, { ok: true });
}
if (TIPO === 'redefinir_senha') {
  await http({ method: 'PUT', url: SUPA + '/auth/v1/admin/users/' + alvo.id, headers: admin, body: { password: pedido.senha } });
  return resp(200, { ok: true });
}
if (TIPO === 'remover') {
  await http({ method: 'DELETE', url: SUPA + '/auth/v1/admin/users/' + alvo.id, headers: admin });
  return resp(200, { ok: true });
}
// atualizar
const meta = { painel: true, papel: pedido.papel !== undefined ? pedido.papel : alvo.papel,
  nome: pedido.nome !== undefined ? String(pedido.nome).trim() : alvo.nome,
  ativo: pedido.ativo !== undefined ? pedido.ativo === true : alvo.ativo };
const corpo = { app_metadata: meta };
if (pedido.ativo !== undefined) corpo.ban_duration = meta.ativo ? 'none' : '876000h';
await http({ method: 'PUT', url: SUPA + '/auth/v1/admin/users/' + alvo.id, headers: admin, body: corpo });
return resp(200, { ok: true });
```

Nota: o gerador não compila `painel_api_corpo.js` isoladamente; o teste do gerador cobre isso (corpo + `usuarios.js`, dentro de função async).

- [ ] **Step 7: Rodar e ver passar**

Run: `npm test`
Expected: tudo PASS (os 17 testes antigos + os novos), saída limpa.

- [ ] **Step 8: Commit**

```bash
git add n8n/painel/consulta_log.js n8n/painel/dashboard.js n8n/painel/usuarios.js n8n/painel/gerar-codigo-no.js n8n/painel/painel_api_corpo.js test/painel/consulta_log.test.js test/painel/dashboard.test.js test/painel/usuarios.test.js test/painel/gerar_codigo_no.test.js
git commit -m "feat(painel): modulos puros (log de consulta, dashboard, usuarios) + gerador de codigo dos nos n8n

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Infra n8n — Data Tables e planilha de erros

**Interfaces (produz):**
- Data Table `cia_consultas_log`, colunas: `quando` (string ISO), `resultado` (string), `tela` (string), `code` (string), `origem` (string), `duracao_ms` (number), `qtd_boletos` (number).
- Data Table `cia_ingestoes_log`, colunas: `quando` (string ISO), `gerado_em` (string), `status` (string: `ok`|`rejeitado`), `cpfs` (number), `devedores` (number), `filtro` (boolean), `motivo` (string).
- Planilha "Erros - Consulta Boletos CIA": `spreadsheetId` + URL, aba `Erros` com cabeçalho na linha 1: `Data/hora | CPF | Tela do erro | Erro | Motivo do erro | Possível solução`.
- Arquivo `backups/painel-ids.json` (gitignored): `{ "consultasLogId", "ingestoesLogId", "planilhaId", "planilhaUrl" }`.

- [ ] **Step 1: Criar os Data Tables**

Carregar `mcp__n8n-mcp__create_data_table` (ToolSearch) e criar os dois tables no projeto `WqOqk61ZzmyASX4J` com as colunas acima. Se o `boolean` não existir, usar `string` com os valores `'true'`/`'false'` e registrar isso no relatório. Conferir com `search_data_tables`.

- [ ] **Step 2: Criar a planilha**

Criar um workflow temporário `TMP criar planilha erros CIA` via `create_workflow_from_code`: Manual Trigger → Google Sheets `resource: spreadsheet, operation: create` (título `Erros - Consulta Boletos CIA`, aba `Erros`, credencial `LU6wtO2xAV2RTwgO`) → Google Sheets `sheet/append` de uma linha de cabeçalho. Antes, seguir as instruções do servidor MCP: `get_sdk_reference`, `get_node_types` com discriminadores e `validate_workflow`.

Se a operação `create` não permitir definir a aba, criar e depois renomear a primeira aba, ou usar `sheet/create` para `Erros`.

Para o cabeçalho: com `append`/`autoMapInputData`, a primeira linha precisa ser o cabeçalho. Escrever a linha 1 com os 6 títulos (operação `update` na linha 1, ou `append` numa planilha vazia com "columns" = títulos, conforme o node types).

Executar com `execute_workflow`, pegar `spreadsheetId` e `spreadsheetUrl`, e depois arquivar o workflow temporário (`archive_workflow`).

- [ ] **Step 3: Compartilhar com o super admin**

Workflow temporário (ou o mesmo) com Google Drive (credencial `0nnJpmlAlgX7vw6y`), `resource: file, operation: share`: `role: writer`, `type: user`, `emailAddress: matheusalencar@amais.io`. Se a credencial do Drive não enxergar o arquivo (conta diferente da do Sheets), usar Google Sheets / Drive com a credencial `LU6wtO2xAV2RTwgO`, se o node permitir. Se nenhuma permitir, registrar como DONE_WITH_CONCERNS: a planilha fica acessível pela conta dona e o link vai no painel.

- [ ] **Step 4: Teste de escrita**

`append` de uma linha de teste (`Data/hora` = `TESTE`) e depois `delete` dessa linha, ou deixá-la e registrar que existe. Confirmar que a escrita pela credencial `LU6wtO2xAV2RTwgO` funciona.

- [ ] **Step 5: Registrar os IDs**

Escrever `backups/painel-ids.json` com os 4 valores. Nada vai para o repo.

---

### Task 3: Consulta PROD — responder antes, depois registrar (log + planilha + ingestão)

Depende das Tasks 1 e 2.

**Interfaces:**
- Consome: saída de `node n8n/painel/gerar-codigo-no.js registrar-consulta`; IDs de `backups/painel-ids.json`.
- Produz: a resposta do webhook `buscar-boletos-novo` fica igual à de hoje, com um campo a mais: `detalhe` nos erros `instabilidade` (`robo` | `api_sponte`). O erro de CPF inválido passa a ter `code: 'cpf_invalido'`. Cada consulta gera 1 linha em `cia_consultas_log`; cada erro gera 1 linha na planilha. A ingestão gera 1 linha em `cia_ingestoes_log`.

- [ ] **Step 1: Backup**

`get_workflow_details` de `W7tTXjTNvvO62wYO` → salvar o JSON em `backups/W7tTXjTNvvO62wYO-<AAAA-MM-DD-HHmm>.json` (parse com `node` se vier em arquivo).

- [ ] **Step 2: Rascunho — consulta (uma chamada `update_workflow`, atômica)**

Carregar ToolSearch `select:mcp__n8n-mcp__update_workflow,mcp__n8n-mcp__get_workflow_details,mcp__n8n-mcp__publish_workflow,mcp__n8n-mcp__get_node_types,mcp__n8n-mcp__validate_node_config`. Antes, `get_node_types` para `n8n-nodes-base.respondToWebhook`, `n8n-nodes-base.dataTable` (row/insert) e `n8n-nodes-base.googleSheets` (sheet/append), e usar os nomes exatos de parâmetro que vierem.

Operações:
1. `Webhook POST Frontend`: `setNodeParameter /responseMode = "responseNode"`. Manter `options.responseHeaders` (CORS): copiar os mesmos 3 headers para o Respond to Webhook.
2. `Validar CPF` `/jsCode`: o código atual, com `inicioMs: Date.now()` nos dois `return`, e o `return` de erro passando a `{ error: true, message: 'CPF invalido', inicioMs: Date.now() }`.
3. `Retornar Erro CPF` `/jsCode` = `return [{ json: { status: 'erro', code: 'cpf_invalido', message: 'CPF invalido fornecido.' } }];`
4. `Nao Encontrado Response` `/jsCode` = `return [{ json: { falhou: true, code: $json.apiErro ? 'instabilidade' : 'nao_encontrado', detalhe: $json.apiErro ? 'api_sponte' : undefined } }];`
5. `Responder Erro` `/jsCode`: o atual, com `detalhe` no retorno: `return [{ json: { status: 'erro', code, message: f.message || msgs[code] || msgs.instabilidade, detalhe: f.detalhe || (code === 'instabilidade' ? 'robo' : undefined) } }];` (ler o código atual e alterar só o `return`).
6. `addNode` `Responder ao Site`: `n8n-nodes-base.respondToWebhook`, typeVersion da node types, responde com JSON = `{{ $json }}` (modo "first incoming item"/`firstIncomingItem` ou `respondWith: json` com `responseBody: ={{ JSON.stringify($json) }}`, conforme o schema), com os 3 headers CORS.
7. `addNode` `Registrar Consulta`: Code v2, `jsCode` = saída **exata** de `node n8n/painel/gerar-codigo-no.js registrar-consulta`. Settings `onError: continueRegularOutput`.
8. `addNode` `Gravar Log Consulta`: dataTable row/insert no table `cia_consultas_log` (id do `painel-ids.json`), mapeando as 7 colunas de `{{ $json.log.<coluna> }}`. Settings `onError: continueRegularOutput`.
9. `addNode` `Foi Erro?`: IF v1 boolean `={{ !!$('Registrar Consulta').first().json.planilha }}` = true.
10. `addNode` `Anotar Planilha`: googleSheets sheet/append, documento = planilhaId, aba `Erros`, credencial `LU6wtO2xAV2RTwgO`. Colunas mapeadas manualmente: cada título ← `{{ $('Registrar Consulta').first().json.planilha['<Título>'] }}`. Settings `onError: continueRegularOutput`, `retryOnFail: true`, `maxTries: 2`.
11. Conexões:
    - `Formatar Cache`, `Responder Live`, `Responder Erro`, `Retornar Erro CPF` → `Responder ao Site`;
    - `Responder ao Site` → `Registrar Consulta` → `Gravar Log Consulta` → `Foi Erro?` → (true) `Anotar Planilha`.
12. Posições legíveis (à direita dos terminais).

Motivo da ordem: a resposta sai no `Responder ao Site`, antes de qualquer log (Review Focus 5).

Atenção: o webhook `OPTIONS` e a `Resposta CORS` ficam como estão (o OPTIONS tem responseMode próprio).

- [ ] **Step 3: Rascunho — ingestão (segunda chamada `update_workflow`)**

1. `Validar Lote`: `setNodeSettings { onError: 'continueErrorOutput' }`.
2. `addNode` `Registrar Rejeicao` (Code): `const b = $('Webhook (Cache Processado)').first().json.body || {}; const p = Array.isArray(b.payload) ? b.payload : []; return [{ json: { quando: new Date().toISOString(), gerado_em: String(b.geradoEm || ''), status: 'rejeitado', cpfs: p.length, devedores: p.filter(i => i && (i.status_sponte === 'negociar' || i.status_sponte === 'pagar_atrasados')).length, filtro: b.filtroSituacaoAplicado === true, motivo: String(($json.error && $json.error.message) || $json.message || 'rejeitado').slice(0, 300) } }];`
3. `addNode` `Gravar Rejeicao`: dataTable insert em `cia_ingestoes_log` (7 colunas de `$json`), `onError: continueRegularOutput`.
4. `addNode` `Responder Rejeicao`: Code `return [{ json: { ok: false, erro: 'lote_rejeitado' } }];`. O webhook de ingestão é `lastNode`, então isso vira a resposta. Ruling: resposta HTTP 200 com `ok:false`. O robô trata como sucesso de POST; ele não tem como corrigir um lote ruim, e o 5xx faria repetir. Custo: o robô não loga a rejeição, mas o painel mostra.
5. `Resumo Ingestao` `/jsCode`: o atual, com os campos a gravar: `const blocos = $('Validar Lote').all(); const b = $('Webhook (Cache Processado)').first().json.body || {}; const p = Array.isArray(b.payload) ? b.payload : []; return [{ json: { ok: true, cpfs: p.length, geradoEm: b.geradoEm, quando: new Date().toISOString(), gerado_em: String(b.geradoEm || ''), status: 'ok', devedores: p.filter(i => i && (i.status_sponte === 'negociar' || i.status_sponte === 'pagar_atrasados')).length, filtro: b.filtroSituacaoAplicado === true, motivo: '' } }];`
6. `addNode` `Gravar Ingestao`: dataTable insert em `cia_ingestoes_log`, `onError: continueRegularOutput`, `executeOnce: true`.
7. `addNode` `Resposta Ingestao`: Code `return [{ json: { ok: true, cpfs: $('Resumo Ingestao').first().json.cpfs } }];`
8. Conexões: `Validar Lote` saída de erro (index 1) → `Registrar Rejeicao` → `Gravar Rejeicao` → `Responder Rejeicao`; `Resumo Ingestao` → `Gravar Ingestao` → `Resposta Ingestao`.

- [ ] **Step 4: Validar e publicar**

`validate_workflow` (se disponível), depois `get_workflow_details` para conferir conexões, depois `publish_workflow`. Confirmar `activeVersionId === versionId`.

- [ ] **Step 5: Testar em produção**

```bash
for c in 07667401373 61600960367 11144477735; do curl -s -m 200 -X POST https://n8n.amais.io/webhook/buscar-boletos-novo -H 'Content-Type: application/json' -d "{\"cpf\":\"$c\"}" | head -c 300; echo; done
curl -s -m 30 -X POST https://n8n.amais.io/webhook/buscar-boletos-novo -H 'Content-Type: application/json' -d '{"cpf":"123"}'; echo
curl -s -m 30 -i -X OPTIONS https://n8n.amais.io/webhook/buscar-boletos-novo | head -5
```

Expected:
- as respostas têm o mesmo formato de antes;
- o inexistente traz `code:'nao_encontrado'`;
- `123` traz `code:'cpf_invalido'`;
- o POST continua com o header `Access-Control-Allow-Origin: *` (verificar com `curl -i`).

Depois, via `get_rows`/execução ou um workflow de leitura: 4 linhas novas em `cia_consultas_log` (resultados coerentes) e 2 linhas novas na planilha (inexistente + CPF inválido).

Teste da guarda: POST de 3 itens para `https://n8n.amais.io/webhook/sponte-cache-<suffix>` (sufixo em `backups/cache-webhook-suffix.txt`, nunca escrito em relatório) → resposta `{ok:false, erro:'lote_rejeitado'}` e 1 linha `rejeitado` em `cia_ingestoes_log`.

---

### Task 4: Workflow `[CIA] Eventos do Site [PROD]`

Depende das Tasks 1 e 2.

**Interfaces:**
- `POST https://n8n.amais.io/webhook/registrar-evento-front`, corpo `{ cpf, code, duracao_ms }` (JSON; o `sendBeacon` manda `text/plain`, então o workflow precisa aceitar body texto). Responde `204`.

- [ ] **Step 1: Criar o workflow** via `create_workflow_from_code`, seguindo SDK reference, node types e validate:
  - `Webhook` POST `registrar-evento-front`, `responseMode: onReceived`, `responseCode: 204`, header `Access-Control-Allow-Origin: *`, opção de raw body se necessária para `text/plain`.
  - `Normalizar Corpo` (Code): se `$json.body` for string, `JSON.parse` dentro de try; senão usa o objeto; devolve `{ body }`.
  - `Registrar Evento` (Code) = saída exata de `node n8n/painel/gerar-codigo-no.js registrar-evento-front`.
  - `Gravar Log` (dataTable insert em `cia_consultas_log`, de `$json.log`).
  - `Anotar Planilha` (append, de `$('Registrar Evento').first().json.planilha`, mesmo mapeamento da Task 3).
  - Os 2 últimos com `onError: continueRegularOutput`.
- [ ] **Step 2: Publicar e testar**

```bash
curl -s -m 30 -o /dev/null -w "%{http_code}\n" -X POST https://n8n.amais.io/webhook/registrar-evento-front -H 'Content-Type: text/plain' -d '{"cpf":"12345678900","code":"cpf_invalido"}'
curl -s -m 30 -o /dev/null -w "%{http_code}\n" -X POST https://n8n.amais.io/webhook/registrar-evento-front -H 'Content-Type: application/json' -d '{"cpf":"<script>","code":"hack","duracao_ms":"x"}'
```

Expected: `204` e `204`. Resultado: 2 linhas no log, a segunda com `code: 'desconhecido'`, CPF vazio e `duracao_ms: null`, e 2 linhas na planilha.

---

### Task 5: Workflow `[CIA] Painel Admin [PROD]` + super admin inicial

Depende das Tasks 1 e 2.

**Interfaces (contrato usado pela Task 7):**
- `POST https://n8n.amais.io/webhook/painel-api`, headers `Content-Type: application/json` e `Authorization: Bearer <access_token>` (exceto em `login`/`refresh`). Resposta: HTTP status do campo `status`; corpo JSON.
- Respostas:
  - `login` `{acao:'login', email, senha}` → 200 `{ ok:true, access_token, refresh_token, expires_at, usuario:{email,nome,papel} }` | 401 `{ ok:false, erro:'E-mail ou senha inválidos.' }`
  - `refresh` `{acao:'refresh', refresh_token}` → igual ao login
  - `eu` → 200 `{ ok:true, usuario, planilhaUrl }`
  - `dashboard` `{acao:'dashboard', de?, ate?}` → 200 `{ ok:true, dashboard: <agregarDashboard>, saude: <avaliarSaude>, ultimaIngestao, planilhaUrl, usuario }`
  - `trocar_senha` `{senha_nova}` → 200 `{ok:true}` | 400 `{ok:false, erro}`
  - `usuarios_listar` → 200 `{ ok:true, usuarios:[{email,nome,papel,ativo}] }`
  - `usuarios_criar` `{email,nome,papel,senha}` / `usuarios_atualizar` `{email, nome?, papel?, ativo?}` / `usuarios_redefinir_senha` `{email, senha}` / `usuarios_remover` `{email}` → 200 `{ok:true}` | 400 `{ok:false, erro}` | 403
  - sessão inválida → 401 `{ ok:false, erro:'sessao_expirada' }`
- CORS em todas as respostas e no OPTIONS: `Access-Control-Allow-Origin: https://rob-sponte-2.vercel.app`, `Access-Control-Allow-Methods: POST, OPTIONS`, `Access-Control-Allow-Headers: Content-Type, Authorization`.

- [ ] **Step 1: Verificar `this.helpers.httpRequest` no nó Code**

Workflow temporário: Manual Trigger → Code `const r = await this.helpers.httpRequest({ method:'GET', url:'https://rob-sponte-r2vk.onrender.com/ping', timeout: 60000 }); return [{ json: { r } }];` → `execute_workflow` → esperar `r: 'pong'`. Depois arquivar.

Se não funcionar, parar e reportar BLOCKED com o erro. O desenho depende disso.

- [ ] **Step 2: Criar o workflow** via `create_workflow_from_code` (SDK reference → node types → validate):
  - `Webhook API`: POST `painel-api`, `responseMode: responseNode`.
  - `Webhook OPTIONS`: `painel-api`, OPTIONS, `onReceived`, com os 3 headers CORS.
  - `Autenticar e Rotear` (Code v2): jsCode = saída exata de `node n8n/painel/gerar-codigo-no.js painel-api`, trocando `__SUPABASE_SERVICE_KEY__` pela service key (lida do nó `Upsert Supabase` do PROD via `get_workflow_details`, sem imprimir) e `__PLANILHA_URL__` pela `planilhaUrl` de `backups/painel-ids.json`.
  - `É Dashboard?` (IF `={{ $json.precisaDashboard === true }}`):
    - true → `Ler Log Consultas`: dataTable row/get, table `cia_consultas_log`, `returnAll: true`, filtro `quando` ≥ `{{ $('Autenticar e Rotear').first().json.desdeIso }}` (condição de comparação de string/data conforme node types; se o filtro ≥ não existir para string, ler tudo e deixar a agregação filtrar). Settings `alwaysOutputData: true`, `executeOnce: true`.
    - depois → `Ler Log Ingestoes`: row/get, table `cia_ingestoes_log`, `returnAll: true`, `alwaysOutputData: true`, `executeOnce: true`.
    - depois → `Montar Dashboard` (Code, jsCode = `gerar-codigo-no.js montar-dashboard` com a key substituída) → `Responder API`.
  - false → `Responder API`.
  - `Responder API`: respondToWebhook, `respondWith: json`, corpo `={{ JSON.stringify($json.corpo) }}`, código de resposta `={{ $json.status }}`, headers CORS.
  - Settings de `Autenticar e Rotear`: `onError: continueErrorOutput` → `Erro Interno` (Code `return [{ json: { status: 500, corpo: { ok:false, erro:'Erro interno. Tente de novo.' } } }];`) → `Responder API`.
- [ ] **Step 3: Publicar e criar o super admin**

Gerar uma senha provisória de 16 caracteres: `node -e "console.log(require('crypto').randomBytes(12).toString('base64url'))"`. Salvar em `backups/super-admin-senha.txt` (gitignored). Não imprimir no relatório.

Criar o usuário direto na admin API do Supabase (Bash com a service key): `POST /auth/v1/admin/users` `{ email:'matheusalencar@amais.io', password:<senha>, email_confirm:true, app_metadata:{ painel:true, papel:'super_admin', nome:'Matheus Alencar', ativo:true } }`. Pelo painel não dá, porque ainda não existe nenhum super admin.

- [ ] **Step 4: Testar o contrato (curl, produção)**

Com `SENHA` lida do arquivo e `API=https://n8n.amais.io/webhook/painel-api`:
1. `login` errado → 401 com mensagem genérica.
2. `login` certo → 200 com `access_token`. Guardar `TK`.
3. `dashboard` sem token → 401 `sessao_expirada`.
4. `dashboard` com `TK` → 200, com `dashboard.total` ≥ 4 (consultas da Task 3) e `saude` com 4 itens.
5. `usuarios_criar` membro teste `painel-teste+<timestamp>@amais.io` com senha `TesteSenha123` → 200.
6. Login do membro → 200. `usuarios_listar` com o token do membro → 403.
7. `usuarios_remover` a si mesmo (super) → 400 "Você não pode…".
8. `usuarios_atualizar` do membro `{ativo:false}` → 200; login do membro → 401. `{ativo:true}` → 200; login → 200.
9. `usuarios_redefinir_senha` do membro → 200; login com a senha nova → 200.
10. Membro `trocar_senha` com senha curta → 400; com 10+ caracteres → 200.
11. `usuarios_remover` do membro → 200; `usuarios_listar` não tem mais o membro.
12. `curl -i -X OPTIONS $API` → headers CORS presentes.

Registrar cada resposta (≤ 300 caracteres, sem tokens) no relatório.

---

### Task 6: Site — beacons de erro do navegador + rota do painel

**Files:**
- Modify: `rob-sponte-2/frontend/script.js` (`handleFormSubmit`, catch principal e `alert("⚠️ Erro desconhecido…")`)
- Modify: `rob-sponte-2/vercel.json`

- [ ] **Step 1: Função de beacon**

No topo de `script.js` (depois das constantes existentes):

```js
// Registra no painel erros que so o navegador ve (CPF invalido, timeout, erro desconhecido)
const URL_EVENTO = 'https://n8n.amais.io/webhook/registrar-evento-front';
function registrarEventoErro(code, cpf, duracaoMs) {
    try {
        const corpo = JSON.stringify({ code, cpf: String(cpf || '').replace(/\D/g, '').slice(0, 11), duracao_ms: duracaoMs == null ? null : Math.round(duracaoMs) });
        if (navigator.sendBeacon) navigator.sendBeacon(URL_EVENTO, corpo);
        else fetch(URL_EVENTO, { method: 'POST', body: corpo, keepalive: true }).catch(() => {});
    } catch (e) { /* nunca atrapalha o site */ }
}
```

- [ ] **Step 2: Chamar nos 3 pontos**
  - Em `handleFormSubmit`, no `if (!validarCPF(cpf)) {`, antes do `return`: `registrarEventoErro('cpf_invalido', cpf, null);`
  - Guardar `const inicioConsulta = Date.now();` logo depois de `startLoadingAnimation(); initGame();`. No `catch (error)` principal (o que abre `modalTimeout` depois das tentativas): `registrarEventoErro('timeout_navegador', cpf, Date.now() - inicioConsulta);`. O `cpf` é a variável local já existente em `handleFormSubmit`: conferir o escopo, porque o catch principal está dentro da mesma função.
  - Em `handleLegacy`, antes de `alert("⚠️ Erro desconhecido ao processar o retorno. Tente novamente mais tarde.");`: `registrarEventoErro('desconhecido', document.getElementById('cpf').value, null);`
- [ ] **Step 3: `vercel.json`**

Rota explícita do painel antes da genérica:

```json
{
  "rewrites": [
    { "source": "/painel-f8ed7ba4777f", "destination": "/frontend/painel-f8ed7ba4777f/index.html" },
    { "source": "/painel-f8ed7ba4777f/", "destination": "/frontend/painel-f8ed7ba4777f/index.html" },
    { "source": "/(.*)", "destination": "/frontend/$1" }
  ]
}
```

- [ ] **Step 4: Checar e commitar**

`node --check frontend/script.js` → sem saída. `node -e "JSON.parse(require('fs').readFileSync('vercel.json','utf8'))"` → ok.

```bash
git add frontend/script.js vercel.json
git commit -m "feat(site): registra erros do navegador no painel + rota do painel

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Sem push (o push acontece na Task 8).

---

### Task 7: Frontend do painel

**Files (todos em `rob-sponte-2/frontend/painel-f8ed7ba4777f/`):** `index.html`, `painel.css`, `painel.js`, `api.js`, `formatos.js`, `formatos.test.js`

**Interfaces:**
- Consome: o contrato da Task 5.
- `formatos.js` exporta (em `window.Formatos` no navegador; `module.exports` no Node):
  - `formatarNumero(n)`: `1234` → `"1.234"`
  - `formatarPct(x)`: `0.875` → `"87,5%"`, e `null`/`undefined`/`NaN` → `"—"`
  - `formatarDuracao(ms)`: `1234` → `"1,2 s"`, `null` → `"—"`, `65000` → `"1 min 5 s"`
  - `formatarDia(aaaa_mm_dd)`: `"2026-09-23"` → `"23/09"`
  - `periodoPreset(nome, hoje)`, com `hoje` = `'AAAA-MM-DD'`: `'hoje'` → `{de:hoje, ate:hoje}`; `'7d'` → 7 dias até hoje; `'30d'` → 30 dias
  - `gerarSenha()`: 14 caracteres de `ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789`, usando `crypto.getRandomValues`

- [ ] **Step 1: Teste (RED)** `formatos.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const F = require('./formatos.js');

test('numero e pct', () => {
    assert.strictEqual(F.formatarNumero(1234), '1.234');
    assert.strictEqual(F.formatarNumero(0), '0');
    assert.strictEqual(F.formatarPct(0.875), '87,5%');
    assert.strictEqual(F.formatarPct(1), '100%');
    assert.strictEqual(F.formatarPct(0), '0%');
    for (const v of [null, undefined, NaN]) assert.strictEqual(F.formatarPct(v), '—');
});
test('duracao e dia', () => {
    assert.strictEqual(F.formatarDuracao(1234), '1,2 s');
    assert.strictEqual(F.formatarDuracao(65000), '1 min 5 s');
    assert.strictEqual(F.formatarDuracao(null), '—');
    assert.strictEqual(F.formatarDia('2026-09-23'), '23/09');
});
test('periodoPreset', () => {
    assert.deepStrictEqual(F.periodoPreset('hoje', '2026-09-23'), { de: '2026-09-23', ate: '2026-09-23' });
    assert.deepStrictEqual(F.periodoPreset('7d', '2026-09-23'), { de: '2026-09-17', ate: '2026-09-23' });
    assert.deepStrictEqual(F.periodoPreset('30d', '2026-03-01'), { de: '2026-01-31', ate: '2026-03-01' });
});
test('gerarSenha', () => {
    const s = F.gerarSenha();
    assert.strictEqual(s.length, 14);
    assert.match(s, /^[A-HJ-NP-Za-km-np-z2-9]+$/);
    assert.notStrictEqual(F.gerarSenha(), s);
});
```

Run: `node --test frontend/painel-f8ed7ba4777f/formatos.test.js` (no repo `rob-sponte-2`) → FAIL, módulo inexistente.

- [ ] **Step 2: `formatos.js`**

```js
(function (raiz) {
    const nf = new Intl.NumberFormat('pt-BR');
    function formatarNumero(n) { return nf.format(Number(n) || 0); }
    function formatarPct(x) {
        if (x === null || x === undefined || Number.isNaN(Number(x))) return '—';
        return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(Number(x) * 100) + '%';
    }
    function formatarDuracao(ms) {
        if (ms === null || ms === undefined || Number.isNaN(Number(ms))) return '—';
        const s = Number(ms) / 1000;
        if (s < 60) return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(s) + ' s';
        return Math.floor(s / 60) + ' min ' + Math.round(s % 60) + ' s';
    }
    function formatarDia(d) { const [, m, dia] = String(d).split('-'); return dia + '/' + m; }
    function menosDias(aaaaMmDd, n) {
        const d = new Date(aaaaMmDd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10);
    }
    function periodoPreset(nome, hoje) {
        if (nome === 'hoje') return { de: hoje, ate: hoje };
        if (nome === '30d') return { de: menosDias(hoje, 29), ate: hoje };
        return { de: menosDias(hoje, 6), ate: hoje };
    }
    function gerarSenha() {
        const A = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
        const c = (typeof crypto !== 'undefined' && crypto.getRandomValues) ? crypto : require('crypto').webcrypto;
        const b = new Uint32Array(14); c.getRandomValues(b);
        return Array.from(b, x => A[x % A.length]).join('');
    }
    const api = { formatarNumero, formatarPct, formatarDuracao, formatarDia, periodoPreset, gerarSenha };
    if (typeof module !== 'undefined' && module.exports) module.exports = api; else raiz.Formatos = api;
})(typeof window !== 'undefined' ? window : globalThis);
```

Run o teste → PASS.

- [ ] **Step 3: `api.js`** (sessão + chamadas)

```js
(function () {
    const URL_API = 'https://n8n.amais.io/webhook/painel-api';
    const CHAVE = 'painelSessao';
    let timerRefresh = null;

    function lerSessao() { try { return JSON.parse(sessionStorage.getItem(CHAVE)); } catch (e) { return null; } }
    function salvarSessao(s) { try { sessionStorage.setItem(CHAVE, JSON.stringify(s)); } catch (e) {} agendarRefresh(s); }
    function limparSessao() { try { sessionStorage.removeItem(CHAVE); } catch (e) {} clearTimeout(timerRefresh); }

    async function chamar(acao, dados, comToken = true) {
        const s = lerSessao();
        const headers = { 'Content-Type': 'application/json' };
        if (comToken && s && s.access_token) headers.Authorization = 'Bearer ' + s.access_token;
        let resp;
        try {
            resp = await fetch(URL_API, { method: 'POST', headers, body: JSON.stringify(Object.assign({ acao }, dados || {})) });
        } catch (e) {
            throw new Error('Não foi possível falar com o servidor. Tente de novo.');
        }
        let corpo = {};
        try { corpo = await resp.json(); } catch (e) { corpo = {}; }
        if (resp.status === 401 && comToken) { limparSessao(); window.dispatchEvent(new Event('painel:sessao-expirada')); }
        if (!resp.ok || corpo.ok === false) {
            const msg = corpo.erro === 'sessao_expirada' ? 'Sua sessão expirou. Entre de novo.' : (corpo.erro || 'Não foi possível concluir. Tente de novo.');
            const err = new Error(msg); err.status = resp.status; throw err;
        }
        return corpo;
    }

    function agendarRefresh(s) {
        clearTimeout(timerRefresh);
        if (!s || !s.expires_at) return;
        const emMs = s.expires_at * 1000 - Date.now() - 60000;
        timerRefresh = setTimeout(async () => {
            try { const n = await chamar('refresh', { refresh_token: s.refresh_token }, false); salvarSessao(n); }
            catch (e) { limparSessao(); window.dispatchEvent(new Event('painel:sessao-expirada')); }
        }, Math.max(emMs, 5000));
    }

    async function entrar(email, senha) { const s = await chamar('login', { email, senha }, false); salvarSessao(s); return s; }
    function sair() { limparSessao(); }

    window.PainelApi = { chamar, entrar, sair, lerSessao, agendarRefresh };
})();
```

- [ ] **Step 4: `index.html`**

Estrutura com estes IDs (usados pelo `painel.js`):
- `<head>`:
  - `<meta name="robots" content="noindex,nofollow">`, `<title>Painel · Boletos CIA</title>`, favicon `../assets/logo-cia.png`;
  - Inter (Google Fonts), Tabler icons (mesmo CDN do site);
  - `https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js`;
  - `painel.css`;
  - `formatos.js`, `api.js`, `painel.js` (`defer`).
- `#telaLogin`: form `#formLogin` com `#loginEmail` (type email, autocomplete username), `#loginSenha` (type password), botão `#btnEntrar` e `<p id="loginErro" class="erro" hidden>`.
- `#app` (hidden no início):
  - `<header>`: logo, "Painel · Boletos CIA", `#usuarioNome`, `#usuarioPapel`, botão `#btnSair`.
  - `<nav>`: botões `data-view="dashboard"`, `data-view="usuarios"` (id `#navUsuarios`, hidden para membro) e `data-view="conta"`.
  - `<section id="viewDashboard">`:
    - período: botões `data-periodo="hoje|7d|30d"`, inputs `#periodoDe` e `#periodoAte` (type date), botão `#btnAplicarPeriodo`;
    - `#cards` com 5 cards (`#cardConsultas`, `#cardDebito`, `#cardEncaminhamentos`, `#cardResolucao`, `#cardErros`; cada um com `.card-valor` e `.card-sub`);
    - `#listaErrosTela` (`<ul>`);
    - `<canvas id="graficoDias">`;
    - `#saude` (`<ul>`);
    - `#infoApoio` (tempo médio + origem);
    - link `#linkPlanilha` (target `_blank`, `rel="noopener"`, texto "Abrir planilha de erros");
    - `#dashboardErro` (hidden).
  - `<section id="viewUsuarios" hidden>`:
    - botão `#btnNovoUsuario`;
    - tabela `#tabelaUsuarios` (colunas Nome, E-mail, Papel, Status, Ações);
    - `#usuariosErro`;
    - `<dialog id="dlgUsuario">` com `#formUsuario`: `#uNome`, `#uEmail`, `#uPapel` (`membro`/`super_admin`), `#uSenha` (readonly) + botões `#btnGerarSenha` e `#btnCopiarSenha`, e `#uErro`;
    - `<dialog id="dlgConfirmar">` com `#confirmarTexto`, `#btnConfirmarSim` e `#btnConfirmarNao`.
  - `<section id="viewConta" hidden>`: `#formSenha` com `#senhaNova` e `#senhaNova2`, `#contaMsg`.
  - `#toast`: aviso de uma linha.

Todo texto visível é em pt-BR.

- [ ] **Step 5: `painel.css`**

Mesma identidade do site: ler `frontend/style.css` e reaproveitar a paleta (as variáveis `--primary`, `--error` etc. que existirem lá), Inter e cantos arredondados.
- **Layout:** header fixo; conteúdo com `max-width: 1100px`; cards em grid `repeat(auto-fit, minmax(180px, 1fr))`.
- **Saúde:** bolinha colorida com as classes `.nivel-verde`, `.nivel-amarelo` e `.nivel-vermelho`.
- **Tabela:** a de usuários rola na horizontal dentro do próprio container no mobile.
- **Diálogos:** `max-width: 92vw`.
- **Mobile:** em 360 px não pode haver scroll horizontal na página. Nav e período quebram linha.
- **Foco:** foco visível nos botões e inputs.

- [ ] **Step 6: `painel.js`**

```js
(function () {
    const F = window.Formatos, API = window.PainelApi;
    const $ = (id) => document.getElementById(id);
    let grafico = null, usuarioAtual = null, periodo = null;
    const hojeSP = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

    function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, 3500); }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

    function mostrarLogin(msg) {
        $('app').hidden = true; $('telaLogin').hidden = false;
        if (msg) { $('loginErro').textContent = msg; $('loginErro').hidden = false; }
    }
    function mostrarApp(usuario) {
        usuarioAtual = usuario;
        $('telaLogin').hidden = true; $('app').hidden = false;
        $('usuarioNome').textContent = usuario.nome || usuario.email;
        $('usuarioPapel').textContent = usuario.papel === 'super_admin' ? 'Super administrador' : 'Membro';
        $('navUsuarios').hidden = usuario.papel !== 'super_admin';
        irPara('dashboard');
    }
    function irPara(view) {
        if (view === 'usuarios' && usuarioAtual.papel !== 'super_admin') view = 'dashboard';
        for (const v of ['dashboard', 'usuarios', 'conta']) $('view' + v[0].toUpperCase() + v.slice(1)).hidden = v !== view;
        document.querySelectorAll('nav [data-view]').forEach(b => b.classList.toggle('ativo', b.dataset.view === view));
        if (view === 'dashboard') carregarDashboard();
        if (view === 'usuarios') carregarUsuarios();
    }

    // ---------- Login ----------
    $('formLogin').addEventListener('submit', async (e) => {
        e.preventDefault();
        $('loginErro').hidden = true; $('btnEntrar').disabled = true;
        try { const s = await API.entrar($('loginEmail').value.trim(), $('loginSenha').value); $('loginSenha').value = ''; mostrarApp(s.usuario); }
        catch (err) { $('loginErro').textContent = err.message; $('loginErro').hidden = false; }
        finally { $('btnEntrar').disabled = false; }
    });
    $('btnSair').addEventListener('click', () => { API.sair(); mostrarLogin(); });
    window.addEventListener('painel:sessao-expirada', () => mostrarLogin('Sua sessão expirou. Entre de novo.'));
    document.querySelectorAll('nav [data-view]').forEach(b => b.addEventListener('click', () => irPara(b.dataset.view)));

    // ---------- Dashboard ----------
    function definirPeriodo(p) { periodo = p; $('periodoDe').value = p.de; $('periodoAte').value = p.ate; }
    document.querySelectorAll('[data-periodo]').forEach(b => b.addEventListener('click', () => {
        document.querySelectorAll('[data-periodo]').forEach(x => x.classList.toggle('ativo', x === b));
        definirPeriodo(F.periodoPreset(b.dataset.periodo, hojeSP())); carregarDashboard();
    }));
    $('btnAplicarPeriodo').addEventListener('click', () => {
        const de = $('periodoDe').value, ate = $('periodoAte').value;
        if (!de || !ate || de > ate) { toast('Escolha um período válido.'); return; }
        document.querySelectorAll('[data-periodo]').forEach(x => x.classList.remove('ativo'));
        definirPeriodo({ de, ate }); carregarDashboard();
    });

    function card(id, valor, sub) { $(id).querySelector('.card-valor').textContent = valor; $(id).querySelector('.card-sub').textContent = sub || ''; }

    async function carregarDashboard() {
        if (!periodo) definirPeriodo(F.periodoPreset('7d', hojeSP()));
        $('dashboardErro').hidden = true;
        document.body.classList.add('carregando');
        try {
            const r = await API.chamar('dashboard', periodo);
            const d = r.dashboard;
            card('cardConsultas', F.formatarNumero(d.total), `${F.formatarDia(d.periodo.de)} a ${F.formatarDia(d.periodo.ate)}`);
            card('cardDebito', F.formatarNumero(d.debito), 'linha digitável de parcela vencida');
            card('cardEncaminhamentos', F.formatarNumero(d.encaminhamento), 'mais de 5 dias de atraso');
            card('cardResolucao', F.formatarPct(d.taxaResolucao),
                `em dia c/ boleto: ${F.formatarNumero(d.emDiaBoleto)} · sem boleto: ${F.formatarNumero(d.emDiaSemBoleto + d.atrasadoSemLinha)}`);
            card('cardErros', F.formatarPct(d.taxaErros), `${F.formatarNumero(d.erros)} consultas com erro`);
            $('listaErrosTela').innerHTML = d.errosPorTela.length
                ? d.errosPorTela.map(e => `<li><span>${esc(e.tela)}</span><strong>${F.formatarNumero(e.qtd)}</strong><em>${F.formatarPct(e.pct)}</em></li>`).join('')
                : '<li class="vazio">Nenhum erro no período.</li>';
            $('saude').innerHTML = r.saude.map(s => `<li><span class="nivel nivel-${esc(s.nivel)}" aria-label="${esc(s.nivel)}"></span><strong>${esc(s.item)}</strong><span>${esc(s.detalhe)}</span></li>`).join('');
            const origem = Object.entries(d.porOrigem).map(([k, v]) => `${({ cache: 'cache', cache_antigo: 'cache antigo', ao_vivo: 'ao vivo', sem_dados: 'sem dados', navegador: 'navegador' })[k] || k}: ${F.formatarNumero(v)}`).join(' · ');
            $('infoApoio').textContent = `Tempo médio de resposta: ${F.formatarDuracao(d.tempoMedioMs)}${origem ? ' · ' + origem : ''}`;
            if (r.planilhaUrl) { $('linkPlanilha').href = r.planilhaUrl; $('linkPlanilha').hidden = false; }
            desenharGrafico(d.porDia);
        } catch (err) {
            $('dashboardErro').textContent = err.message; $('dashboardErro').hidden = false;
        } finally { document.body.classList.remove('carregando'); }
    }

    function desenharGrafico(porDia) {
        const dados = { labels: porDia.map(p => F.formatarDia(p.dia)), datasets: [
            { label: 'Resolvidas', data: porDia.map(p => p.resolvidas), backgroundColor: '#1f9d55', stack: 's' },
            { label: 'Erros', data: porDia.map(p => p.erros), backgroundColor: '#d64545', stack: 's' }] };
        if (typeof Chart === 'undefined') return;
        if (grafico) { grafico.data = dados; grafico.update(); return; }
        grafico = new Chart($('graficoDias'), { type: 'bar', data: dados,
            options: { responsive: true, maintainAspectRatio: false, scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } } } } });
    }

    // ---------- Usuarios ----------
    let usuarios = [];
    async function carregarUsuarios() {
        $('usuariosErro').hidden = true;
        try { usuarios = (await API.chamar('usuarios_listar')).usuarios; desenharUsuarios(); }
        catch (err) { $('usuariosErro').textContent = err.message; $('usuariosErro').hidden = false; }
    }
    function desenharUsuarios() {
        const eu = usuarioAtual.email;
        $('tabelaUsuarios').querySelector('tbody').innerHTML = usuarios.map(u => {
            const proprio = u.email === eu;
            const acoes = proprio ? '<em>você</em>' : `
                <button data-acao="papel" data-email="${esc(u.email)}">${u.papel === 'super_admin' ? 'Tornar membro' : 'Tornar super admin'}</button>
                <button data-acao="ativo" data-email="${esc(u.email)}">${u.ativo ? 'Desativar' : 'Reativar'}</button>
                <button data-acao="senha" data-email="${esc(u.email)}">Redefinir senha</button>
                <button data-acao="remover" data-email="${esc(u.email)}" class="perigo">Remover</button>`;
            return `<tr><td>${esc(u.nome)}</td><td>${esc(u.email)}</td><td>${u.papel === 'super_admin' ? 'Super admin' : 'Membro'}</td>
                <td>${u.ativo ? 'Ativo' : 'Inativo'}</td><td class="acoes">${acoes}</td></tr>`;
        }).join('');
    }
    function confirmar(texto) {
        return new Promise(res => {
            $('confirmarTexto').textContent = texto; const d = $('dlgConfirmar');
            const fim = (v) => { d.close(); $('btnConfirmarSim').onclick = $('btnConfirmarNao').onclick = null; res(v); };
            $('btnConfirmarSim').onclick = () => fim(true); $('btnConfirmarNao').onclick = () => fim(false); d.showModal();
        });
    }
    async function acaoUsuario(acao, dados, ok) {
        try { await API.chamar(acao, dados); toast(ok); await carregarUsuarios(); }
        catch (err) { toast(err.message); }
    }
    $('tabelaUsuarios').addEventListener('click', async (e) => {
        const b = e.target.closest('button[data-acao]'); if (!b) return;
        const u = usuarios.find(x => x.email === b.dataset.email); if (!u) return;
        if (b.dataset.acao === 'papel') {
            const papel = u.papel === 'super_admin' ? 'membro' : 'super_admin';
            if (await confirmar(`${papel === 'super_admin' ? 'Tornar' : 'Rebaixar'} ${u.nome} ${papel === 'super_admin' ? 'super administrador' : 'para membro'}?`))
                acaoUsuario('usuarios_atualizar', { email: u.email, papel }, 'Papel atualizado.');
        } else if (b.dataset.acao === 'ativo') {
            if (await confirmar(`${u.ativo ? 'Desativar' : 'Reativar'} ${u.nome}?`))
                acaoUsuario('usuarios_atualizar', { email: u.email, ativo: !u.ativo }, u.ativo ? 'Usuário desativado.' : 'Usuário reativado.');
        } else if (b.dataset.acao === 'senha') {
            const senha = F.gerarSenha();
            if (await confirmar(`Nova senha provisória para ${u.nome}: ${senha}\nCopie antes de confirmar.`)) {
                try { await navigator.clipboard.writeText(senha); } catch (err) {}
                acaoUsuario('usuarios_redefinir_senha', { email: u.email, senha }, 'Senha redefinida (copiada).');
            }
        } else if (b.dataset.acao === 'remover') {
            if (await confirmar(`Remover ${u.nome} (${u.email})? Essa ação não pode ser desfeita.`))
                acaoUsuario('usuarios_remover', { email: u.email }, 'Usuário removido.');
        }
    });
    $('btnNovoUsuario').addEventListener('click', () => {
        $('formUsuario').reset(); $('uSenha').value = F.gerarSenha(); $('uErro').hidden = true; $('dlgUsuario').showModal();
    });
    $('btnGerarSenha').addEventListener('click', () => { $('uSenha').value = F.gerarSenha(); });
    $('btnCopiarSenha').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('uSenha').value); toast('Senha copiada.'); } catch (e) { toast('Copie a senha manualmente.'); } });
    $('formUsuario').addEventListener('submit', async (e) => {
        e.preventDefault();
        if (e.submitter && e.submitter.value === 'cancelar') { $('dlgUsuario').close(); return; }
        $('uErro').hidden = true;
        try {
            await API.chamar('usuarios_criar', { nome: $('uNome').value.trim(), email: $('uEmail').value.trim(), papel: $('uPapel').value, senha: $('uSenha').value });
            $('dlgUsuario').close(); toast('Usuário criado. Envie a senha provisória a ele.'); carregarUsuarios();
        } catch (err) { $('uErro').textContent = err.message; $('uErro').hidden = false; }
    });

    // ---------- Minha conta ----------
    $('formSenha').addEventListener('submit', async (e) => {
        e.preventDefault();
        const a = $('senhaNova').value, b = $('senhaNova2').value;
        const msg = $('contaMsg');
        if (a !== b) { msg.textContent = 'As senhas não conferem.'; return; }
        try { await API.chamar('trocar_senha', { senha_nova: a }); msg.textContent = 'Senha alterada.'; $('formSenha').reset(); }
        catch (err) { msg.textContent = err.message; }
    });

    // ---------- Inicio ----------
    (async function iniciar() {
        const s = API.lerSessao();
        if (!s || !s.access_token) return mostrarLogin();
        API.agendarRefresh(s);
        try { const r = await API.chamar('eu'); mostrarApp(r.usuario); } catch (e) { mostrarLogin(); }
    })();
})();
```

O `#formUsuario` tem dois botões submit: `value="salvar"` e `value="cancelar"` (`formnovalidate`).

- [ ] **Step 7: Checar**
  - `node --check` em `painel.js`, `api.js` e `formatos.js`;
  - `node --test frontend/painel-f8ed7ba4777f/formatos.test.js` → PASS;
  - abrir `index.html` com um servidor local (`npx -y http-server frontend -p 8765`) e verificar no navegador (agent-browser) que a tela de login renderiza sem erros no console e sem scroll horizontal em 360 px.
- [ ] **Step 8: Commit**

```bash
git add frontend/painel-f8ed7ba4777f/index.html frontend/painel-f8ed7ba4777f/painel.css frontend/painel-f8ed7ba4777f/painel.js frontend/painel-f8ed7ba4777f/api.js frontend/painel-f8ed7ba4777f/formatos.js frontend/painel-f8ed7ba4777f/formatos.test.js
git commit -m "feat(painel): painel de administracao (login, dashboard, usuarios, minha conta)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Deploy e validação ponta a ponta

Depende das Tasks 1–7.

- [ ] **Step 1: Push**

Robô (`main`): só os módulos e testes; nada muda em runtime. Site: `main` (Tasks 6 e 7). Usar o comando de push das Global Constraints. Esperar o Vercel: `curl -s -o /dev/null -w "%{http_code}" https://rob-sponte-2.vercel.app/painel-f8ed7ba4777f/` → 200, e o HTML contém `noindex`.

- [ ] **Step 2: A página principal não tem link para o painel**

`curl -s https://rob-sponte-2.vercel.app/ | grep -c painel` → `0`.

- [ ] **Step 3: E2E com agent-browser (Vercel)**

`npx -y agent-browser --help` para confirmar os comandos. Guardar screenshots no scratchpad.
1. Abrir o painel → tela de login. Login com senha errada → mensagem genérica.
2. Login do super admin (senha de `backups/super-admin-senha.txt`) → dashboard com 5 cards, erros por pop-up, gráfico e saúde (4 itens).
3. "Consultas realizadas" (período Hoje) igual ao número de linhas de hoje em `cia_consultas_log` (conferir via MCP).
4. Usuários → criar o membro `painel-e2e+<timestamp>@amais.io` e copiar a senha → Sair → login como membro → o menu "Usuários" não aparece → Minha conta → trocar a senha → Sair.
5. Login como super admin → remover o membro → a lista não tem mais o membro.
6. Viewport 360×740: dashboard sem scroll horizontal (`document.documentElement.scrollWidth <= 360`).
7. Site principal: digitar um CPF com dígito errado (ex. `111.111.111-12`). O site mostra o erro de CPF e o log recebe `cpf_invalido` com origem `navegador` (conferir o Data Table).

- [ ] **Step 4: Memória**

Criar a memória `painel-admin.md`: URL, workflows (IDs), Data Tables, planilha, onde está a senha provisória do super admin, e como adicionar um super admin via admin API. Atualizar `MEMORY.md`.
