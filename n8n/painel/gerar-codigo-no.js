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
    'registrar-evento-front': ['valores.js', 'consulta_log.js'],
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
const consultaId = String($('Validar CPF').first().json.consulta_id || '');
const log = { quando, resultado: c.resultado, tela: c.tela, code: c.code, origem: c.origem,
  duracao_ms: inicio ? Date.now() - inicio : null, qtd_boletos: c.qtd_boletos, consulta_id: consultaId, valor_debito: c.valor_debito };
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
