import { chromium } from 'playwright';
import fs from 'fs';

async function scrapeCity(page, cityValue, cityName) {
  console.log(`\n--- Starting Scrape for ${cityName} ---`);

  try {
    // Step 1: Select City
    console.log(`Selecting City: ${cityName} (${cityValue})...`);
    await page.locator('#cmb_cidade').selectOption(cityValue);

    console.log('Clicking Próximo (Search Criteria)...');
    await page.getByRole('button', { name: ' Próximo' }).click();

    // Step 2: Property Filters (Dados do imóvel)
    console.log('Clicking Próximo (Property Filters)...');
    await page.getByRole('button', { name: ' Próximo' }).click();

    // Step 3: Client Data (Dados do cliente)
    console.log('Unchecking Authorization and Clicking Próximo (Client Data)...');
    if (await page.locator('#chkAutoriza').count() > 0) {
      await page.locator('#chkAutoriza').uncheck();
    }
    await page.getByRole('button', { name: ' Próximo' }).click();

    // Step 4: Results Extraction with Pagination
    console.log('Waiting for results page...');
    await page.waitForTimeout(2000);

    let allResults = [];
    let hasNextPage = true;
    let pageNum = 1;

    while (hasNextPage) {
      console.log(`Extracting data from page ${pageNum}...`);

      // Caixa renders two card layouts inside ".dadosimovel-col2":
      //  1. Standard auction: the title anchor already includes "| R$ <price>".
      //  2. "Venda Direta Online": the title anchor has no price; the value is
      //     in a separate span as "Valor mínimo de venda: R$ <price>".
      // Normalize both into the clean "TITLE | R$ PRICE" format.
      let titles = await page.locator('.dadosimovel-col2').evaluateAll((nodes) =>
        nodes
          .map((node) => {
            const link = node.querySelector('a');
            const title = link
              ? link.innerText.trim().replace(/\s+/g, ' ')
              : '';
            if (!title) return '';
            if (/\|\s*R\$/.test(title)) return title;
            const text = node.innerText;
            const avaliacao = text.match(
              /Valor de avalia[çc][aã]o:\s*(R\$\s?[\d.,]+)/i
            );
            const minimo = text.match(
              /Valor m[ií]nimo de venda:\s*(R\$\s?[\d.,]+)/i
            );
            const parts = [avaliacao?.[1], minimo?.[1]].filter(Boolean);
            return parts.length > 0
              ? `${title} | ${parts.join(', ')}`
              : title;
          })
          .filter((text) => text.length > 0)
      );

      // Fallback to the legacy anchor-based layout when no cards are present.
      if (titles.length === 0) {
        titles = await page
          .locator('a')
          .filter({ hasText: '| R$' })
          .allInnerTexts();
      }

      console.log(`Found ${titles.length} properties on page ${pageNum}`);

      titles.forEach((title) => {
        allResults.push(title.trim());
      });

      const nextLink = page.locator(`span.navegacao a:text("${pageNum + 1}")`);
      if (await nextLink.count() > 0) {
        console.log(`Moving to page ${pageNum + 1}...`);
        await nextLink.first().click();
        await page.waitForTimeout(2000);
        pageNum++;
      } else {
        hasNextPage = false;
      }
    }

    if (allResults.length > 0) {
      const date = new Date();
      const day = String(date.getDate()).padStart(2, '0');
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const year = date.getFullYear();
      const fileName = `${cityName.toLowerCase()}_${day}-${month}-${year}.md`;

      let markdownContent = `# Property Results for ${cityName.toUpperCase()} - ${day}/${month}/${year}\n\n`;
      markdownContent += `Total properties found: ${allResults.length}\n\n`;
      markdownContent += `| Property Title |\n`;
      markdownContent += `| :--- |\n`;

      allResults.forEach((title) => {
        markdownContent += `| ${title.replace(/[\n\r]+/g, ' ').replace(/\|/g, '\\|')} |\n`;
      });

      fs.writeFileSync(fileName, markdownContent);
      console.log(`Successfully generated ${fileName} with ${allResults.length} properties.`);
    } else {
      console.log(`No properties found for ${cityName}.`);
    }

    // Prepare for next city by clicking 'Alterar'
    const resetLink = page.locator('#altera_0 a');
    if (await resetLink.count() > 0) {
      console.log("Clicking 'Alterar' (Step 1) to reset for next city...");
      await resetLink.click();
      await page.waitForTimeout(1000);
    } else if (await page.getByRole('link', { name: ' Alterar' }).count() > 0) {
      console.log("Clicking 'Alterar' (General) to reset for next city...");
      await page.getByRole('link', { name: ' Alterar' }).first().click();
      await page.waitForTimeout(1000);
    } else {
      console.log("'Alterar' link not found. Navigating back to start.");
      await page.goto('https://venda-imoveis.caixa.gov.br/sistema/busca-imovel.asp?sltTipoBusca=imoveis');
      await page.locator('#cmb_estado').selectOption('TO');
      await page.waitForTimeout(1000);
    }

  } catch (error) {
    console.error(`Error during scraping for ${cityName}:`, error);
    await page.goto('https://venda-imoveis.caixa.gov.br/sistema/busca-imovel.asp?sltTipoBusca=imoveis');
    await page.locator('#cmb_estado').selectOption('TO');
    await page.waitForTimeout(1000);
  }
}

async function run() {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: false
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log('Navigating to Caixa Imóveis...');
    await page.goto('https://venda-imoveis.caixa.gov.br/sistema/busca-imovel.asp?sltTipoBusca=imoveis');

    console.log('Selecting State: TO...');
    await page.locator('#cmb_estado').selectOption('TO');
    await page.waitForTimeout(1000);

    const cityOptions = await page.locator('#cmb_cidade option').evaluateAll(options =>
      options.map(opt => ({ value: opt.value, text: opt.innerText.trim() }))
    );

    const targetCities = cityOptions.filter(opt =>
        opt.text.toUpperCase() === 'PALMAS' ||
        opt.text.toUpperCase() === 'GURUPI'
    );

    if (targetCities.length === 0) {
      console.log("Neither PALMAS nor GURUPI found in the list.");
      // Fallback: log if Palmas specifically is missing
      if (!cityOptions.some(opt => opt.text.toUpperCase() === 'PALMAS')) {
        console.log('does not exists palmas');
      }
    }

    for (const city of targetCities) {
      await scrapeCity(page, city.value, city.text);
    }

  } catch (error) {
    console.error('Main loop error:', error);
  } finally {
    console.log("\nFinished all tasks.");
    await page.waitForTimeout(3000);
    await browser.close();
  }
}

run().catch(console.error);
