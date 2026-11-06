# Victron: přebytky FV, zimní spánek a diagnostika

Cerbo řídí MultiPlus a přebírá MQTT telemetrii. Proxmox poskytuje Dashboard 2.0,
ceny, předpověď a diagnostické soubory. Soubory flow ponechávají původní názvy
`Cerbo_v166_VICTRON_ESS_JEN_PREBYTKY_FV.json` a
`Proxmox_v166_VICTRON_ESS_JEN_PREBYTKY_FV.json`. Nové části používají verzi 174.

## Provozní pravidla

- Finální cena je `(spot Kč/MWh - poplatek Kč/MWh) / 1000`.
- Běžné cenové povolení i ruční povolení používá ON/ESS a přebytky FV. Samotná záporná cena nevynucuje nabíjení ze sítě.
- Metoda A vybírá cenu do limitu a cíl 100 % SOC.
- Metoda B vybírá nejvyšší cílové SOC ze splněných cenových stupňů. Hlavní limit nesmaže stupně.
- Metoda C vybírá nastavený počet nejlevnějších čtvrthodin každého pražského dne. Shodné ceny rozhoduje čas začátku.
- Den změny času může mít 92 nebo 100 čtvrthodin. Chybějící cena neprodlužuje předchozí interval.
- Ceny, BMS, SOC, noc a přetížení ovlivňují výsledný režim. Tabulka ukazuje cenové povolení, nikoli zaručený nabíjecí proud.
- Nouzový požadavek se zapne při SOC do 10 % a skončí při 15 %. Oba prahy lze nastavit.
- Nouzové nabíjení vyžaduje čerstvá data BMS, povolené nabíjení a kladný limit proudu. Neobchází BMS ani bezpečný režim.
- Při čerstvě potvrzeném odpojení AC vstupu nouzový požadavek ponechá Mode 3, nikoli Charger Only. Požadavek zůstává aktivní.

SOC a skutečný výkon pro řízení pocházejí z vybraných JK BMS. Při výběru všech
BMS musí být dostupný nastavený očekávaný počet. Kladný součet výkonů znamená
tok do baterií. Chybějící nebo zastaralý výkon není nula.

## Zimní spánek

Zimní režim je při prvním spuštění vypnutý. Výchozí práh spánku je 25 % SOC.
Spánek vyžaduje čerstvý skutečný výkon pod 50 W po dobu 60 sekund.
Export do sítě není podmínkou. SOC nad prahem sám spánek nespustí.

Automat uloží původní Optimized režim a vlastnictví změn na disk před prvním
zápisem. Ověří Mode 3 a oba flagy `/Hub4/DisableFeedIn=1` a
`/Hub4/DisableCharge=1`. Potom zapíše `/Settings/CGwacs/Hub4Mode=3`.
Za spánek považuje pouze stav potvrzený MQTT zpětnou vazbou stejného GX a instance.
Nepotvrzený vstup po 60 sekundách zahájí obnovu.

Probuzení vyžaduje novou cenovou hranu: nejprve cenu nad limitem, potom přísně pod
limitem. Rovnost není hrana. Automat obnoví přesně původní Hub4Mode 1 nebo 2.
Teprve po potvrzení obnoví vlastní blokovací flagy. Potom ponechá 180 sekund na
rozběh FV nabíjení. Pokud baterie znovu splní podmínky spánku, znovu usne.
Trvale nízká cena nespouští opakované probouzení.

Nouzový požadavek, vypnutí zimy, ruční povolení, zákaz vybíjení BMS nebo ztráta
potřebných dat zahájí obnovu Optimized. Dokud obnova není potvrzená, zimní automat
blokuje souběžné zápisy Mode z watchdogu a běžného writeru.
Po restartu nejprve obnoví vlastní rozpracovaný zimní stav.

VE.Bus Mode 3 není totéž jako Hub4Mode 3. Automat nepoužívá Mode 4 (Off).
Passthru neznamená nulovou spotřebu měniče. External control vypíná nativní ESS
regulaci a BatteryLife. V tomto režimu nelze spoléhat na řízení maximálního
vybíjecího proudu spravované baterie jako v Optimized.

Pokud program neběží nebo MQTT nefunguje, program nemůže potvrdit ani dokončit
obnovu. Neodstraňujte `winter.json` během vlastněného spánku. Zimní chyba vyžaduje
kontrolu telemetrie a uloženého stavu, nikoli slepý reset měniče.

