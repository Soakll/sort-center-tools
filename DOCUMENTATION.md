# Technical & Operational Documentation: TL All-in-One Suite 📘

[Português](#português-🇧🇷) | [English](#english-🇺🇸)

---

## Português 🇧🇷

Este documento detalha exaustivamente o funcionamento, a arquitetura e a lógica por trás da **TL All-in-One Suite**.

### 1. Arquitetura do Sistema
O script funciona como um contêiner monolítico que gerencia múltiplos módulos independentes. A espinha dorsal é o objeto global `_SUITE`.

#### 🌐 Objeto Global `_SUITE`
-   **`_SUITE.LANG`**: Dicionário centralizado contendo todas as strings para Português (PT) e Inglês (EN).
-   **`_SUITE.L(key)`**: Função auxiliar que retorna a string traduzida baseada na configuração de idioma (salva em `rd_lang`).
-   **`_SUITE.utils`**: Conjunto de ferramentas para detecção automática de Node (ex: CGH7), escape de Strings, e captura de tokens de segurança.

#### 🛡️ Segurança e Tokens Anti-CSRF
O script realiza requisições para APIs internas da Amazon. Para isso, ele utiliza a função `_SUITE.utils.fetchAntiCsrfToken`, que:
1.  Busca um token válido na página atual ou em subpáginas.
2.  Armazena o token temporariamente para evitar buscas excessivas.
3.  Inclui o header `anti-csrftoken-a2z` em todas as chamadas `GM_xmlhttpRequest`.

---

### 2. Módulos Detalhados

#### 📈 TPH Chart (V5) - Dashboard de Throughput
Este é o módulo mais complexo, focado em visualização de dados via **Chart.js**.

**A. Lógica de Cálculo de Necessidade (Need Calculation):**
A "Necessidade Atual" é recalculada em tempo real para garantir que o volume planejado seja processado até o fim do turno.
-   **Fórmula:** `Nec_Atual = Volume_Restante / Blocos_Restantes_de_5min`
-   **Volume Restante:** `Volume_Total - Scans_já_realizados`.
-   **Blocos Restantes:** Contagem de períodos de 5 minutos desde o momento atual até o horário de fim do turno, **excluindo** os períodos marcados como Almoço/Janta ou Pausa.

**B. Sistema de Cache:**
Para garantir performance e reduzir carga nos servidores:
-   Períodos passados e finalizados são salvos no `GM_setValue` com uma chave única (`tph_v2_NODE_INICIO_FIM`).
-   O cache tem um TTL (Time-To-Live) de 24 horas.
-   Períodos recentes (últimos 15 minutos) nunca são cacheados para permitir correção de dados em tempo real.

---

#### 👥 Dynamic Container Builder Ranking
Módulo focado em performance de associados.

-   **Captura de Dados:** Utiliza o endpoint `PRODUCTIVITY_REPORT` com granularidade de pacote.
-   **Ranking:** Ordena associados pelo número total de scans `successfulScans`.
-   **PPH (Packages Per Hour):** Calculado com base no tempo decorrido vs pacotes processados.
-   **Auto-Scroll Inteligente:**
    -   Inicia após 5 segundos de inatividade.
    -   Velocidade ajustável pelo usuário no painel.
    -   Pausa instantânea ao detectar `mousemove` nas linhas da tabela.

---

#### 🔍 VRID Info & CPT Analytics
Este módulo atua como uma camada de inteligência sobre as páginas de Site Status, YMS e Relay Tracking.

-   **Captura de Dados Multi-Sistema:** O script intercepta IDs de VRID na página e realiza consultas paralelas aos endpoints `getContainerIds` e `getContainersDetail` da API Vista.
-   **Cálculo de Volumetria (CuFt):** Diferente dos sistemas padrão que focam em scans, este módulo converte as dimensões de todos os pallets bipados de `cm³` para `ft³` (CuFt). Isso permite que a liderança visualize a ocupação real do trailer antes mesmo do fechamento.
-   **Abas de Análise no Popup:**
    -   **Total:** Mostra o volume planejado vs carregado.
    -   **Restante:** Filtra apenas os pacotes/pallets que ainda precisam ser processados para aquele VRID específico.
    -   **X-Dock:** Identifica pacotes que não pertencem à rota direta, facilitando a triagem de transbordo.
    -   **CPT Priority:** Ordena toda a carga pendente por horário de saída (CPT), destacando o que é crítico.
-   **Exportação de Dados:** Utiliza a biblioteca `SheetJS (XLSX)` injetada para permitir que o usuário baixe um relatório detalhado em Excel com um único clique.

---

### 3. Design System: Glassmorphism
A interface foi projetada para ser visualmente premium e funcional.
-   **Fundo:** `rgba(10, 22, 40, 0.85)` com `backdrop-filter: blur(16px)`.
-   **Cores de Status:**
    -   **Real:** `#a89dff` (Roxo suave).
    -   **Necessário:** `#39ff14` (Verde Neon).
    -   **Meta (Raise the bar):** `#ff2a5f` (Rosa/Vermelho).
-   **Tipografia:** Utiliza `DM Sans` e `Syne` via Google Fonts para uma leitura moderna e clara.

---

### 4. Guia de Configuração (LocalStorage)
Valores importantes armazenados no `GM_setValue`:
| Chave | Descrição | Valor Padrão |
| :--- | :--- | :--- |
| `tl_node` | Node ID detectado ou manual | Detectado via URL |
| `rd_lang` | Idioma da interface | `pt` |
| `tl_v5_chart_goal` | Meta da linha Raise the Bar | `800` |
| `tl_v5_vol_total` | Volume planejado para o turno | `60000` |

---

## English 🇺🇸

This document provides an exhaustive dive into the **TL All-in-One Suite** architecture and operational logic.

### 1. Core Architecture
The script operates as a monolithic container managing multiple independent modules via the global `_SUITE` engine.

#### 🌐 `_SUITE` Global Logic
-   **`_SUITE.LANG`**: Centralized dictionary for all UI strings.
-   **`_SUITE.L(key)`**: Localization helper fetching strings based on `rd_lang` setting.
-   **`_SUITE.utils`**: Tools for automated Node detection (e.g., CGH7), string escaping, and security token retrieval.

#### 🛡️ Security & Anti-CSRF
The script communicates with internal Amazon APIs using `GM_xmlhttpRequest`.
-   **Token Retrieval:** Uses `fetchAntiCsrfToken` to scan the DOM for the `anti-csrftoken-a2z` required by Vista and SSP controllers.
-   **Persistence:** Tokens are cached in-memory and refreshed upon expiration (401/403 errors).

---

### 2. Module Deep Dive

#### 📈 TPH Chart (V5) - Throughput Dashboard
Data visualization powered by **Chart.js** with real-time analytics.

**A. Dynamic Need Algorithm:**
The "Current Need" is recalculated every refresh to adapt to throughput fluctuations.
-   **Formula:** `Current_Need = Remaining_Volume / Remaining_5min_Blocks`
-   **Remaining Volume:** `Total_Volume_Goal - Cumulative_Scans`.
-   **Remaining Blocks:** A count of 5-minute intervals from *now* until the *shift end*, **excluding** periods defined as Lunch/Dinner or Breaks.

**B. Caching Layer:**
-   Completed time blocks are stored in `GM_setValue` using unique keys: `tph_v2_NODE_START_END`.
-   TTL is set to 24 hours.
-   Data from the last 15 minutes is always fetched fresh to ensure real-time accuracy.

---

#### 👥 Dynamic Container Builder Ranking
-   **Data Aggregation:** Pulls from `PRODUCTIVITY_REPORT`.
-   **Ranking Engine:** Sorts users by `successfulScans` descending.
-   **Visual Tiers:**
    -   **Top Tier (Green):** >90% of PPH goal.
    -   **Good Tier (Yellow):** >75% of PPH goal.
    -   **Warning (Red):** >40% of PPH goal.
-   **Smart Auto-Scroll:** Loops through the table only if no mouse activity is detected for 5 seconds.

---

#### 🔍 VRID Info & CPT Analytics
An intelligence layer that enhances Site Status, YMS, and Relay Tracking pages by providing deep visibility into cargo details.

-   **Multi-System Data Injection:** Intercepts VRID IDs on the page and performs parallel queries to Vista API endpoints (`getContainerIds` and `getContainersDetail`).
-   **Volumetric Calculation (CuFt):** Unlike standard systems that focus solely on scan counts, this module converts pallet dimensions from `cm³` to `ft³` (CuFt). This allows leadership to monitor real-time trailer occupancy and plan for consolidations.
-   **Advanced Analysis Tabs:**
    -   **Total:** Overview of total planned vs. loaded volume.
    -   **Remaining:** Dynamically filters packages/pallets that are yet to be processed for the specific VRID.
    -   **X-Dock:** Specifically identifies Cross-Dock/Transshipment packages not belonging to the direct route.
    -   **CPT Priority:** Sorts all pending cargo by critical departure times (CPT), highlighting missed or urgent shipments.
-   **Data Exporting:** Uses the integrated `SheetJS (XLSX)` library to generate and download comprehensive Excel reports directly from the browser UI.

---

### 3. UI Design System
Built on "Glassmorphism" principles for a premium dashboard feel.
-   **Tokens:**
    -   **Glass Background:** `rgba(10, 22, 40, 0.85)` + `blur(16px)`.
    -   **Primary (Real):** `#a89dff`.
    -   **Need Line:** `#39ff14`.
    -   **Meta Line:** `#ff2a5f`.
-   **Fonts:** `DM Sans` (Clean) and `Syne` (Accents/Titles) imported via Google Fonts.

---

### 4. Persistence Settings (Tampermonkey Storage)
| Key | Description | Default |
| :--- | :--- | :--- |
| `tl_node` | Active node | Auto-detected |
| `rd_lang` | UI Language | `en` |
| `tl_v5_chart_goal` | Target for Raise the Bar line | `800` |
| `tl_v5_vol_total` | Planned volume for shift | `60000` |

---
*Developed with ❤️ for the Amazon Sort Center Community.*
