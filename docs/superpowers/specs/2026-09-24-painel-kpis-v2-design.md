# Painel admin v2: KPIs de conversão, valor recuperado e novo visual

**Data:** 24/09/2026
**Status:** desenho aprovado em conversa; aguardando revisão desta spec
**Base:** `docs/superpowers/specs/2026-09-23-painel-admin-design.md` (painel v1, já em produção)

## 1. Objetivo

O painel v1 mostra volume e erros. O v2 precisa responder a três perguntas:
1. Quantas famílias agiram depois de consultar (copiaram a linha, falaram com a Amais, anteciparam)?
2. Quanto dinheiro o site ajudou a recuperar e a antecipar, contando só quem pagou de fato?
3. Quanto trabalho humano o site poupou?

Também é preciso que o super admin escolha quais KPIs cada membro vê. O visual deve ficar mais moderno, limpo e minimalista.

**Sucesso:** a direção abre o painel e lê o valor recuperado, a conversão e as horas poupadas sem fazer contas. Um membro vê só os cards que o super admin liberou, e a API não entrega os números ocultos.

## 2. Decisões tomadas com o usuário

| Tema | Decisão |
|---|---|
| Arquitetura | Tudo no n8n, com Data Tables e workflows, no painel estático atual (HTML/CSS/SVG, sem React). Sem infraestrutura nova. |
| Redução de inadimplência | Valor pago confirmado ÷ valor em débito mostrado nas consultas com débito do período. |
| Confirmação de pagamento | Conferências 28 h, 48 h e 72 h depois da cópia da linha. |
| Critério de "pagou" | A parcela copiada saiu das parcelas em aberto no cache do export. O valor é **aproximado**, porque renegociação e cancelamento também tiram a parcela da lista. |
| Tempo humano | Tempo humano por consulta = 2 × tempo médio do robô ao vivo. Mostra as horas economizadas e a % de redução. |
| Permissões | Por usuário, com um padrão para novos membros. Super admin vê tudo. O filtro é feito no servidor. |
| KPIs 2, 3 e 4 | Saem direto do campo `resultado` do log de consultas. Nada é recalculado. |
| Visual | Mistura de três referências: advanced-stats (cards 24 px, card escuro de destaque, linha de KPIs), gráfico de área com lista de métricas, e stats-card com barras em par. Paleta CIA, light mode, ícones Tabler. |

## 3. Captura de dados

### 3.1 Código da consulta
- O site gera `consulta_id` (UUID v4, `crypto.randomUUID()`) a cada busca. Ele vai no POST para `buscar-boletos-novo` (`{cpf, consulta_id}`) e fica em memória na página para os eventos.
- No n8n, `Validar CPF` repassa o `consulta_id` somente se casar com o regex de UUID; caso contrário, fica vazio. Um site em cache antigo, que não manda o campo, continua funcionando.
- `Registrar Consulta` grava duas colunas novas em `cia_consultas_log`:
  - `consulta_id` (texto);
  - `valor_debito` (número, soma do `valor` das parcelas vencidas mostradas; 0 se não houver).
- Os valores chegam como `"179,9900"`. A conversão é feita por `n8n/painel/valores.js` → `paraNumero()`, que troca a vírgula decimal e ignora lixo.

### 3.2 Novos eventos do site
São enviados por `sendBeacon` para `registrar-evento-front`, o mesmo canal usado hoje para os erros.

| `tipo` | Quando | Campos |
|---|---|---|
| `copiou_linha` | clique em "Copiar" no modal da linha digitável | `consulta_id`, `cpf`, `modo` (`debito` \| `antecipacao`), `num_parcela`, `vencimento` (dd/mm/aaaa), `valor`, `linha` |
| `clicou_amais` | clique em qualquer "Falar com a Amais" | `consulta_id` |
| `clicou_antecipar` | clique em "Pagar próximo boleto" | `consulta_id` |

- `modo = antecipacao` quando o modal foi aberto pelo botão "Pagar próximo boleto". Nos outros casos, `debito`.
- Os erros do navegador que já existem (`cpf_invalido`, `timeout_navegador`, `desconhecido`) continuam iguais, sem o campo `tipo`.

