# Consulta de boletos confiável — design

Data: 2026-09-23
Repos afetados: `rob--sponte` (este, robô Render), `rob-sponte-2` (site Vercel), n8n PROD `W7tTXjTNvvO62wYO`, n8n Despertador `3OnXUxjwSh345Sy1`.

## Problema

Consultas com dados corretos retornam erro. Os 8 CPFs reportados estão todos na planilha Sponte de 23/09 com boletos corretos. As causas, verificadas nas execuções do n8n, no Supabase e na API Sponte:

1. **Cache parado desde 05/08/2026.** O ramo "Ao Adicionar Planilha no Drive → Ler Excel → Processar Regras" trava o worker do n8n toda madrugada (`crashed` / "failed to be processed too many times"). A planilha tem 5 MB, 20.594 linhas e 65 colunas, porque o export pega todas as situações (Quitada 14.185, Cancelada 3.461, Pendente 2.944) das duas escolas, de 01/jan até o fim do próximo mês. Ela cresce todo mês.
2. **Regra "cache < 24h".** Com cache velho, toda consulta cai no robô ao vivo.
3. **O robô ao vivo não encontra CPF de responsável.** `students?CPF=` só busca o CPF do aluno. 5 dos 8 casos são responsáveis e recebem "não encontramos nenhum aluno".
4. **Robô hibernando → 503.** O despertador pinga `busca-boletos-cia-dev.onrender.com` (suspenso), não o robô real `rob-sponte-r2vk`. O n8n manda `Accept: text/html`, então a Render devolve na hora a página "Application loading" (503) em vez de segurar a requisição até o robô subir. O n8n faz só 2 tentativas.
5. **Mensagem enganosa.** A falha HTTP do robô vira "Não encontramos nenhum boleto em aberto…", e o site abre o modal de CPF não encontrado.
6. **O cache nunca apaga nem zera linhas.** Quem quitou tudo continua vendo o boleto antigo; quem nunca teve pendência não tem linha no cache.

## Decisões do usuário

- Processar a planilha **no robô** e também **filtrar o relatório na Sponte** (só pendentes).
- Cache vale se for **do mesmo dia** (fuso America/Sao_Paulo). Se for mais antigo, tenta o robô ao vivo **até 5x** em caso de erro (hibernação).
- **Desligar o despertador.** As 5 tentativas cobrem o robô hibernando.
- Publicar tudo em produção e validar lá.

## Arquitetura

```
03:00 n8n "Acordar Robô" → POST /iniciar-exportacao
  robô: login admin → Contas a Receber (Todas as empresas, situação Pendente, venc. 01/01/<ano-1> → fim do próximo mês)
      → baixa .xls → FECHA o browser → processar_planilha.js (parse enxuto + regras)
      → POST JSON  n8n /webhook/sponte-cache-processado   (lote de cache)
      → POST .xls  n8n /webhook/sponte-relatorio-excel    (arquivo no Drive, como hoje)
  n8n cache-processado: valida lote → upsert Supabase em blocos → reconcilia CPFs ausentes → "em_dia sem boletos"

Site → n8n /webhook/buscar-boletos-novo
  cache do mesmo dia? → responde cache
  senão → Sponte students → robô ao vivo (até 5x, Accept: application/json)
        → sucesso: resposta ao vivo
        → falha ou aluno não encontrado: cache antigo, se existir (cacheDesatualizado: true)
        → nada: erro com `code` ('nao_encontrado' | 'instabilidade')
```

### 1. Robô (`rob--sponte`)

**`processar_planilha.js` (novo, funções puras, sem I/O de rede):**
- `lerPlanilha(caminho)`: lê com SheetJS em modo `dense`, localiza a linha de cabeçalho (`NumeroBoleto` + `CPFResponsavel`) e devolve objetos só com as colunas usadas: `Sacado, NomeResponsavel, CPFResponsavel, Situacao, DataVencimento, Valor, NumeroBoleto, NumeroParcela`.
- `montarCache(linhas, hoje)`: porta fiel do nó "Processar Regras e Matemática":
  - filtro "aberto" (`Situacao` ∈ Pendente/Em Aberto/Aberto/Atrasada, `NumeroBoleto` ≠ '0', campos obrigatórios presentes);
  - dedupe CPF + Sacado + Vencimento, mantendo a maior parcela;
  - linha digitável BB (convênio 3121068, carteira 17, fator de vencimento com rollover em 22/02/2025);
  - por aluno: algum atraso ≥ 6 dias → `negociar` (sem boletos); atraso 1–5 → `pagar_atrasados` (só os que têm linha); sem atraso → `em_dia` com o próximo vencimento;
  - status geral: negociar > pagar_atrasados > em_dia; `legacy` igual ao atual.
  - Saída: `[{ cpf:'000.000.000-00', status_sponte, nome_formatado, data_atualizacao, proximo_boleto:{alunos, legacy} }]`.
- `hoje` é injetado (meia-noite em America/Sao_Paulo) para os testes serem determinísticos.

**`export_sponte.js` (alterado):**
- Início do vencimento: `01/01/<ano anterior>`, para não perder boleto pendente do ano passado.
- Tenta aplicar o filtro de situação "Pendente"/"Em aberto" na tela (select ou checkboxes, busca por texto como nos outros campos). Se não achar, registra no log e segue: o robô filtra de qualquer jeito.
- Depois do download, fecha o browser **antes** de processar (a Render free tem 512 MB).
- Envia primeiro o JSON do cache (`{ geradoEm, totalLinhas, totalPendentes, payload }`) e depois o arquivo. Falha no envio do cache → erro → entra no retry existente (3x).
- URLs dos webhooks: o `webhookUrl` do body continua sendo o do arquivo; o do cache vem de `cacheWebhookUrl` no body, com padrão `https://n8n.amais.io/webhook/sponte-cache-processado`.

