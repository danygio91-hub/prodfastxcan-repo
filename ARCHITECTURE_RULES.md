# Prodfast Architettura - Regole Costituzionali

Questo documento definisce i principi fondamentali che devono guidare lo sviluppo del software Prodfast. Ogni modifica, refactoring o nuova feature deve rispettare queste regole per garantire l'integrità dei dati e la manutenibilità del sistema.

## 1. Principio SSoT (Single Source of Truth)
Esiste un solo "motore di calcolo" per i dati aziendali. Calcoli di giacenze, stati, pesi e tempi devono avvenire in funzioni centralizzate (es. in `src/lib/`). Nessun calcolo critico deve essere "sparso" nei componenti UI.

## 2. Divieto di Logica Duplicata
I frontend (UI Admin, App Tablet Operatore, Console Produzione) non devono calcolare stati o matematiche di business. Devono limitarsi a visualizzare i risultati forniti dal Backend centralizzato o dalle utility condivise in `src/lib/`.

## 3. Priorità Admin
La logica di calcolo dell'Admin è la fonte di verità (SSoT). Tutte le altre applicazioni (Operator App, Logistics Console, ecc.) devono allinearsi alla logica definita e validata nell'area Admin.

## 4. No Rogue Optimistic Math
Dopo un'operazione di salvataggio o modifica dati (es. un prelievo di materiale, un cambio fase, una chiusura commessa), il frontend non deve eseguire calcoli locali fittizi ("optimistic UI" non verificata) per aggiornare la vista. Il frontend deve ricaricare il dato reale idratato dal server per riflettere lo stato aggiornato e centrale.
