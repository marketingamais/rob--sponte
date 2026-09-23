# Consulta de Boletos Confiável Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer a consulta de boletos responder corretamente para todo CPF que existe na Sponte, com o cache diário voltando a funcionar e o caminho ao vivo resistindo à hibernação do robô.

**Architecture:** O robô (Render) passa a processar a planilha exportada e enviar ao n8n um lote JSON pequeno. O n8n só grava no Supabase e reconcilia os ausentes. A consulta usa cache do mesmo dia; senão tenta o robô 5x e, se falhar, cai no cache antigo. O site passa a distinguir "não encontrado" de "instabilidade" pelo campo `code`.

**Tech Stack:** Node 20+ (CommonJS), Express 5, Puppeteer, SheetJS `xlsx` 0.18, axios, form-data, `node:test`; n8n (MCP `update_workflow` / `publish_workflow`); Supabase REST; site estático no Vercel.

**Spec:** `docs/superpowers/specs/2026-09-23-consulta-boletos-confiavel-design.md`

## Global Constraints

- Repo do robô: `D:\VIBE CODDING\CLAUDE CODE\BOLETO CIA - Copia` (origin `marketingamais/rob--sponte`, branch `main`, deploy automático na Render `https://rob-sponte-r2vk.onrender.com`).
- Repo do site: `D:\VIBE CODDING\CLAUDE CODE\rob-sponte-2` (branch `main`, deploy automático no Vercel `https://rob-sponte-2.vercel.app`). Commitar **só** arquivos de `frontend/`; nunca `git add -A` (o repo não ignora `node_modules`).
- Neste repo do robô, nunca `git add -A`: há arquivos não rastreados com segredos (`old_sponte.js`, `sponte_api_dev.js`, `token.txt` etc.). Adicionar arquivos pelo nome.
- n8n PROD: workflow `W7tTXjTNvvO62wYO`. Toda edição via MCP vai para o **rascunho**; só vale depois de `publish_workflow`. Backup do estado anterior: `backups/W7tTXjTNvvO62wYO-2026-09-23.json` (gitignored).
- Supabase: `https://udvkjlnvcttzrhscsecg.supabase.co/rest/v1/alunos_cache`, PK `cpf` no formato `000.000.000-00`. A service key é a mesma que já está no nó "Salvar no Supabase (Bulk)" do backup (campo `Authorization: Bearer …`). Não versionar essa chave em arquivos do repo.
- Fuso de negócio: `America/Sao_Paulo`.
- Regras de status, sem mudança: atraso ≥ 6 dias → `negociar`; 1–5 → `pagar_atrasados`; sem atraso → `em_dia`. Prioridade geral: negociar > pagar_atrasados > em_dia.
- Lote de ingestão com menos de **200** CPFs é rejeitado.
- Webhook de ingestão: `https://n8n.amais.io/webhook/sponte-cache-processado`.
- Mensagens começam com "Não encontramos…" (code `nao_encontrado`) e "O sistema da escola está instável…" (code `instabilidade`).
- Commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Data de vencimento como número serial do Excel** (ex.: `46305`) em vez de texto `10/10/2026 00:00:00`: o robô deve converter para `dd/mm/aaaa`, não descartar em silêncio todas as linhas. Teste na Task 1.
2. **Valor numérico** (`209.99`) em vez de texto `209,9900`: a linha digitável deve sair igual à do texto equivalente. Teste na Task 1.
3. **CPF numérico sem zero à esquerda** (`6140707323` para `061.407.073-23`): deve ser completado para 11 dígitos, não descartado. Teste na Task 1.
4. **Export parcial ou filtro errado** gerando poucos CPFs: o n8n rejeita o lote e não zera ninguém no Supabase. Teste na Task 3 (POST com 3 itens → execução com erro, `count` da tabela inalterado).
5. **Robô hibernando na hora da consulta**: a chamada usa `Accept: application/json` e 5 tentativas; se ainda falhar, o site recebe o cache antigo ou `code:'instabilidade'`, nunca "não encontramos boleto". Teste na Task 5 (passo de caminho ao vivo).

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `processar_planilha.js` (novo) | Ler o .xls e transformar linhas em payload do cache. Funções puras, sem rede. |
| `export_sponte.js` (alterado) | Dirigir a Sponte, baixar o relatório, fechar o browser e chamar `enviarResultados`. |
| `sponte_api.js` (alterado) | Repassar `cacheWebhookUrl` ao export; nova rota `GET /versao`. |
| `test/processar_planilha.test.js` (novo) | Testes unitários e golden do processamento. |
| `test/enviar_resultados.test.js` (novo) | Testes do envio (cache antes do arquivo, falha propaga). |
| `test/fixtures/n8n_original.js` (já criado) | Cópia literal do nó n8n original, usada como referência golden. |
| `package.json` | Script `test`. |
| n8n `W7tTXjTNvvO62wYO` | Ramo de ingestão novo; consulta com cache do dia, retries e fallback. |
| n8n `3OnXUxjwSh345Sy1` | Despertador desativado. |
| `rob-sponte-2/frontend/script.js` | Tratar `code`, timeout do fetch e retry só em erro de servidor. |

Tracks independentes, que podem rodar em paralelo: **A** = Task 1 → Task 2 (robô); **B** = Task 3 → Task 4 (n8n); **C** = Task 5a (site). A Task 5 (deploy e validação ponta a ponta) espera as três.

---

### Task 1: Módulo `processar_planilha.js`

**Files:**
- Create: `processar_planilha.js`
- Create: `test/processar_planilha.test.js`
- Modify: `package.json` (script `test`)
- Existing (read-only): `test/fixtures/n8n_original.js` exporta `function n8nOriginal($input, __now)` e devolve `[{ json: { payload } }]`

**Interfaces:**
- Produces:
  - `lerPlanilha(caminho: string) => Linha[]`
  - `extrairLinhas(matriz: any[][]) => Linha[]`, onde `Linha = { Sacado, NomeResponsavel, CPFResponsavel, Situacao, DataVencimento, Valor, NumeroBoleto, NumeroParcela }`, todos strings normalizadas
  - `ehAberto(linha: Linha) => boolean`
  - `hojeSaoPaulo(agora?: Date) => Date` (meia-noite local do dia corrente em São Paulo)
  - `montarCache(linhas: Linha[], hoje: Date, agoraIso: string) => ItemCache[]`, onde `ItemCache = { cpf, status_sponte, nome_formatado, data_atualizacao, proximo_boleto: { alunos: [{ nomeAluno, status, boletos }], legacy } }`

- [ ] **Step 1: Adicionar o script de teste**

Em `package.json`, trocar `"test": "echo \"Error: no test specified\" && exit 1"` por:

```json
"test": "node --test test/"
```

- [ ] **Step 2: Escrever os testes que falham**

