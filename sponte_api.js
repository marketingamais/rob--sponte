const express = require('express');
const puppeteer = require('puppeteer');

const app = express();
const port = process.env.PORT || 3000;

app.get('/extrair-boleto', async (req, res) => {
    const { cid, login, senha } = req.query;
    if (!cid || !login || !senha) return res.status(400).json({ error: 'Faltam parametros' });

    let browser;
    try {
        browser = await puppeteer.launch({ 
            headless: true, // Obrigatório true na VPS/Render (Linux sem interface gráfica)
            defaultViewport: null,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-popup-blocking']
        });
        const page = await browser.newPage();
        
        await page.goto(`https://portal.sponteweb.com.br/SelecionaLogin.aspx?cid=${cid}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.type('#txtLogin', login);
        await page.type('#txtSenha', senha);
        
        await page.click('#btnOk');
        
        // Aguarda até 10s para a Sponte responder: pode ser redirecionamento ou o Modal de Troca de Senha (highslide)
        try {
            await page.waitForFunction(() => {
                return document.querySelector('.highslide-container') !== null || 
                       window.location.href.toLowerCase().includes('financeiro') || 
                       window.location.href.toLowerCase().includes('default') ||
                       (document.querySelector('#lblMsg') && document.querySelector('#lblMsg').innerText.length > 0);
            }, { timeout: 10000 });
        } catch (e) {
            // Timeout: ignoramos e prosseguimos
        }
        
        // Anti-travamento DEFINITIVO: O botão Ignorar fica dentro de um iframe!
        try {
            await new Promise(r => setTimeout(r, 2000)); // Aguarda o iframe carregar
            let modalFrame = page.frames().find(f => f.url().includes('RecuperarSenha.aspx'));
            if (modalFrame) {
                await modalFrame.evaluate(() => {
                    const btn = Array.from(document.querySelectorAll('a, button, input'))
                        .find(el => (el.innerText && el.innerText.toLowerCase().includes('ignorar')) || (el.value && el.value.toLowerCase().includes('ignorar')));
                    if (btn) btn.click();
                }).catch(() => {});
                await new Promise(r => setTimeout(r, 2000)); // Aguarda processar o clique
            }
        } catch(e) {}
        
        // Força a ida pro financeiro, não importa se abriu modal de senha ou não
        await page.goto('https://portal.sponteweb.com.br/Financeiro.aspx', { waitUntil: 'domcontentloaded', timeout: 60000 });
        
        // Espera a tabela carregar e clica na primeira linha
        await page.waitForSelector('#ctl00_ContentPlaceHolder1_grdFinanceiro tr.odd[onclick]', { timeout: 10000 }).catch(()=>{});
        
        // Clica na linha da tabela
        const selecionou = await page.evaluate(() => {
            const row = document.querySelector('#ctl00_ContentPlaceHolder1_grdFinanceiro tr.odd[onclick], #ctl00_ContentPlaceHolder1_grdFinanceiro tr.even[onclick]');
            if (row) {
                row.click();
                return true;
            }
            return false;
        });

        if (!selecionou) {
            await browser.close();
            return res.json({ error: 'Nenhuma parcela pendente encontrada.' });
        }
        
        // Espera o clique processar no Sponte
        await new Promise(r => setTimeout(r, 1000));

        // Clica em Imprimir
        await page.click('#ctl00_ContentPlaceHolder1_btnImprimirBoleto');

        // Loop para esperar a nova aba do Boleto.aspx carregar completamente
        let boletoPage = null;
        for (let i = 0; i < 20; i++) {
            await new Promise(r => setTimeout(r, 1000)); // Espera 1 seg
            const pagesAgora = await browser.pages();
            // Procura alguma aba que tenha Boleto.aspx na URL
            boletoPage = pagesAgora.find(p => p.url().toLowerCase().includes('boleto.aspx'));
            if (boletoPage) break;
        }

        if (!boletoPage) {
            await browser.close();
            return res.json({ error: 'Timeout: O Sponte não gerou a aba do Boleto.aspx a tempo.' });
        }

        // Aguarda carregar o boleto
        await boletoPage.waitForNetworkIdle({ timeout: 10000 }).catch(() => {});
        
        const url = boletoPage.url();
        const texto = await boletoPage.evaluate(() => document.body.innerText);
        
        // Expressão regular avançada para achar a linha digitável com pontos e espaços (inclusive non-breaking spaces)
        // Formato padrão: 00000.00000 00000.000000 00000.000000 0 00000000000000
        const regexLinha = /\d{5}\.?\d{5}\s*\d{5}\.?\d{6}\s*\d{5}\.?\d{6}\s*\d\s*\d{14}/;
        const match = texto.match(regexLinha);
        
        let linhaDigitavel = 'Linha digitável não encontrada no boleto.';
        if (match) {
            // Se encontrou, limpa os espaços e pontos para retornar só os 47 números limpos!
            linhaDigitavel = match[0].replace(/\D/g, '');
        }
        
        await browser.close();
        res.json({ linkBoleto: url, linhaDigitavel, extraidoComSucesso: !!match });

    } catch (e) {
        if (browser) await browser.close();
        res.status(500).json({ error: e.toString() });
    }
});

app.listen(port, () => {
    console.log(`🤖 Servidor RPA Sponte iniciado na porta ${port}!`);
});
