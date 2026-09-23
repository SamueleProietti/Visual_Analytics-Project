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
- [x] Fase 16 — completata il: 2026-08-23 — **AS index invariato: 61.452**
      Rifinitura visiva, verificata invece che asserita: `scripts/06_verify_visual.py`
      **34/34** + `verifyLegends()` runtime **20/20**.
      **Le palette sono misurate, non dichiarate sicure.** Ogni palette passa per una
      simulazione di protanopia, deuteranopia e tritanopia (Viénot-Brettel-Mollon) e le
      distanze fra colori si calcolano in CIE Lab. Tre tipi di scala, tre regole diverse:
      · **categorica** → ogni coppia distinguibile (ΔE ≥ 10): i colori portano identità;
      · **sequenziale** → luminosità monotona: la rampa porta ordine, non identità;
      · **divergente** → luminosità a V + estremi lontani: va scuro-chiaro-scuro *per
        progetto*.
      **Bug reale nella palette, trovato dalla misura:** "essere una palette sicura" non
      è "essere sicura in combinazione". In deuteranopia l'arancione `#E69F00` e il
      vermiglio `#D55E00` di Okabe-Ito, entrambi in uso in View C, collassavano a
      **ΔE 6,6** — praticamente lo stesso colore. Sostituito con il giallo `#F0E442`
      della stessa palette: **ΔE 13,3**. Riscontro anche in View D: gli estremi della
      divergente restano a ΔE 44,9–96,9 sotto tutte e tre le deficienze.
      **Bug nel test, trovato subito dopo:** la prima versione applicava alle scale
      divergenti la regola delle sequenziali e bocciava il residuo di View A su tutte e
      tre le deficienze — marcando come difetto un progetto corretto. Un test che usa il
      criterio sbagliato è peggio di nessun test.
      **Legenda di View D mai più vuota:** senza selezione mostrava 0 caratteri e 0
      simboli. Un contenitore vuoto si legge come legenda mancante (2 punti). Ora mostra
      la codifica in grigio attenuato anche prima che esistano barre: dice all'analista
      cosa il pannello risponderà, senza asserire alcun risultato.
      Verificato che **tutte e 4 le legende sono popolate in tutti e 4 gli stati**
      (vuoto, selezione, residuo, dopo-clear) e che nessuna vista scrolla in nessuno.
- [x] Rifinitura frontend — 2026-09-06/08 — **AS index invariato: 61.452**
      *Fuori dalla numerazione delle fasi: richiesta esplicita di sistemare il frontend
      prima delle ultime due fasi.*
      **Layout.** La griglia riempie il viewport invece di due colonne fisse da 590px con
      un margine morto a destra. `repeat(2, minmax(0, 1fr))` e **non** `auto-fit`:
      auto-fit deduce il numero di colonne dalla larghezza e a 1600px ne montava tre,
      rompendo l'accoppiamento A B / D C del mockup. Sotto i 990px collassa a una colonna.
      Tolti il chip di stato verde (ora banner di solo guasto: un badge permanente
      "tutto ok" è chrome che l'occhio impara a saltare) e il footer.
      **Difetto in View B, reso evidente dall'allargamento:** gli assi x e y erano scalati
      in modo indipendente. Gli assi t-SNE non hanno unità, ma l'embedding *è isotropo*:
      il rapporto fra due distanze è l'unica cosa che asserisce, e scalare i due assi in
      modo diverso disegna un cluster rotondo come un'ellisse. Ora un solo fattore di
      scala, plot centrato; il layout globale e la ri-proiezione locale condividono il fit.

- [x] Sistema cromatico — 2026-09-08 — **AS index invariato: 61.452**
      `scripts/06_verify_visual.py` da 34 a **39/39**.
      **Dottrina del corso, dalle slide:** VA_03_1 #25 «the rainbow scale does not
      work!!!», #26 «6 colori elementari in 3 coppie → 11 distinguibili», #27
      «colorbrewer2.org · do not use colors in a random way», #35 «**maintain consistence
      across different graphs**»; VA_07_C #6 «11 colours for labeling, **max 4 for
      color-blind people**».
      **Dai flag ufficiali di ColorBrewer** (`colorbrewer_schemes.js`): *nessuno* schema
      qualitativo è dichiarato sicuro a 7 categorie (Set2 e Dark2 sono `0` da n=7).
      Coincide con il «max 4» del corso. Okabe-Ito a 7 misura ΔE 11,6 contro 5,0 di Dark2
      e 8,6 di Set2: **View C resta su Okabe-Ito perché è misurabilmente migliore**, non
      per preferenza — l'unica deviazione da ColorBrewer, e giustificata da un numero.
      **Il vincolo che sembrava centrale è impossibile.** Volevo che l'asse segnato
      (rosso/blu) non fosse indossato da nient'altro: su tutte le combinazioni divergente
      × categorica il massimo raggiungibile è **ΔE 8,3**, sotto la soglia di 10. Una
      palette categorica che copre il cerchio cromatico contiene per forza qualcosa di
      vicino a qualunque estremo divergente. Quindi la coerenza **non** può venire da
      «nessun colore si somiglia»: viene dal **tipo di scala come grammatica** —
      divergente = «rispetto all'atteso», sequenziale = «quanto», categorica = «quale».
      **Difetto reale trovato:** i tre layer di View A dipingono *gli stessi pixel*
      scambiati dal toggle, e due di loro erano quasi identici — residuo `#b2182b` vs
      attribuzione `#a50f15` a **ΔE 5,0** in tritanopia. Ogni scala passava la propria
      regola: il difetto era invisibile ai controlli per-scala. Adottato il **Sistema A**:
      volume Blues→**BuPu**, attribuzione Reds→**YlOrBr**, intensità Purples→**Greens**;
      RdBu resta sul segnato, quindi rosso = «sopra l'atteso» in View A e in View D.
      Risultato: residuo/attribuzione **10,2**, residuo/volume **11,2**,
      volume/attribuzione **14,1**. Il tetto misurato per RdBu è 10,4, quindi il sistema è
      di fatto al massimo che la convenzione consente.
      **Effetto collaterale voluto:** il viola non è più anche la rampa di intensità, così
      resta a significare *solo* «scelto dall'analista» (lazo, banner locale, contorno di
      selezione indiretta). Un punto non può più essere scuro perché intenso *o* perché
      selezionato.
      **Nuovo gruppo di verifiche (sezione 3):** «one meaning per colour where the
      meanings share pixels» — confronta i colori-segnale dei tre layer di View A e
      controlla che View D usi gli estremi del residuo di View A. Rimettendo Reds il
      controllo fallisce con ΔE 5,0 ed esce 1: è il difetto che prima nessun test vedeva.

