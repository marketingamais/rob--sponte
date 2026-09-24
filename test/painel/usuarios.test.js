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
