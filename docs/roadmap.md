# Roadmap — Threat-Shape

Build one phase at a time. After finishing a phase: summarise what was built, restate
the AS index if it changed, name the next phase, then stop and wait for confirmation.

| # | Fase | Obiettivo | Output | Bloccante? |
|---|---|---|---|---|
| 0 | Verifica dati | Ricontare le colonne one-hot reali, ricalcolare l'AS index, contare le categorie di `incident_type` | Report di verifica, numeri confermati o corretti | **Sì — non si procede senza** |
| 1 | Setup & architettura | Repo, backend FastAPI + frontend D3, "hello world" che dimostra che si parlano | Skeleton funzionante | No |
| 2 | Preprocessing dati | Join delle 4 tabelle su `incident_id`, esplosione colonne multi-valore, one-hot encoding, "Not available" come categoria propria | `features_matrix.csv.gz` + tabelle di contingenza | No |
| 3 | Feature scaling + PCA | Standardizzazione (z-score), PCA a 20 componenti, verifica varianza spiegata reale | `pca_components.csv.gz` + loadings/summary | No |
| 4 | t-SNE globale (offline) | Embedding precalcolato sull'intero corpus, perplexity motivata | `tsne_global.csv.gz` | No |
| 5 | Backend API — dati statici | Endpoint che servono incidenti, coordinate t-SNE, geometria mappa | API minima funzionante | No |
| 6 | View A — Mappa | Choropleth con dati reali, layer switchable residuo/attribuzione, pannello details-on-demand | Vista funzionante, non coordinata | No |
| 7 | View B — Scatter t-SNE | Punti reali, colore/size come da proposta | Vista funzionante | No |
| 8 | View C — Timeline ad area | Dati reali aggregati per anno/tipo (atomi esplosi, non stringhe combinate) | Vista funzionante | No |
| 9 | View D — Pannello di contrasto | Solo layout statico per ora | Vista funzionante | No |
| 10 | Selection store condiviso | Stato centralizzato, pub/sub, nessuna vista ancora reagisce | Infrastruttura di coordinamento | No |
| 11 | Coordinamento bidirezionale | Collega le 4 viste secondo il punto 4 della proposta | Click/lasso/brush propagano ovunque | No |
| 12 | Analitica 6.1 — z-score sulla mappa | Deviazione standardizzata sulla selezione corrente, badge "small sample" | Endpoint `/api/residuals` + integrazione mappa | No |
| 13 | Analitica 6.2 — Re-proiezione locale | t-SNE rifittato sul sottoinsieme selezionato, soglia minima dichiarata | Endpoint `/api/reproject` + integrazione scatter | No |
| 14 | Analitica 6.3 — z-score contrastivo | Selection-vs-rest e A-vs-B, ranking per z-score | Endpoint `/api/contrast` + integrazione pannello D | No |
| 15 | Trigger via interazione | Lasso, click/ctrl-click, brush — verifica che nessun risultato esista prima dell'interazione | Comportamento conforme al punto 5 | No |
| 16 | Rifinitura visiva | Legende su ogni vista, scale divergenti solo dove serve, palette colorblind-safe | Polish | No |
| 17 | Caccia agli insight | Usare il sistema per trovare pattern reali, documentarli con screenshot | `docs/insights.md` | No |
| 18 | Deliverable finali | Report 5-6 pagine, related work, slide, demo | Consegna | No |

## Note di avanzamento

Aggiungere qui, mano a mano, una riga per fase completata con data e AS index corrente,
così chi apre una nuova sessione (tu, il tuo compagno, o Claude Code) vede subito lo
stato reale senza dover rileggere tutta la chat.

- [x] Fase 0 — completata il: 2026-08-21 — **AS index confermato: 61.452** (3.414 × 18)
      Verifica in `scripts/00_verify_data.py`, esiti in `docs/phase0_report.md`.
      `docs/proposal.md` NON modificato: le divergenze sono registrate nel report.
      Decisioni chiuse il 2026-08-22:
      · set one-hot = **123** colonne su 14 blocchi (matrice 127 = 123 + 4 ordinali);
      · non-attribuzione = **51,87%**, `initiator_country` ∈ {Not attributed, Unknown},
        cioè "nessuno stato iniziatore identificato" (il 48,65% del proposal misurava
        `attribution_source_url`, cioè la presenza del link alla fonte);
      · artefatti in **`.csv.gz`** e non `.parquet`: evita la dipendenza `pyarrow`,
        fuori dallo stack di CLAUDE.md §7, per un guadagno di ~70 ms una volta
        all'avvio su una matrice da 69 KB. Tabella sopra aggiornata di conseguenza.
