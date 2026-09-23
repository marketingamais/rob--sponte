# Painel de administração — design

Data: 2026-09-23
Depende de: `2026-09-23-consulta-boletos-confiavel-design.md` (consulta com `code`, n8n PROD `W7tTXjTNvvO62wYO`).

## Objetivo

Um painel privado para acompanhar o sistema de consulta de boletos:
- dashboard com as métricas abaixo;
- usuários com login;
- um super administrador que também gerencia os membros.

Os erros vão para uma planilha Google atualizada em tempo real.

## Decisões do usuário

- **Onde fica:** no mesmo site, em caminho secreto `https://rob-sponte-2.vercel.app/painel-f8ed7ba4777f/`. Não há link na página principal e a página leva `noindex`. O repo é público, então o caminho não é segredo forte; a proteção real é o login.
- **Login:** e-mail + senha. O super admin cadastra o membro com uma senha provisória, e o membro pode trocá-la depois.
- **Super admin inicial:** `matheusalencar@amais.io`.
- **CPF:** só aparece na planilha de erros. O log do dashboard não guarda CPF.
- **Planilha de erros:** Google Sheets, uma linha por erro. Colunas: Data/hora, CPF, Tela do erro, Erro, Motivo do erro, Possível solução.
- **Métricas:**
  1. Consultas realizadas.
  2. Consultas com débito: o sistema devolveu linha digitável de parcela **vencida**.
  3. Encaminhamentos para a Amais: `negociar`, mais de 5 dias de atraso.
  4. Taxa de resolução: tudo que não terminou em pop-up de erro, incluindo "em dia sem boleto".
  5. Taxa de erros, detalhada pelo nome de cada pop-up.
  6. Saúde do sistema.

## Restrições técnicas

Elas moldam a arquitetura:
- Não há acesso às variáveis de ambiente da Vercel nem da Render.
- Não há SQL no Supabase `udvkjlnvcttzrhscsecg`: ele não está na conta MCP. Só temos a service key, que já mora no n8n.
- O n8n tem Data Tables (projeto `WqOqk61ZzmyASX4J`) e a credencial Google Sheets `[AMAIS] GOOGLE SHEETS` (`LU6wtO2xAV2RTwgO`).
- O Supabase Auth está ativo, com provedor e-mail. A admin API responde com a service key e hoje há 0 usuários.

Conclusão: todo segredo fica no n8n. O navegador só fala com webhooks do n8n.

## Arquitetura

```
Site (consulta) ──POST buscar-boletos-novo──► n8n PROD (consulta)
      │                                         ├─ responde ao site (Respond to Webhook)
      │                                         └─ depois: registra no Data Table cia_consultas_log
      │                                                     └─ se erro: linha na planilha "Erros - Consulta Boletos CIA"
      └──sendBeacon registrar-evento-front──► n8n (erros só do navegador: CPF inválido, timeout, erro desconhecido)

Painel (/painel-f8ed7ba4777f/) ──POST painel-api {acao, ...} + Bearer──► n8n "[CIA] Painel Admin [PROD]"
      ├─ login / refresh ──► Supabase Auth (/auth/v1/token)
      ├─ toda outra ação: valida token (GET /auth/v1/user) + papel em cia_admin_usuarios
      ├─ dashboard ──► agrega cia_consultas_log + cia_ingestoes_log + saúde (robô /ping,/versao; idade do cache)
      └─ usuarios.* (só super_admin) ──► Supabase Auth admin API + cia_admin_usuarios
```

### 1. Log de consultas (n8n PROD `W7tTXjTNvvO62wYO`)

- O `Webhook POST Frontend` passa a `responseMode: responseNode`. Cada ponto terminal passa por um nó `Responder ao Site` (Respond to Webhook) com o JSON atual e depois segue para `Registrar Consulta`. Os pontos terminais são: `Formatar Cache`, `Responder Live`, `Responder Erro`, `Retornar Erro CPF`, e também `Resposta CORS` no webhook OPTIONS, que continua como está. O contrato da resposta ao site não muda.
- `Validar CPF` grava `inicioMs: Date.now()`.
- **`Registrar Consulta`** (Code) monta a linha a partir da resposta. Ele usa a função pura `classificarConsulta(resposta)` (ver abaixo) e grava:
  - `quando` (ISO), `resultado`, `tela`, `code`;
  - `origem`: `cache` | `ao_vivo` | `cache_antigo` | `validacao`;
  - `duracao_ms`, `qtd_boletos`.
  Se for erro, também monta a linha da planilha com CPF, tela, erro, motivo e solução, via `motivoESolucao(code, detalhe)`.