- [x] View A — zoom, popup, legenda — 2026-09-08 — **AS index invariato: 61.452**
      `05_verify_triggers.py` da 21 a **23/23**, `verifyTriggers()` da 13 a **17/17**.
      **Zoom a due bottoni**, in alto a destra *dentro* il rettangolo della mappa, con
      limiti `[1, 8]`. Il minimo è 1 — «il mondo intero, adattato» — perché sotto quel
      valore la mappa rimpicciolirebbe dentro la propria cornice senza rivelare nulla:
      fuori dalla sfera non c'è niente. Il massimo è 8, che risolve gli stati insulari
      che EuRepoC registra (Malta, Bahrain, Singapore) senza lasciare che un paese
      riempia il riquadro: una coropleta confronta luoghi, e un paese solo non confronta
      niente. I bottoni si disabilitano ai limiti invece di smettere di rispondere.
      Tornare a 1 azzera anche la traslazione, altrimenti «zoom tutto indietro» non
      restituirebbe la vista da cui si era partiti.
      **Applicato senza transizione d3.** Una transizione è guidata da
      `requestAnimationFrame`, che il browser congela in una scheda nascosta: l'effetto
      del bottone dipenderebbe da qualcosa fuori dal bottone. Verificato in laboratorio —
      con `document.hidden` vero nessuna transizione partiva. Un controllo a scatti deve
      atterrare dove dice, ogni volta che lo si preme.
      **La rotella NON è un gesto di zoom:** la pagina scrolla, e una rotella che zooma
      la mappa invece di scorrere oltre fa sembrare la pagina rotta. Zoom = i due
      bottoni; il trascinamento continua a fare pan, delimitato dal canvas.
      **Le info paese sono un popup** in basso a sinistra dentro la mappa; il riquadro
      sotto la mappa è stato eliminato. Nascosto quando non c'è nulla da dire: come
      pannello sotto la mappa il prompt «click a country» riempiva una scatola che
      c'era comunque, come popup coprirebbe geometria per non dire niente. L'invito è
      passato al sottotitolo della view, dove non costa mappa. Tolta la riga
      «contrast A-vs-B: phase 14»: nominava una fase invece di un risultato, e il
      contrasto sta in View D, che dichiara già per esteso il proprio confronto.
      **Bug preso in corsa:** `.map-popup { display: flex }` batteva per specificità
      l'`[hidden]{display:none}` del browser (una classe vince su un selettore di
      attributo), quindi il popup compariva come scatola bianca vuota sopra la mappa.
      **Legenda impilata:** titolo su una riga, valori sulla successiva
      (`.view-legend.is-stacked`). In linea il titolo mangiava abbastanza larghezza che
      l'ultima classe del layer attribuzione cadeva da sola sulla riga sotto — e una
      classe isolata si legge come un gruppo a sé, non come la coda di una scala
      ordinata. Verificato: ora 6 valori su una riga, nessun orfano. Solo View A aderisce;
      View B porta due titoli affiancati di proposito.
      **Controllo che si dichiarava più forte di quanto fosse:** `05` asseriva «the only
      <button> elements are created by the two-state toggle» ma testava solo che
      index.html non contenesse bottoni statici — un'etichetta diventata falsa nel
      momento in cui View A ha avuto lo zoom, senza che il controllo se ne accorgesse.
      Ora enumera *quali file* creano bottoni e ispeziona i loro handler: nessuno scrive
      sullo store né chiama un endpoint di analitica. In runtime, 14 pressioni dei
      bottoni zoom lasciano selezione e barre di View D invariate.

