# Kontrola a opravy — v167

Kontrola vznikla 7. listopadu 2026. Jde o kontrolu dodaných exportů,
historie jejich repozitáře, simulaci rozhodování a běh dvou skutečných instancí
Node-RED s dashboardem. Zařízení a externí služby byly simulované a odchozí
spojení na zařízení blokované. Nejde o protokol měření FVE.

## Obnova programu

Dodané Cerbo v166 obsahovalo pouze čtyři uzly Discordu a neexistující proměnnou
`msgs`. Chybělo řízení Victronu, telemetrie, relé i API.
Kompletní základ byl obnoven z commitu `6185735` stejného repozitáře.
Tento základ obsahoval 181 uzlů. Nový Cerbo export obsahuje 186 uzlů,
Proxmox export 84 uzlů.

Proxmox vychází z dodaného aktuálního exportu v166. Oba nové exporty mají
společné označení v167. Původní soubory nejsou přepsané.

## Opravené chyby

| Oblast | Zjištěná chyba | Oprava |
| --- | --- | --- |
| Zimní režim | Logika ani řízení příznaků neexistovaly | Přidán spánek, podmíněné probuzení, dočasné externí ESS a návrat původního režimu |
| Obnova ESS | Nebyl uložen původní režim | Trvalý deník před prvním zápisem; chyby úložiště blokují změnu |
| Watchdog | Samostatně určoval polohu přepínače | Respektuje zimní zásah; Passthru v zimě neruší |
| Příznaky ESS | V seznamu byla i neexistující cesta DisableDischarge | Použity výhradně DisableCharge a DisableFeedIn |
| BMS | Čerstvá teplota nebo článek maskovaly staré SoC a povolení | Kontroluje se stáří jednotlivých důležitých polí |
| Více BMS | Jedna chybějící BMS mohla projít jako kompletní sada | Kontroluje se očekávaný počet a povolení každé vybrané BMS |
| Nabíjecí limit BMS | Nulový limit jedné BMS mohl překrýt proud jiné BMS | Nulový limit kterékoli vybrané BMS blokuje nabíjení |
| MQTT | Neměnné hodnoty se při keepalive znovu nepublikovaly | Každých 25 s se výslovně čtou důležitá bezpečnostní pole |
| Přetok | Nesouvisející zprávy mohly obnovit čas starého součtu | Součet nese čas nejstarší fáze; null zneplatní měření |
| Spotřeba | Četla se neexistující souhrnná cesta Venus | Spotřeba se sčítá z Ac/Consumption/L1–L3/Power |
| API | Skutečný režim se četl z jiného klíče než zapisoval parser | API používá skutečný klíč telemetrie |
| Nastavení | Chybný argument vytvořil text místo cenového limitu | Opravena číselná výchozí hodnota |
| Restart | Část inicializace byla až za return | Inicializace předpovědi a dalších parametrů je dosažitelná |
| Uložení | Některé startovací migrace přepisovaly vlastní hodnoty | Doplňují se chybějící hodnoty; zadané limity se zachovají |
| Validace | Povel save_settings dovoloval libovolný zápis globálních klíčů | Samostatná validace typů, rozsahů a voleb; neplatný požadavek nic neuloží |
| Potvrzení | HTTP 200 se zobrazilo jako úspěch i při ok:false | Kontroluje se také obsah odpovědi |
| SAFE MODE | Ruční relé ON mohlo přepsat bezpečnostní vypnutí | SAFE MODE má ve writerech poslední slovo |
| STOP | Návrat do AUTO mohl nabíjení okamžitě obnovit | STOP aktivuje SAFE MODE; AUTO ho uvolňuje |
| Záporná cena | Plná nebo nevybraná baterie mohla zůstat v ESS | Cenová větev respektuje cíl i výběr baterie |
| SolaX | Ignorovala se volba baterie i nastavený proud | Používá se výběr, vlastní limit a nastavený proud |
| SolaX | Chybějící SoC nahrazovalo 67 % | Bez čerstvého skutečného SoC se požaduje 0 A |
| SolaX | Rozhodování mohlo používat starý priceModeCode | Cena se vyhodnocuje přímo z aktuálního intervalu |
| SolaX | Ruční nabíjení obcházelo část kontrol | Kontroluje se BMS, aktuální SoC a dostupnost telemetrie i Cerba |
| Modbus | Cizí či stará odpověď mohla být přijata jako potvrzení | Kontroluje se transakce, unit ID, hodnota a hlavička |
| Modbus | Neshodný readback se uložil jako hotový zápis | Neshoda vyvolá další pokus; STOP vyžaduje přesně 0 |
| Dashboard | Skript stránky SolaXu měl syntaktickou chybu | Skript opraven; všech sedm Vue šablon prošlo kompilací |
| Předpověď | Lokální čas serveru měnil ranní cíl | Používá se Europe/Prague |
| Předpověď | Výsledný cíl se neposílal Cerbu | Výsledek se synchronizuje; chybné nebo staré předpovědi se nepoužijí |
| Discord | Export míchal neslučitelné typy uzlů | Sjednocen na node-red-contrib-discord-advanced 3.6.0 |
| Discord | Některá hlášení četla neplněné globální klíče | Čtou společnou telemetrii dashboardu |
| Discord | Graf a ranní hlášení čekaly neexistující time/day | Čas se odvozuje ze skutečného timestampu ceny |
| Statistiky | Měsíční report mazal data před potvrzením odeslání | Data se nemažou; report vybírá předchozí měsíc |
| Trvalý kontext | Dvě úložiště zapisovala do stejného výchozího adresáře | Zimní deník má samostatný adresář `winter-context`; ověřena obnova po restartu |
| FlowFuse nastavení | Samostatné konstanty před export default rozbíjely parser ui-template | Skript začíná export default; data jsou uvnitř komponenty, úklid používá podporovaný unmounted |
| HTTP | msg.timeout neomezoval HTTP Request; některé chyby neměly připojený Catch | Použit msg.requestTimeout a doplněné chybové větve pro Tasmotu a Shelly |
| Tasmota proxy | Povel ignoroval nastavený host Cerba | Sdílí host, port a protokol ostatních požadavků |
| BMS dashboard | Čerstvé null nebo nemožné bezpečnostní hodnoty vypadaly jako platná BMS | Kontrola hodnot, typů i rozsahů; chybějící data neznamenají povolené nabíjení |
| Baterie dashboard | Zobrazovaly se staré globální hodnoty místo vybrané BMS | Zobrazení odpovídá vybranému zdroji; neznámé povolení není zaměněno za false |
| Relé Cerba | Zpětná vazba četla pevný index | Parser i periodické čtení respektují nastavení; dvě funkce nemohou sdílet stejný výstup |
| Tasmota | Null relé mohlo znamenat všechny výstupy; neúspěch mohl přepsat stav | Neplatné povely vracejí 400, stav se mění až po potvrzení POWERn |
| Shelly | HTTP odpověď bez potvrzení byla považována za úspěch | Vyžaduje platné potvrzení; chyby aktivují prodlevu a zobrazí neznámý stav |
| Ceny | Chyběl formát s explicitní kWh cenou a po změně provize zůstával starý výpočet | Parser validuje čísla i jednotky; rozhodování používá aktuální provizi |
| SolaX STOP | Ztracená transakce mohla trvale držet busy a odložit STOP | Čekání má časový limit; budoucí bezpečnostní snapshot se odmítá |
| Změny nastavení | Nová provize nebo parametry předpovědi čekaly na další periodu | Uložení spouští obnovení příslušných dat |
| Výpadek Cerba | Nastavení mohlo zmizet nebo vypadat jako dostupné výchozí hodnoty | Zachová se schéma i rozepsané změny, formulář se zablokuje a SolaX požaduje STOP |
| Start API | Stav mohl hlásit ok ještě před inicializací nastavení | Připravenost vyžaduje skutečně načtené schéma; čas startu je skutečný |

