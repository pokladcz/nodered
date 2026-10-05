# Victron Node-RED ESS & Řízení Přebytků FV

Tento repozitář obsahuje komplexní systém pro automatizované řízení fotovoltaické elektrárny na platformě Victron Energy. Systém je kompletně postavený v Node-RED a rozdělen na dvě hlavní části pro zajištění maximální plynulosti, oddělení výkonu a čistého uživatelského rozhraní.

## 🏛️ Architektura systému

1. **Cerbo GX (Venus OS)**
   - Stará se o kritickou "hard-realtime" logiku a všechny fyzické zápisy do měničů.
   - Přebírá data přímo z Victron DBus/MQTT.
   - Běží zde `Energy Manager v166`, watchdog uzly, a ovládání fyzických relé (Wattrouter, Bojler).

2. **Proxmox (Externí server / LXC kontejner)**
   - Hostuje hlavní grafický Dashboard pro uživatele (Node-RED Dashboard 2.0 - Vue.js).
   - Stará se o komunikaci s internetem (stahování spotových cen Enerspot, počasí).
   - Odesílá ceny a ruční povely na Cerbo přes HTTP/MQTT.

---

## 🚀 Hlavní automatizace a funkce (Energy Manager v166)

Celý systém je plně závislý na SOC (stavu nabití). **Primárně používá přesné SOC počítané MultiPlusem (VE.Bus)**, v případě nedostupnosti padá na Venus OS SOC, a až jako poslední instanci na procenta z BMS.

### 1. Nabíjení ze sítě podle spotových cen
Systém se automaticky rozhoduje, kdy nabít baterii levnou energií ze sítě:
*   **Hlavní limit:** Nabíjí, pokud je cena elektřiny (včetně poplatku) **pod nastaveným limitem** a baterie není plná.
*   **Záporná cena:** Pokud cena klesne pod nulu, systém začne automaticky nabíjet ZCELA VŽDY (bez ohledu na to, jak nízko je nastaven hlavní limit). Záporná cena je absolutní priorita pro spotřebu.
*   **Dynamické 5-stupňové nabíjení:** Umožňuje nastavit 5 cenových hladin. Např. "pokud je cena pod 1.00 Kč, nabij na 80%", "pokud je pod 0.00 Kč, nabij na 100%". Systém dynamicky hlídá nejvyšší platný limit podle aktuálního nabití.

### 2. Ochrana 100% nabité baterie při drahé síti
*   Pokud baterie dosáhne **100 %** a aktuální cena ze sítě je **nad stanoveným limitem** (např. 2 Kč/kWh), systém automaticky přepne MultiPlus do režimu **Inverter Only (Mód 2)**.
*   Tím zabrání přetokům do sítě za nevýhodnou (nebo zápornou) cenu a fyzicky donutí dům jet čistě z ostrovní energie, dokud se cena nevrátí do normálu nebo neklesne SOC.

### 3. Nouzové nabíjení a ochrana baterie
*   **Grid Shield (přepěťová ochrana):** Pokud napětí v síti stoupne nad limit (např. 253V), systém okamžitě zakáže export a přepne na nabíjení ze sítě, aby pomohl srazit lokální přepětí.
*   **Nouzové nabíjení z BMS:** Pokud jakákoliv připojená JK BMS nahlásí kriticky nízký článek nebo vydá zákaz vybíjení, systém okamžitě přepne na nabíjení ze sítě (Charger Only) na bezpečné úrovně (do 25 % SOC).

### 4. Inteligentní řízení zátěže (Relé 1, Relé 2, Shelly)
Systém poskytuje detailní řízení spotřebičů podle ceny a stavu baterie:
*   **Relé 1 (Wattrouter):** Zapíná se primárně při levné/záporné ceně, pokud to povolí BMS.
*   **Relé 2 (Spirála/Bojler):** Ovladač přebytků. Může fungovat na základě levné ceny, nebo (primárně) hlídá SOC baterie. Pokud je SOC nad 91 %, zapne spirálu. Pokud SOC klesne pod 89 %, vypne ji. Ideální pro pálení solárních přebytků v létě do vody.
*   **Shelly relé:** Samostatně řízené přes síť s možností vlastních podrobných pravidel v nastavení.

### 5. Diagnostika a hlídače (Self-Healing)
*   **Ochrana ESS "Hub4Mode":** Systém na sběrnici skenuje, v jakém režimu ESS se nachází. Pokud zjistí `External control` (ve kterém baterie nefunguje), okamžitě zobrazí červený poplach v Dashboardu s jedním tlačítkem "OPRAVIT", které vše vrátí do `Optimized without BatteryLife`.
*   **Ochrana DVCC:** Dashboard varuje a umožňuje 1-klikem zapnout VYPNOUTÉ DVCC (kritické pro záchranu baterie).
*   **Shared Temperature Sense:** Upozorní, pokud se sdílí falešná teplota z MultiPlusu do baterie a umožní to vypnout.
*   Systém si pravidelně (Watchdog) kontroluje stáří dat z Enerspotu, dostupnost SolaXu, kondici BMS atd. a informuje přes Discord webhooky.

---

## ⚙️ Výpočet ceny energie (Nákup/Výkup)

Veškerá logika a limity v Node-RED operují se **sjednocenou Finální cenou (Kč/kWh)**.
*   Enerspot API (nebo OTE) poskytuje surovou "Spot" cenu na trhu.
*   Aby se systém rozhodoval správně, od této spot ceny se VŠUDE konzistentně **odečítá fixní poplatek (provize)**.
*   **Vzorec:** `(Spot v Kč/MWh - Provize v Kč/MWh) / 1000 = Výsledná cena v Kč/kWh`
*   Pokud je tedy spotová cena například `1000 Kč/MWh` a provize v nastavení je `300 Kč`, výsledná cena použitá v pravidlech je `0.70 Kč/kWh`.
*   Záporná cena v celém programu vždy plnohodnotně vynucuje nabíjení a pálení elektřiny, dokonce má prioritu před cílovými SOC procenty.

---

## 🛠️ Jak nasadit (Deployment)

1. Smažte aktuální toky na vašem Node-RED a udělejte čistý **Import** souboru `Cerbo_...json` do Venus OS.
2. Na externím serveru importujte `Proxmox_...json`.
3. Klikněte na **Deploy**.
4. Zkontrolujte IP adresy (v Proxmox konfiguraci zadejte IP adresu Cerba).
5. V sekci Nastavení si upravte hodnotu `Poplatek k nákupní ceně Kč/MWh` tak, aby plně vyhovovala vašim tarifním podmínkám.