**Testes:** `node --test` com fixture sintética (sem dados reais): cabeçalho deslocado, dedupe, cada status, múltiplos filhos, CPF inválido, `NumeroBoleto` 0, e valores "golden" (linha digitável e payload completo) gerados pela função original do nó n8n, copiada para `test/fixtures/n8n_original.js`, rodando sobre a mesma fixture. A porta tem que ser fiel. `package.json` ganha `"test": "node --test"`.

### 2. n8n PROD (`W7tTXjTNvvO62wYO`)

**Novo ramo de ingestão:** `Webhook (Cache Processado)` POST `sponte-cache-processado` → `Validar Lote` (Code: rejeita se `payload` < 200 itens ou sem `geradoEm`) → `Dividir em Blocos` (Code: blocos de 500) → `Upsert Supabase` (HTTP POST `alunos_cache`, `Prefer: resolution=merge-duplicates`) → `Reconciliar Ausentes` (HTTP PATCH `alunos_cache?data_atualizacao=lt.<geradoEm>` → `status_sponte:'em_dia'`, `proximo_boleto:{alunos:[],legacy:null}`, `data_atualizacao: geradoEm`). O reconcile roda uma vez, depois de todos os blocos.

**Removidos:** `Ao Adicionar Planilha no Drive`, `Baixar Planilha do Drive`, `Ler Excel`, `Processar Regras e Matemática`, `Salvar no Supabase (Bulk)`. O ramo `Webhook (Receber Planilha) → Salvar Planilha Nova → Listar/Excluir antigos` continua como arquivo.

**Consulta:**
- `Cache Recente?` → "mesmo dia": `data_atualizacao` convertida para America/Sao_Paulo tem a mesma data de hoje.
- `Chamar Robo Puppeteer`: header `Accept: application/json`, `retryOnFail` com `maxTries 5` e `waitBetweenTries 5000`, `onError: continueRegularOutput`, timeout 100 s.
- `Formatar Resposta Live`: quando nenhum aluno volta válido, marca `falhou:true` com `code` (`instabilidade` se houve erro HTTP ou `status:'erro'` do robô; `nao_encontrado` caso contrário).
- Novo `Tem Cache Antigo?`: no ramo "Não encontrou alunos" e no ramo "falhou" do live, se `Ler Supabase Cache` trouxe uma linha, responde por `Formatar Cache` com `cacheDesatualizado:true`. Se não trouxe, responde o erro com `code`.
- Mensagens: `nao_encontrado` → "Não encontramos nenhum aluno ou responsável com esse CPF…"; `instabilidade` → "O sistema da escola está instável no momento. Tente novamente em alguns minutos."

**Despertador `3OnXUxjwSh345Sy1`:** desativado. O `Acordar Robô` das 03:00 continua.

Antes de editar, salvar o JSON atual do workflow em `backups/` (gitignored) para rollback. Toda edição via MCP vai para rascunho: **publicar** no final.

### 3. Site (`rob-sponte-2/frontend/script.js`)

- `handleLegacy`: `data.code === 'instabilidade'` → modal de timeout; `data.code === 'nao_encontrado'` → modal de CPF não encontrado. As verificações por texto continuam como fallback.
- `em_dia` com `alunos: []` (linha reconciliada) → cai no modal "Parabéns, você está em dia" sem botão de próximo boleto (comportamento já existente em `handleLegacy`; conferir).
- `fetch` com `AbortController` de 150 s. O loop de 5 tentativas só repete em erro de rede, HTTP ≥ 500 ou JSON inválido, como hoje.
- Commit só de arquivos em `frontend/` (o repo não ignora `node_modules`).

## Tratamento de erros

| Situação | Resultado |
|---|---|
| Export falha 3x | Cache do dia anterior fica. Consultas vão ao vivo; se falharem, usam o cache antigo. |
| Lote com < 200 itens | Ingestão aborta sem tocar no Supabase (protege contra export parcial zerar todo mundo). |
| Robô hibernando | `Accept: application/json` faz a Render segurar a requisição; mais 5 tentativas. |
| CPF de responsável e cache velho | Robô não acha → cache antigo. |
| CPF desconhecido | `code:'nao_encontrado'` → modal de CPF não encontrado. |

## Validação (critérios de aceite)

1. `npm test` passa no robô.
2. Processar localmente a planilha real de 23/09 (fora do repo): os 8 CPFs aparecem, com saída idêntica à da função original do n8n rodando sobre as mesmas linhas (ex.: Matheus `em_dia` com a parcela de 10/10; Brenda e Gabriela `negociar`, porque têm pendência vencida há mais de 5 dias). O processamento roda com `--max-old-space-size=350`.
3. Depois do deploy: disparar `/iniciar-exportacao`; a execução de ingestão no n8n termina com `success`; `max(data_atualizacao)` no Supabase é hoje.
4. `curl` no webhook de consulta para os 8 CPFs: nenhum `status:'erro'`, todos com `cache:true`.
5. Caminho ao vivo: forçar cache velho num CPF de aluno (8731) e verificar resposta ao vivo; CPF inexistente válido retorna `code:'nao_encontrado'`.
6. Site em `rob-sponte-2.vercel.app` testado com agent-browser (Vercel): os 8 CPFs mostram a tela de boletos correta; o CPF inexistente mostra o modal certo.

## Fora de escopo

Consulta ao vivo do CIA KIDS (o portal do aluno não está habilitado na Sponte), migração para fora da Render, e trocar o scraping pela API `receivables`.