Neúčinné historické volby pro SolaX Force Charge, ochranu spirály podle SolaXu
a automatické odmítání Passthru nejsou v novém formuláři nabízené.
Tato verze neprohlašuje tyto staré mechanismy za funkční.
Původní hodnoty v kontextu se kvůli tomu nemažou.

## Podstatné hranice a priority

Zimní pravidlo používá společný cenový limit `chargeBelowFinalPriceKcKwh`.
Porovnává cenu po odečtení provize, stejně jako původní cenová automatika.
Nejde o úplnou nákupní cenu včetně distribuce a daní.

SolaX má také vlastní cenový limit. V automatice se používá před společným
limitem, pokud je nastavený. Zimní zákazy se týkají Victronu.
SolaX může dál pracovat podle své samostatné automatiky.

Při uspání se původní dobíjení 10 → 25 % neprosadí proti zimnímu pravidlu.
Probuzení nevyvolá samotné zvýšení SoC ani záporná cena.
Vypnutí zimního režimu v nastavení umožňuje návrat k ostatním pravidlům.
Po obnově nativního ESS řídicí program nepřepisuje jeho vlastní zákazy BMS.

Protože mají oba směry hranici 500 W, může kolísání přetoku při SoC pod 20 %
vyvolávat opakované přechody. Jiná hystereze ani časová prodleva nebyla do
zadaného pravidla přidána. Rozhodování běží přibližně každých pět sekund.

## Co bylo ověřeno

- Syntaxe všech Function uzlů a skriptů dashboardu.
- Jedinečnost ID, propojení uzlů, konfigurační odkazy a API cesty.
- Hraniční hodnoty 20 %, 500 W a rovnost ceny s limitem.
- Kombinace podmínek probuzení a chybějící či stará data.
- Zapamatování spánku a trvalá obnova původního ESS.
- Selhání zápisu deníku, změna identity a existující cizí externí regulátor.
- Priority nabíjení, nastavení a relé SAFE MODE.
- Skutečné fázové cesty pro měření spotřeby.
- Rozhodování SolaXu a odmítnutí neplatných Modbus odpovědí.
- Statická kontrola undefined proměnných, nedosažitelného kódu a duplicitních klíčů pomocí ESLint.
- Kompilace všech sedmi Vue šablon pomocí @vue/compiler-sfc.

