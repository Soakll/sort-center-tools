# Technical & Operational Documentation: TL All-in-One Suite 📘

[Português](#português-🇧🇷) | [English](#english-🇺🇸)

---

## Português 🇧🇷

Este documento detalha exaustivamente o funcionamento, a arquitetura e a lógica técnica por trás da **TL All-in-One Suite**.

### 1. Arquitetura do Sistema
O script funciona como um contêiner monolítico que gerencia múltiplos módulos independentes de forma coordenada. A espinha dorsal é o objeto global `_SUITE`.

#### 🌐 Objeto Global `_SUITE`
-   **`_SUITE.LANG`**: Dicionário centralizado contendo todas as strings para Português (PT) e Inglês (EN).
-   **`_SUITE.L(key)`**: Função auxiliar que retorna a string traduzida baseada na configuração de idioma (salva em `rd_lang`).
-   **`_SUITE.utils`**: Conjunto de ferramentas para detecção automática de Node (ex: CGH7), escape de Strings, e captura de tokens de segurança.

---

### 2. Detalhamento dos Módulos

#### 📈 TPH Chart - Dashboard de Throughput
Focado em visualização de dados de produção em tempo real via **Chart.js**.

-   **Lógica de Cálculo de Necessidade (Need Algorithm):**
    A "Necessidade Atual" é recalculada dinamicamente a cada atualização para garantir que o volume planejado seja processado até o fim do turno.
    -   **Fórmula:** `Nec_Atual = Volume_Restante / Blocos_Restantes_de_5min`
    -   **Volume Restante:** `Volume_Total_Definido - Scans_já_realizados_no_período`.
    -   **Blocos Restantes:** Contagem de períodos de 5 minutos desde o momento atual até o horário de fim do turno, **excluindo** os blocos que coincidem com horários de Almoço/Janta ou Pausas configuradas.
-   **Sistema de Cache:**
    -   Dados de períodos passados e finalizados são salvos no `GM_setValue` com uma chave única (`tph_v2_NODE_INICIO_FIM`).
    -   O cache possui TTL (Time-To-Live) de 24 horas para garantir que dados de turnos anteriores não interfiram no atual.
    -   Períodos recentes (últimos 15 minutos) nunca são cacheados para permitir a correção de dados instáveis durante o processamento.

---

#### 👥 Dynamic Container Builder Ranking (Produtividade)
Monitoramento de performance individual de associados.

-   **Processamento de Dados:** Agrega múltiplos scans bem-sucedidos (`successfulScans`) por associado através do endpoint `PRODUCTIVITY_REPORT`.
-   **Cálculo de PPH (Packages Per Hour):** Estimativa baseada no volume bipado dividido pelo tempo de atividade detectado no sistema.
-   **Tiers de Performance (Cores):**
    -   **Verde:** >90% da meta definida (`tl_goal_pph`).
    -   **Amarelo:** >75% da meta.
    -   **Vermelho:** <40% da meta (alerta de baixa produtividade).
-   **Auto-Scroll Inteligente:** Monitora a inatividade do mouse por 5 segundos antes de iniciar a rolagem automática da lista, pausando imediatamente ao detectar movimento (`mousemove`) para permitir a análise de um associado específico.

---

#### 🚛 Mapa VSM & Dock View
Visualização física e lógica das operações de pátio e doca.

-   **Matriz de Layout:** O mapa utiliza uma matriz de coordenadas (`DEFAULT_MAP_MATRIX`) que mapeia VSMs (Virtual Sorting Machines) para posições gráficas em um grid estilo glassmorphism.
-   **Mapeamento VSM-Rota:** Utiliza o dicionário `DEFAULT_VSM_SEGMENT_MAP` para vincular automaticamente rotas de transporte a seus respectivos VSMs.
-   **Integração YMS/Vista:**
    -   Busca status de ocupação de trailers em tempo real.
    -   Visualiza densidade de pacotes por doca através de gradientes de cor.
    -   Permite a personalização do layout (posição das docas) via interface de configuração dedicada.

---

#### 🔍 VRID Info & CPT Analytics
Inteligência profunda sobre cargas e viagens.

-   **Intercepção de VRID:** Identifica IDs de viagem em qualquer página compatível (Site Status, YMS, RTT) e injeta botões de consulta rápida.
-   **Cálculo de Volumetria (CuFt):** Converte dimensões brutas capturadas da API em volume cúbico real (`ft³`), permitindo prever o preenchimento físico do trailer antes que ele feche.
-   **Análise de Fluxo:**
    -   **Total/Restante:** Identifica o gap entre o planejamento e a execução.
    -   **X-Dock:** Separa pacotes de transbordo da carga direta para facilitar o planejamento de área.
    -   **CPT Priority:** Ordena toda a carga pendente por criticidade de tempo, alertando sobre volumes que estão perdendo o horário de saída.

---

### 3. Design System & UI
-   **Design:** Baseado em "Glassmorphism" (transparência e desfoque de fundo).
-   **Tokens de Cores:**
    -   **Real:** `#a89dff` (Roxo).
    -   **Necessário:** `#39ff14` (Verde Neon).
    -   **Meta:** `#ff2a5f` (Rosa).
-   **Tipografia:** Fontes modernas `DM Sans` e `Syne` carregadas via Google Fonts.

---

### 4. Guia de Configuração (Persistence)
Valores persistidos via `GM_setValue`:
| Chave | Descrição |
| :--- | :--- |
| `tl_node` | Node ID ativo (ex: CGH7). |
| `rd_lang` | Idioma da interface (`pt` ou `en`). |
| `tl_goal_pph` | Meta de produtividade individual. |
| `tl_v5_vol_total` | Volume alvo do turno para o gráfico TPH. |

---

## English 🇺🇸

This document provides a comprehensive technical breakdown of the **TL All-in-One Suite**.

### 1. System Architecture
The script operates as a coordinated monolithic container managing several modules via the `_SUITE` global engine.

#### 🌐 `_SUITE` Global Engine
-   **`_SUITE.LANG`**: Centralized dictionary for all UI strings (PT/EN).
-   **`_SUITE.L(key)`**: Localization helper utilizing the `rd_lang` configuration.
-   **`_SUITE.utils`**: Integrated tools for Node detection, security token retrieval, and DOM cleaning.

---

### 2. Module Deep Dive

#### 📈 TPH Chart - Throughput Dashboard
Real-time production analytics powered by **Chart.js**.

-   **Dynamic Need Algorithm:**
    Calculated fresh at every refresh to adapt to current throughput speed.
    -   **Formula:** `Current_Need = Remaining_Volume / Remaining_5min_Blocks`
    -   **Remaining Volume:** `Total_Volume_Target - Total_Scans_Processed_so_far`.
    -   **Remaining Blocks:** A count of 5-minute intervals from the current time until the shift end, **excluding** periods defined as Lunch/Dinner or standard Breaks.
-   **Caching Layer:**
    -   Past data blocks are stored in `GM_setValue` with a unique key (`tph_v2_NODE_START_END`).
    -   24-hour TTL (Time-To-Live).
    -   Recent data (last 15 minutes) is never cached to maintain real-time accuracy.

---

#### 👥 Dynamic Container Builder Ranking (Productivity)
Deep tracking of individual associate performance.

-   **Data Processing:** Aggregates scan counts from the `PRODUCTIVITY_REPORT` endpoint.
-   **PPH (Packages Per Hour):** Estimated based on cumulative volume vs. active time detected.
-   **Visual Tiers:**
    -   **Green (Top):** >90% of goal.
    -   **Yellow (Good):** >75% of goal.
    -   **Red (Warning):** <40% of goal.
-   **Smart Auto-Scroll:** Monitors mouse inactivity for 5 seconds before cycling through the list; resets instantly on user hover.

---

#### 🚛 VSM Map & Dock View
Physical and logical visualization of yard and dock operations.

-   **Layout Matrix:** Uses a coordinate-based grid (`DEFAULT_MAP_MATRIX`) to render VSMs (Virtual Sorting Machines) in a glassmorphism style.
-   **Route-to-VSM Mapping:** Utilizes `DEFAULT_VSM_SEGMENT_MAP` to automatically link transport routes to specific sort areas.
-   **YMS/Vista Integration:**
    -   Real-time trailer occupancy status.
    -   Density visualization via color gradients.
    -   Custom layout editor to rearrange dock positions on-the-fly.

---

#### 🔍 VRID Info & CPT Analytics
Advanced intelligence for load planning and travel analysis.

-   **VRID Interception:** Injects data-lookup buttons into Site Status, YMS, and Relay Tracking pages.
-   **Volumetric Calculation (CuFt):** Converts raw API dimensions from `cm³` to `ft³` (CuFt), enabling predictive trailer fill analysis.
-   **Flow Analysis Tabs:**
    -   **Total/Remaining:** Gap analysis between plan and execution.
    -   **X-Dock:** Filters Transshipment packages for area planning.
    -   **CPT Priority:** Sorts all pending cargo by critical departure times.

---

### 3. UI Design System
-   **Design:** Premium Glassmorphism (blur + transparency).
-   **Color Logic:**
    -   **Real:** `#a89dff`.
    -   **Need:** `#39ff14`.
    -   **Meta:** `#ff2a5f`.
-   **Typography:** Professional fonts `DM Sans` and `Syne`.

---

### 4. Persistence Settings
Saved locally via `GM_setValue`:
| Key | Description |
| :--- | :--- |
| `tl_node` | Active site Node ID. |
| `rd_lang` | UI Language choice. |
| `tl_goal_pph` | Individual scan target. |
| `tl_v5_vol_total` | Total volume target for TPH Chart. |

---
*Last Updated: 2026-04-13*