### 3.3 Processamento no workflow "Eventos do Site"
Novo módulo puro `n8n/painel/eventos.js`, com `normalizarEvento(body)`. Ele devolve `{ tipo, log, conferencia }` ou `{ ignorar: true }`.
- **Log, sempre sem CPF:** grava em `cia_eventos_log` (`quando`, `tipo`, `consulta_id`, `modo`, `valor`).
- **Deduplicação:** o mesmo evento (`consulta_id` + `tipo`, e também parcela e vencimento no caso de `copiou_linha`) é ignorado se já existir no log. A checagem é feita num Data Table get antes do insert.
- **Conferência de pagamento:** só para `copiou_linha`. Uma linha em `cia_pagamentos_a_conferir` é criada apenas se:
  1. o `consulta_id` existir em `cia_consultas_log` nas últimas 2 h; e
  2. a parcela (pela linha digitável, ou por parcela + vencimento) estiver nas parcelas em aberto do cache desse CPF naquele momento.

  Essas duas travas impedem que um evento forjado no webhook público entre no valor recuperado.
- **Planilha de erros:** não recebe os eventos novos.

## 4. Conferência de pagamento

### 4.1 Tabelas
- **`cia_pagamentos_a_conferir`** (tem CPF, é temporária): `consulta_id`, `cpf`, `modo`, `num_parcela`, `vencimento`, `linha`, `valor`, `copiado_em`, `etapa` (1 a 3), `proxima_conferencia`.
- **`cia_pagamentos_resultado`** (sem CPF, permanente): `consulta_id`, `modo`, `valor`, `copiado_em`, `resultado` (`pago` \| `nao_pago` \| `indeterminado`), `confirmado_em`, `etapa`.

### 4.2 Workflow "[CIA] Conferir Pagamentos"
Roda de hora em hora (Schedule). Para cada linha com `proxima_conferencia <= agora`:
1. Lê o cache do CPF no Supabase (`alunos_cache`).
2. Chama a função pura `decidirConferencia(linha, cacheRow, agora)` de `n8n/painel/pagamentos.js`:
   - **Cache desatualizado** (`data_atualizacao <= copiado_em`, ou seja, não houve export depois da cópia): não conta a etapa. Avança para a próxima etapa sem concluir. Se já era a etapa 3, o resultado é `indeterminado`.
   - **Parcela ausente** das parcelas em aberto (em `proximo_boleto.alunos[].boletos` e no formato legado): `pago`.
   - **Parcela presente:** se a etapa for menor que 3, vai para a próxima etapa (48 h, depois 72 h). Na etapa 3, o resultado é `nao_pago`.
   - **CPF fora do cache:** `indeterminado`.
3. Com o resultado final, faz o insert em `cia_pagamentos_resultado` e apaga a linha de `cia_pagamentos_a_conferir`. Assim, o CPF deixa de existir em até 72 h mais uma rodada.

Os horários das etapas contam a partir de `copiado_em`: +28 h, +48 h e +72 h.

## 5. KPIs

Período = `de`..`ate`, em dia de São Paulo, como no v1. Cada KPI tem uma chave, que também é usada nas permissões.

| Grupo | Chave | Cálculo |
|---|---|---|
| Volume | `consultas_total` | Linhas do log de consultas no período, inclusive as de erro e as do navegador. |
| Volume | `consultas_em_dia` | `resultado` ∈ {`em_dia_boleto`, `em_dia_sem_boleto`}. |
| Volume | `consultas_debito` | `resultado` ∈ {`debito`, `atrasado_sem_linha`}. |
| Volume | `encaminhamentos` | `resultado` = `encaminhamento`. |
| Volume | `comparativo_diario` | Série por dia com os 4 números acima. |
| Conversão | `funil_debito` | Consultas com débito × `consulta_id` distintos com `copiou_linha` em modo `debito`. Mostra a %. |
| Conversão | `funil_amais` | Encaminhamentos × `consulta_id` distintos com `clicou_amais`. Mostra a %. |
| Conversão | `funil_antecipar` | Consultas em dia × `consulta_id` distintos com `clicou_antecipar`. Mostra a %. |
| Financeiro | `valor_recuperado` | Soma de `valor` em `cia_pagamentos_resultado` com `pago` e modo `debito`, pela data da cópia. Mostra também a soma de `valor` "em conferência" (`cia_pagamentos_a_conferir`, modo `debito`). |
| Financeiro | `valor_antecipado` | A mesma lógica, com modo `antecipacao`. |
| Financeiro | `reducao_inadimplencia` | `valor_recuperado` ÷ soma de `valor_debito` das consultas com débito do período. Sem base, mostra `null` ("—"). |
| Eficiência | `tempo_humano` | Ver a seção 5.1. |
| Operação | `erros_por_tela` | Como no v1. |
| Operação | `origem_respostas` | Como no v1. |
| Operação | `saude_sistema` | Como no v1. |