Criar `test/processar_planilha.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const XLSX = require('xlsx');
const n8nOriginal = require('./fixtures/n8n_original.js');
const { lerPlanilha, extrairLinhas, ehAberto, hojeSaoPaulo, montarCache } = require('../processar_planilha.js');

// 23/09/2026 12:00 em Sao Paulo
const AGORA = new Date('2026-09-23T15:00:00Z');
const HOJE = hojeSaoPaulo(AGORA);

function linha(o) {
    return Object.assign({
        Sacado: 'Aluno Teste', NomeResponsavel: 'Resp Teste', CPFResponsavel: '111.444.777-35',
        Situacao: 'Pendente', DataVencimento: '10/10/2026 00:00:00', Valor: '179,9900',
        NumeroBoleto: '162741', NumeroParcela: '8'
    }, o);
}

const CENARIO = [
    // em_dia: so parcela futura
    linha({}),
    // pagar_atrasados: 3 dias de atraso
    linha({ CPFResponsavel: '222.333.444-05', Sacado: 'Bia Atrasada', NomeResponsavel: 'Mae Bia', DataVencimento: '20/09/2026 00:00:00', NumeroBoleto: '40127', NumeroParcela: '7' }),
    linha({ CPFResponsavel: '222.333.444-05', Sacado: 'Bia Atrasada', NomeResponsavel: 'Mae Bia', DataVencimento: '20/10/2026 00:00:00', NumeroBoleto: '40128', NumeroParcela: '8' }),
    // negociar: 13 dias de atraso
    linha({ CPFResponsavel: '333.444.555-06', Sacado: 'Caio Devedor', DataVencimento: '10/09/2026 00:00:00', NumeroBoleto: '166083', NumeroParcela: '6' }),
    // dois filhos: um em dia, outro atrasado 2 dias -> geral pagar_atrasados
    linha({ CPFResponsavel: '444.555.666-07', Sacado: 'Filho Um', NomeResponsavel: 'Pai Dois', DataVencimento: '10/10/2026 00:00:00', NumeroBoleto: '5001', NumeroParcela: '3' }),
    linha({ CPFResponsavel: '444.555.666-07', Sacado: 'Filho Dois', NomeResponsavel: 'Pai Dois', DataVencimento: '21/09/2026 00:00:00', NumeroBoleto: '5002', NumeroParcela: '2' }),
    // duplicado (mesmo CPF+Sacado+Venc): mantem a maior parcela
    linha({ CPFResponsavel: '555.666.777-08', Sacado: 'Dup', DataVencimento: '10/11/2026 00:00:00', NumeroBoleto: '9001', NumeroParcela: '4' }),
    linha({ CPFResponsavel: '555.666.777-08', Sacado: 'Dup', DataVencimento: '10/11/2026 00:00:00', NumeroBoleto: '9002', NumeroParcela: '9' }),
    // ignorados: quitada, boleto 0, CPF curto
    linha({ CPFResponsavel: '666.777.888-09', Situacao: 'Quitada' }),
    linha({ CPFResponsavel: '777.888.999-10', NumeroBoleto: '0' }),
    linha({ CPFResponsavel: '123.456', NumeroBoleto: '777' }),
    // pendencia do ano passado -> negociar
    linha({ CPFResponsavel: '888.999.000-11', Sacado: 'Antigo', DataVencimento: '10/12/2025 00:00:00', NumeroBoleto: '1234', NumeroParcela: '12' })
];

test('montarCache e identico ao no n8n original (golden)', () => {
    const esperado = n8nOriginal({ all: () => CENARIO.map(json => ({ json })) }, AGORA)[0].json.payload;
    const obtido = montarCache(CENARIO, HOJE, AGORA.toISOString());
    assert.deepStrictEqual(obtido, esperado);
});

test('status por cenario', () => {
    const porCpf = Object.fromEntries(montarCache(CENARIO, HOJE, AGORA.toISOString()).map(i => [i.cpf, i]));
    assert.strictEqual(porCpf['111.444.777-35'].status_sponte, 'em_dia');
    assert.strictEqual(porCpf['111.444.777-35'].proximo_boleto.alunos[0].boletos[0].dataVencimento, '10/10/2026');
    assert.strictEqual(porCpf['222.333.444-05'].status_sponte, 'pagar_atrasados');
    assert.strictEqual(porCpf['222.333.444-05'].proximo_boleto.alunos[0].boletos.length, 1);
    assert.strictEqual(porCpf['333.444.555-06'].status_sponte, 'negociar');
    assert.strictEqual(porCpf['444.555.666-07'].status_sponte, 'pagar_atrasados');
    assert.strictEqual(porCpf['444.555.666-07'].proximo_boleto.alunos.length, 2);
    assert.strictEqual(porCpf['555.666.777-08'].proximo_boleto.alunos[0].boletos[0].numParcela, '9');
    assert.strictEqual(porCpf['888.999.000-11'].status_sponte, 'negociar');
    assert.ok(!porCpf['666.777.888-09'] && !porCpf['777.888.999-10']);
    assert.strictEqual(Object.keys(porCpf).length, 6);
    for (const i of Object.values(porCpf)) assert.strictEqual(i.data_atualizacao, AGORA.toISOString());
});

test('linha digitavel tem 47 digitos', () => {
    const it = montarCache([linha({})], HOJE, AGORA.toISOString())[0];
    assert.match(it.proximo_boleto.alunos[0].boletos[0].linhaDigitavel, /^\d{47}$/);
});

test('ehAberto', () => {
    assert.ok(ehAberto(linha({})));
    assert.ok(!ehAberto(linha({ Situacao: 'Cancelada' })));
    assert.ok(!ehAberto(linha({ NumeroBoleto: '0' })));
    assert.ok(!ehAberto(linha({ Valor: '' })));
});

test('extrairLinhas acha o cabecalho deslocado e ignora colunas extras', () => {
    const matriz = [
        ['Relatorio Contas a Receber'], [''], ['Periodo x'],
        ['NumeroParcela', 'Sacado', 'Extra', 'CPFResponsavel', 'NomeResponsavel', 'Situacao', 'DataVencimento', 'Valor', 'NumeroBoleto'],
        ['8', 'Aluno', 'lixo', '111.444.777-35', 'Resp', 'Pendente', '10/10/2026 00:00:00', '179,9900', 162741]
    ];
    const [l] = extrairLinhas(matriz);
    assert.deepStrictEqual(l, {
        Sacado: 'Aluno', NomeResponsavel: 'Resp', CPFResponsavel: '111.444.777-35', Situacao: 'Pendente',
        DataVencimento: '10/10/2026 00:00:00', Valor: '179,9900', NumeroBoleto: '162741', NumeroParcela: '8'
    });
});

test('extrairLinhas sem cabecalho devolve lista vazia', () => {
    assert.deepStrictEqual(extrairLinhas([['a', 'b'], ['c', 'd']]), []);
});

// Review Focus 1, 2, 3: celulas numericas
test('normaliza data serial do Excel, valor numerico e CPF sem zero a esquerda', () => {
    const serial10out2026 = 46305; // 10/10/2026
    const matriz = [
        ['NumeroParcela', 'Sacado', 'CPFResponsavel', 'NomeResponsavel', 'Situacao', 'DataVencimento', 'Valor', 'NumeroBoleto'],
        [8, 'Gabi', 6140707323, 'Resp', 'Pendente', serial10out2026, 179.99, 162741]
    ];
    const [l] = extrairLinhas(matriz);
    assert.strictEqual(l.CPFResponsavel, '06140707323');
    assert.strictEqual(l.DataVencimento, '10/10/2026 00:00:00');
    assert.strictEqual(l.Valor, '179,99');
    const texto = montarCache([linha({ CPFResponsavel: '061.407.073-23', Valor: '179,9900' })], HOJE, 'x')[0];
    const numerico = montarCache([l], HOJE, 'x')[0];
    assert.strictEqual(numerico.cpf, '061.407.073-23');
    assert.strictEqual(numerico.proximo_boleto.alunos[0].boletos[0].linhaDigitavel,
        texto.proximo_boleto.alunos[0].boletos[0].linhaDigitavel);
});

test('lerPlanilha le um .xlsx de verdade', () => {
    const tmp = path.join(os.tmpdir(), `plan-${process.pid}.xlsx`);
    const ws = XLSX.utils.aoa_to_sheet([
        ['Titulo'],
        ['NumeroParcela', 'Sacado', 'CPFResponsavel', 'NomeResponsavel', 'Situacao', 'DataVencimento', 'Valor', 'NumeroBoleto'],
        ['8', 'Aluno', '111.444.777-35', 'Resp', 'Pendente', '10/10/2026 00:00:00', '179,9900', '162741']
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Contas a Receber');
    XLSX.writeFile(wb, tmp);
    try {
        const linhas = lerPlanilha(tmp);
        assert.strictEqual(linhas.length, 1);
        assert.strictEqual(linhas[0].NumeroBoleto, '162741');
    } finally { fs.unlinkSync(tmp); }
});

test('hojeSaoPaulo usa o dia de Sao Paulo', () => {
    const d = hojeSaoPaulo(new Date('2026-09-24T02:30:00Z')); // 23/09 23:30 em SP
    assert.strictEqual(d.getDate(), 23);
    assert.strictEqual(d.getHours(), 0);
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL com `Cannot find module '../processar_planilha.js'`.

- [ ] **Step 4: Implementar `processar_planilha.js`**

```js
// Processa o relatorio "Contas a Receber" da Sponte e monta as linhas do cache (Supabase alunos_cache).
// Porta fiel do no n8n "Processar Regras e Matematica" (ver test/fixtures/n8n_original.js).
const XLSX = require('xlsx');