- [x] View A — deselezione, popup leggibile, §6.3 corretta — 2026-09-08
      **AS index invariato: 61.452.** `verifyTriggers()` da 17 a **20/20**.
      **Corretta la formulazione di CLAUDE.md §6.3.** Diceva «when **2+** countries are
      selected, switch to a direct A-vs-B contrast», ma sopra i due paesi «B» non esiste
      finché non se ne nomina uno, e l'unica cosa disponibile per nominarlo è l'ordine
      dei click. Misurato sul corpus: {IT, DE, FR} contrastati usando a turno ciascuno
      come pivot condividono **0 feature su 5** fra il pivot FR e il pivot IT, e la mappa
      non mostra quale paese sia il pivot. Con selezioni piccole peggiora: {IT, MT, CY}
      si divide in 81-vs-7, 1-vs-87 e 8-vs-80, tutti sotto la soglia minima, quindi
      *ogni* pivot rifiuta di rispondere mentre vs-rest dà comunque 60 feature usabili.
      Da tre paesi in su resta **gruppo vs resto del mondo**. Il comportamento non è
      cambiato: era la frase a essere imprecisa.
      **Click sul mare = deselezione.** Prima, per uscire da una selezione di tre paesi
      bisognava cliccarne un quarto (che sostituisce l'insieme) e poi ricliccarlo — due
      click che affermano entrambi qualcosa che l'analista non intendeva. `setCountries([])`
      e non `clear()`: la mappa possiede il filtro paesi e nient'altro, e un brush
      temporale appartiene a View C.
      **La guardia guarda il puntatore, non la trasformazione.** Un trascinamento
      termina con un evento click, che non va letto come «click sul mare». La prima
      versione confrontava la trasformazione prima/dopo — ma a scala 1, e al bordo dei
      limiti di pan, la trasformazione è bloccata: un pan reale non la cambia, e
      l'analista che trascina aspettandosi di spostare la mappa perderebbe la selezione.
      Ora è una soglia di 4px sullo spostamento del puntatore. Verificato: trascinamento
      a 1x → selezione intatta; a 2,56x → intatta; click semplice → azzerata.
      **Popup riscritto.** Tolta la frase «geographic residual needs a time or lasso
      context (…)»: spendeva tre righe di un riquadro che galleggia sulla mappa per
      descrivere una cosa che non c'era. Quando non c'è contesto, la riga semplicemente
      non compare — l'analisi in quello stato *è* la scomposizione per settore, che
      dichiara da sé il proprio confronto.
      **La riga dei settori era ordinata su |z| e nascondeva metà del risultato.**
      «by sector: Critical infrastructure +4.1 · Education +3.8» chiedeva al lettore di
      decodificare il segno e non diceva rispetto a *cosa*; peggio, prendendo i due |z|
      più grandi poteva mostrare due positivi e nascondere un negativo altrettanto forte
      — il settore Media degli Stati Uniti sta a **−3,35**, subito dietro Education a
      +3,76, e non compariva mai. Ora la lista è divisa per direzione, con l'intestazione
      che nomina il confronto: «which sectors are hit, against the global sector mix ·
      more than expected: … · less than expected: …».

- [x] View A — un bordo, due canali separabili — 2026-09-12 — **AS index invariato: 61.452**
      Emerso da una domanda in fase di test: «cosa significano i bordi viola e
      tratteggiati?». Spiegandolo è venuto fuori che si sovrascrivevano.
      **Il bordo portava tre cose su un canale solo:** grigio sottile = non selezionato,
      nero spesso = paese cliccato, viola = paese *toccato* da un lasso o da un brush,
      tratteggiato grigio = residuo inaffidabile (attesi < 5). Misurato nel browser, la
      regola CSS `.is-unreliable` **vinceva** sull'attributo inline impostato da `draw()`
      (una dichiarazione CSS batte un attributo di presentazione), quindi «inaffidabile»
      cancellava «selezionato». Su una mappa in stato residuo, dove tipicamente 104 paesi
      su 168 sono inaffidabili, spariva la maggior parte della selezione — compreso il
      bordo nero del paese appena cliccato.
      **Il viola è stato rimosso.** Misurato su selezioni tipiche marcava il **66%** del
      mondo con un lasso stretto e il **91%** con un brush temporale: un marcatore che si
      applica a quasi tutto non separa niente. E fra il 22% e il 47% dei paesi viola lo
      perdeva comunque sotto il tratteggio, quindi era anche intermittente. Il requisito
      «ogni view è sorgente e bersaglio» resta soddisfatto molto più fortemente dal fatto
      che al lasso **l'intera mappa cambia layer e ridipinge tutti i 168 paesi** sulla
      scala del residuo; e il conteggio non si perde, il popup scrive ancora
      «touching N countries». Argomento percettivo, da riportare: VA_07_C — la
      *congiunzione* di feature pre-attentive smette di essere pre-attentiva, e colore
      del tratto + stile del tratto sullo stesso bordo sono dimensioni integrali
      (Ware). Qui non interferivano soltanto: si sovrascrivevano.
      **Ora il bordo porta due fatti su due canali separabili:** il *colore* dice se
      l'analista ha scelto quel paese (grigio / nero), il *tratteggio* dice se il residuo
      è affidabile (continuo / tratteggiato). La regola CSS dichiara solo
      `stroke-dasharray`; colore e spessore li decide `draw()`, così una funzione sola
      governa tutto il bordo.
      Verificato sui quattro stati: `selected + unreliable` ora resta nero 1,6px **e**
      tratteggiato (prima diventava grigio 0,8px). Caso reale ripreso a schermo: Città
      del Vaticano, inaffidabile, cliccata → mantiene entrambi i segnali.

- [x] View B — legenda, didascalia, e la ri-proiezione isolata — 2026-09-12
      **AS index invariato: 61.452.** 23/23 trigger, 39/39 visivo, 20/20 runtime, 20/20 legende.
      **Legenda in due gruppi.** I due titoli («weighted intensity», «affected entities»)
      restano sulla stessa riga, ciascuno con i propri valori sotto. Prima erano in linea
      con i simboli, il che metteva due scale diverse su un'unica fila e lasciava al
      lettore il compito di capire dove finiva il colore e cominciava la dimensione.
      **Didascalia «axes have no units…» tolta dal grafico**, spostata nel sottotitolo
      della view. L'avvertenza serve — è ciò che impedisce di leggere il piano come una
      mappa — ma sta con le istruzioni, non sopra i dati.
      **Il difetto vero: due sistemi di coordinate nello stesso piano.** Dopo la
      ri-proiezione locale i punti selezionati si spostano nell'embedding locale mentre
      quelli non selezionati restavano visibili *sbiaditi alle loro coordinate globali*.
      Non erano «gli stessi dati sullo sfondo»: erano una mappa diversa disegnata sotto.
      Il context+focus funziona in View C perché contesto e fuoco condividono gli assi;
      qui no. E un secondo lazo catturava entrambi, producendo una selezione che mescola
      «vicini nell'embedding locale» con «capitati in quel punto nel layout vecchio».
      Ora i punti fuori dal sottoinsieme sono **nascosti**, non sbiaditi (impostato
      direttamente, non dentro la transizione: se un segno è a schermo non deve dipendere
      da un frame di animazione), e **il lazo è sospeso** finché il layout locale è
      attivo. Il click su spazio vuoto resta attivo: è la via di ritorno al globale.
      **Sotto-difetto preso in corsa:** bloccando il `mousemove` durante il layout locale,
      un trascinamento non accumulava vertici e cadeva nel ramo «meno di tre vertici =
      click», *azzerando la selezione*. Cioè faceva qualcosa, quando il punto era non
      fare nulla. Ora i vertici si registrano comunque; è solo il disegno e la selezione
      a essere sospesi.
      **Coerenza aggiunta:** se arriva una selezione da un'altra view (click sulla mappa,
      brush temporale) mentre il layout locale è a schermo, si torna al globale. Un
      embedding locale descrive *una* selezione; lasciarlo con un'altra evidenziata
      sopra sarebbe una figura che non corrisponde più ai dati che mostra.

