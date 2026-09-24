# Handoff: Painel admin do sistema de boletos CIA, n8n parcialmente implantado

**Data:** 2026-09-24 (madrugada, horário de SP)
**Status:** bloqueado. Falta o MCP do n8n (`n8n-mcp` responde 502 Bad Gateway nesta sessão).

## 1. Objetivo

Construir um painel de administração privado para o sistema de consulta de boletos da escola CIA:
- **Login:** e-mail + senha. Um super admin gerencia os membros.
- **Dashboard com métricas:**
  1. consultas realizadas;
  2. consultas com débito (linha digitável de parcela vencida);
  3. encaminhamentos para a Amais (`negociar`);
  4. taxa de resolução;
  5. taxa de erros por pop-up;
  6. saúde do sistema.
- **Planilha Google de erros:** uma linha por erro, com CPF, tela, erro, motivo e possível solução.

Antes disso, nesta mesma sessão, foi corrigida a consulta de boletos. Ela falhava para CPFs válidos. Está **em produção e funcionando**; ver §3.

## 2. Contexto essencial

**Componentes (três repos, todos PÚBLICOS no GitHub):**

| Componente | Onde | Deploy |
|---|---|---|
| Robô Puppeteer (export Sponte + consulta ao vivo) | repo `marketingamais/rob--sponte`. Clone local: `D:\VIBE CODDING\CLAUDE CODE\BOLETO CIA - Copia` | Render `https://rob-sponte-r2vk.onrender.com`, automático no push para `main`. `GET /versao` devolve o commit em produção. |
| Site de consulta + painel (estático) | repo `marketingamais/rob-sponte-2`. Local: `D:\VIBE CODDING\CLAUDE CODE\rob-sponte-2` | Vercel `https://rob-sponte-2.vercel.app`, automático no push para `main` (~15 s) |
| Orquestração | n8n `https://n8n.amais.io`, projeto `WqOqk61ZzmyASX4J` | Edição via MCP vai para o **rascunho**. É preciso chamar `publish_workflow`. |
| Cache | Supabase `https://udvkjlnvcttzrhscsecg.supabase.co`, tabela `alunos_cache` (PK `cpf` no formato `000.000.000-00`) | — |

**Workflows n8n:**

| ID | Nome | Situação |
|---|---|---|
| `W7tTXjTNvvO62wYO` | `[CIA] Busca de Boletos [PROD]` | Consulta do site (webhook `buscar-boletos-novo`) + ingestão do cache (webhook secreto `sponte-cache-<sufixo>`) + export às 03:00. Versão ativa confirmada: `1b233a18-9b40-492c-997e-f7f716af0b0f`. |
| `vQ3YTmcK3zPalgwY` | `[CIA] Eventos do Site [PROD]` | Novo, publicado (webhook `registrar-evento-front`) |
| `3OnXUxjwSh345Sy1` | Despertador | **Desativado** de propósito |
| `[CIA] Painel Admin [PROD]` | — | **Ainda não existe** |

**Decisões tomadas e por quê:**
- **Segredos só no n8n.** Não há acesso às variáveis de ambiente da Vercel nem da Render, e os repos são públicos. O navegador fala só com webhooks do n8n.
- **Usuários do painel = usuários do Supabase Auth** com `app_metadata = { painel: true, papel: 'super_admin'|'membro', nome, ativo }`. Não há tabela própria de usuários. Desativar = `app_metadata.ativo=false` + `ban_duration`.
- **`usuarios_criar` nunca reaproveita conta Auth existente.** O fallback antigo permitia sequestro de conta. Agora, e-mail já existente → 400.
- **Log de consultas:** Data Table do n8n `cia_consultas_log` (id `0xrb1cufhD17HkAs`), **sem CPF**. **Log de ingestão:** `cia_ingestoes_log` (id `ViPUjk5VLuBlKURh`). O CPF só vai para a planilha de erros (decisão do usuário, LGPD).
- **Planilha "Erros - Consulta Boletos CIA":** id `1XLMjLXyLCAhUCPVMTcXRm_x8DnLl8D8awKPojl79OjI`, aba `Erros`. Link: https://docs.google.com/spreadsheets/d/1XLMjLXyLCAhUCPVMTcXRm_x8DnLl8D8awKPojl79OjI/edit. Dona: `valdeyrcunha@amais.io`, via a credencial n8n `[AMAIS] GOOGLE SHEETS` (`LU6wtO2xAV2RTwgO`). Hoje tem só o cabeçalho.
- **Painel no caminho `/painel-f8ed7ba4777f/`** do mesmo site, com `noindex` e sem link na página principal. Como o repo é público, a proteção real é o login.
- **Super admin inicial:** `matheusalencar@amais.io`.
- **Definições de métrica (usuário):**
  - "débito" = só parcela **vencida** com linha digitável;
  - "resolução" = tudo que não virou pop-up de erro, inclusive "em dia sem boleto".
