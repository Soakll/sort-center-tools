# Technical Documentation: TL All-in-One Suite 📘

[Português](#português-🇧🇷) | [English](#english-🇺🇸)

---

## Português 🇧🇷

Este documento fornece detalhes técnicos e operacionais sobre o funcionamento da **TL All-in-One Suite**.

### 1. Arquitetura Geral
O script é construído sobre um objeto global centralizado chamado `_SUITE`. Este objeto gerencia:
-   **Internacionalização (i18n):** Traduções dinâmicas via `_SUITE.L(key)`.
-   **Utilitários:** Funções de detecção de Node, busca de tokens anti-CSRF e manipulação de DOM.
-   **Estado do Módulo:** Flags que determinam quais módulos devem ser carregados com base na URL atual.

### 2. Módulos Técnicos

#### 📈 TPH Chart (V5)
Este módulo utiliza **Chart.js** para visualização e possui uma lógica de "Necessidade Dinâmica":
-   **Cálculo de Nec:** `Rem_Vol / Rem_5min_Blocks`.
-   **Pausas:** O sistema desconta automaticamente os minutos de almoço e pausas configurados do total de blocos disponíveis.
-   **Cache:** Utiliza `GM_setValue` com um sistema de expiração (TTL) para evitar chamadas de API repetitivas em períodos já finalizados.

#### 👥 Dynamic Container Builder Ranking
-   **Data Fetching:** Realiza consultas paralelas ao endpoint de `PRODUCTIVITY_REPORT`.
-   **Processamento:** Agrega dados por associado e calcula PPH (Packages Per Hour).
-   **Auto-Scroll:** Implementado com um temporizador de inatividade. Pausa se houver interação do usuário e retoma após 15 segundos.

#### 🚛 VSM Map / Dock View
-   **Mapeamento:** Utiliza um mapa de coordenadas fixo para posicionar graficamente as rotas e docas.
-   **Integração YMS:** Busca dados de trailers e carregamento diretamente dos sistemas de pátio da Amazon.

### 3. Persistência de Dados
Configurações do usuário são salvas localmente no navegador via Tampermonkey (`GM_setValue`). Chaves principais:
-   `tl_node`: Node ID atual.
-   `rd_lang`: Idioma selecionado.
-   `tl_v5_chart_goal`: Meta global da régua (Raise the bar).

---

## English 🇺🇸

This document provides technical and operational details regarding the **TL All-in-One Suite**.

### 1. Core Architecture
The script is built around a centralized global object named `_SUITE`. This object manages:
-   **Internationalization (i18n):** Dynamic translations via `_SUITE.L(key)`.
-   **Utilities:** Node detection, anti-CSRF token fetching, and DOM manipulation functions.
-   **Module State:** Flags determining which modules load based on the current URL.

### 2. Technical Modules

#### 📈 TPH Chart (V5)
This module uses **Chart.js** for visualization and features "Dynamic Need" logic:
-   **Need Calculation:** `Rem_Vol / Rem_5min_Blocks`.
-   **Breaks:** The system automatically subtracts configured Lunch/Dinner and standard break minutes from the total available blocks.
-   **Caching:** Uses `GM_setValue` with a TTL (Time-To-Live) system to prevent redundant API calls for completed periods.

#### 👥 Dynamic Container Builder Ranking
-   **Data Fetching:** Performs parallel requests to the `PRODUCTIVITY_REPORT` endpoint.
-   **Processing:** Aggregates data per associate and calculates PPH (Packages Per Hour).
-   **Auto-Scroll:** Implemented with an inactivity timer. Pauses on user interaction and resumes after 15 seconds.

#### 🚛 VSM Map / Dock View
-   **Mapping:** Uses a fixed coordinate grid to graphically position routes and docks.
-   **YMS Integration:** Fetches trailer and loading data directly from Amazon yard management systems.

### 3. Data Persistence
User settings are saved locally in the browser via Tampermonkey (`GM_setValue`). Main keys:
-   `tl_node`: Current Node ID.
-   `rd_lang`: Selected language.
-   `tl_v5_chart_goal`: Global "Raise the bar" target.

---
*Last Updated: 2026-04-13*