- Insere a linha em `cia_consultas_log` (Data Table). Se for erro, adiciona a linha na planilha. Os nós de log usam `onError: continueRegularOutput`: falha no log nunca afeta a consulta, porque a resposta já foi enviada.
- **Valores de `resultado`:**

  | `resultado` | Quando |
  |---|---|
  | `debito` | status `pagar_atrasados` com ≥ 1 boleto com linha digitável |
  | `encaminhamento` | `negociar` |
  | `em_dia_boleto` | em dia, com próximo boleto com linha digitável |
  | `em_dia_sem_boleto` | em dia, sem boleto liberado |
  | `erro` | qualquer resposta `status: 'erro'` |

  Quando há vários filhos, vale o status geral da resposta.
- **Valores de `tela`** (o pop-up que o site mostra):

  | `tela` | Quando |
  |---|---|
  | `Boletos vencidos` | `debito` |
  | `Negociar com a Amais` | `encaminhamento` |
  | `Em dia` | `em_dia_*` |
  | `CPF não encontrado` | `code: nao_encontrado` |
  | `Sistema instável` | `code: instabilidade` |
  | `Sem senha no portal` | `code: sem_senha` |
  | `CPF inválido` | `Retornar Erro CPF` |
  | `Erro desconhecido` | qualquer outro erro |

### 2. Erros que só o navegador vê

O site (`frontend/script.js`) chama `navigator.sendBeacon('https://n8n.amais.io/webhook/registrar-evento-front', JSON)` em três casos:
- **(a)** CPF que falha no `validarCPF` do site: tela "CPF inválido". Esse CPF nunca chega ao n8n.
- **(b)** Timeout ou falha de rede depois das tentativas: tela "Sistema instável", `code: timeout_navegador`.
- **(c)** O `alert("Erro desconhecido…")`: tela "Erro desconhecido".

Um workflow novo, pequeno, `[CIA] Eventos do Site [PROD]`, faz o seguinte:
- valida os campos (lista fechada de telas e codes; CPF só dígitos, até 11);
- grava em `cia_consultas_log` com `origem: 'navegador'`;
- adiciona a linha na planilha;
- responde 204.

O webhook é público. Aceitamos o risco de alguém poluir métricas, porque ele só grava log e nunca lê nada.

### 3. Log de ingestão

O ramo `Webhook (Cache Processado)` grava em `cia_ingestoes_log` os campos `quando`, `geradoEm`, `cpfs`, `devedores`, `filtroSituacaoAplicado` e `status`. Os valores de `status`:
- `ok`, no fim, em `Resumo Ingestao`;
- `rejeitado`, com `motivo`. Para isso, `Validar Lote` passa a ter saída de erro (`onError: continueErrorOutput`) → `Registrar Rejeicao` → resposta 422. O efeito continua sendo "não toca no Supabase".

### 4. Planilha de erros

Planilha "Erros - Consulta Boletos CIA", criada pelo n8n com a credencial `[AMAIS] GOOGLE SHEETS` e compartilhada como editor com `matheusalencar@amais.io`.

Aba `Erros`, com cabeçalho `Data/hora | CPF | Tela do erro | Erro | Motivo do erro | Possível solução`.

`motivoESolucao` (tabela fixa):