- **Lógica de negócio em módulos puros testados** em `n8n/painel/*.js` (robô, branch `feat/painel-admin`). O jsCode dos nós é gerado por `node n8n/painel/gerar-codigo-no.js <no>`, com `<no>` ∈ `registrar-consulta` | `registrar-evento-front` | `montar-dashboard` | `painel-api`. Os placeholders `__SUPABASE_SERVICE_KEY__` e `__PLANILHA_URL__` são substituídos só no payload MCP.
- **Processo:** o usuário pediu brainstorming → writing-plans → subagent-driven-development, com paralelismo quando possível, **sem perguntar nada no meio**: aprovar o próprio plano e entregar testado. E2E de frontend com **agent-browser (Vercel)**.

## 3. O que já foi feito

**Parte A: consulta de boletos (concluída e em produção, 23/09)**
1. **Diagnóstico:**
   - o cache estava parado desde 05/08 (o n8n travava por memória ao processar a planilha de 5 MB);
   - a regra "cache < 24h" jogava tudo para o robô ao vivo;
   - o robô não acha CPF de responsável;
   - o despertador pingava o serviço errado (suspenso) → 503 → mensagem enganosa.
2. **O robô agora processa a planilha:** `processar_planilha.js` é uma porta fiel do nó n8n, validada por golden test. Ele envia o lote ao n8n pelo webhook secreto e aplica filtro "a receber". A janela vai de 01/01 do ano anterior até o fim do mês seguinte. Há allowlist de URL `https://n8n.amais.io/webhook/`, retry só do POST, teto de 2 consultas ao vivo e keep-alive durante o export. Commit `e552e98` em produção.
3. **n8n:**
   - cache vale no mesmo dia;
   - robô com 5 tentativas + `Accept: application/json`;
   - fallback para cache antigo;
   - erros com `code` (`nao_encontrado` | `instabilidade` | `sem_senha`);
   - guarda do lote: ≥1000 CPFs e algum devedor.
4. **Site:** trata `code`, timeout de 150 s e não re-tenta timeout. Commit `aafb360`.
5. **Validação:** o export das 00:02Z ingeriu 1.981 CPFs e 2.476 linhas foram atualizadas. Os 8 CPFs do usuário respondem corretamente do cache.
   - O 1º export morreu por colisão com o deploy da Render.
   - Snapshot antes: `backups/alunos_cache-snapshot-2026-09-23.json`.

**Parte B: painel admin**

- **Spec:** `docs/superpowers/specs/2026-09-23-painel-admin-design.md`.
- **Plano:** `docs/superpowers/plans/2026-09-23-painel-admin.md`, com 8 tasks.
- **Ledger:** `.superpowers/sdd/2026-09-23-painel-admin/progress.md` (gitignored, fica no disco). **Leia primeiro.**