Zdroj rozhraní: [Victron ESS mode 2 and 3](https://www.victronenergy.com/live/ess:ess_mode_2_and_3).

## Uložení nastavení

Nové Function uzly vyžadují vestavěné Node.js moduly `fs`, `path` a `os`.
Jejich vazby jsou součástí importu (`libs`). Node-RED musí podporovat asynchronní
Function uzly a povolené moduly v záložce Setup. Pokud místní politika moduly
zakazuje, import sám toto nastavení nezmění. Nejdříve schvalte potřebnou konfiguraci.

Datový adresář určuje `VICTRON_AUTOMATION_DIR` nebo interní
`automationDataDir`. Výchozí umístění je `~/.victron-automation` účtu Node-RED.
Na Cerbu zvolte adresář v trvalém zapisovatelném úložišti `/data`, nikoli RAM.
V kontejneru Proxmox použijte trvalý svazek. Adresáře obou runtime jsou oddělené.

Cerbo ukládá veřejná provozní nastavení do `settings.json`. Zápis používá dočasný
soubor, `fsync` a přejmenování. Na Linuxu potvrzuje také adresář.
Odpověď „potvrzeno“ přijde až po dokončení zápisu. Při chybě disku odpoví chybou
a nepoužije nové hodnoty. Po restartu načte soubor až po původní inicializaci.
Hodnoty `0` a `false` se zachovají. Hesla a tokeny do tohoto souboru nepatří.

Při prvním importu bez souboru se převezmou povolené dosavadní hodnoty.
Jednorázově se nastaví nouzová politika 10–15 % a běžné nabíjení pouze z FV.
Po prvním importu proto zkontrolujte celý formulář před zapnutím automatického řízení.

## Diagnostika

Proxmox ukládá změny stavů a pravidelné snímky do `events.jsonl` a tří rotovaných
souborů. Každý soubor má nejvýše 1 MiB. Při souběžném zápisu počítá vynechané
záznamy. Jde o omezené diagnostické okno, nikoli úplný dlouhodobý archiv.

Snímky zahrnují rozhodnutí, BMS, měřený tok, zimní přechody, cenový plán,
spojení, chyby uzlů a stav uložení. Verze a časy běhu pomáhají odlišit restart
automatizace od restartu hostitele. Samotná změna Mode nebo State reboot nedokazuje.
Logger vynechává hesla, tokeny, hlavičky, raw payloady a heslový registr SolaXu.
Při stažení provede redakci znovu.

Dashboard nabízí odkaz `GET /api/diagnostics/download`. Endpoint dědí stávající
ochranu HTTP runtime. Tento import nemění autentizaci. Nevystavujte jej veřejně
bez stávajícího ověřeného zabezpečení. Bundle není důkazem příčiny fyzické závady.

## Kontrolované nasazení

1. Exportujte aktuální flows a zálohujte trvalé datové adresáře obou runtime.
2. Ověřte dostupné moduly, oprávnění k datovým adresářům a MQTT readbacky.
3. Ověřte stávající konfiguraci Victron ESS pro zákaz exportu baterie a nabíjení jen z FV.
4. Ponechte zimní režim vypnutý při prvním importu.
5. Importujte odpovídající JSON na každém zařízení bez slepého smazání ostatních flows.
6. Ověřte MQTT portál, instance, IP adresy a počet JK BMS.
7. Uložte nastavení a ověřte potvrzení zápisu na disku Cerba.
8. Restartujte pouze Node-RED a ověřte zachování nastavení.
9. V diagnostice ověřte čerstvost cen, SOC, výkonu a Hub4 readbacků.
10. Teprve při místním dohledu ověřte jeden zimní cyklus a návrat Optimized.

Tyto změny nebyly nasazené na hardware. Offline test nenahrazuje zkoušku
AC-out, přepnutí při výpadku sítě nebo součinnosti s firmwarem a BMS.
Při návratu starých flows nejprve vypněte zimu a potvrďte obnovený Optimized.
Samotný import starých flows nemusí obnovit nastavení, která vlastní nový automat.

## Sestavení a testy

`runtime/*.js` a `runtime/status.vue` jsou zdroje vložených Function a UI uzlů.
Nasazení používá výsledné JSON soubory, nikoli samostatné soubory `runtime`.

```sh
node build-flows.cjs
node --test winter-regression.cjs
node --test offline-regression.cjs
```

Nová sada ověřuje zimní přechody, nouzové priority, uložení, plán a diagnostiku.
Původní sada má sedm známých dřívějších selhání: detekci výpadku, zavádějící text
watchdogu, měsíční archiv, denní archiv, dvě aktualizační větve a text STOP/AUTO.
Nejsou součástí opravy zimního režimu. Nelze proto tvrdit, že celý projekt má zelené testy.
