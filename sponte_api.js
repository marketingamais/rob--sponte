const express = require('express');
const puppeteer = require('puppeteer');

const app = express();
const port = process.env.PORT || 3000;

app.get('/extrair-boleto', async (req, res) => {
    const { cid, login, senha } = req.query;
    if (!cid || !login || !senha) {
        return res.status(200).json({ status: 'erro', message: 'Este aluno não possui senha cadastrada no Portal da Sponte para que possamos consultar os boletos.' });
    }

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
        
        // Força a ida pro financeiro apenas se ainda não estiver indo
        try {
            if (!page.url().toLowerCase().includes('financeiro')) {
                await page.goto('https://portal.sponteweb.com.br/Financeiro.aspx', { waitUntil: 'domcontentloaded', timeout: 60000 });
            }
        } catch (e) {
            // Se der net::ERR_ABORTED, significa que o clique no "Ignorar" já disparou a navegação!
        }
        
        // Aguarda ter certeza que chegou na tela do financeiro
        try {
            await page.waitForFunction(() => window.location.href.toLowerCase().includes('financeiro'), { timeout: 15000 });
        } catch(e) {}
        
        // Espera a tabela carregar ou não (se não tiver parcelas)
        const temTabela = await page.waitForSelector('#ctl00_ContentPlaceHolder1_grdFinanceiro tr.odd', { timeout: 20000 })
            .then(() => true).catch(() => false);
        
        if (!temTabela) {
            await browser.close();
            return res.json({ status: 'em_dia', message: 'Nenhuma parcela pendente encontrada.' });
        }
        
        // Extrai todas as parcelas da tabela
        const parcelas = await page.evaluate(() => {
            const rows = Array.from(document.querySelectorAll('#ctl00_ContentPlaceHolder1_grdFinanceiro tr.odd, #ctl00_ContentPlaceHolder1_grdFinanceiro tr.even'));
            return rows.map((row, index) => {
                const img = row.querySelector('img[id*="imgSituacao"]');
                const title = img ? img.getAttribute('title') : '';
                const numParcela = row.querySelector('td:nth-child(1)') ? row.querySelector('td:nth-child(1)').innerText.trim() : '';
                const dataVencimento = row.querySelector('td:nth-child(2)') ? row.querySelector('td:nth-child(2)').innerText.trim() : '';
                const valor = row.querySelector('td:nth-child(3)') ? row.querySelector('td:nth-child(3)').innerText.trim() : '';
                
                let diasAtraso = 0;
                let isVencida = false;
                if (title && title.toLowerCase().includes('vencida a')) {
                    isVencida = true;
                    const match = title.match(/\d+/);
                    if (match) diasAtraso = parseInt(match[0], 10);
                }
                
                return { index, numParcela, dataVencimento, valor, title, isVencida, diasAtraso };
            });
        });

        if (parcelas.length === 0) {
            await browser.close();
            return res.json({ status: 'em_dia', message: 'Nenhuma parcela pendente encontrada.' });
        }

        const atrasadas = parcelas.filter(p => p.isVencida);
        const maxAtraso = atrasadas.length > 0 ? Math.max(...atrasadas.map(p => p.diasAtraso)) : 0;

        // Regra 1: Mais de 5 dias de atraso (Negociar)
        if (maxAtraso > 5) {
            await browser.close();
            return res.json({ status: 'negociar', maxAtraso, parcelasAtrasadas: atrasadas.length });
        }

        // Função auxiliar para extrair linha digitável de um índice específico da tabela
        const extrairLinhaDigitavel = async (rowIndex) => {
            await page.evaluate((idx) => {
                const rows = Array.from(document.querySelectorAll('#ctl00_ContentPlaceHolder1_grdFinanceiro tr.odd, #ctl00_ContentPlaceHolder1_grdFinanceiro tr.even'));
                if (rows[idx]) rows[idx].click();
            }, rowIndex);
            
            await new Promise(r => setTimeout(r, 1000));
            await page.click('#ctl00_ContentPlaceHolder1_btnImprimirBoleto');
            
            let boletoPage = null;
            for (let i = 0; i < 20; i++) {
                await new Promise(r => setTimeout(r, 1000));
                const pagesAgora = await browser.pages();
                boletoPage = pagesAgora.find(p => p.url().toLowerCase().includes('boleto.aspx'));
                if (boletoPage) break;
            }
            
            if (!boletoPage) return null;
            
            await boletoPage.waitForNetworkIdle({ timeout: 10000 }).catch(() => {});
            const texto = await boletoPage.evaluate(() => document.body.innerText);
            
            const regexLinha = /\d{5}\.?\d{5}\s*\d{5}\.?\d{6}\s*\d{5}\.?\d{6}\s*\d\s*\d{14}/;
            const match = texto.match(regexLinha);
            let linha = null;
            if (match) {
                linha = match[0].replace(/\D/g, '');
            }
            
            await boletoPage.close(); // Fecha a aba do boleto
            await new Promise(r => setTimeout(r, 500)); // Pequena pausa
            return linha;
        };

        // Regra 2: Atraso de 1 a 5 dias (Pagar atrasados)
        if (atrasadas.length > 0) {
            let resultados = [];
            for (let p of atrasadas) {
                const linha = await extrairLinhaDigitavel(p.index);
                resultados.push({ ...p, linhaDigitavel: linha });
            }
            await browser.close();
            return res.json({ status: 'pagar_atrasados', parcelas: resultados });
        }

        // Regra 3: Nenhuma atrasada (Em dia)
        // Extrai a primeira parcela (próxima a vencer)
        const proxima = parcelas[0];
        const linhaProxima = await extrairLinhaDigitavel(proxima.index);
        await browser.close();
        return res.json({ status: 'em_dia', proximoBoleto: { ...proxima, linhaDigitavel: linhaProxima } });

    } catch (e) {
        if (browser) await browser.close();
        res.status(500).json({ error: e.toString() });
    }
});

app.listen(port, () => {
    console.log(`🤖 Servidor RPA Sponte iniciado na porta ${port}!`);
});