const COLUNAS = ['Sacado', 'NomeResponsavel', 'CPFResponsavel', 'Situacao', 'DataVencimento', 'Valor', 'NumeroBoleto', 'NumeroParcela'];
const SITUACOES_ABERTAS = ['Pendente', 'Em Aberto', 'Aberto', 'Atrasada'];

function lerPlanilha(caminho) {
    const wb = XLSX.readFile(caminho, { dense: true, cellFormula: false, cellHTML: false, cellText: false });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const matriz = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    return extrairLinhas(matriz);
}

// Celulas numericas (Excel) -> mesmo texto que a Sponte exporta
function normalizar(coluna, v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') {
        if (coluna === 'DataVencimento') return XLSX.SSF.format('dd/mm/yyyy hh:mm:ss', v);
        if (coluna === 'Valor') return v.toFixed(2).replace('.', ',');
        if (coluna === 'CPFResponsavel') return String(Math.trunc(v)).padStart(11, '0');
    }
    return String(v).trim();
}

function extrairLinhas(matriz) {
    const h = matriz.findIndex(r => Array.isArray(r) && r.includes('NumeroBoleto') && r.includes('CPFResponsavel'));
    if (h === -1) return [];
    const idx = COLUNAS.map(c => matriz[h].indexOf(c));
    const linhas = [];
    for (let i = h + 1; i < matriz.length; i++) {
        const r = matriz[i];
        if (!Array.isArray(r)) continue;
        const o = {};
        COLUNAS.forEach((c, k) => { o[c] = idx[k] === -1 ? '' : normalizar(c, r[idx[k]]); });
        linhas.push(o);
    }
    return linhas;
}

const ehAberto = (r) => !!(r && r.Situacao && SITUACOES_ABERTAS.includes(r.Situacao) && r.NumeroBoleto && r.NumeroBoleto !== '0' && r.Valor && r.CPFResponsavel && r.DataVencimento);