- [x] Layout a finestra intera — 2026-09-17 — **AS index invariato: 61.452**
      `06_verify_visual.py` da 39 a **43/43**, `verifyLegends()` da 20 a **30/30**,
      `05` **23/23**, `verifyTriggers()` **20/20**.
      **Il problema, misurato:** dallo screenshot del portatile usato per la demo, il
      browser lascia alla pagina circa **1265 × 629 px CSS** (display ad alta densità
      scalato a 2×, meno interfaccia del browser e barra delle applicazioni). Il layout
      2×2 con canvas fissi da 340px ne richiedeva circa 1.000: la pagina scrollava e
      **non mostrava mai le quattro view coordinate insieme** — cioè brushare la timeline
      con la mappa fuori schermo.
      **Il nuovo layout,** ispirato al progetto di riferimento mastro94 (mappa del mondo,
      tre view sopra, una a tutta larghezza sotto): A | B | D in alto, C a tutta
      larghezza in basso. Scelto dalla forma naturale di ogni grafico e non tenuto il 2×2
      del mockup (che nella proposta è marcato «draft»): la mappa Equal Earth vuole ~2:1,
      il piano t-SNE è circa quadrato, il pannello di contrasto ha bisogno di un margine
      per le etichette, e la timeline è l'unico grafico che si legge meglio come striscia
      larga e bassa. Nel 2×2 a quell'altezza ogni view era a corto di altezza mentre mappa
      e t-SNE sprecavano metà della larghezza.
      Colonne `1.9fr / 1.1fr / 1.25fr`, righe `1.7fr / 1fr`, dimensionate sulla finestra
      (`100vh`) e non su costanti in pixel. Misure dei canvas: a 1265×629 mappa 532×275,
      t-SNE 299×275, contrasto 343×275, timeline 1226×167; a 1905×937 rispettivamente
      818×469, 465×469, 531×469, 1866×281. **Pagina alta esattamente quanto la finestra
      in tutti e tre i casi provati** (anche 1521×722). Sotto 1100px di larghezza si passa
      a due colonne con scroll di pagina: più leggibile che rimpicciolire.
      **«Viste a dimensione fissa» ridefinito, non abbandonato.** Il canvas non ha più
      un'altezza in pixel, ma nulla *dentro* una view può cambiarne la dimensione dopo che
      il grafico è stato disegnato: titolo, sottotitolo e legenda hanno altezze fisse,
      il canvas prende il resto con `min-height: 0` e `overflow: hidden`. Il verificatore
      statico controlla ora queste proprietà invece della vecchia `height: var(--view-h)`.
      **Spazio recuperato togliendo i duplicati:** la nota di View C («bands count type
      occurrences…») era sia nel sottotitolo sia in legenda; quella di View D («bar length
      = … order = |z|») idem. Ciascuna ora compare una volta. La legenda di D al posto del
      duplicato spiega ciò che prima non spiegava: *barre sbiadite e tratteggiate = non
      passano il test di validità*.
      **L'intestazione del confronto di View D ha una riga tutta sua.** Condivideva la riga
      del titolo e veniva troncata esattamente quando era più lunga — e CLAUDE.md §5 vieta
      di lasciare implicito il termine di confronto.
      **View D si adatta all'altezza:** una barra ogni 26px, fra 6 e 14 (9 sul portatile,
      14 su un 1080p, dove prima nove barre fisse erano spesse il doppio del necessario e
      nascondevano cinque feature). Il margine delle etichette non supera il 45% del
      pannello, e le etichette troppo lunghe sono accorciate con «…» e testo completo nel
      tooltip — prima sforavano a sinistra e il taglio mangiava proprio il prefisso
      («impact:», «issue:») che dice di che tipo di feature si tratta.
      **Due difetti presi dalle nuove misure, non a occhio:** la legenda di View B
      sforava di 5px (SVG dei cerchi alto 20px in una legenda da due righe, ora 15px con
      larghezza misurata sul testo); e il popup della mappa **tagliava le ultime righe** —
      proprio «less than expected», metà della risposta — perché il limite del 46% su un
      canvas da 275px non bastava. Ora il popup è più compatto e i nomi di settore sono
      accorciati a 24 caratteri per restare su una riga.
      **Nuovi controlli runtime:** in ogni stato, nessuna legenda è tagliata, la dashboard
      entra nella finestra senza scroll di pagina (quando la finestra è ≥ 1100×560), e il
      popup del paese mostra tutte le sue righe.
      **Limite noto, ora più rilevante:** le view misurano il proprio riquadro al
      caricamento. Ridimensionare la finestra dopo — incluso passare a schermo intero con
      F11 durante la demo — non le ridisegna. Da risolvere prima della presentazione.

