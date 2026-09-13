# Victron Node-RED ESS & Řízení Přebytků FV

Tento repozitář obsahuje komplexní systém pro automatizované řízení fotovoltaické elektrárny na platformě Victron Energy. Systém je kompletně postavený v Node-RED a rozdělen na dvě hlavní části pro zajištění maximální plynulosti, oddělení výkonu a čistého uživatelského rozhraní.

## 🏗️ Architektura systému

Z důvodu optimalizace zátěže (CPU/RAM) a zajištění stability je systém rozdělen na dvě zařízení:

1. **Cerbo GX (Venus OS)**
   - Stará se o kritickou "hard-realtime" logiku.
   - Přebírá data přímo z Victron DBus/MQTT snímačů.
   - Běží zde `Energy Manager`, hlídací psi (`VE.Bus watchdog`) a ovládání fyzických relé.
   - Obsahuje REST API pro dotazování z venku (Proxmoxe).

2. **Proxmox (Externí server / LXC kontejner)**
   - Hostuje hlavní grafický Dashboard pro uživatele (Node-RED Dashboard 2.0 - Vue.js).
   - Stará se o těžké operace, které by Cerbo zpomalovaly: stahování spotových cen z internetu (Enerspot), vizualizační prvky a logování.
   - Komunikuje přes API se zařízením Cerbo (každých 5 sekund si žádá data, aniž by zahltil interní sběrnici).

---

## 🌟 Hlavní funkce

*   **Pokročilé řízení ESS a VE.Bus:** Automatické přepínání režimů měniče MultiPlus (Inverter Only, ESS, Charger Only) podle ceny elektřiny a stavu baterie. 
*   **Integrace spotových cen:** Systém se dokáže sám rozhodnout, kdy je výhodné nabíjet baterii z gridu podle denních cen OTE/Enerspot.
*   **SolaX Modbus & Telemetrie:** Spolupráce a monitorování sekundárního střídače SolaX v jedné síti.
*   **JK BMS Management:** Bezpečné sloučení dat a řídících signálů z vícero JK BMS. Automatické hlídání článků a blokace nabíjení/vybíjení (Anti-Passthru).
*   **Řízení přebytků (Relé 1 & 2):**
    *   **Relé 1 (Wattrouter):** Slouží k plynulému řízení hlavních přebytků.
    *   **Relé 2 (Bojler / Spirála):** Ovládáno čistě dle limitů SoC (State of Charge) baterie. Zapíná a vypíná na definovaných úrovních (např. >91% ON, <89% OFF). Podporuje plně manuální override přes UI.
*   **Custom Dashboard:** Na míru napsané responsivní UI, které nepoužívá jen defaultní Node-RED prvky, ale propracované HTML/CSS/Vue.js šablony.

---

## 📁 Obsah repozitáře

*   `Cerbo_v166_VICTRON_ESS_JEN_PREBYTKY_FV.json` – Toky (flows) určené výhradně pro import do Node-RED běžícího na zařízení Cerbo GX.
*   `Proxmox_v166_VICTRON_ESS_JEN_PREBYTKY_FV.json` – Toky určené pro externí systém hostující UI (Proxmox/Docker/RasPi).
*   `README.md` – Tato dokumentace.

---

## 🛠️ Nedávné optimalizace a opravy (v166 Clean)

Projekt byl nedávno pročištěn a výrazně optimalizován pro vyšší stabilitu:

1. **Oprava komunikace Relé 2:** Z kódu byla odstraněna závislost na chybně pojmenované proměnné (`portalId` -> `venusPortalId`), díky čemuž relé nyní správně reaguje na povely a příkazy nepropadávají.
2. **Nezávislost Relé 2:** Z logiky bojleru byla odebrána historická ochranná pravidla (cenové limity, SolaX stavy) - nyní se řídí 100% spolehlivě pouze podle stavu nabití baterie (SoC) nebo manuálního příkazu.
3. **Zamezení pádům Cerba (OOM & Event Loop):** Bylo smazáno 15 zapomenutých vývojářských `debug` uzlů, testovací simulátory cen a vyčištěno přes 20 KB "mrtvých" zakomentovaných historických kódů uvnitř function nodů. 
4. **Vypnutí falešných chyb "Passthrough":** VE.Bus watchdog již neuvaluje bezpečnostní 5minutový "lockout" při manuálním přepnutí režimu (při kterém měnič přirozeně na pár vteřin hlásí stav Passthru).
5. **Dashboard 2.0 Responsive Fix:** UI na Proxmoxu bylo kompletně přeskládáno do 5 logických horizontálních bloků. V CSS byly opraveny chyby CSS gridu (`minmax(0,1fr)` + `align-items: start`), čímž se eliminovalo nepříjemné překrývání dlouhých textů i nevzhledná prázdná hluchá místa pod kartami.

---

## 🚀 Jak nasadit (Deployment)

1. Otevřete Node-RED rozhraní na svém Victron zařízení.
2. V pravém horním menu zvolte **Import**.
3. Nahrajte obsah souboru `Cerbo_...json` a klikněte na **Deploy**.
4. Následně otevřete druhé Node-RED rozhraní (na Proxmoxu / serveru).
5. Dejte **Import** a nahrajte obsah `Proxmox_...json`.
6. Klikněte na **Deploy**.
7. Otevřete záložku Dashboardu na IP adrese vašeho Proxmox serveru (typicky port `:1881/dashboard`).
