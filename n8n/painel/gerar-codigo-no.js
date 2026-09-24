#!/usr/bin/env node
// Uso: node n8n/painel/gerar-codigo-no.js <no>  -> imprime o jsCode do no Code do n8n
const fs = require('fs');
const path = require('path');

const mod = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8')
    .split('\n').filter(l => !l.includes('// @no-n8n')).join('\n')
    .replace(/^module\.exports\s*=.*$/m, '').trim();

const ADAPTADORES = {
    // Workflow de consulta: roda depois de "Responder ao Site". Entrada: a resposta enviada ao site.
    'registrar-consulta': ['valores.js', 'consulta_log.js'],
    'registrar-evento-front': ['valores.js', 'consulta_log.js', 'pagamentos.js', 'eventos.js'],
    'validar-copia': ['valores.js', 'pagamentos.js', 'eventos.js'],
    'montar-dashboard': ['dashboard.js', 'kpis.js'],
    'painel-api': ['kpis.js', 'usuarios.js']
};

const CORPOS = {
    'registrar-consulta': `
const resposta = $json;
const inicio = $('Validar CPF').first().json.inicioMs;
const cpf = String($('Validar CPF').first().json.cpf || '').replace(/\\D/g, '');
const quando = new Date().toISOString();
const c = classificarConsulta(resposta);
const consultaId = String($('Validar CPF').first().json.consulta_id || '');
const log = { quando, resultado: c.resultado, tela: c.tela, code: c.code, origem: c.origem,
  duracao_ms: inicio ? Date.now() - inicio : null, qtd_boletos: c.qtd_boletos, consulta_id: consultaId, valor_debito: c.valor_debito };
const planilha = c.resultado === 'erro' ? linhaPlanilhaErro({ quando, cpf, tela: c.tela, code: c.code, detalhe: resposta.detalhe }) : null;
return [{ json: { log, planilha } }];`,
    'registrar-evento-front': `
const b = $json.body || {};
const quando = new Date().toISOString();
if (b.tipo) {
  const e = normalizarEvento(b, quando);
  if (e.ignorar) return [{ json: { rota: 'ignorar', motivo: e.motivo } }];
  return [{ json: { rota: 'evento', tipo: e.tipo, log: e.log, conferencia: e.conferencia } }];
}
const CODES = ['cpf_invalido', 'timeout_navegador', 'desconhecido'];
const code = CODES.includes(b.code) ? b.code : 'desconhecido';
const cpf = String(b.cpf || '').replace(/\\D/g, '').slice(0, 11);
const c = classificarConsulta({ status: 'erro', code });
const duracao = Number(b.duracao_ms);
const log = { quando, resultado: 'erro', tela: c.tela, code, origem: 'navegador',
  duracao_ms: Number.isFinite(duracao) && duracao >= 0 && duracao < 600000 ? Math.round(duracao) : null, qtd_boletos: 0 };
return [{ json: { rota: 'erro', log, planilha: linhaPlanilhaErro({ quando, cpf, tela: c.tela, code }) } }];`,
    'validar-copia': `
const ev = $('Registrar Evento').first().json;
const consulta = $('Buscar Consulta').all().map(i => i.json).find(r => r && r.consulta_id === ev.conferencia.consulta_id) || null;
const SERVICE_KEY = '__SUPABASE_SERVICE_KEY__';
const cpfFmt = ev.conferencia.cpf.replace(/(\\d{3})(\\d{3})(\\d{3})(\\d{2})/, '$1.$2.$3-$4');
let cacheRow = null;
try {
  const r = await this.helpers.httpRequest({ method: 'GET', json: true, timeout: 15000,
    url: 'https://udvkjlnvcttzrhscsecg.supabase.co/rest/v1/alunos_cache?select=status_sponte,data_atualizacao,proximo_boleto&cpf=eq.' + encodeURIComponent(cpfFmt),
    headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY } });
  cacheRow = Array.isArray(r) && r[0] ? r[0] : null;
} catch (e) { cacheRow = null; }
const v = validarCopia({ consulta, cacheRow, conferencia: ev.conferencia, agoraIso: new Date().toISOString() });
return [{ json: { ok: v.ok, motivo: v.motivo, conferencia: ev.conferencia } }];`,
    'montar-dashboard': `
const pedido = $('Autenticar e Rotear').first().json;
const linhas = $('Ler Log Consultas').all().map(i => i.json).filter(l => l && l.quando);
const ingestoes = $('Ler Log Ingestoes').all().map(i => i.json).filter(l => l && l.quando)
  .sort((a, b) => String(b.quando).localeCompare(String(a.quando)));
const agora = new Date();
const d = agregarDashboard(linhas, pedido.de, pedido.ate, agora);
const ler = (no) => { try { return $(no).all().map(i => i.json).filter(x => x && (x.quando || x.copiado_em)); } catch (e) { return []; } };
const cfg = (() => { try { return $('Ler Config').all().map(i => i.json).find(r => r && r.chave === 'kpis_padrao'); } catch (e) { return null; } })();
let padrao = null; try { padrao = cfg ? JSON.parse(cfg.valor) : null; } catch (e) { padrao = null; }
const permitidos = kpisPermitidos(pedido.usuario, padrao);
const kpis = filtrarKpis(agregarKpis({ consultas: linhas, eventos: ler('Ler Eventos'), resultados: ler('Ler Resultados'),
  aConferir: ler('Ler A Conferir'), de: pedido.de, ate: pedido.ate, agora }), permitidos);
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
const operacao = filtrarKpis({ erros_por_tela: d.errosPorTela, origem_respostas: { porOrigem: d.porOrigem, tempoMedioMs: d.tempoMedioMs } }, permitidos);
return [{ json: { status: 200, corpo: { ok: true, dashboard: pedido.usuario && pedido.usuario.papel === 'super_admin' ? d : undefined, kpis: permitidos, dados: Object.assign({}, kpis, operacao),
  saude: permitidos.includes('saude_sistema') ? saude : null, ultimaIngestao: permitidos.includes('saude_sistema') ? u : null,
  periodo: d.periodo, planilhaUrl: pedido.planilhaUrl, usuario: pedido.usuario } } }];`,
    'painel-api': fs.readFileSync(path.join(__dirname, 'painel_api_corpo.js'), 'utf8')
};

const no = process.argv[2];
if (!ADAPTADORES[no]) { console.error('No desconhecido: ' + no + '. Use: ' + Object.keys(ADAPTADORES).join(', ')); process.exit(1); }
process.stdout.write(ADAPTADORES[no].map(mod).join('\n\n') + '\n\n' + CORPOS[no].trim() + '\n');