- [x] Mappa a pieno riquadro, cornici ridotte — 2026-09-17
      **AS index invariato: 61.452.** 43/43 visivo, 23/23 trigger, 30/30 legende, 20/20 runtime.
      **La mappa COPRE il suo riquadro invece di starci dentro.** `fitSize()` rimpiccioliva
      il mondo finché ci stava, lasciando su un canvas più largo del ~2:1 della proiezione
      un terzo di View A come sfondo vuoto — il singolo spreco più grande dell'interfaccia.
      Ora si prende il fattore di scala *maggiore* fra i due e il ritaglio fa il resto.
      Tagli scelti, non subiti: a nord **84°**, perché la Groenlandia settentrionale e la
      costa artica russa hanno incidenti nel corpus e una coropleta che nasconde un paese
      non può colorarlo; a sud **−58°**, che elimina l'Antartide — l'unica area grande la
      cui perdita non costa nulla, visto che EuRepoC non vi registra alcun receiver.
      Misurato a 1265×629: sfera 654×318 su canvas 545×286, ritagliata ai lati.
      **Un bordo invece di due.** La card era incorniciata e il grafico dentro di lei
      incorniciato di nuovo: due volte la stessa linea. Tolto il bordo del canvas, ridotti
      i padding e il gap da 6 a 4px. I canvas crescono: mappa 532×275 → **545×286**,
      timeline 1226×167 → **1244×175**, e View D passa da 9 a **10 barre**.
      **Perché non il 2×2 del progetto di riferimento.** Misurato applicando le griglie
      alternative alla pagina reale, a 1265×629:
      · 3+1 (attuale): mappa 545×286, t-SNE 310×286, contrasto 354×286 (10 barre), timeline 1244×175
      · 2×2 uguali: tutte 613×209 — ogni grafico perde **77px di altezza (−27%)**, il
        t-SNE spreca **404px** di larghezza (la nuvola è quadrata), View D scende a 7 barre
      · 2×2 con colonne 1.55/1: mappa 748×209, t-SNE 478×209 (269px sprecati), 7 barre
      La differenza non è di gusto ma di altezza disponibile: il progetto di riferimento
      gira su una finestra alta ~1010px, dove un 2×2 dà ~400px per grafico; qui la finestra
      è alta 629px e ne dà 209. Scelta lasciata aperta: sono tre righe di CSS.