| Task | O quê | Estado |
|---|---|---|
| 1 | Módulos puros + testes (44/44) | ✅ `7b2958f`..`65e31f5` (branch `feat/painel-admin`, **não mergeado/pushado**) |
| 2 | Data Tables + planilha | ✅ (o share com matheusalencar falhou: foi bloqueado pelo classificador de permissões do Claude Code; o usuário deve compartilhar manualmente) |
| 3 | Log no workflow PROD (Respond to Webhook → log → planilha; log de ingestão) | ⚠️ Construído e publicado; o teste `cpf=123` travou → **revertido** para `1b233a18`. O rascunho com tudo está preservado como versionId `6f4a77f8-5c99-4c53-bb1e-c48c9812897b`. |
| 4 | Workflow Eventos do Site | ✅ publicado e testado (204; linhas no log e na planilha). Falta a revisão formal. |
| 5 | Workflow Painel Admin + super admin | ❌ Desenho validado (`validate_workflow` ok, 9 nós) mas **não criado** (n8n 503 "Database is not ready", depois MCP 502). `this.helpers.httpRequest` em nó Code foi **confirmado funcionando**. |
| 6 | Beacons de erro no site + rota do painel | ✅ `c955ebd`, **pushado** |
| 7 | Frontend do painel | ✅ `96c9a6d`, **pushado** (a página abre, mas o login falha: a API não existe) |
| 8 | Deploy + E2E | parcial: o site foi pushado a pedido do usuário |

**Descobertas:**
- **Bug pré-existente:** `cpf=123` trava **também na versão antiga** do PROD. `Validar CPF` → `Ler Supabase Cache` roda **antes** do IF `CPF Invalido`, com cpf indefinido, e a execução fica "running". Real users não chegam lá (o site valida antes), mas as execuções presas ocupam o n8n. **Não foi a Task 3 que causou.**
- **Janela a partir de 01/01/2025:** inclui 2.516 linhas de débitos de 2025, e 1.045 famílias viram "negociar". Mantido, porque é dado real da Sponte; o usuário deve ser informado.

## 4. Estado atual

- **Funcionando:**
  - consulta do site (≈2 s);
  - robô `e552e98`;
  - export diário (próximo às 03:00 SP);
  - beacon de erros do navegador;
  - página do painel `https://rob-sponte-2.vercel.app/painel-f8ed7ba4777f/` (200).
- **Não funcionando:**
  - login do painel (`POST /webhook/painel-api` → 404);
  - super admin inexistente;
  - log das consultas servidas pelo n8n (Task 3 revertida), então o dashboard mostraria só eventos do navegador.
- **Bloqueio:** `n8n-mcp` retorna 502 nesta sessão. O usuário adicionou um conector "N8N AMAIS" no claude.ai, que só aparece numa **sessão nova**. O n8n em si está saudável (`/healthz` e `/healthz/readiness` 200).

## 5. Próximos passos

1. **Conectividade:** confirmar que o MCP do n8n responde. Carregar via ToolSearch `select:mcp__n8n-mcp__search_workflows` (ou o nome do conector "N8N AMAIS") e chamar `search_workflows`.
2. **Verificar produção:**
   - `get_workflow_details W7tTXjTNvvO62wYO` → `activeVersionId` deve ser `1b233a18-…`;
   - `search_executions` status `running` → se houver execuções presas antigas (dos testes `cpf=123`), anotar. Não há tool de stop; mencionar ao usuário se persistirem.
3. **Task 3 (republicar com correção).** Partir do rascunho `6f4a77f8…`: se o rascunho atual do workflow ainda for ele, `get_workflow_details` mostra os nós `Responder ao Site`, `Registrar Consulta` etc. Com `update_workflow`:
   - remover a conexão `Validar CPF` → `Ler Supabase Cache`;
   - adicionar `Validar CPF` → `CPF Invalido`;
   - trocar a saída **true** de `CPF Invalido` para `Retornar Erro CPF` (já é) e a saída **false** para `Ler Supabase Cache`;
   - `Cache Recente?`: true → `Formatar Cache` (já é); **false → `Buscar Alunos 8731`** (antes ia para `CPF Invalido`).

   Conferir conexões, `publish_workflow`, e rodar os testes do brief (`task-3-brief.md` step 5), incluindo `cpf=123` com `-m 60`. Se algo falhar, reverter com `publish_workflow` versionId `1b233a18-9b40-492c-997e-f7f716af0b0f`.
