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
- [x] Fase 6 — completata il: 2026-08-23 — **AS index invariato: 61.452**
      View A funzionante: coropletica mondiale, toggle a due stati, details-on-demand,
      legenda propria. Non ancora coordinata (Fase 11).
      **Geometria da CDN** (`world-atlas@2/countries-50m`) + `i18n-iso-countries` per il
      ponte alpha-2 → numeric-3. Scelta 50m e non 110m sulla base di una misura sui
      nostri dati: 110m dipinge 142/168 paesi (97,1% incidenti) e perde del tutto Hong
      Kong, Singapore, Bahrein e Malta; 50m ne dipinge **162/168 (99,4%)** per 739 KB
      caricati una volta. Restano fuori 6 paesi / 29 incidenti.
      **Proiezione Equal Earth** (equivalente): una coropletica codifica una quantità
      riempiendo un'area, quindi Mercatore gonfierebbe Russia e Canada a prescindere
      dai valori.
      **Scale a classi discrete**, non continue: i conteggi vanno 1–871 con la maggior
      parte dei paesi a una cifra, una rampa lineare dipingerebbe il mondo di un solo
      tono e gli USA di un altro. Sequenziale a tinta unica, mai divergente: il segno
      qui non ha significato (CLAUDE.md §2).
      **Interpretazione dichiarata:** il toggle è `Incident volume` / `Attribution`, non
      `residuo` / `attribuzione`, perché il residuo non può esistere prima di una
      selezione (CLAUDE.md §6). In Fase 12 il primo stato diventerà il residuo
      divergente quando una selezione esiste.
      **Corretto:** l'`<svg>` inline stava sulla baseline del testo e faceva scrollare
      il canvas a dimensione fissa — violazione graded. `display:block` lo risolve.
- [x] Fase 7 — completata il: 2026-08-23 — **AS index invariato: 61.452**
      View B funzionante: 3.414 punti, colore sequenziale a tinta unica su
      `weighted_intensity`, dimensione su `log1p(affected_entities)`, legenda propria.
      **Nessun asse disegnato e nessun tick**: le coordinate t-SNE non hanno unità e le
      distanze fra cluster non sono significative (CLAUDE.md §5). Al loro posto una
      didascalia che lo dichiara esplicitamente.
      **Dimensione: doppia compressione motivata.** `log1p` perché la variabile grezza
      va da 0 a 1.000.000 e un solo incidente schiaccerebbe tutti gli altri; poi `sqrt`
      sul raggio, così l'**area** — ciò che l'occhio integra — è proporzionale al valore
      log-compresso e non al suo quadrato. Risultato misurato: un fattore 1.000.000 nei
      dati diventa 16× nell'area, e i due gruppi dominanti restano distinguibili
      (r 2,0 con 0 entità contro 3,3 con 1).
      **Da segnalare nel report:** `affected_entities` è quasi degenere — 53,9% a 0,
      45,0% fra 1 e 10, un solo incidente a 1.000.000. Il canale dimensione porta quindi
      poca informazione: è fedele al proposal, ma va dichiarato come limite.
- [x] Fase 8 — completata il: 2026-08-23 — **AS index invariato: 61.452**
      View C funzionante: area impilata 2000–2024, 7 bande, legenda propria.
      Costruita sugli **atomi esplosi**, mai sulle 49 stringhe combinate. Totali
      verificati contro l'API e contro il conteggio Python: identici.
      **Palette Okabe-Ito**, lo standard per la sicurezza rispetto ai deficit di
      visione cromatica. 7 categorie ≤ 12 (CLAUDE.md §2), quindi nessun raggruppamento
      in famiglie: ogni tipo tiene la propria tinta. Ordine dello stack fisso, non
      guidato dai dati, così le bande non si riordinano fra fasi diverse.
      **Assi disegnati ed etichettati**, al contrario di View B: qui anni e conteggi
      sono quantità reali.
      **Avvertenza dichiarata nella vista, non solo nel report:** un incidente può
      portare più tipi, quindi le bande sommano a **1,7×** il numero di incidenti
      (**2,1×** nel 2023: 1.513 occorrenze contro 723 incidenti). L'asse y conta
      *occorrenze di tipo*, non incidenti — senza dirlo sovrastimerebbe il volume
      fino al 100%.
      **Spunto per la Fase 17:** il rapporto occorrenze/incidenti cresce nel tempo
      (1,54 nel 2017 → 2,09 nel 2023), quindi parte della crescita apparente della
      timeline è crescita della *granularità di codifica*, non della minaccia.
      I 92 incidenti senza data restano esclusi da questa vista, per costruzione.
