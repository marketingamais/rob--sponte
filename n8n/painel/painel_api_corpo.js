// Corpo do no "Autenticar e Rotear" (workflow [CIA] Painel Admin [PROD]). Funcoes de usuarios.js ja estao em escopo.
const SUPA = 'https://udvkjlnvcttzrhscsecg.supabase.co';
const SERVICE_KEY = '__SUPABASE_SERVICE_KEY__';
const PLANILHA_URL = '__PLANILHA_URL__';
const req = $('Webhook API').first().json;
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
  return [{ json: { precisaDashboard: true, de, ate, desdeIso, usuario: { email: eu.email, nome: eu.nome, papel: eu.papel, kpis: eu.kpis }, planilhaUrl: PLANILHA_URL } }];
}

if (acao === 'eu') return resp(200, { ok: true, usuario, planilhaUrl: PLANILHA_URL, catalogo: KPIS });

if (acao === 'kpis_padrao_ler' || acao === 'kpis_padrao_salvar') {
  if (eu.papel !== 'super_admin') return resp(403, { ok: false, erro: 'Apenas o super administrador pode alterar o padrão de KPIs.' });
  if (acao === 'kpis_padrao_ler') {
    let padrao = PADRAO_INICIAL;
    try { const c = $('Ler Config').all().map(i => i.json).find(r => r && r.chave === 'kpis_padrao'); if (c) padrao = JSON.parse(c.valor); } catch (e) {}
    return resp(200, { ok: true, padrao: kpisPermitidos({ papel: 'membro' }, padrao), catalogo: KPIS });
  }
  if (!validarListaKpis(body.padrao)) return resp(400, { ok: false, erro: 'Lista de KPIs inválida.' });
  return [{ json: { salvarConfig: { chave: 'kpis_padrao', valor: JSON.stringify(body.padrao) }, status: 200, corpo: { ok: true } } }];
}

if (acao === 'trocar_senha') {
  const v = validarNovaSenha(body.senha_nova);
  if (!v.ok) return resp(400, { ok: false, erro: v.erro });
  await http({ method: 'PUT', url: SUPA + '/auth/v1/user', headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + token }, body: { password: body.senha_nova } });
  return resp(200, { ok: true });
}

if (!acao.startsWith('usuarios_')) return resp(400, { ok: false, erro: 'Ação inválida.' });
if (eu.papel !== 'super_admin') return resp(403, { ok: false, erro: 'Apenas o super administrador pode gerenciar usuários.' });

const usuarios = await listarUsuarios();
if (acao === 'usuarios_listar') return resp(200, { ok: true, usuarios: usuarios.map(u => ({ email: u.email, nome: u.nome, papel: u.papel, ativo: u.ativo, kpis: u.kpis })) });

const TIPO = { usuarios_criar: 'criar', usuarios_atualizar: 'atualizar', usuarios_remover: 'remover', usuarios_redefinir_senha: 'redefinir_senha' }[acao];
if (!TIPO) return resp(400, { ok: false, erro: 'Ação inválida.' });
const pedido = Object.assign({}, body, { tipo: TIPO, email: String(body.email || '').trim().toLowerCase() });
const v = validarAlteracaoUsuario(usuarios, eu.email, pedido);
if (!v.ok) return resp(400, { ok: false, erro: v.erro });
const alvo = usuarios.find(u => u.email === pedido.email);

if (TIPO === 'criar') {
  const meta = { painel: true, papel: pedido.papel, nome: String(pedido.nome).trim(), ativo: true };
  if (Array.isArray(pedido.kpis)) meta.kpis = pedido.kpis;
  try {
    await http({ method: 'POST', url: SUPA + '/auth/v1/admin/users', headers: admin,
      body: { email: pedido.email, password: pedido.senha, email_confirm: true, app_metadata: meta } });
  } catch (e) {
    return resp(400, { ok: false, erro: 'Já existe uma conta de login com esse e-mail. Use outro e-mail.' });
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
meta.kpis = pedido.kpis === null ? null : (pedido.kpis !== undefined ? pedido.kpis : (alvo.kpis || undefined));
const corpo = { app_metadata: meta };
if (pedido.ativo !== undefined) corpo.ban_duration = meta.ativo ? 'none' : '876000h';
await http({ method: 'PUT', url: SUPA + '/auth/v1/admin/users/' + alvo.id, headers: admin, body: corpo });
return resp(200, { ok: true });