4. **Task 5 (criar a API do painel).** Fonte validada (só placeholders): `.superpowers/sdd/2026-09-23-painel-admin/task5-workflow.ts`. Desenho completo em `task-45-report.md`.
   - Substituir `__SUPABASE_SERVICE_KEY__`: é o header `apikey` do nó `Upsert Supabase` do PROD. Nunca gravar em arquivo.
   - Substituir `__PLANILHA_URL__`: vem de `backups/painel-ids.json`.
   - `create_workflow_from_code`, depois publish.
5. **Criar o super admin** `matheusalencar@amais.io`:
   - senha gerada, salva só em `backups/super-admin-senha.txt`;
   - via workflow TMP com nó Code chamando `POST /auth/v1/admin/users` com `{ email_confirm: true, app_metadata: { painel:true, papel:'super_admin', nome:'Matheus Alencar', ativo:true } }`;
   - arquivar o TMP.
6. **Testes de contrato da API:** os 12 curl de `task-5-brief.md` step 4 (login ok/errado, 401, 403 membro, criar/desativar/reativar/redefinir/remover membro de teste `painel-teste+<ts>@amais.io`, não remover a si mesmo, OPTIONS com CORS). Remover os usuários de teste.
7. **Revisões pendentes** (subagent-driven-development): Task 3 (após republicar), Task 4, Task 5, cada uma com um task reviewer. Depois, a **revisão final do branch inteiro** (modelo mais capaz). Os minors adiados estão no ledger.
8. **Merge + push do robô:** `feat/painel-admin` → `main` (fast-forward). Só módulos e testes; nada muda em runtime. Push com o comando da §7.
9. **E2E com agent-browser** (`task-8-brief.md` step 3):
   - login errado/certo;
   - dashboard com 5 cards;
   - "Consultas realizadas" (Hoje) = linhas de hoje no Data Table;
   - criar membro → login como membro → sem menu Usuários → trocar senha → remover;
   - 360 px sem scroll horizontal;
   - CPF inválido no site vira linha `cpf_invalido` no log;
   - também a consulta do site com os 8 CPFs do usuário: `06140707323 07667401373 01831885352 03583035160 68018622353 02683233302 60740570366 61600960367`.
10. **Memória:** criar `painel-admin.md` (URL, IDs de workflows, tables e planilha, onde está a senha provisória, como adicionar um super admin via admin API) e atualizar `deploy-topology.md` e `render-free-tier-limite.md` (despertador desligado; ingestão via webhook secreto; robô processa a planilha). Atualizar `MEMORY.md`.
11. **Entregar ao usuário:** link do painel, e-mail + senha provisória (pedir para trocar), lista "Rulings I made" do ledger, pendências manuais (§6).

## 6. Perguntas em aberto

- **Compartilhar a planilha** com `matheusalencar@amais.io`: o usuário precisa fazer isso manualmente pela conta `valdeyrcunha@amais.io`. Não contornar o bloqueio de permissão.
- **Segurança (pré-existente, precisa do usuário):**
  - a senha do admin Sponte está hardcoded em `export_sponte.js` num **repo público**, e há um `token.txt` versionado. Recomendar trocar a senha e mover para uma env var da Render;
  - a service key do Supabase está hardcoded nos nós HTTP/Code do n8n.
- **Janela de débitos de 2025:** as 1.045 famílias agora em "negociar" incluem dívidas antigas. Confirmar com o usuário se deve voltar só para o ano corrente (trocar `currentYear - 1` → `currentYear` em `export_sponte.js`).
- **Workflow `Zr2SAslJCI1EvdD6`** ("[AMAIS] Bot Segunda Via de Boleto v2"): o usuário perguntou sobre ele. Não é deste sistema e não foi tocado.