- **Comparação com o período anterior:** os cards de Volume e Financeiro mostram a variação, reaproveitando `periodoAnterior()`, `variacao()` e a segunda chamada que o painel já faz.
- **Contagem:** tudo é contado por consulta, não por família.

### 5.1 Tempo humano
- `tempoRobo`: média de `duracao_ms` das consultas com `origem = ao_vivo` no período. Se não houver nenhuma, usa os últimos 30 dias do log. Se ainda assim não houver, usa 60 000 ms e liga a flag `estimado: true`.
- `tempoHumano = 2 × tempoRobo`.
- `semHumano` = consultas do período com `resultado ≠ erro`.
- `horasEconomizadas = semHumano × tempoHumano / 3 600 000`.
- `reducaoTempo = 1 − (tempo médio real do site no período ÷ tempoHumano)`, limitado a [0, 1].

## 6. Permissões

- **Catálogo:** `n8n/painel/kpis.js` exporta o catálogo `KPIS` (chave, grupo, rótulo) e a função `kpisPermitidos(usuario, padrao)`:
  - `super_admin` → todas as chaves;
  - membro com `app_metadata.kpis` válido → a lista dele, filtrada pelo catálogo;
  - membro sem lista → o `padrao`.
- **Padrão para novos membros:** fica em `cia_painel_config`, na linha `chave = 'kpis_padrao'`, com `valor` = JSON com a lista. O padrão inicial é Volume + Conversão + Operação.
- **Mudanças na API (`painel-api`):**
  - `dashboard`: calcula tudo e depois apaga do corpo as chaves não permitidas antes de responder. Também responde `kpis: [...]`, a lista permitida, para o front montar a grade.
  - `usuarios_criar` e `usuarios_atualizar`: aceitam `kpis` (array). A validação exige que seja um array de chaves do catálogo; caso contrário, responde 400.
  - `usuarios_listar`: devolve `kpis` de cada membro.
  - novas ações só para super admin: `kpis_padrao_ler` e `kpis_padrao_salvar`.
- **Front:** a tela Usuários ganha "KPIs visíveis" por membro, com caixas de marcar agrupadas por grupo, e o botão "Padrão para novos membros".

## 7. Layout

- **Base:**
  - fundo branco `#FFFFFF`;
  - cards com raio de 24 px, fundo `#F7F8FB`, borda `#E6E8F0`;
  - rótulos de 11 px em maiúsculas, com `letter-spacing` de 0.12em e cor `#8A90A6`;
  - números em Inter 700, com `tabular-nums`;
  - selo de variação em pílula verde (`#059669` sobre `#ECFDF5`) ou vermelha (`#E11D48` sobre `#FFF1F2`);
  - azul CIA `#23316E` como cor principal.
- **Menu lateral:** o atual, recolhível, com visual mais limpo.
- **Linhas da grade:**
  1. **KPIs de Volume** (4 cards). O hover tinge a borda de verde ou vermelho conforme a variação.
  2. **Comparativo diário** em área suave com degradê e legenda em quadradinhos, ocupando 2/3. Na coluna à direita: o card escuro `#23316E` com a **Redução de inadimplência** (% e barra de progresso) e, abaixo, o card claro de **Tempo humano** (horas economizadas e % de redução).
  3. **Três funis**, cada um com número grande, % de conversão com seta e barras em par por dia (escura = consultaram, clara = agiram).
  4. **Valor recuperado** e **Valor antecipado**, com a linha "+ R$ X em conferência".
  5. **Operação:** Erros por tela, Origem das respostas e Saúde do sistema, em lista de métricas com ícone Tabler, rótulo, valor e seta.