- [x] Mappa rettangolare, proiezione cilindrica equivalente — 2026-09-17
      **AS index invariato: 61.452.** 43/43, 23/23, 30/30, 20/20.
      **Il bordo curvo non era un difetto del ritaglio: è la forma di Equal Earth.** Il suo
      contorno è un ovale, quindi riempire un rettangolo lascia *sempre* i quattro angoli
      vuoti, e nessun ritaglio lo elimina — la curva corre lungo tutto il bordo.
      **Serviva una proiezione rettangolare senza perdere l'equivalenza delle aree,** che
      per una coropleta non è negoziabile: il colore codifica una quantità riempiendo una
      forma, quindi una proiezione che gonfia il nord (l'equirettangolare lo raddoppia a
      60°, Mercatore lo quadruplica) farebbe urlare Canada e Russia a prescindere dai
      valori. La soluzione è una **cilindrica equivalente**, rettangolare *ed* equivalente.
      **Il parallelo standard è risolto sul riquadro, non scelto a caso.** L'aspetto di una
      cilindrica equivalente è esattamente `2π·cos²(p) / span`, quindi `p` si ricava dalle
      proporzioni del canvas: il mondo riempie la scatola con angoli quadri e **senza
      ritagliare longitudine**. Alle proporzioni del portatile cade intorno ai 37°, cioè la
      proiezione **Hobo-Dyer**. Nessuna dipendenza nuova: `d3.geoConicEqualArea` degenera in
      una cilindrica quando i due paralleli sono opposti.
      **Antartide fuori per scelta** (banda 90°..−60°): EuRepoC non vi registra alcun
      receiver, ed è l'unica area grande la cui perdita non costa nulla; l'altezza liberata
      va alle latitudini dove i dati stanno davvero.
      Verificato a due proporzioni: a 1265×629 sfera 545×306,5 su canvas 545×286
      (longitudine completa, taglio solo in basso); a 1905×937 sfera 831×514,5 su canvas
      831×480. In entrambi i casi Nuova Zelanda, Figi, Russia e Groenlandia sono dentro,
      l'Antartide fuori.