## 7. Artefatos relevantes

- **Ledgers (ler primeiro):**
  - `.superpowers/sdd/2026-09-23-painel-admin/progress.md`
  - `.superpowers/sdd/2026-09-23-consulta-boletos-confiavel/progress.md`
- **Briefs/relatórios por task:** `.superpowers/sdd/2026-09-23-painel-admin/task-N-{brief,report}.md`, `task-45-report.md`, `task-3-workflow-after.json`, `task4-workflow.ts`, `task5-workflow.ts`, `global-constraints.md`.
- **Specs e planos:** `docs/superpowers/specs/2026-09-23-*.md`, `docs/superpowers/plans/2026-09-23-*.md`.
- **Gitignored em `backups/`:**
  - `painel-ids.json` (ids das tables e da planilha)
  - `cache-webhook-suffix.txt` (**segredo**, não imprimir)
  - `W7tTXjTNvvO62wYO-*.json` (backups do workflow)
  - `alunos_cache-snapshot-2026-09-23.json`
  - `super-admin-senha.txt` (a criar)
- **Push:** o `gh` tem token inválido. Use o Git Credential Manager:
  ```
  git -c credential.https://github.com.helper= -c credential.https://github.com.helper=manager -c credential.interactive=never push origin main
  ```
- **Testes:**
  - robô: `npm test` (= `node --test test/**/*.test.js`);
  - painel: `node --test frontend/painel-f8ed7ba4777f/formatos.test.js` (no repo do site).
- **Checagens rápidas:**
  ```
  curl -s https://rob-sponte-r2vk.onrender.com/versao
  curl -s -X POST https://n8n.amais.io/webhook/buscar-boletos-novo -H 'Content-Type: application/json' -d '{"cpf":"07667401373"}'
  curl -s -X POST https://n8n.amais.io/webhook/painel-api -H 'Content-Type: application/json' -d '{"acao":"login","email":"x@x.com","senha":"x"}'
  ```
- **Skills:**
  - `superpowers:subagent-driven-development`: scripts em `…/skills/subagent-driven-development/scripts/` (`sdd-workspace`, `task-brief`, `review-package`);
  - `superpowers:dispatching-parallel-agents`.

## 8. Instruções para a próxima sessão

- **Idioma e tom:** responder ao usuário em **português do Brasil**, direto, sem jargão desnecessário. Ele quer tudo entregue pronto e testado, **sem perguntas no meio**. Decida, registre a decisão ("Ruling:") no ledger e siga. Pare só para ação irreversível ou de segurança, ou quando algo depende dele (conectar MCP, compartilhar planilha).
- **Segredos:**
  - nunca escrever a service key do Supabase, o sufixo do webhook, senhas ou tokens em arquivos versionados, relatórios ou mensagens. Os repos são **públicos**;
  - se o classificador de permissões bloquear algo com credencial, **não contornar**: reportar ao usuário.
- **Git:** nunca `git add -A` / `git add .`. Há arquivos não rastreados com segredos no repo do robô, e `node_modules` não é ignorado no repo do site. Adicionar arquivos pelo nome. O trailer dos commits é `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **n8n:** toda edição via MCP fica em rascunho; **publicar** depois. Antes de mexer no PROD `W7tTXjTNvvO62wYO`, salvar um backup e anotar o `activeVersionId` para poder reverter. O `get_workflow_details` é grande (~60 KB): extraia só o necessário com `node`.
- **Rate limit:** houve vários 429 com muitos subagentes em paralelo. Prefira 2–3 simultâneos. Se um agente morrer, verifique o estado real (n8n/git) antes de re-despachar, para não duplicar.
- **Produção:** o site é usado por pais de alunos. Qualquer mudança no fluxo de consulta precisa manter o contrato de resposta e ter teste em produção logo após publicar, com plano de reversão.
- **Robô na Render:** não disparar `/iniciar-exportacao` logo após um deploy (a troca de instância matou o 1º export). Espere o `/versao` estabilizar por 1–2 min.