Testovací sady jsou v `test/flows.test.mjs` a `test/settings-ui.test.mjs`.
Po celkové kontrole prošlo všech 59 testů, bez selhání.

Navíc prošlo 13 integračních scénářů v Node-RED 5.0.9 a FlowFuse Dashboard
1.36.0. Běžely skutečné HTTP uzly, API, dashboard a asynchronní souborový kontext.
Simulované byly MQTT zařízení, externí HTTP služby, Modbus a odesílání Discordu.
Ověřeno nabíjení s potvrzením, uspání i probuzení podle ceny a přetoku,
priorita SAFE MODE, neplatná BMS, proxy Tasmoty a směrování příkazu Discordu.
Čtyři neplatné HTTP požadavky byly skutečně odmítnuty stavem 400.

Samostatně byl ověřen výpadek Cerba: SolaX přešel na 0 A, nastavení zachovalo
rozepsané změny a po návratu spojení je nepřepsalo. Po ukončení a novém spuštění
procesu Cerba zůstal simulovaný Victron v zimním spánku; po splnění podmínek
probuzení se z deníku obnovil původní nativní ESS. Před restartem byl samostatně
uložen stav simulovaného zařízení, aby restart Node-RED nepředstíral restart hardwaru.
Strojově čitelný souhrn je v `output/OVERENI.json`.

Před publikací na GitHub byl odstraněn vložený token Enerspotu. Načítá se z
`ENERSPOT_TOKEN` nebo již existujícího globálního kontextu; bez tokenu se požadavek
neodešle. Tuto změnu pokrývá další test, celkem tedy při publikaci prošlo 60 testů.
Původní integrační protokol zachycuje 59 testů před touto úpravou.

Při aktualizaci starší v167 je nutné ještě se starým kontextem vypnout zimní režim
a potvrdit návrat do nativního ESS. Teprve pak zastavit Node-RED, zálohovat kontext
a změnit jeho adresář. Podrobný postup je v README. Aktivní deník se nesmí opustit.

## Úprava nastavení dashboardu

- Každá ze 74 voleb má vlastní český název a vysvětlení.
- Zimní podmínky jsou viditelné přímo u přepínače zimního režimu.
- Společný cenový limit a samostatný limit SolaXu jsou rozlišené.
- Technické parametry jsou oddělené od běžných voleb.
- Časy v milisekundách se v rozhraní zobrazují v sekundách a při uložení převádějí zpět.
- Ukládají se jen změněné hodnoty; načítání nových dat nepřepisuje rozepsané úpravy.
- Uložení vyžaduje potvrzení odpovídajících hodnot z Cerba. Při výpadku spojení se úpravy nezahodí.
- Cerbo nyní přijímá tři dříve nabízené, ale odmítané volby: levný Wattrouter, levný bojler a export po nabití.
- Odstraněno zastaralé upozornění, které popíralo existující zimní zápisy a režim nabíjení.

Dashboard byl ověřen v Edge při šířce 1440 a 390 px.
Ověřeno uložení, zahození změn, přepočet sekund, ovládání klávesnicí a odhalení
chybného pole ve sbalené sekci. Mobilní stránka nemá vodorovný přesah.
Všech šest stránek bylo následně otevřeno ve skutečném FlowFuse runtime,
bez chyb v konzoli prohlížeče. Uložení ve formuláři změnilo nastavení testovacího
Cerba přes skutečné HTTP propojení; potvrzení nebylo podvržené prohlížečem.
Zařízení na hranicích těchto instancí zůstala simulovaná. Snímky jsou v
`output/playwright/settings-real-runtime.png` a `settings-real-runtime-mobile.png`.

## Co vyžaduje skutečné zařízení

- Readback příznaků a fyzický přechod konkrétního Victronu do Passthru.
- Přijetí MQTT zápisů, skutečná VE.Bus instance a přítomnost ESS Assistantu.
- Schopnost konkrétního zapojení vytvořit přetok během zimního spánku.
- Správnost indexů HTTP pole Data konkrétního firmwaru SolaXu.
- Jednotka registru R36. Export přebírá škálu 100 jednotek na 1 A z původního programu.
- Celkový proud při současném nabíjení z více fyzických zdrojů. Limit každého zdroje nenahrazuje koordinaci celé baterie.
- HTTPS konfigurace, tokeny, práva Discord bota a instalované balíčky Node-RED.

Tasmota stránka nadále ukazuje stav posledních potvrzených povelů,
nikoli průběžně měřený fyzický stav všech 24 kontaktů.
Energie bojleru není v dodaném programu měřená; hlášení ji označuje jako neměřenou.
Finanční statistika nadále počítá nákup výchozí sazbou 6 Kč/kWh.
Není náhradou elektroměru ani fakturace dodavatele.

Na skutečné zařízení nebyl odeslán žádný povel a nové flows nebyly nasazeny.
