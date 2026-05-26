# Specification: Playwright Scraper for Caixa Imóveis

## Objective
Automate the extraction of property listing data from the Caixa Econômica Federal website for multiple cities (e.g., Palmas and Gurupi) in Tocantins (TO).

## Target URL
`https://venda-imoveis.caixa.gov.br/sistema/busca-imovel.asp?sltTipoBusca=imoveis`

## Navigation Flow

### Step 1: Initial Setup
1.  **Navigate** to the Target URL.
2.  **Select State**: Locate `#cmb_estado` and select **"TO"**.
3.  **Identify Cities**: Scan the `#cmb_cidade` dropdown for target cities (**PALMAS**, **GURUPI**).

### Step 2: City Loop (For each target city)
1.  **Select City**: Select the city from the `#cmb_cidade` dropdown.
2.  **Submit Criteria**: Click the "Próximo" button using `getByRole('button', { name: ' Próximo' })`.
3.  **Skip Filters**: On the "Dados do imóvel" page, click the "Próximo" button again.
4.  **Client Data**: 
    *   Locate `#chkAutoriza` and **uncheck** it (if present).
    *   Click the "Próximo" button.

### Step 3: Results Extraction & Pagination
1.  **Wait for Results**: The final results page loads with property listings.
2.  **Extraction**: Get all link texts matching `a` elements containing `"| R$"` (these are the property title links, e.g., `PALMAS - LOT SOL NASCENTE | R$ 119.000,00`).
3.  **Pagination**: 
    *   Check for navigation links (e.g., "2", "3") in `span.navegacao`.
    *   If a next page exists, click the number and repeat extraction.
4.  **Reset**: After all pages are processed for the current city, click the **" Alterar"** link (Step 1 reset, e.g., `#altera_0 a`) to return to the city selection step.

## Output Requirements
- **Format**: Markdown table (single column).
- **Filename**: `{city}_{day}-{month}-{year}.md`.
- **Column**:
    *   **Property Title**: Link text from the results page (e.g., `PALMAS - LOT SOL NASCENTE | R$ 119.000,00`).


## Implementation Details

### Selectors
- **State Select**: `#cmb_estado`
- **City Select**: `#cmb_cidade`
- **Next Button**: `getByRole('button', { name: ' Próximo' })`
- **Authorization Checkbox**: `#chkAutoriza`
- **Alter/Reset Link**: `getByRole('link', { name: ' Alterar' })`
- **Pagination Links**: `span.navegacao a`

## Considerations
*   **Sequential Fetching**: If multiple cities are targetted, the script must complete one city (including all pages) before resetting via "Alterar".
*   **Logging**: If a target city (like Palmas) is missing from the dropdown, log "does not exists palmas" and continue to the next target.
*   **Data Integrity**: Handle special characters (like pipes `|`) in property text to ensure the Markdown table renders correctly.