| code / tela | Erro | Motivo | Possível solução |
|---|---|---|---|
| `nao_encontrado` | Nenhum aluno ou responsável com esse CPF | O CPF não é de aluno cadastrado na Sponte (8731/70532) e não aparece como CPFResponsavel no relatório de Contas a Receber | Conferir o CPF com o responsável; verificar na Sponte se o aluno/responsável está cadastrado com esse CPF |
| `instabilidade` (robô) | Robô não respondeu | O robô ao vivo falhou ou demorou nas 5 tentativas e não havia cache | Tentar de novo em alguns minutos; ver "Saúde do sistema" no painel |
| `instabilidade` (API Sponte) | API da Sponte indisponível | A consulta de alunos na Sponte retornou erro | Aguardar a Sponte normalizar; se persistir, contatar suporte Sponte |
| `sem_senha` | Aluno sem senha no Portal | O aluno não tem senha do Portal do Aluno cadastrada na Sponte | Cadastrar a senha do Portal do Aluno na Sponte |
| `timeout_navegador` | Tempo esgotado no site | O site esperou 150 s sem resposta, ou a rede falhou | Tentar de novo; se repetir, ver "Saúde do sistema" |
| `cpf_invalido` | CPF inválido | O CPF digitado não passa na verificação de dígitos | Orientar a pessoa a conferir o CPF digitado |
| outro | Erro desconhecido | Resposta inesperada do sistema | Ver a execução no n8n pelo horário |

Para separar os dois casos de `instabilidade`, `Responder Erro` passa a incluir `detalhe` (`robo` | `api_sponte`). O site ignora esse campo.

### 5. API do painel (workflow novo `[CIA] Painel Admin [PROD]`)

- Um webhook `POST painel-api`. O corpo é `{ acao, ...params }` e o cabeçalho é `Authorization: Bearer <access_token>`, exceto em login e refresh.
- CORS: `Access-Control-Allow-Origin: https://rob-sponte-2.vercel.app`, mais um webhook OPTIONS.
- Um nó `Roteador` (Switch por `acao`). Toda ação, exceto `login` e `refresh`, passa antes por `Autenticar`:
  1. `GET /auth/v1/user` com o token do usuário;
  2. busca o e-mail em `cia_admin_usuarios`;
  3. exige `ativo = true`;
  4. anexa `{ email, nome, papel }`.

  Token inválido → `401 { erro: 'sessao_expirada' }`. Papel insuficiente → `403`.

**Ações:**

| `acao` | Quem | Faz |
|---|---|---|
| `login` `{email, senha}` | todos | `POST /auth/v1/token?grant_type=password`. Se ok e ativo na tabela → `{ access_token, refresh_token, expires_at, usuario }`. Erro genérico "E-mail ou senha inválidos" (não revela se o e-mail existe). Usuário inativo → mesmo erro genérico. |
| `refresh` `{refresh_token}` | todos | `grant_type=refresh_token`, mais o mesmo checagem de ativo |
| `dashboard` `{de, ate}` | membro+ | ver §6 |
| `trocar_senha` `{senha_nova}` | membro+ | `PUT /auth/v1/user` com o token do próprio usuário; mínimo 10 caracteres |
| `usuarios_listar` | super_admin | linhas de `cia_admin_usuarios` |
| `usuarios_criar` `{email, nome, papel, senha}` | super_admin | admin API `POST /auth/v1/admin/users` (`email_confirm: true`) e depois linha na tabela. Se o e-mail já existe no Auth, reaproveita e atualiza a senha. |
| `usuarios_atualizar` `{email, nome?, papel?, ativo?}` | super_admin | atualiza a tabela; ao desativar, também faz `ban_duration: '876000h'` no Auth; ao reativar, `ban_duration: 'none'` |
| `usuarios_redefinir_senha` `{email, senha}` | super_admin | admin API `PUT /auth/v1/admin/users/{id}` |
| `usuarios_remover` `{email}` | super_admin | apaga do Auth e da tabela |

**Regras de proteção:**
- O super admin não pode desativar, rebaixar nem remover a si mesmo.
- Tem que sobrar pelo menos 1 super_admin ativo.
- Papéis válidos: `super_admin` e `membro`.
- Senha com no mínimo 10 caracteres.

**Data Table `cia_admin_usuarios`:** `email`, `nome`, `papel`, `ativo`, `criado_em`, `criado_por`.

### 6. Dashboard (`acao: dashboard`)

Período `de`/`ate` (datas locais de São Paulo). Opções prontas: Hoje, 7 dias (padrão), 30 dias e Personalizado.

A agregação é uma função pura `agregarDashboard(linhas, de, ate)`. Ela devolve:

- **Cards:**
  1. Consultas realizadas: total de linhas, servidor + navegador.
  2. Consultas com débito: `resultado = debito`.
  3. Encaminhamentos para a Amais: `resultado = encaminhamento`.
  4. Taxa de resolução: `(total − erro) / total`.
  5. Taxa de erros: `erro / total`.

  Os cards 4 e 5 mostram "—" quando `total = 0`. Os subtotais "Em dia com próximo boleto" e "Em dia sem boleto" aparecem pequenos.
- **Erros por pop-up:** lista `{ tela, qtd, pct }`, ordenada de forma decrescente.
- **Gráfico por dia:** barras empilhadas de resolvidas × erros.
- **Tempo médio de resposta** e **origem** (cache / ao vivo / cache antigo): informação de apoio.
- **Saúde do sistema:** coletada ao vivo a cada chamada, com timeout de 60 s.

  | Item | Verde | Amarelo | Vermelho |
  |---|---|---|---|
  | Robô | `/versao` respondeu em < 5 s (mostra o commit) | respondeu em < 60 s ("acordando") | falhou |
  | Último export | último `cia_ingestoes_log` ok com < 26 h | — | mais velho, ou rejeitado |
  | Idade do cache | `max(data_atualizacao)` do Supabase < 26 h | — | mais velho |
  | Erros nas últimas 24 h | taxa < 10% | 10–25% | > 25% |

Os dados vêm de `cia_consultas_log` filtrado pela janela, via nó Data Table com filtro de data.

**Retenção:** um schedule semanal apaga linhas de `cia_consultas_log` e `cia_ingestoes_log` com mais de 180 dias. A planilha de erros não é apagada.

### 7. Frontend do painel (`rob-sponte-2/frontend/painel-f8ed7ba4777f/`)

- **Arquivos:** `index.html` (login + app numa página só, com estados), `painel.css`, `painel.js`, `api.js` (cliente do webhook) e `formatos.js` (formatação pura, testável). Mesma identidade do site: Inter, cores do `style.css`, logo CIA. Gráfico com Chart.js via jsDelivr. `<meta name="robots" content="noindex,nofollow">`.
- **Sessão:** tokens em `sessionStorage`. O refresh é automático 1 min antes de expirar, e 401 volta ao login. Há botão "Sair".
- **Telas:**
  1. **Login.**
  2. **Dashboard:** filtro de período, 5 cards, erros por pop-up, gráfico diário, saúde e botão "Abrir planilha de erros" com o link da planilha.
  3. **Usuários** (menu só para super_admin): tabela; adicionar (nome, e-mail, papel, senha provisória gerada com opção de copiar); editar papel; ativar/desativar; redefinir senha; remover (com confirmação).
  4. **Minha conta:** trocar senha.
- Responsivo, até 360 px de largura.
- **Erros:** mensagens amigáveis; falha de rede → "Não foi possível falar com o servidor. Tente de novo."

## Testes e validação

1. **Funções puras com `node:test`:** `classificarConsulta`, `motivoESolucao`, `agregarDashboard`, as regras de proteção de usuários (`validarAlteracaoUsuario`) e `formatos.js`. Elas ficam no repo do robô em `n8n/painel/*.js` (fonte da verdade). O código dos nós Code é a cópia literal delas, verificada por teste que compara com o JSON do workflow exportado.
2. **n8n:** executar cada ação do `painel-api` via curl em produção:
   - login certo e errado;
   - token inválido → 401;
   - membro chamando ação de super admin → 403;
   - criar, desativar, reativar e remover um membro de teste;
   - não conseguir remover a si mesmo.
3. **Log:** consultar 3 CPFs (um com débito, um em dia, um inexistente) e ver as 3 linhas no Data Table, com 1 linha na planilha.
4. **E2E com agent-browser (Vercel):**
   - login do super admin;
   - dashboard com números batendo com o Data Table;
   - criar um membro, sair, logar como membro;
   - conferir que o membro não vê "Usuários";
   - trocar a senha;
   - voltar como super admin e remover o membro;
   - site principal sem link para o painel.

## Fora de escopo

Recuperação de senha por e-mail (o super admin redefine), 2FA, auditoria de ações dos admins, métricas da carteira (em dia / atrasados no cache) e domínio próprio.