function hojeSaoPaulo(agora = new Date()) {
    const hoje = new Date(agora.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    hoje.setHours(0, 0, 0, 0);
    return hoje;
}

const modulo10 = (str) => {
    let sum = 0, multiplier = 2;
    for (let i = str.length - 1; i >= 0; i--) {
        let val = parseInt(str[i]) * multiplier;
        if (val > 9) val = Math.floor(val / 10) + (val % 10);
        sum += val;
        multiplier = multiplier === 2 ? 1 : 2;
    }
    const digit = 10 - (sum % 10);
    return digit === 10 ? 0 : digit;
};

const modulo11 = (str) => {
    let sum = 0, multiplier = 2;
    for (let i = str.length - 1; i >= 0; i--) {
        sum += parseInt(str[i]) * multiplier;
        multiplier++;
        if (multiplier > 9) multiplier = 2;
    }
    const digit = 11 - (sum % 11);
    return digit === 0 || digit === 10 || digit === 11 ? 1 : digit;
};

// Linha digitavel Banco do Brasil (convenio 3121068, carteira 17)
function linhaDigitavelBB(numeroBoleto, valorStr, dataVencimentoStr) {
    try {
        const [day, month, year] = dataVencimentoStr.split(' ')[0].split('/');
        if (!year) return null;
        const vencDate = new Date(year, month - 1, day);
        let fator = Math.floor((vencDate - new Date(1997, 9, 7)) / 86400000);
        if (fator > 9999) fator = 1000 + Math.floor((vencDate - new Date(2025, 1, 22)) / 86400000);
        const valorClean = valorStr.split(',')[0] + (valorStr.split(',')[1] || '00').padEnd(2, '0').substring(0, 2);
        const valorPad = valorClean.padStart(10, '0');
        const campoLivre = '000000' + '3121068' + numeroBoleto.toString().padStart(10, '0') + '17';
        const dvGeral = modulo11('001' + '9' + fator + valorPad + campoLivre);
        const b1 = '0019' + campoLivre.substring(0, 5);
        const b2 = campoLivre.substring(5, 15);
        const b3 = campoLivre.substring(15, 25);
        return (b1 + modulo10(b1)) + (b2 + modulo10(b2)) + (b3 + modulo10(b3)) + dvGeral + fator + valorPad;
    } catch (e) { return null; }
}

const mkParcela = (b, atrasada) => ({
    title: atrasada ? 'Atrasada' : 'Pendente',
    valor: b.r.Valor.toString(),
    isVencida: atrasada,
    diasAtraso: atrasada ? b.diffDays : 0,
    isPendente: true,
    numParcela: b.r.NumeroParcela || '1',
    dataVencimento: b.r.DataVencimento.toString().split(' ')[0],
    linhaDigitavel: linhaDigitavelBB(b.r.NumeroBoleto.toString(), b.r.Valor.toString(), b.r.DataVencimento.toString())
});

function calcAluno(boletos) {
    const atrasados = boletos.filter(b => b.diffDays > 0);
    if (atrasados.length > 0) {
        const maxAtraso = Math.max(...atrasados.map(b => b.diffDays));
        if (maxAtraso >= 6) return { status: 'negociar', boletos: [] };
        return { status: 'pagar_atrasados', boletos: atrasados.map(b => mkParcela(b, true)).filter(p => p.linhaDigitavel) };
    }
    boletos.sort((a, b) => a.vencDate - b.vencDate);
    const pr = mkParcela(boletos[0], false);
    return { status: 'em_dia', boletos: pr.linhaDigitavel ? [pr] : [] };
}

function montarCache(linhas, hoje, agoraIso) {
    // Dedupe CPF + Sacado + Vencimento, mantendo a maior parcela
    const unicos = new Map();
    for (const r of linhas.filter(ehAberto)) {
        const chave = r.CPFResponsavel.replace(/[^0-9]/g, '') + '_' + (r.Sacado || '').trim() + '_' + r.DataVencimento;
        const ex = unicos.get(chave);
        if (!ex || (parseInt(r.NumeroParcela) || 0) > (parseInt(ex.NumeroParcela) || 0)) unicos.set(chave, r);
    }

    const respMap = new Map();
    for (const r of unicos.values()) {
        const cpfLimpo = r.CPFResponsavel.replace(/[^0-9]/g, '');
        if (cpfLimpo.length !== 11) continue;
        const cpf = cpfLimpo.replace(/([0-9]{3})([0-9]{3})([0-9]{3})([0-9]{2})/, '$1.$2.$3-$4');
        const partes = r.DataVencimento.split(' ')[0].split('/');
        if (!partes[2]) continue;
        const vencDate = new Date(partes[2], partes[1] - 1, partes[0]);
        const diffDays = Math.ceil((hoje - vencDate) / 86400000);
        const sacado = (r.Sacado || 'Aluno').trim();
        if (!respMap.has(cpf)) respMap.set(cpf, { nomeResp: r.NomeResponsavel || '', alunos: new Map() });
        const resp = respMap.get(cpf);
        if (!resp.alunos.has(sacado)) resp.alunos.set(sacado, []);
        resp.alunos.get(sacado).push({ r, vencDate, diffDays });
    }

    const payload = [];
    for (const [cpf, resp] of respMap.entries()) {
        const alunos = [];
        for (const [sacado, boletos] of resp.alunos.entries()) {
            const c = calcAluno(boletos);
            alunos.push({ nomeAluno: sacado, status: c.status, boletos: c.boletos });
        }
        let overall = 'em_dia';
        if (alunos.some(a => a.status === 'negociar')) overall = 'negociar';
        else if (alunos.some(a => a.status === 'pagar_atrasados')) overall = 'pagar_atrasados';

        let legacy = null;
        if (overall === 'pagar_atrasados') legacy = alunos.filter(a => a.status === 'pagar_atrasados').reduce((acc, a) => acc.concat(a.boletos), []);
        else if (overall === 'em_dia') { const p = alunos.find(a => a.boletos.length > 0); legacy = p ? p.boletos[0] : null; }

        payload.push({ cpf, status_sponte: overall, nome_formatado: resp.nomeResp, data_atualizacao: agoraIso, proximo_boleto: { alunos, legacy } });
    }
    return payload;
}

module.exports = { lerPlanilha, extrairLinhas, ehAberto, hojeSaoPaulo, montarCache, linhaDigitavelBB };
```

Observação: a linha digitável original monta o texto com pontos e espaços e depois remove tudo que não é dígito. A concatenação acima produz os mesmos 47 dígitos; o teste golden confirma.

- [ ] **Step 5: Rodar e ver passar**

Run: `npm test`
Expected: todos os testes PASS. Se o golden falhar, corrigir a porta (não o teste nem a fixture).

- [ ] **Step 6: Validar com a planilha real (fora do repo)**

A planilha real de 23/09 está em `C:/Users/DESIGN~1/AppData/Local/Temp/claude/d--VIBE-CODDING-CLAUDE-CODE-BOLETO-CIA---Copia/4c85baef-d731-4f4a-b178-61319deb0528/scratchpad/plan.xls`. Rodar:

```bash
node --max-old-space-size=350 -e '
const {lerPlanilha,montarCache,hojeSaoPaulo}=require("./processar_planilha.js");
const n8n=require("./test/fixtures/n8n_original.js");
const agora=new Date();const t=Date.now();
const l=lerPlanilha(process.argv[1]);const p=montarCache(l,hojeSaoPaulo(agora),agora.toISOString());
console.log("linhas",l.length,"cpfs",p.length,"ms",Date.now()-t,"rssMB",process.memoryUsage().rss/1e6|0);
const g=n8n({all:()=>l.map(json=>({json}))},agora)[0].json.payload;
require("assert").deepStrictEqual(p,g);console.log("golden real OK");
for(const c of ["061.407.073-23","076.674.013-73","018.318.853-52","035.830.351-60","680.186.223-53","026.832.333-02","607.405.703-66","616.009.603-67"]){const i=p.find(x=>x.cpf===c);console.log(c,i?i.status_sponte+" "+i.proximo_boleto.alunos.map(a=>a.nomeAluno+":"+a.boletos.map(b=>b.dataVencimento).join(",")).join(" / "):"AUSENTE");}
' "C:/Users/DESIGN~1/AppData/Local/Temp/claude/d--VIBE-CODDING-CLAUDE-CODE-BOLETO-CIA---Copia/4c85baef-d731-4f4a-b178-61319deb0528/scratchpad/plan.xls"
```

Expected: sem "heap out of memory"; `golden real OK`; `cpfs` > 1000. Os 7 CPFs com linha Pendente aparecem. Aleph (018.318.853-52) pode aparecer AUSENTE, porque todas as linhas dele estão Quitadas; na consulta ele será atendido pela reconciliação (em dia). Colar a saída no relatório da task.

- [ ] **Step 7: Commit**

```bash
git add processar_planilha.js test/processar_planilha.test.js test/fixtures/n8n_original.js package.json .gitignore
git commit -m "feat(robo): processa planilha Sponte no robo (porta fiel do n8n) + testes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Export envia lote de cache + filtro de situação + rota de versão

**Files:**
- Modify: `export_sponte.js` (inteiro; estrutura abaixo)
- Modify: `sponte_api.js:10-23` (rota `/iniciar-exportacao`) e nova rota `/versao` logo após `/ping` (linha 8)
- Create: `test/enviar_resultados.test.js`

**Interfaces:**
- Consumes: `lerPlanilha`, `montarCache`, `hojeSaoPaulo`, `ehAberto` de `./processar_planilha.js`
- Produces:
  - `enviarResultados(filePath: string, urls: { webhookUrl?: string, cacheWebhookUrl?: string }, deps?: { post?, lerPlanilha?, agora?: () => Date, meta?: object }) => Promise<{ totalLinhas, totalPendentes, cpfs }>`
  - `runWithRetries(webhookUrl, cacheWebhookUrl)` (assinatura nova)
  - `CACHE_WEBHOOK_PADRAO = 'https://n8n.amais.io/webhook/sponte-cache-processado'`
  - Corpo JSON enviado ao cache: `{ geradoEm: ISO, totalLinhas, totalPendentes, filtroSituacaoAplicado: boolean, payload: ItemCache[] }`

- [ ] **Step 1: Escrever o teste que falha**

Criar `test/enviar_resultados.test.js`:

```js
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

test('falha no envio do cache propaga e NAO envia o arquivo', async () => {
    const urls = [];
    const post = async (url) => { urls.push(url); if (url.includes('cache')) throw new Error('500'); };
    const f = arquivoTemp();
    await assert.rejects(enviarResultados(f, { webhookUrl: 'http://n8n/arquivo', cacheWebhookUrl: 'http://n8n/cache' },
        { post, lerPlanilha: linhasFake }), /500/);
    fs.unlinkSync(f);
    assert.deepStrictEqual(urls, ['http://n8n/cache']);
});

test('sem cacheWebhookUrl envia so o arquivo', async () => {
    const urls = [];
    const post = async (url) => { urls.push(url); };
    const f = arquivoTemp();
    await enviarResultados(f, { webhookUrl: 'http://n8n/arquivo' }, { post, lerPlanilha: linhasFake });
    fs.unlinkSync(f);
    assert.deepStrictEqual(urls, ['http://n8n/arquivo']);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL em `enviar_resultados.test.js` com `enviarResultados is not a function` (hoje `export_sponte.js` só exporta `runWithRetries`).

- [ ] **Step 3: Implementar em `export_sponte.js`**

3a. No topo, depois dos `require` existentes:

```js
const { lerPlanilha, montarCache, hojeSaoPaulo, ehAberto } = require('./processar_planilha.js');

const CACHE_WEBHOOK_PADRAO = 'https://n8n.amais.io/webhook/sponte-cache-processado';

// Processa a planilha baixada e envia: 1) lote de cache (JSON) 2) arquivo bruto (arquivo no Drive).
// O cache vai primeiro: se ele falhar, o erro sobe e o retry do export roda de novo.
async function enviarResultados(filePath, urls, deps = {}) {
    const post = deps.post || axios.post;
    const ler = deps.lerPlanilha || lerPlanilha;
    const agora = deps.agora ? deps.agora() : new Date();
    const linhas = ler(filePath);
    const payload = montarCache(linhas, hojeSaoPaulo(agora), agora.toISOString());
    const totalPendentes = linhas.filter(ehAberto).length;
    console.log(`Planilha processada: ${linhas.length} linhas, ${totalPendentes} pendentes, ${payload.length} CPFs.`);

    if (urls.cacheWebhookUrl) {
        console.log(`Enviando lote de cache para ${urls.cacheWebhookUrl}...`);
        await post(urls.cacheWebhookUrl, {
            geradoEm: agora.toISOString(),
            totalLinhas: linhas.length,
            totalPendentes,
            filtroSituacaoAplicado: !!(deps.meta && deps.meta.filtroSituacaoAplicado),
            payload
        }, { timeout: 120000, maxBodyLength: Infinity, maxContentLength: Infinity });
        console.log('Lote de cache enviado!');
    }

    if (urls.webhookUrl) {
        console.log(`Enviando arquivo para o N8N (${urls.webhookUrl})...`);
        const form = new FormData();
        form.append('arquivo', fs.createReadStream(filePath));
        await post(urls.webhookUrl, form, { headers: { ...form.getHeaders() }, maxBodyLength: Infinity, maxContentLength: Infinity });
        console.log('Arquivo enviado com sucesso para o N8N!');
    }

    return { totalLinhas: linhas.length, totalPendentes, cpfs: payload.length };
}
```

3b. Dividir `exportarRelatorio`: renomear o corpo atual para `async function baixarRelatorio()` que devolve `{ filePath, filtroSituacaoAplicado }` e fecha o browser no `finally` (como hoje). Remover do corpo o bloco `if (webhookUrl) { … axios.post(webhookUrl, form …) }` e o `return { success: true … }`; no lugar, `return { filePath, filtroSituacaoAplicado };`. O `catch` que posta `{ error: true }` sai daqui e vai para `exportarRelatorio`. Nova `exportarRelatorio`:

```js
async function exportarRelatorio(webhookUrl, cacheWebhookUrl) {
    try {
        const { filePath, filtroSituacaoAplicado } = await baixarRelatorio(); // browser ja fechado aqui (libera RAM)
        const r = await enviarResultados(filePath, { webhookUrl, cacheWebhookUrl }, { meta: { filtroSituacaoAplicado } });
        return { success: true, message: 'Exportação concluída!', ...r };
    } catch (e) {
        console.error('Erro durante a automação:', e);
        if (webhookUrl) {
            try { await axios.post(webhookUrl, { error: true, message: e.toString() }); } catch (err) {}
        }
        throw e;
    }
}
```

3c. Período, dentro de `baixarRelatorio`: trocar `const startDateStr = \`01/01/${currentYear}\`;` por:

```js
        // Ano anterior inteiro: pega boleto pendente antigo (o filtro de situacao deixa o arquivo pequeno)
        const startDateStr = `01/01/${currentYear - 1}`;
```

3d. Filtro de situação, dentro de `baixarRelatorio`, logo depois do laço que preenche as datas e antes de `console.log("Configurando exportação para Excel...")`:

```js
        console.log("Aplicando filtro de situacao (so Pendente/Em aberto)...");
        let filtroSituacaoAplicado = false;
        for (const frame of page.frames()) {
            const ok = await frame.evaluate(() => {
                const norm = s => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
                const abertos = ['pendente', 'em aberto', 'aberto', 'a receber'];
                const fechados = ['quitada', 'quitado', 'cancelada', 'cancelado', 'pago', 'paga', 'recebido', 'recebida'];
                let aplicou = false;
                // 1) Select de situacao
                for (const sel of document.querySelectorAll('select')) {
                    const ctx = norm(sel.id + ' ' + sel.name + ' ' + (sel.parentElement ? sel.parentElement.textContent : ''));
                    if (!ctx.includes('situa')) continue;
                    const i = Array.from(sel.options).findIndex(o => abertos.includes(norm(o.text)));
                    if (i !== -1) {
                        sel.selectedIndex = i;
                        sel.dispatchEvent(new Event('change', { bubbles: true }));
                        aplicou = true;
                    }
                }
                // 2) Checkboxes rotuladas
                for (const chk of document.querySelectorAll('input[type="checkbox"]')) {
                    const lbl = chk.id ? document.querySelector(`label[for="${chk.id}"]`) : null;
                    const txt = norm((lbl ? lbl.textContent : '') || (chk.nextSibling && chk.nextSibling.textContent) || (chk.parentElement ? chk.parentElement.textContent : ''));
                    if (fechados.includes(txt) && chk.checked) { chk.click(); aplicou = true; }
                    if (abertos.includes(txt) && !chk.checked) { chk.click(); aplicou = true; }
                }
                return aplicou;
            }).catch(() => false);
            if (ok) filtroSituacaoAplicado = true;
        }
        console.log(filtroSituacaoAplicado
            ? "Filtro de situacao aplicado."
            : "ALERTA: filtro de situacao nao encontrado na tela; seguindo com todas as situacoes (o robo filtra depois).");
```

3e. `runWithRetries(webhookUrl, cacheWebhookUrl)`: repassar os dois para `exportarRelatorio(webhookUrl, cacheWebhookUrl)`.

3f. Export: `module.exports = { runWithRetries, enviarResultados, CACHE_WEBHOOK_PADRAO };`

- [ ] **Step 4: Ajustar `sponte_api.js`**

Depois de `app.get('/ping', …)`:

```js
// Commit em producao (a Render define RENDER_GIT_COMMIT) - usado para confirmar deploy
app.get('/versao', (req, res) => res.json({ commit: process.env.RENDER_GIT_COMMIT || 'local' }));
```

Na rota `/iniciar-exportacao`, trocar a importação para `const { runWithRetries, CACHE_WEBHOOK_PADRAO } = require('./export_sponte.js');`, ler `const cacheWebhookUrl = (req.body && req.body.cacheWebhookUrl) || CACHE_WEBHOOK_PADRAO;`, chamar `runWithRetries(webhookUrl, cacheWebhookUrl)` e incluir `cacheWebhookUrl` no `res.json`. Ler as linhas 10-23 antes de editar para preservar a validação existente de `webhookUrl`.

- [ ] **Step 5: Rodar os testes e checar a sintaxe do servidor**

Run: `npm test && node -e "require('./export_sponte.js'); console.log('ok')"`
Expected: todos PASS e `ok`. Não subir o servidor (ele abriria a porta 3000 e o Puppeteer não é necessário aqui).

- [ ] **Step 6: Commit**

```bash
git add export_sponte.js sponte_api.js test/enviar_resultados.test.js
git commit -m "feat(export): robo processa planilha e envia lote de cache ao n8n; filtro Pendente; /versao

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: n8n — ramo de ingestão do lote (sem publicar ainda)

Executor com acesso às ferramentas MCP `mcp__n8n-mcp__*` (carregar via ToolSearch `select:mcp__n8n-mcp__update_workflow,mcp__n8n-mcp__publish_workflow,mcp__n8n-mcp__get_workflow_details`). A service key sai do backup: `node -e "const w=require('./backups/W7tTXjTNvvO62wYO-2026-09-23.json');console.log(w.nodes.find(n=>n.name==='Salvar no Supabase (Bulk)').parameters.headerParameters.parameters.find(p=>p.name==='Authorization').value)"`. Nos blocos abaixo, `<SERVICE_KEY>` é o JWT sem o prefixo `Bearer `. Substituir antes de enviar; não gravar em arquivo do repo.

**Interfaces:**
- Consumes: corpo `{ geradoEm, totalLinhas, totalPendentes, filtroSituacaoAplicado, payload: ItemCache[] }` (Task 2)
- Produces: webhook `POST https://n8n.amais.io/webhook/sponte-cache-processado` que responde `{ ok: true, cpfs: N, geradoEm }`

- [ ] **Step 1: Remover o ramo antigo e adicionar o novo (uma chamada `update_workflow`, `workflowId: "W7tTXjTNvvO62wYO"`)**

Operações:

```json
[
 {"type":"removeNode","nodeName":"Ao Adicionar Planilha no Drive"},
 {"type":"removeNode","nodeName":"Baixar Planilha do Drive"},
 {"type":"removeNode","nodeName":"Ler Excel"},
 {"type":"removeNode","nodeName":"Processar Regras e Matemática"},
 {"type":"removeNode","nodeName":"Salvar no Supabase (Bulk)"},
 {"type":"addNode","node":{"name":"Webhook (Cache Processado)","type":"n8n-nodes-base.webhook","typeVersion":2,"position":[17984,3600],
   "parameters":{"httpMethod":"POST","path":"sponte-cache-processado","responseMode":"lastNode","options":{}}}},
 {"type":"addNode","node":{"name":"Validar Lote","type":"n8n-nodes-base.code","typeVersion":2,"position":[18224,3600],
   "parameters":{"jsCode":"const b = $json.body || {};\nconst payload = Array.isArray(b.payload) ? b.payload : [];\nif (!b.geradoEm || payload.length < 200) {\n  throw new Error(`Lote rejeitado: ${payload.length} CPFs (minimo 200), geradoEm=${b.geradoEm}`);\n}\nconst blocos = [];\nfor (let i = 0; i < payload.length; i += 500) {\n  blocos.push({ json: { geradoEm: b.geradoEm, bloco: payload.slice(i, i + 500) } });\n}\nreturn blocos;"}}},
 {"type":"addNode","node":{"name":"Upsert Supabase","type":"n8n-nodes-base.httpRequest","typeVersion":4.1,"position":[18464,3600],
   "parameters":{"method":"POST","url":"https://udvkjlnvcttzrhscsecg.supabase.co/rest/v1/alunos_cache","sendHeaders":true,
     "headerParameters":{"parameters":[{"name":"apikey","value":"<SERVICE_KEY>"},{"name":"Authorization","value":"Bearer <SERVICE_KEY>"},{"name":"Prefer","value":"resolution=merge-duplicates,return=minimal"},{"name":"Content-Type","value":"application/json"}]},
     "sendBody":true,"specifyBody":"json","jsonBody":"={{ JSON.stringify($json.bloco) }}","options":{}}}},
 {"type":"addNode","node":{"name":"Reconciliar Ausentes","type":"n8n-nodes-base.httpRequest","typeVersion":4.1,"position":[18704,3600],
   "parameters":{"method":"PATCH","url":"={{ 'https://udvkjlnvcttzrhscsecg.supabase.co/rest/v1/alunos_cache?data_atualizacao=lt.' + encodeURIComponent($('Validar Lote').first().json.geradoEm) }}","sendHeaders":true,
     "headerParameters":{"parameters":[{"name":"apikey","value":"<SERVICE_KEY>"},{"name":"Authorization","value":"Bearer <SERVICE_KEY>"},{"name":"Prefer","value":"return=minimal"},{"name":"Content-Type","value":"application/json"}]},
     "sendBody":true,"specifyBody":"json","jsonBody":"={{ JSON.stringify({ status_sponte: 'em_dia', proximo_boleto: { alunos: [], legacy: null }, data_atualizacao: $('Validar Lote').first().json.geradoEm }) }}","options":{}}}},
 {"type":"addNode","node":{"name":"Resumo Ingestao","type":"n8n-nodes-base.code","typeVersion":2,"position":[18944,3600],
   "parameters":{"jsCode":"const blocos = $('Validar Lote').all();\nreturn [{ json: { ok: true, cpfs: blocos.reduce((s, i) => s + i.json.bloco.length, 0), geradoEm: blocos[0].json.geradoEm } }];"}}},
 {"type":"addConnection","source":"Webhook (Cache Processado)","target":"Validar Lote"},
 {"type":"addConnection","source":"Validar Lote","target":"Upsert Supabase"},
 {"type":"addConnection","source":"Upsert Supabase","target":"Reconciliar Ausentes"},
 {"type":"addConnection","source":"Reconciliar Ausentes","target":"Resumo Ingestao"},
 {"type":"setNodeSettings","nodeName":"Reconciliar Ausentes","settings":{"executeOnce":true}},
 {"type":"setNodeSettings","nodeName":"Resumo Ingestao","settings":{"executeOnce":true}},
 {"type":"setNodeSettings","nodeName":"Upsert Supabase","settings":{"retryOnFail":true,"maxTries":3,"waitBetweenTries":3000}}
]
```

`executeOnce` no PATCH garante uma única reconciliação depois de todos os blocos: o n8n processa todos os itens de um nó antes de passar ao próximo.

- [ ] **Step 2: Conferir o rascunho**

`get_workflow_details` → confirmar que os 5 nós antigos sumiram, os 5 novos existem conectados em sequência e `Webhook (Receber Planilha) → Salvar Planilha Nova → …` continua intacto.

- [ ] **Step 3: Commit (não há arquivo; registrar no relatório)** — nada a commitar. A publicação acontece na Task 4, junto com as mudanças da consulta.

---

### Task 4: n8n — consulta (cache do dia, 5 tentativas, fallback, `code`), publicar e desligar o despertador

**Interfaces:**
- Consumes: nós existentes `Ler Supabase Cache`, `Cache Recente?`, `Chamar Robo Puppeteer`, `Formatar Resposta Live`, `Nao Encontrou Alunos`, `Nao Encontrado Response`, `Formatar Cache`
- Produces: resposta do webhook `buscar-boletos-novo`:
  - sucesso: `{ status, cache, nomeResponsavel, nomeFormatado, alunos, parcelas?, proximoBoleto?, cacheDesatualizado? }`
  - erro: `{ status: 'erro', code: 'nao_encontrado' | 'instabilidade' | 'sem_senha', message }`

- [ ] **Step 1: `update_workflow` com as operações:**

```json
[
 {"type":"updateNodeParameters","nodeName":"Cache Recente?","replace":true,"parameters":{"conditions":{"boolean":[{
  "value1":"={{ !!$json.data_atualizacao && DateTime.fromISO($json.data_atualizacao).setZone('America/Sao_Paulo').toISODate() === $now.setZone('America/Sao_Paulo').toISODate() }}",
  "value2":true}]}}},

 {"type":"updateNodeParameters","nodeName":"Chamar Robo Puppeteer","parameters":{"sendHeaders":true,"headerParameters":{"parameters":[{"name":"Accept","value":"application/json"}]}}},
 {"type":"setNodeSettings","nodeName":"Chamar Robo Puppeteer","settings":{"retryOnFail":true,"maxTries":5,"waitBetweenTries":5000,"onError":"continueRegularOutput"}},
 {"type":"setNodeSettings","nodeName":"Buscar Alunos 8731","settings":{"retryOnFail":true,"maxTries":3,"waitBetweenTries":2000,"onError":"continueRegularOutput"}},
 {"type":"setNodeSettings","nodeName":"Buscar Alunos 70532","settings":{"retryOnFail":true,"maxTries":3,"waitBetweenTries":2000,"onError":"continueRegularOutput"}},

 {"type":"setNodeParameter","nodeName":"Formatar Resposta Live","path":"/jsCode",
  "value":"const items = $input.all().map(i => i.json || {});\nconst validos = items.filter(r => r && (r.status === 'em_dia' || r.status === 'pagar_atrasados' || r.status === 'negociar'));\nif (validos.length === 0) {\n  const semSenha = items.find(r => r && r.status === 'erro' && /senha/i.test(r.message || ''));\n  if (semSenha) return [{ json: { falhou: true, code: 'sem_senha', message: semSenha.message } }];\n  const houveErro = items.some(r => r && (r.error || r.status === 'erro'));\n  return [{ json: { falhou: true, code: houveErro ? 'instabilidade' : 'nao_encontrado' } }];\n}\nconst alunos = validos.map(r => {\n  let boletos = [];\n  if (r.status === 'pagar_atrasados' && Array.isArray(r.parcelas)) boletos = r.parcelas;\n  else if (r.status === 'em_dia' && r.proximoBoleto) boletos = [r.proximoBoleto];\n  return { nomeAluno: r.nomeAluno || r.nomeFormatado || 'Aluno', status: r.status, boletos: boletos };\n});\nlet overall = 'em_dia';\nif (validos.some(r => r.status === 'negociar')) overall = 'negociar';\nelse if (validos.some(r => r.status === 'pagar_atrasados')) overall = 'pagar_atrasados';\nlet parcelas = [];\nlet proximoBoleto = null;\nif (overall === 'pagar_atrasados') parcelas = alunos.filter(a => a.status === 'pagar_atrasados').reduce((acc, a) => acc.concat(a.boletos), []);\nelse if (overall === 'em_dia') { const p = alunos.find(a => a.boletos.length > 0); proximoBoleto = p ? p.boletos[0] : null; }\nconst nomeResp = validos[0].nomeFormatado || validos[0].nomeAluno || 'Aluno';\nreturn [{ json: { falhou: false, status: overall, cache: false, nomeResponsavel: nomeResp, nomeFormatado: nomeResp, alunos: alunos, parcelas: parcelas, proximoBoleto: proximoBoleto } }];"},

 {"type":"setNodeParameter","nodeName":"Nao Encontrado Response","path":"/jsCode",
  "value":"return [{ json: { falhou: true, code: 'nao_encontrado' } }];"},

 {"type":"setNodeParameter","nodeName":"Formatar Cache","path":"/jsCode",
  "value":"// Serve o cache do dia (via Cache Recente?) e o cache antigo como fallback (via Tem Cache Antigo?)\nconst row = $('Ler Supabase Cache').first().json;\nlet pb = typeof row.proximo_boleto === 'string' ? JSON.parse(row.proximo_boleto) : row.proximo_boleto;\n\nlet retorno = {\n  status: row.status_sponte,\n  nomeFormatado: row.nome_formatado,\n  nomeResponsavel: row.nome_formatado,\n  cache: true,\n  cacheDesatualizado: $json.falhou === true\n};\n\nif (pb && !Array.isArray(pb) && pb.alunos) {\n  retorno.alunos = pb.alunos;\n  let legacy = pb.legacy;\n  if (row.status_sponte === 'pagar_atrasados') retorno.parcelas = legacy || [];\n  else if (row.status_sponte === 'em_dia') retorno.proximoBoleto = legacy || null;\n} else {\n  if (row.status_sponte === 'pagar_atrasados') retorno.parcelas = pb;\n  else if (row.status_sponte === 'em_dia') retorno.proximoBoleto = pb;\n  let bs = row.status_sponte === 'pagar_atrasados' ? (Array.isArray(pb) ? pb : []) : (pb ? [pb] : []);\n  retorno.alunos = [{ nomeAluno: row.nome_formatado, status: row.status_sponte, boletos: bs }];\n}\n\nreturn [{ json: retorno }];"},

 {"type":"addNode","node":{"name":"Live Falhou?","type":"n8n-nodes-base.if","typeVersion":1,"position":[0,0],
   "parameters":{"conditions":{"boolean":[{"value1":"={{ $json.falhou === true }}","value2":true}]}}}},
 {"type":"addNode","node":{"name":"Responder Live","type":"n8n-nodes-base.code","typeVersion":2,"position":[0,0],
   "parameters":{"jsCode":"const r = { ...$input.first().json };\ndelete r.falhou;\nreturn [{ json: r }];"}}},
 {"type":"addNode","node":{"name":"Tem Cache Antigo?","type":"n8n-nodes-base.if","typeVersion":1,"position":[0,0],
   "parameters":{"conditions":{"boolean":[{"value1":"={{ !!$('Ler Supabase Cache').first().json.cpf }}","value2":true}]}}}},
 {"type":"addNode","node":{"name":"Responder Erro","type":"n8n-nodes-base.code","typeVersion":2,"position":[0,0],
   "parameters":{"jsCode":"const f = $input.first().json;\nconst code = f.code || 'instabilidade';\nconst msgs = {\n  nao_encontrado: 'Não encontramos nenhum aluno ou responsável com esse CPF em nenhuma das nossas escolas. Se achar que é um engano, fale com a secretaria.',\n  instabilidade: 'O sistema da escola está instável no momento. Tente novamente em alguns minutos.'\n};\nreturn [{ json: { status: 'erro', code, message: f.message || msgs[code] || msgs.instabilidade } }];"}}},

 {"type":"addConnection","source":"Formatar Resposta Live","target":"Live Falhou?"},
 {"type":"addConnection","source":"Live Falhou?","sourceIndex":0,"target":"Tem Cache Antigo?"},
 {"type":"addConnection","source":"Live Falhou?","sourceIndex":1,"target":"Responder Live"},
 {"type":"addConnection","source":"Nao Encontrado Response","target":"Tem Cache Antigo?"},
 {"type":"addConnection","source":"Tem Cache Antigo?","sourceIndex":0,"target":"Formatar Cache"},
 {"type":"addConnection","source":"Tem Cache Antigo?","sourceIndex":1,"target":"Responder Erro"}
]
```

Depois, `setNodePosition` dos 4 nós novos à direita de `Formatar Resposta Live` (ler a posição dele no `get_workflow_details` e somar 240/480 em x; `Responder Live` 160 abaixo), para o canvas ficar legível.

Sobre o `Nao Encontrado Response`: a mensagem antiga "Nao encontramos nenhum aluno…" passa a sair do `Responder Erro`, que continua contendo "encontr" (o site antigo, antes do deploy da Task 5a, segue abrindo o modal certo).

- [ ] **Step 2: Conferir o rascunho**

`get_workflow_details`: a conexão `Cache Recente?` saída 0 → `Formatar Cache` continua; `Formatar Cache` tem 2 entradas; nenhum nó órfão além dos stickies.

- [ ] **Step 3: Publicar**

`publish_workflow({ workflowId: "W7tTXjTNvvO62wYO" })`. Depois `get_workflow_details` e confirmar `activeVersionId === versionId`.

- [ ] **Step 4: Testar o caminho do cache antigo e o de CPF inexistente (produção)**

```bash
for c in 61600960367 07667401373 11144477735; do curl -s -m 200 -X POST https://n8n.amais.io/webhook/buscar-boletos-novo -H 'Content-Type: application/json' -d "{\"cpf\":\"$c\"}"; echo; done
```

Expected (cache ainda de 05/08): Brenda (`616…`) e Matheus (`076…`) respondem `cache:true, cacheDesatualizado:true` (o robô ao vivo pode responder antes, com `cache:false`; os dois servem, desde que não seja `status:'erro'`). `11144477735` (CPF válido e inexistente) responde `{"status":"erro","code":"nao_encontrado",…}`.

- [ ] **Step 5: Testar a guarda do lote (Review Focus 4)**

```bash
curl -s -m 60 -X POST https://n8n.amais.io/webhook/sponte-cache-processado -H 'Content-Type: application/json' -d '{"geradoEm":"2026-09-23T00:00:00.000Z","payload":[{"cpf":"x"},{"cpf":"y"},{"cpf":"z"}]}'; echo
```

Expected: resposta de erro do n8n (HTTP 500 ou `{"message":"Error in workflow"}`); execução com erro "Lote rejeitado: 3 CPFs". Conferir que nada foi escrito:

```bash
curl -s -I "https://udvkjlnvcttzrhscsecg.supabase.co/rest/v1/alunos_cache?select=cpf" -H "apikey: <SERVICE_KEY>" -H "Authorization: Bearer <SERVICE_KEY>" -H "Prefer: count=exact" | grep -i content-range
```

Expected: o total continua `1830`, e `select=data_atualizacao&order=data_atualizacao.desc&limit=1` continua `2026-08-05…`.

- [ ] **Step 6: Desligar o despertador**

`unpublish_workflow({ workflowId: "3OnXUxjwSh345Sy1" })`, depois `search_executions` do workflow após a próxima dezena de minutos → nenhuma execução nova.

---

### Task 5a: Site — `code`, timeout e retry só em erro de servidor

**Files:**
- Modify: `D:\VIBE CODDING\CLAUDE CODE\rob-sponte-2\frontend\script.js` (`handleFormSubmit`, linhas 127-160, e `handleLegacy`, linhas 313-323)

**Interfaces:**
- Consumes: resposta do n8n da Task 4 (`code` em erros; `alunos: []` em linha reconciliada)

- [ ] **Step 1: Timeout e retry no `fetch`**

Trocar o bloco `try { const response = await fetch(…); const jsonData = await response.json(); … }` do laço por:

```js
            try {
                const ctrl = new AbortController();
                const timer = setTimeout(() => ctrl.abort(), 150000); // robo ao vivo pode levar ~2 min
                let response;
                try {
                    response = await fetch(webhookUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ cpf }),
                        signal: ctrl.signal
                    });
                } finally {
                    clearTimeout(timer);
                }

                // 5xx (n8n/robo fora do ar): tenta de novo
                if (response.status >= 500) throw new Error('HTTP ' + response.status);

                const jsonData = await response.json();

                // Verifica se o N8N retornou erro de timeout (Error in workflow)
                if (jsonData.message && jsonData.message.includes('Error in workflow')) {
                    throw new Error('N8N Timeout');
                }

                data = jsonData;
                break; // Sucesso, sai do loop
            } catch (err) {
```

(o `catch` e o resto do laço ficam iguais.)

- [ ] **Step 2: Tratar `code` em `handleLegacy`**

Dentro de `if (data.status === 'erro') {`, antes do `if (data.message && data.message.includes('não possui senha'))`, inserir:

```js
        if (data.code === 'nao_encontrado') {
            openModal('modalCpfNaoEncontrado');
            return;
        }
        if (data.code === 'instabilidade') {
            document.getElementById('textoTimeout').innerText = "Desculpe! O sistema da escola está instável ou demorando muito para responder no momento. Por favor, tente novamente em alguns minutos!";
            openModal('modalTimeout');
            return;
        }
        if (data.code === 'sem_senha') {
            openModal('modalSemSenha');
            return;
        }
```

Conferir que os IDs `modalCpfNaoEncontrado`, `modalTimeout`, `textoTimeout` e `modalSemSenha` existem em `frontend/index.html` (`grep -n 'id="modal' frontend/index.html`).

- [ ] **Step 3: Conferir `em_dia` com `alunos: []`**

Ler `handleRobotResponse` e `handleLegacy`: com `{status:'em_dia', alunos:[], proximoBoleto:null, nomeFormatado:'X'}` o fluxo cai em `handleLegacy`, abre `modalEmDia` e esconde `btnQueroPagarProximo`. Se sim, nada muda. Se não, ajustar para esse comportamento.

- [ ] **Step 4: Checar a sintaxe**

Run: `node --check "D:/VIBE CODDING/CLAUDE CODE/rob-sponte-2/frontend/script.js"`
Expected: sem saída (OK).

- [ ] **Step 5: Commit (sem push; o push é na Task 5)**

```bash
cd "D:/VIBE CODDING/CLAUDE CODE/rob-sponte-2"
git add frontend/script.js
git commit -m "fix(front): trata code (nao_encontrado/instabilidade/sem_senha), timeout 150s e retry so em 5xx

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Deploy e validação ponta a ponta (produção)

Depende das Tasks 1, 2, 4 e 5a.

- [ ] **Step 1: Deploy do robô**

```bash
cd "D:/VIBE CODDING/CLAUDE CODE/BOLETO CIA - Copia" && npm test && git push origin main && git rev-parse HEAD
```

Esperar a Render publicar: repetir `curl -s -m 90 https://rob-sponte-r2vk.onrender.com/versao` a cada ~60 s (usar Monitor ou uma espera em loop, não `sleep` solto) até `commit` ser igual ao `HEAD`. Limite de 15 min; se passar disso, investigar (a Render pode não ter autodeploy; nesse caso, relatar).

- [ ] **Step 2: Rodar o export agora**

```bash
curl -s -m 120 -X POST https://rob-sponte-r2vk.onrender.com/iniciar-exportacao -H 'Content-Type: application/json' -d '{"webhookUrl":"https://n8n.amais.io/webhook/sponte-relatorio-excel","cacheWebhookUrl":"https://n8n.amais.io/webhook/sponte-cache-processado"}'
```

Acompanhar com `search_executions` do `W7tTXjTNvvO62wYO` até aparecer uma execução do webhook `sponte-cache-processado`. Ela deve terminar em `success`. Ver no `get_execution` (nó `Validar Lote`) o `filtroSituacaoAplicado` e o total; registrar os dois. Se falhar, depurar com `superpowers:systematic-debugging` antes de mudar código.

- [ ] **Step 3: Conferir o Supabase**

`max(data_atualizacao)` = hoje; `count` ≥ 1830; e os 8 CPFs do usuário com `data_atualizacao` de hoje (mesmo comando do diagnóstico, com `select=cpf,nome_formatado,status_sponte,data_atualizacao`).

- [ ] **Step 4: Consulta dos 8 CPFs pelo webhook**

```bash
for c in 06140707323 07667401373 01831885352 03583035160 68018622353 02683233302 60740570366 61600960367; do curl -s -m 200 -X POST https://n8n.amais.io/webhook/buscar-boletos-novo -H 'Content-Type: application/json' -d "{\"cpf\":\"$c\"}" | head -c 400; echo; done
```

Expected: 8 respostas com `cache:true`, `cacheDesatualizado:false` e nenhuma `status:'erro'`. Status coerentes com a saída do Step 6 da Task 1.

- [ ] **Step 5: Caminho ao vivo (Review Focus 5)**

Envelhecer só a linha da Brenda (aluna 8731, CPF próprio), consultar e restaurar:

```bash
K=<SERVICE_KEY>; U=https://udvkjlnvcttzrhscsecg.supabase.co/rest/v1/alunos_cache
ORIG=$(curl -s "$U?cpf=eq.616.009.603-67&select=data_atualizacao" -H "apikey: $K" -H "Authorization: Bearer $K")
curl -s -X PATCH "$U?cpf=eq.616.009.603-67" -H "apikey: $K" -H "Authorization: Bearer $K" -H 'Content-Type: application/json' -d '{"data_atualizacao":"2026-09-01T06:00:00Z"}'
time curl -s -m 200 -X POST https://n8n.amais.io/webhook/buscar-boletos-novo -H 'Content-Type: application/json' -d '{"cpf":"61600960367"}' | head -c 400; echo
echo "$ORIG"   # restaurar com o valor original:
curl -s -X PATCH "$U?cpf=eq.616.009.603-67" -H "apikey: $K" -H "Authorization: Bearer $K" -H 'Content-Type: application/json' -d "{\"data_atualizacao\":$(echo "$ORIG" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.stringify(JSON.parse(s)[0].data_atualizacao)))')}"
```

Expected: resposta `cache:false` (robô ao vivo) **ou** `cache:true, cacheDesatualizado:true` (fallback), nunca `status:'erro'`. Na execução do n8n, `Chamar Robo Puppeteer` com header `Accept: application/json`.

- [ ] **Step 6: Deploy do site**

```bash
cd "D:/VIBE CODDING/CLAUDE CODE/rob-sponte-2" && git push origin main
```

Esperar ~30 s e conferir que o `script.js` publicado contém `AbortController`: `curl -s https://rob-sponte-2.vercel.app/script.js | grep -c AbortController` → ≥ 1.

- [ ] **Step 7: E2E no navegador com agent-browser (Vercel)**

Conferir a CLI: `npx -y agent-browser --help` (pacote `agent-browser`, da vercel-labs). Para cada um dos 8 CPFs e para o inexistente `111.444.777-35`:

```bash
npx -y agent-browser open https://rob-sponte-2.vercel.app
npx -y agent-browser snapshot -i            # achar a ref do campo CPF e do botao
npx -y agent-browser fill <ref-cpf> "616.009.603-67"
npx -y agent-browser click <ref-botao>
npx -y agent-browser wait --text "Olá" --timeout 60000   # ou o texto do modal esperado
npx -y agent-browser screenshot <scratchpad>/e2e-61600960367.png
npx -y agent-browser snapshot
```

Expected: para os 8, a tela de boletos por aluno (ou o modal "Parabéns / em dia" no caso reconciliado) com o nome certo do aluno; para o inexistente, o modal de CPF não encontrado. Guardar os screenshots no scratchpad e anexar o resumo ao relatório final. Se os comandos da CLI forem diferentes dos acima, seguir o `--help` dela.

- [ ] **Step 8: Atualizar a memória do projeto**

Atualizar `deploy-topology.md` (despertador desligado; ingestão via `sponte-cache-processado`; robô processa a planilha) e `render-free-tier-limite.md` (despertador desativado em 23/09/2026 por decisão do usuário; consulta tenta 5x).