- [x] Fase 9 — completata il: 2026-08-23 — **AS index invariato: 61.452**
      View D: layout completo, **nessun calcolo**. All'avvio 0 SVG e 0 barre, header
      `no selection`, prompt visibile — è la prova del vincolo "no default global
      state" (CLAUDE.md §6). L'analitica 6.3 arriva in Fase 14.
      **Ambiguità di CLAUDE.md §5 risolta e dichiarata:** "lunghezza = magnitudine,
      ordine = |z-score|, non magnitudine" ha senso solo se le due sono quantità
      diverse — altrimenti coinciderebbero. Quindi: **lunghezza = differenza di
      proporzione grezza in punti percentuali** (effect size), **ordine = |z|**
      (affidabilità, che pesa la numerosità). Conferma nel proposal riga 83:
      "ranks features by reliability, with bar length showing magnitude".
      Verificato con dati fittizi: la barra più lunga (157px) finisce **ultima**
      perché z=1,1, mentre la prima è più corta (128px) ma ha z=4,6.
      Il valore di z è stampato accanto a ogni barra: la chiave di ordinamento deve
      essere leggibile, non solo implicita nella posizione.
      **Scala divergente giustificata:** qui lo zero (nessuna differenza) e il segno
      hanno significato reale, quindi la divergente è corretta e non decorativa.
      Coppia opponente blu/rosso di ColorBrewer RdBu, sicura per i deficit di visione
      cromatica al contrario di rosso/verde.
      `ViewD.demo()` disegna il layout con numeri inventati **solo da console**, con
      scritta "DEMO DATA" sovraimpressa: un grafico plausibile di dati finti sarebbe
      peggio di nessun grafico.