- [x] Ri-proiezione solo col lazo, ritorno al 2×2, mappa equirettangolare — 2026-09-21
      **AS index invariato: 61.452.** `05` da 23 a **24/24**, `verifyTriggers()` da 20 a
      **21/21**, 43/43 visivo, 30/30 legende.
      **Bug: un click in View B ri-proiettava la selezione di un paese.** Un click semplice
      sul piano chiama `setLasso(null)`, che pubblica con origine «projection»; con un paese
      ancora selezionato la selezione non è vuota, e il gate — che guardava solo *da dove*
      arrivava la notifica — lanciava il refit t-SNE sugli incidenti del paese. Due
      correzioni: il gate ora richiede che **un lazo esista**, e un click senza lazo attivo
      non pubblica proprio nulla (una notifica che non cambia stato sveglia comunque tutti i
      subscriber). Il controllo statico estrae ora la condizione dell'`if` che protegge la
      chiamata e verifica entrambe le parti; `verifyTriggers()` riproduce il caso
      segnalato: paese selezionato, click in B, nessun banner locale.
      **Ritorno al 2×2** (A B / D C, come nel mockup della proposta), per scelta: le
      quattro view uguali si leggono come quattro domande di pari peso. Il costo misurato
      prima resta vero (−27% di altezza per grafico a 629px); la mappa non ha più bisogno
      di una colonna larga, perché ora riempie qualunque riquadro riceva.
      **Mappa equirettangolare, allontanandosi di proposito dall'equivalenza delle aree.**
      Argomento dell'utente, e giusto: in qualunque mappa equivalente l'Africa riceve la
      quota di pixel che le spetta per superficie — la più grande — pur portando il minor
      numero di incidenti, mentre l'Europa, dove il corpus è più denso, viene schiacciata
      fino a rendere i suoi piccoli stati difficili da vedere e da **cliccare**, in una view
      il cui compito è essere cliccata. Proporzioni della mappa di riferimento; preferita a
      Mercatore perché quello gonfia le aree del doppio a ogni latitudine (1/cos² contro
      1/cos). **Costo dichiarato:** area gonfiata di 1,6× a 50°, 2× a 60°, ~3× nell'Artico —
      Russia e Canada guadagnano peso visivo non meritato. Misurato sul canvas reale
      (613×209): rapporto Europa/Africa in pixel da **0,167 a 0,268** (+60%), Europa da
      1.349 a 1.991 px², Africa −8%, Italia +19%, Belgio +38%. Banda 82°N…56°S.

- [x] View D — barre sbiadite davvero, niente hover, valori in pp — 2026-09-21
      **AS index invariato: 61.452.** `06` da 43 a **46/46**, 24/24, 30/30, 21/21.
      **Bug: le barre non affidabili non erano sbiadite.** `render()` imposta
      `fill-opacity` 0,4 sulle feature che non passano il test di validità, ma la regola
      CSS `rect.bar { fill-opacity: 0.88 }` la sovrascriveva (una dichiarazione CSS batte un
      attributo di presentazione): misurato, dipinte a 0,88 come le altre. La legenda diceva
      «faded, dashed bars fail the validity test» — tratteggiate sì, sbiadite mai. È lo
      **stesso errore** del bordo di View A; il verificatore controlla ora entrambi i casi,
      e rimettendo la regola fallisce 44/46.
      **Tolto l'hover che scuriva le barre:** prometteva un'interazione che non esiste.
      Resta il tooltip nativo con etichetta completa e cifre.
      **Le lunghezze erano corrette, ma si leggevano male.** Brasile: Corporate Targets
      +34,6pp con z 5,96; oissue Unknown +20,4pp e State institutions +20,9pp, entrambe con
      z ≈ 2,6. La lunghezza è la differenza in pp, la z è la chiave dell'ordinamento, come
      stabilito in Fase 9. Stessa differenza non vuol dire stessa z: z divide la differenza
      per il suo errore standard, che dipende dal tasso di base — una feature vicina al 50%
      di prevalenza è la più rumorosa che una proporzione possa essere (p(1−p) massimo), e
      guadagna meno z a parità di pp. State institutions ha prevalenza combinata ~52%,
      Corporate Targets ~16%: il rapporto degli errori standard, √(0,25/0,13) ≈ 1,37, spiega
      esattamente perché 20,9pp danno 2,6 mentre 34,6pp danno 6,0. Mostrando solo la z
      accanto alla barra, però, il lettore leggeva la z come lunghezza. Ora la colonna di
      destra mostra entrambi: **`+34.6pp  z 6.0`**, con il valore in pp in evidenza.
      **Proprietà fisse per ogni confronto? Misurato: no.** Su 48 paesi con almeno 20
      incidenti, **53 feature diverse** entrano in qualche top 9; le 7 più frequenti, fissate
      per tutti, coprirebbero in media il **32%** della top 9 di un paese, e in **17 paesi su
      48** non ne catturerebbero nessuna delle prime 3. **Aperto:** il 45% degli slot in
      cima è occupato da indicatori «Not available / Unknown / none» — da decidere come
      trattarli.

