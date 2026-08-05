import { chromium } from 'playwright';
import fs from 'fs';

const SEARCH_URL =
  'https://venda-imoveis.caixa.gov.br/sistema/busca-imovel.asp?sltTipoBusca=imoveis';

// `cities: null` means every city listed for that state.
const TARGETS = [
  { state: 'TO', cities: null },
  { state: 'GO', cities: ['GOIANIA'] }
];

// Caixa mixes accented and unaccented spellings (e.g. "GOIÂNIA"), so compare
// on a diacritic-free uppercase form.
function normalize(text) {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
}

function slugify(text) {
  return normalize(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

async function selectState(page, state) {
  await page.goto(SEARCH_URL);
  console.log(`Selecting State: ${state}...`);
  await page.locator('#cmb_estado').selectOption(state);
  // The city list is loaded by AJAX and can take several seconds for states
  // with many cities, so wait for it to be populated rather than a fixed delay.
  await page.waitForFunction(
    () => {
      const select = document.querySelector('#cmb_cidade');
      return select !== null && select.options.length > 1;
    },
    null,
    { timeout: 30000 }
  );
}

async function scrapeCity(page, state, cityValue, cityName) {
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
    let pageNum = 1;

    // "#paginacao" lists every page as a link calling carregaListaImoveis(n),
    // with the current page wrapped in <b>. It is absent for single-page results.
    const totalPages = Math.max(
      1,
      await page.locator('#paginacao a').count()
    );
    console.log(`Total pages: ${totalPages}`);

    while (pageNum <= totalPages) {
      console.log(`Extracting data from page ${pageNum} of ${totalPages}...`);

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

      if (pageNum < totalPages) {
        const nextPage = pageNum + 1;
        console.log(`Moving to page ${nextPage}...`);
        await page.evaluate((n) => carregaListaImoveis(n), nextPage);
        // The list is replaced in place, so wait for the <b> marker to move.
        await page.waitForFunction(
          (n) =>
            document.querySelector('#paginacao b')?.innerText.trim() ===
            String(n),
          nextPage,
          { timeout: 30000 }
        );
      }
      pageNum++;
    }

    if (allResults.length > 0) {
      const date = new Date();
      const day = String(date.getDate()).padStart(2, '0');
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const year = date.getFullYear();
      const fileName = `${day}-${month}-${year}_${slugify(cityName)}_${state.toLowerCase()}.md`;

      let markdownContent = `# Property Results for ${cityName.toUpperCase()}/${state} - ${day}/${month}/${year}\n\n`;
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
      await selectState(page, state);
    }

  } catch (error) {
    console.error(`Error during scraping for ${cityName}:`, error);
    await selectState(page, state);
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

    for (const { state, cities } of TARGETS) {
      await selectState(page, state);

      const cityOptions = await page.locator('#cmb_cidade option').evaluateAll(options =>
        options
          .map(opt => ({ value: opt.value, text: opt.innerText.trim() }))
          // The first option is the "Selecione" placeholder with an empty value.
          .filter(opt => opt.value && opt.text)
      );

      const wanted = cities?.map(normalize);
      const targetCities = wanted
        ? cityOptions.filter(opt => wanted.includes(normalize(opt.text)))
        : cityOptions;

      if (wanted) {
        const missing = wanted.filter(
          name => !cityOptions.some(opt => normalize(opt.text) === name)
        );
        missing.forEach(name =>
          console.log(`City not found in ${state}: ${name}`)
        );
      }

      console.log(`\n=== ${state}: ${targetCities.length} cities to scrape ===`);

      for (const city of targetCities) {
        await scrapeCity(page, state, city.value, city.text);
      }
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