- [x] Fase 1 — completata il: 2026-08-21
      Scheletro FastAPI + D3 v7 funzionante, round-trip `GET /api/health` verificato.
      Griglia 2×2 come da mockup (A B / D C), viste a dimensione fissa, nessuno scroll.
- [x] Fase 2 — completata il: 2026-08-22 — **AS index invariato: 61.452**
      `scripts/01_preprocess.py` produce 5 artefatti in `data/processed/`, 23/23 verifiche
      passate. Matrice **3.414 × 127** (123 binarie + 4 ordinali).
      Contingenza paese×settore da `receiver` + fallback da `global` sui 92 incidenti
      mancanti: copertura 3.414/3.414.
      **Correzione:** trovato un bug nello split dei `;` dentro le parentesi — one-hot
      123 e non 125, matrice 127 e non 129 (AS index invariato). Regola di split ora
      condivisa in `scripts/eurepoc_atoms.py`. Dettagli in `docs/phase0_report.md` §5.1.
      **Da affrontare in Fase 12:** l'82,4% delle celle paese×settore ha frequenza
      attesa < 5 (205 paesi × 12 settori su 12.363 osservazioni).
- [x] Fase 3 — completata il: 2026-08-22 — **AS index invariato: 61.452**
      `scripts/02_pca.py`: standardizzazione + PCA a 20 componenti, 5/5 verifiche.
      **Varianza spiegata dalle 20 componenti: 50,7%** (ne servirebbero 55 per l'80%).
      Il timore sulle categorie rare è risultato infondato: |loading| medio 0,0135 per
      le rare contro 0,1029 per le comuni — la PCA le relega nella coda.
      **Problema aperto per la Fase 4:** PC1 (10,4% della varianza, la componente
      maggiore) correla **r = +0,79** con l'incompletezza documentale, che ne spiega il
      62% della varianza. I suoi contributi principali sono tutti indicatori
      "Not available". Prima di costruire View B va verificato se il t-SNE separa
      visibilmente su quest'asse: l'analista leggerebbe "due profili di minaccia" dove
      c'è solo "documentato vs non documentato".
- [x] Fase 4 — completata il: 2026-08-22 — **AS index invariato: 61.452**
      `scripts/03_tsne_global.py`: embedding 2D precalcolato, 5/5 verifiche.
      **Perplexity = 30**, scelta misurando la *trustworthiness* su tre candidate
      (15 → 0,9877 · **30 → 0,9897** · 50 → 0,9885), non presa per default. La KL
      divergence è esplicitamente scartata come criterio: cala con la perplexity per
      costruzione, quindi premierebbe sempre la candidata più piccola.
      **Questione della Fase 3 risolta:** l'incompletezza documentale raggruppa a 0,913
      contro 0,898 della variabile sostanziale più forte (baseline casuale 0,045) —
      +1,7%, quindi *comparabile*, non dominante. L'embedding raggruppa fortemente su
      tutto insieme. Resta un limite dichiarato nel report, non un blocco per View B.
      **Da tenere presente in Fase 6-7:** il settore bersaglio raggruppa solo a 0,409 —
      selezionare per settore NON produrrà un cluster netto in View B. È una proprietà
      dei dati: le viste coordinate non devono essere attese concordi su quell'asse.
      **Nota:** 673 incidenti hanno profili di feature identici (il gruppo maggiore ne
      conta 40), quindi coordinate ripetute sono attese e non un errore.
- [x] Fase 5 — completata il: 2026-08-23 — **AS index invariato: 61.452**
      5 endpoint statici: `/api/health`, `/api/incidents` (3.414), `/api/timeline`
      (114 celle anno×tipo), `/api/countries` (168), `/api/features` (123).
      `backend/app/data.py` carica gli artefatti una volta sola e li tiene in memoria.
      Frontend collegato: carica i 4 dataset in ~525 ms e mostra i conteggi.
      View D resta vuota per costruzione (CLAUDE.md §6).
      **Bug trovato e corretto:** il codice ISO della Namibia è `NA`, che pandas rilegge
      come valore mancante — la Namibia spariva dalla mappa. I lettori dei file con
      codici paese usano `keep_default_na=False`; `01_preprocess.py` ora avvisa.
      **Copertura mappa:** 92,2% delle osservazioni su 168 paesi. I 249 incidenti
      localizzati solo su regioni/organizzazioni **non sono raggiungibili col click
      sulla mappa** — la Fase 11 deve saperlo: la selezione geografica non è esaustiva.
      **Geometria mappa:** non servita dal backend, arriva da CDN in Fase 6 insieme a
      View A (coerente con "D3 v7 via CDN, no build step"). Il backend fornisce i
      codici ISO alpha-2 per il join.
- [ ] Fase 6 — completata il: ___
