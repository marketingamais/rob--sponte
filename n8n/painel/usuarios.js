// Regras de usuarios do painel. Usuario do painel = usuario do Supabase Auth com app_metadata.painel === true.
const { validarListaKpis } = require('./kpis.js'); // @no-n8n

const PAPEIS = ['super_admin', 'membro'];

function usuarioDoAuth(u) {
    if (!u || !u.app_metadata || u.app_metadata.painel !== true) return null;
    const m = u.app_metadata;
    return { id: u.id, email: String(u.email || '').toLowerCase(), nome: m.nome || '', papel: m.papel, ativo: m.ativo === true, kpis: Array.isArray(m.kpis) ? m.kpis : null };
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
    if (p.kpis !== undefined && !validarListaKpis(p.kpis)) return falha('Lista de KPIs inválida.');

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
    if (p.tipo === 'atualizar' && p.ativo !== undefined && typeof p.ativo !== 'boolean') return falha('Status inválido.');
    if (ehVoceMesmo && (p.tipo === 'remover' || rebaixa || desativa)) return falha('Você não pode remover, rebaixar ou desativar você mesmo.');

    const tiraSuper = alvo.papel === 'super_admin' && alvo.ativo && (p.tipo === 'remover' || rebaixa || desativa);
    const superAtivos = lista.filter(u => u.papel === 'super_admin' && u.ativo).length;
    if (tiraSuper && superAtivos <= 1) return falha('Precisa sobrar pelo menos um super administrador ativo.');
    return { ok: true };
}

module.exports = { usuarioDoAuth, validarAlteracaoUsuario, validarNovaSenha };