- [x] Fase 17 — completata il: 2026-09-23 — **AS index invariato: 61.452**
      **`docs/insights.md`: cinque insight**, ognuno raggiungibile con un gesto del tool,
      prodotto da una delle tre analitiche e accompagnato dalla sua z. Soglia dichiarata:
      |z| ≥ 2 è «più che rumore», e i numeri sotto soglia sono citati **come tali**, non
      nascosti (View D · IT vs DE ransomware z 1,91; UA vs RU disruption z −1,21).
      **`scripts/07_insights.py` ricalcola ogni cifra del documento** chiamando gli stessi
      endpoint dell'interfaccia: i numeri del documento sono i numeri che il tool mostra,
      non un'analisi parallela scritta in pandas che per caso concorda.
      **Il lasso non è riproducibile, il cluster sì.** Dove l'analista racchiude un
      gruppo a mano, lo script lo recupera con DBSCAN sulle coordinate t-SNE pubblicate
      (eps=5, min_samples=10) e restituisce **78 e 37 incidenti**, esattamente i due
      gruppi densi che il lasso racchiude.
      **1. Russia, due famiglie operative.** 37 incidenti a intensità media 1,59
      (`downtime · Day` +73,5pp, z 10,8) contro 78 a intensità **3,26**
      (`technique · Data Exfiltration` +65,9pp, z 10,0). Re-proiezione locale:
      trustworthiness 0,938 e 0,977. **Non si dividono per attore**: HUR e gruppi
      volontari stanno in entrambi e la non-attribuzione è 38% contro 40%. La proiezione
      ha separato *cosa fa* l'operazione, non *chi* la conduce.
      **2. La rottura di codifica 2020-2022 domina qualsiasi contrasto temporale.**
      `ilaw: Not available` passa da 100% (2013) a 86,8% (2019), 54,9% (2020), 16,7%
      (2022), 2,1% (2024); le occorrenze di tipo per incidente da 1,21 a 2,04. Un brush
      2000-2013 restituisce in cima **cinque feature che sono artefatti di codifica**
      (|z| 26-34). È un insight *sul dato* trovato dal pannello di contrasto, ed è anche
      la trappola che lo stesso pannello tende: per confrontare caratteristiche si
      spazzola dentro l'era omogenea.
      **3. L'attribuzione segue chi attacca, non la capacità della vittima.** Due regimi
      sulla mappa: <30% non attribuiti (KR 17%, SA 21%, AE 24%, IN, CN, VN, UA) contro
      >55% (FR 72%, ES, MX, CA, IT, US, DE, CH, AU, BE). Il contrasto spiega lo split:
      quota media di iniziatori state-affiliated **45,2% contro 15,6%**. L'ipotesi
      «gli occidentali attribuiscono meglio» è rovesciata.
      **4. Ucraina e Russia sono immagini speculari.** Modalità A-vs-B: l'Ucraina è
      colpita da attori statali (36,5% contro 10,4%, z 5,79), la Russia da gruppi non
      statali (53,0% contro 13,1%, z −7,46) che pubblicano ciò che rubano (doxing 27,2%
      contro 5,8%).
      **5. Italia contro Germania.** Gruppi non statali 46,9% contro 18,6% (z 4,59);
      non attribuiti 25,9% contro 49,4% (z −3,47). Profilo criminale tracciabile da una
      parte, lacuna documentale dall'altra.
      **Limiti dichiarati nel documento:** nessuna correzione per test multipli (123
      indicatori per contrasto), gli iniziatori non hanno un layer sulla mappa, il corpus
      è un registro di *segnalazioni*, e con tre o più paesi non esiste il dettaglio per
      membro (§6.3).
      **Da fare:** catturare i cinque screenshot elencati in fondo a `docs/insights.md`
      dentro `docs/img/`.