- [x] Fase 10 — completata il: 2026-08-23 — **AS index invariato: 61.452**
      `frontend/js/selectionStore.js`: stato centralizzato + pub/sub. **Nessuna vista
      pubblica o si sottoscrive ancora** (0 sottoscrittori all'avvio) — è solo
      infrastruttura, il collegamento è la Fase 11.
      **Perché è una fase a sé:** con una sola autorità sulla selezione, la domanda
      "esiste una selezione?" ha una sola risposta, e `isEmpty()` diventa la guardia
      che ogni analitica controlla. Con quattro viste che tengono ciascuna il proprio
      stato, il vincolo graded di CLAUDE.md §6 dipenderebbe da quattro discipline
      separate invece che dalla struttura.
      **Tre sorgenti combinate per INTERSEZIONE**, non unione: paesi (View A) ∩ lasso
      (View B) ∩ finestra temporale (View C). Il proposal descrive il brush come
      *restrizione* di ogni computazione alla sua finestra: chi lazza un cluster e poi
      spazzola 2022–2024 intende "questi incidenti, in quegli anni", non "o l'uno o
      l'altro".
      **Verificato:** IT→81 (coincide con View A), IT+DE→237 con 15 sovrapposti (unione,
      non somma), brush 2000–2024→3.322 (i 92 senza data escono per costruzione),
      US→871, selezione+complemento = 3.414 sempre. Passaggio automatico ad A-vs-B con
      2 paesi: `"IT" vs "DE"`. Un sottoscrittore che va in errore non blocca gli altri.
      **Aggiunto a `/api/incidents`:** `countries` per incidente (+143 KB non compressi,
      ~30 gzippati) — senza, un click sulla mappa non può risolversi in un insieme di
      incidenti lato client.
- [x] Fase 11 — completata il: 2026-08-23 — **AS index invariato: 61.452**
      Coordinamento bidirezionale completo: tutte e 4 le viste sono sorgente e
      destinazione, come da punto 4 del proposal.
      **I tre trigger sono tutti implementati** (CLAUDE.md §2: nessun menu può avviare
      un'analitica): click/ctrl-click sulla mappa, **lasso libero** sulla proiezione,
      **brush** sulla timeline.
      Il lasso è scritto a mano (ray casting per point-in-polygon, ~12 righe): D3 non
      lo fornisce e una dipendenza costerebbe più da giustificare all'esame di quanto
      costi leggere il codice. Il `mouseup` è su `window`, non sull'svg, altrimenti
      rilasciando fuori dal grafico il lasso resterebbe bloccato.
      **View A non possiede più la selezione:** pubblica nello store e ridisegna da ciò
      che torna, esattamente come le viste che non hanno originato il cambiamento.
      Distingue selezione **diretta** (bordo nero, click sul paese) da **indiretta**
      (bordo viola, paesi toccati da un lasso o da un brush).
      **View C usa contesto + focus:** le bande complete restano dietro in chiaro e la
      selezione si sovrappone a colori pieni, **sulla stessa scala y**. Riscalare
      farebbe sembrare una selezione minuscola grande come l'intero corpus.
      **View D aggiorna solo l'header**, nessun calcolo: la domanda è definita, la
      risposta arriva in Fase 14.
      **Verificato:** click IT→81 propagato a tutte e 4; lasso→696 incidenti che
      illuminano 116 paesi; brush 2022–24→1.777; intersezione IT∩2022–24→52 con 0 fuori
      range; clear azzera tutto. **Esattamente 1 notifica per azione — nessun ciclo** —
      propagazione in 33–42 ms, 0 errori in console.
      **Aggiunto a `/api/incidents`:** `types` per incidente, così View C può ridisegnarsi
      sulla selezione dagli stessi atomi esplosi della serie globale.
- [x] Fase 12 — completata il: 2026-08-23 — **AS index invariato: 61.452**
      Analitica 6.1 in `backend/app/analytics.py` + `POST /api/residuals`, integrata
      nella mappa con scala divergente e badge "small sample".
      **`POST`, non `GET`, e senza forma senza parametri:** chiedere il residuo
      *obbliga* a dichiarare cosa è selezionato. Una lista vuota è rifiutata con 422
      dalla validazione. Il vincolo di CLAUDE.md §6 è nel contratto API, non solo
      nell'interfaccia.
      **Questione aperta dalla Fase 2 risolta con due statistiche invece di una.**
      Misure sui dati reali: celle paese×settore affidabili solo 19,2% (387/2016), ma
      paesi con almeno una cella affidabile 67,3%, e paesi affidabili su un residuo
      *per paese* 72,0%. Quindi: **la mappa usa il residuo per paese** (un numero per
      paese, come richiede una coropletica), **il pannello dettagli usa i residui
      paese×settore** (la tabella di contingenza letterale di §6.1, dove il badge serve
      davvero). Nessuno dei due viene soppresso quando inaffidabile: viene marcato.
      **Bug di design trovato e corretto — circolarità.** Selezionando solo l'Italia il
      residuo dava **z = +23,20**: la selezione *era* l'Italia, quindi l'Italia risultava
      al 100% contro un 3% atteso. Ora il residuo geografico si calcola sulla selezione
      **meno il filtro paese** (`SelectionStore.resolveIgnoring`): il lasso e il brush
      danno il contesto, la mappa risponde "dentro quel contesto, quali paesi deviano?".
      Italia dentro il brush 2022–24 dà ora **z = +5,14**, che coincide col calcolo
      Python indipendente. Con il solo filtro paese la mappa resta sul volume e lo dice
      esplicitamente, invece di mostrare un numero privo di senso.
      **Toggle sempre a due stati:** il primo slot è "Incident volume" senza selezione e
      "Residual" quando un residuo è calcolabile. Un terzo bottone avrebbe trasformato
      un interruttore di visualizzazione nel menu che il brief vieta.
      **Verificato:** 121/168 paesi affidabili sul brush 2022–24, 42 paesi tratteggiati,
      CN −6,71 / DE +5,85 / IT +5,14 identici al calcolo indipendente, clear azzera tutto.
- [x] Fase 13 — completata il: 2026-08-23 — **AS index invariato: 61.452**
      Analitica 6.2: `POST /api/reproject` + integrazione in View B. È **la tecnica di
      DR integrata nel flusso interattivo**, come vuole il proposal: la PCA resta
      denoising statico offline, il t-SNE viene **rifittato davvero** sul sottoinsieme,
      non filtrato da un embedding precalcolato.
      **Soglia minima n = 30, misurata** — `scripts/04_threshold_check.py` la riproduce.
      Trustworthiness con **k fisso a 4** e media su **15 sottoinsiemi casuali** per
      dimensione (media ± dev.st): n=10→0,817±0,055 · n=12→0,814±0,049 ·
      n=15→0,899±0,045 · n=20→0,921±0,033 · **n=30→0,937±0,023** · n=60→0,960±0,011 ·
      n=100→0,970±0,008.
      La media gira presto, fra 12 e 15. **È la dispersione a decidere:** a n=15 lo
      stesso sottoinsieme può dare da 0,79 a 0,96 a seconda di quali punti capitano,
      quindi un buon layout locale lì è tanto fortuna quanto segnale. La dev.st si
      dimezza fra 25 e 30. **30 è il punto in cui il risultato diventa riproducibile,
      non quello in cui diventa buono.**
      **Correzione:** la prima misura di questa fase era metodologicamente sbagliata —
      un solo sottoinsieme per dimensione e `k` che cresceva con `n`, cioè lo stesso
      errore di confrontabilità già corretto in Fase 4. Dava una curva diversa e falsa
      (n=30→0,876, n=12→0,788). Trovata perché i numeri non si riproducevano rilanciando
      il comando di test. La soglia resta 30, la motivazione è cambiata.
      **DA CONFERMARE** (CLAUDE.md §8): costante `MIN_SUBSET` in `analytics.py`.
      **Il rifiuto è un risultato, non un errore:** sotto soglia l'endpoint risponde 200
      con `ok:false` e il motivo. Un embedding di 12 punti sembra sicuro di sé esattamente
      quanto uno di 1.200, e l'analista non può distinguerli guardando.
      **Banner obbligatorio:** un layout locale e quello globale si assomigliano ma i
      loro assi significano cose diverse. Il banner viola dichiara n, perplexity e
      trustworthiness — scambiare l'uno per l'altro è il fraintendimento più dannoso
      che View B permetta.
      **Trigger: solo il lasso** (CLAUDE.md §5), non ogni cambio di selezione: un refit
      costa 2,6–2,9 s e lanciarlo a ogni ctrl-click renderebbe l'interfaccia inservibile.
      **Bug latente corretto:** dopo una re-proiezione i punti si spostano, ma il lasso
      testava ancora le coordinate globali — avrebbe selezionato i punti nelle vecchie
      posizioni. Ora testa i `cx`/`cy` correnti.
      **Verificato:** lasso di 861 incidenti → perplexity 30, trustworthiness 0,980;
      12 incidenti → rifiuto esplicito; clear ripristina il layout globale e toglie il banner.
- [x] Fase 14 — completata il: 2026-08-23 — **AS index invariato: 61.452**
      Analitica 6.3: `POST /api/contrast` + **View D finalmente popolata**. Tutte e tre
      le analitiche sono ora vive.
      **Test z per due proporzioni** con varianza poolata:
      `z = (p_a - p_b) / sqrt(p_pool·(1-p_pool)·(1/n_a + 1/n_b))`. La poolatura è ciò che
      rende il test valido fra gruppi di dimensioni molto diverse — il caso normale qui,
      81 contro 3.333. Applica la lezione della Fase 13: il confronto fra gruppi di
      taglia diversa richiede una statistica che le incorpori, non una che le ignori.
      **Due modalità decise dalla selezione, non da un controllo:** 2 paesi → `a-vs-b`
      diretto, altrimenti `vs-rest`. L'header dichiara sempre quale è in vigore.
      **Bug trovato e corretto due volte (backend, poi frontend).** Ordinando per |z|
      soltanto, `impact: Endpoint Denial of Service` finiva **primo** con +2,3pp e test
      di validità fallito, sopra `target: Critical infrastructure` a +21,7pp. Un z
      calcolato dove l'approssimazione normale non vale può essere arbitrariamente
      grande: non è un risultato più forte, è un numero che non va letto come z. Ora
      l'ordine è `(affidabile, |z|)`. Le inaffidabili **restano visibili**, sbiadite,
      tratteggiate e con ⚠ accanto allo z — marcate, non soppresse (§6.1 applicata a 6.3).
      La correzione è servita in due punti: il backend ordinava bene e `render()` di
      View D ri-ordinava disfacendo il lavoro.
      **Prova del design a schermo:** in `"IT" vs rest of world` la barra più lunga
      (155px, Critical infrastructure, z 3,9) sta in **seconda** posizione, sotto una
      barra più corta (137px, Corporate Targets, z 4,7). Lunghezza = magnitudine,
      ordine = affidabilità, esattamente come prescritto.
      **Token anti-sorpasso** sulle richieste: una risposta lenta non può sovrascrivere
      un risultato più recente.
      **Materiale per la Fase 17:** IT vs DE → `init: Non-state-group` +27,6pp (z 4,6) e
      `init: Not attributed` −20,3pp (z −3,5): gli incidenti italiani sono attribuiti a
      gruppi non statali molto più di quelli tedeschi, che restano più spesso anonimi.
- [x] Fase 15 — completata il: 2026-08-23 — **AS index invariato: 61.452**
      Fase di **verifica**, non di costruzione: il contratto di interazione dei due
      vincoli graded (§2 nessun menu può avviare un'analitica, §6 nessun risultato prima
      di una selezione) è ora **dimostrabile e ri-verificabile**, non asserito.
      **`scripts/05_verify_triggers.py` — 17 verifiche statiche + API**, tutte passate:
      · zero `<select>`, `<option>`, radio o checkbox in tutto il frontend;
      · zero `<button>` statici in `index.html` (i due del toggle sono generati da D3);
      · `setCountries()` scritto **solo** da `viewA_map.js`, `setLasso()` **solo** da
        `viewB_scatter.js`, `setYearRange()` **solo** da `viewC_timeline.js` —
        nessun quarto scrittore dello store;
      · tutte e 4 le viste reagiscono **solo** tramite la sottoscrizione allo store;
      · `bootstrap()` non invoca nessuna analitica prima della sottoscrizione;
      · `GET` su `/api/residuals`, `/api/reproject`, `/api/contrast` → **404**: non
        esiste un URL digitabile che produca un risultato globale;
      · `POST` con selezione vuota → **422** su tutti e tre.
      **`verifyTriggers()` in `frontend/js/verify.js` — 13 verifiche runtime**, da console
      durante la demo: nessuna barra, nessun tratteggio, nessun banner prima di
      un'interazione; **premere il toggle non avvia alcun calcolo** (è un interruttore di
      visualizzazione, non un trigger); click e brush producono risultati; il clear
      rimuove *tutto* e riporta il toggle a "Incident volume".
      Scritta come funzione da invocare e **non** come check automatico all'avvio: un
      test che girasse al caricamento sarebbe esso stesso una computazione prima che una
      selezione esista.
      **Il lasso** non è nella batteria runtime (simulare il trascinamento è fragile):
      va provato a mano, ed è verificato in Fase 13.
      **Due difetti trovati DAL verificatore stesso, dopo il primo commit:**
      · `verifyTriggers()` viveva in `main.js` e scriveva nello store → il controllo lo
        segnalava come **quarto trigger**, correttamente: una funzione spedita nel
        bootstrap che può impostare un intervallo temporale senza interazione *è* un
        quarto percorso verso lo store. Spostata in `verify.js`, escluso per nome dalla
        verifica, e **l'esclusione è a sua volta verificata** (un elenco di eccezioni che
        nessuno controlla è il modo in cui un vero quarto trigger finirebbe per
        nascondersi). Aggiunti check che il file di test non si auto-invochi.
      · lo script **saltava** le 6 verifiche API a server spento e concludeva comunque
        `passed` con exit 0. Ora gli skip sono registrati e producono un fallimento
        esplicito: *a partial pass is not a pass*.
      **Totale: 21 verifiche statiche+API e 13 runtime, tutte passate.**
- [ ] Fase 16 — completata il: ___