- **Comportamento:**
  - cards sem permissão não são renderizados, e a grade CSS se reorganiza sozinha;
  - no celular (até 767 px) tudo fica em uma coluna, sem rolagem horizontal;
  - os cards entram em sequência (fade + 8 px), e nada anima com `prefers-reduced-motion`;
  - os gráficos continuam em SVG próprio (`graficos.js`), com um tipo novo: área suave com várias séries (`areas()`) e barras em par (`barrasPar()`).

## 8. Privacidade (LGPD)

- **CPF:** existe só em `cia_pagamentos_a_conferir`, por no máximo cerca de 73 h, e na planilha de erros, como já acontece hoje. Os logs de eventos, os resultados e o dashboard não têm CPF.
- **Valores:** o valor das parcelas não identifica ninguém sem o CPF.
- **Execuções do n8n:** a recomendação de "Do not save" continua valendo para o painel-api. Para o workflow de conferência, vale o mesmo, porque as execuções carregam CPF.

## 9. Testes

- **Unitários** (`node --test`), com os módulos puros primeiro:
  - `valores.paraNumero`;
  - `eventos.normalizarEvento`: tipos, deduplicação por chave e sanitização;
  - `pagamentos.decidirConferencia`: pago, próxima etapa, desatualizado, 3ª etapa, CPF ausente e formato legado;
  - `kpis.agregarKpis`: cada KPI com fixture, divisão por zero e fallback do tempo;
  - `kpis.kpisPermitidos` e o filtro do corpo;
  - `consulta_log` com os novos campos.
- **Contrato da API:** o super admin recebe todas as chaves. Um membro com `kpis = [consultas_total]` recebe só essa, e não recebe `valor_recuperado`. `kpis` inválido responde 400.
- **Workflows:**
  - Conferir Pagamentos com `test_workflow` usando cache fixado (pinned) nos cenários pago, não pago e desatualizado;
  - Eventos com um evento forjado, cujo `consulta_id` não existe, que precisa ser ignorado.
- **E2E (agent-browser):**
  - consulta real, depois copiar a linha; conferir a linha em `cia_eventos_log` e em `cia_pagamentos_a_conferir`;
  - painel com super admin e com membro restrito;
  - 360 px sem rolagem horizontal.

## 10. Ordem de entrega

1. Módulos puros e testes (robô, `n8n/painel/`).
2. Data Tables: novas colunas em `cia_consultas_log` e as tabelas `cia_eventos_log`, `cia_pagamentos_a_conferir`, `cia_pagamentos_resultado` e `cia_painel_config`.
3. n8n PROD: `Validar CPF` e `Registrar Consulta` passam a gravar `consulta_id` e os valores. A resposta ao site não muda.
4. Workflow Eventos: novos tipos, deduplicação e travas.
5. Site: `consulta_id` e os três eventos. É compatível com o n8n anterior.
6. Workflow Conferir Pagamentos.
7. painel-api: KPIs novos, permissões e padrão.
8. Front do painel: novo layout e tela de permissões.
9. E2E, revisão e memória.

Cada etapa que mexe em produção precisa de backup e versão de reversão anotada, e é testada logo após publicar.

## 11. Riscos e limites

- **Valor aproximado:** renegociação ou cancelamento contam como pago.
- **Dependência do export:** se o export falhar três dias seguidos, as conferências terminam como `indeterminado` e não entram no valor.
- **Baixa ou saldo parcial:** a parcela só "some" quando a Sponte baixa o pagamento. Boleto pago mas ainda não compensado aparece como não pago na conferência de 28 h, e é por isso que existem as conferências de 48 h e 72 h.
- **Cópia não é pagamento:** a cópia mede intenção. Quem paga pelo app do banco lendo o código de barras em outro lugar não é contado.
- **Primeiros dias:** o histórico é curto, e os cards de valor ficam com "em conferência" nos 3 primeiros dias.
