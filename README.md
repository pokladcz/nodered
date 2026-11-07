# Victron + SolaX — opravené exporty v167

Tato verze obnovuje kompletní Cerbo z historie dodaného projektu a opravuje
propojení s Proxmoxem. Přidává zimní Passthru podle zadaných podmínek.
Původní soubory ve složce Downloads zůstávají beze změn.

## Soubory

- `Cerbo_v167_ZIMNI_PASSTHRU.json` importujte na Cerbo GX.
- `Proxmox_v167_ZIMNI_PASSTHRU.json` importujte na Proxmox.
- `settings-context.cjs` obsahuje nastavení trvalého kontextu.
- `KONTROLA.md` popisuje opravy, výsledky kontrol a omezení.
- `test/flows.test.mjs` ověřuje logiku bez připojení k zařízení.

## Zimní režim

Volba **Zimní režim** je v nastavení dashboardu. Výchozí hodnota je zapnuto.
Program nepřepíná roční období podle kalendáře. Pravidlo platí, dokud tuto
volbu nevypnete.

| Aktuální stav | Podmínka | Výsledek |
| --- | --- | --- |
| Provoz | SoC < 20 % **a** přetok < 500 W | Uspat Victron |
| Uspáno | Přetok > 500 W **a** cena po provizi > společný cenový limit | Probudit Victron |
| Uspáno | Některá podmínka probuzení neplatí | Zůstat uspán |
| Libovolný | Zimní režim vypnut v nastavení | Ukončit zimní zásah a obnovit původní ESS |

Při přesně 20 % se spánek neaktivuje. Při přesně 500 W nebo ceně rovné
limitu se spánek neuvolní. Import ze sítě znamená přetok 0 W.
Přetok je čistý součet všech fází, nikoli výkon samotných panelů.
Při volbě všech BMS používá rozhodování nejnižší čerstvé SoC.

Spánek zůstává zapamatovaný. Samotný růst SoC ho neukončí.
Chybějící nebo stará cena či měření přetoku ho neukončí.
Zimní spánek má přednost také před starým nouzovým dobíjením 10 → 25 %
a před ručním nabíjením Victronu. Pro ruční nabíjení nejprve vypněte zimní režim.
Ochrany uvnitř Victronu a BMS zůstávají účinné.

Program zapisuje skutečné příznaky:

- `/Hub4/DisableCharge = 1`
- `/Hub4/DisableFeedIn = 1`

Oba příznaky blokují nabíjení přes Multi a dodávku ze střídače.
Samostatný MPPT ani samostatný SolaX tím nejsou vypnuté.
Program nepoužívá neexistující `/Hub4/DisableDischarge`.
Polohu přepínače Multi drží na `Mode = 3` — On.
To je jiná veličina než **režim řízení ESS**.

Pro zimní zásah program dočasně přepne režim řízení ESS na externí.
Před první změnou uloží původní režim do trvalého deníku.
Po probuzení uvolní své dva zákazy a obnoví původní režim ESS.
Žádné výkonové setpointy jednotlivých fází neposílá.
Pokud ESS již řídí jiný externí regulátor, program ho nepřevezme.

Za potvrzené uspání považuje až čerstvý readback obou zákazů, externí ESS,
polohu On a stav **Passthru — State 8**. Dashboard ukazuje čekání i potvrzení.
Při výpadku sítě může Victron podle své vestavěné logiky napájet zálohovaný výstup.
Zimní Passthru neznamená fyzické vypnutí měniče ani nulovou vlastní spotřebu.

Pokud při uspání nemůže vzniknout přetok z jiného zdroje, podmínka probuzení
nemusí nikdy nastat. Typicky jde o zapojení pouze s DC panely za uspaným Victronem.
Pravidlo zde zůstává přesně podle zadání; výroba panelů ho nenahrazuje.

Oficiální popis příznaků, Passthru a výpadku sítě:
[Victron ESS mode 2 and 3](https://www.victronenergy.com/live/ess:ess_mode_2_and_3).

## Import

1. Zálohujte aktuální flows a nastavení obou instalací Node-RED.
2. Na Cerbu ověřte ESS Assistant a běžný nativní režim ESS, nikoli cizí externí regulátor.
3. Na Cerbu nastavte níže uvedený trvalý kontext **před aktivací nového flow**.
4. Na Proxmoxu zapněte trvalý kontext pro nastavení a měsíční statistiky.
5. Na Proxmoxu nainstalujte `@flowfuse/node-red-dashboard` a `node-red-contrib-discord-advanced`.
6. Nahraďte původní flows odpovídajícími exporty v167. Nenechávejte běžet dvě verze writerů současně.
7. V konfiguraci **Solar Bot** zadejte Discord token. V portálu Discordu povolte Message Content Intent.
8. Ověřte MQTT na Cerbu a adresy uvedené níže. Proveďte úplný Deploy.
9. V nastavení zadejte skutečný očekávaný počet BMS; výchozí hodnota je dvě.
10. Na dashboardu ověřte BMS, ceny, skutečný přetok a stav zimního řízení.

Ověření na skutečném zařízení není součástí lokálních testů.
Změny firmwaru, režimu ESS nebo zapojení mohou ovlivnit fyzický výsledek.
První přechod do Passthru i probuzení zkontrolujte přímo na Cerbu.

### Trvalý kontext

Soubor `settings-context.cjs` zkopírujte vedle stávajícího `settings.js` Node-RED.
Do existujícího exportovaného objektu v `settings.js` přidejte nebo slučte:

```js
contextStorage: require('./settings-context.cjs'),
```

Nenahrazujte celý stávající `settings.js`. Zachovejte jeho ostatní nastavení
a případná další úložiště. Po úpravě restartujte Node-RED.

Úložiště `winter` používá samostatný adresář `winter-context` a `cache: false`.
Dvě úložiště `localfilesystem` nesmějí zapisovat do stejného adresáře: běžná
mezipaměť by mohla přepsat zimní deník. Použijte celý dodaný `settings-context.cjs`.
Zimní writer čeká na dokončení zápisu
před změnou ESS. Běžná nastavení používají úložiště `file` s běžnou mezipamětí.
Jeho poslední změny se při náhlém výpadku mohou ztratit před zápisem mezipaměti.
Správná konfigurace pojmenovaného úložiště je nutná; některé verze Node-RED
při chybějícím názvu úložiště použijí výchozí kontext.

**Aktualizace již běžící starší verze v167:** ještě se starými flows a původním
kontextem vypněte zimní režim a počkejte na potvrzené obnovení původního nativního
ESS a ukončení zimního zásahu. Dokud obnova není potvrzená, cestu úložiště neměňte.
Potom zastavte Node-RED, zálohujte jeho kontext i flows, nahraďte konfiguraci
kontextu a oba exporty a znovu spusťte Node-RED. Po kontrole telemetrie lze zimní
režim opět zapnout. Samotné přesměrování úložiště při aktivním spánku by skrylo
deník potřebný k obnově ESS.

Proces Node-RED na Proxmoxu musí mít časové pásmo `Europe/Prague`.
To určuje časy plánovaných zpráv Discordu.

### Adresy a přístupy

Výchozí adresy odpovídají původnímu exportu:

| Služba | Adresa |
| --- | --- |
| Cerbo API | `https://192.168.0.124:1881` |
| SolaX HTTP telemetrie | `http://192.168.0.156/api/realTimeData.htm` |
| SolaX Modbus | `192.168.0.155:502` |
| MQTT na Cerbu | `localhost:1883` |

Nastavení HTTPS serveru, certifikátu a portu Cerba není součástí JSON exportu.
Proxmox používá původní důvěru k self-signed certifikátu Cerba.
Pokud máte jiný host, port nebo protokol, změňte konfiguraci před Deploy.
Tasmota proxy používá stejné nastavení hostu, portu a protokolu Cerba jako ostatní požadavky.

Export neobsahuje přístupové tokeny. Na Proxmoxu nastavte proměnnou prostředí
`ENERSPOT_TOKEN` pro službu Node-RED a službu restartujte. Zachována je také
kompatibilita s již nastaveným globálním kontextem `enerspotToken`, který má přednost.
Bez tokenu se ceny nestahují; uzel Enerspot URL hlásí chybějící token.
Discord token zadejte do konfigurace Solar Bot v editoru Node-RED.
Tokeny neukládejte do exportů ani do Gitu.
Přístup k ovládacím API chraňte v konfiguraci Node-RED nebo v reverzní proxy.
JSON flow samo nenastavuje autentizaci HTTP serveru.

## Kontrola bez hardwaru

Z kořene projektu spusťte:

```powershell
rtk proxy node --test test/flows.test.mjs test/settings-ui.test.mjs
```

Testy spouštějí skutečný kód uzlů nad řízenými vstupy a časem.
Neposílají požadavky na měniče, relé, Discord ani cenové API.

Při celkové kontrole prošlo 59 automatických testů a 13 integračních scénářů
ve dvou skutečných instancích Node-RED 5.0.9 s FlowFuse Dashboard 1.36.0.
Simulované byly hranice zařízení a externích služeb; HTTP propojení Cerba
s Proxmoxem a dashboard běžely skutečně. V prohlížeči bylo ověřeno všech šest
stránek, uložení potvrzené Cerbem, výpadek spojení i mobilní zobrazení.
Zimní deník přežil restart procesu a umožnil obnovit původní ESS.
Výsledky jsou v `output/OVERENI.json`; fyzická FVE při testu připojená nebyla.

## Přehlednější nastavení dashboardu

Stránka nastavení má srozumitelné české popisky, jednotky a vysvětlení každé volby.
Zimní režim ukazuje obě podmínky uspání a probuzení vedle sebe.
Spotřebiče mají vlastní rozbalovací sekce. Adresy a ochranné časy jsou mezi technickými volbami.
Časy původně zadávané v milisekundách se zobrazují v sekundách; program nadále ukládá stejné jednotky jako dříve.

Tlačítko **Uložit změny** odesílá jen upravené hodnoty.
Potvrzení se zobrazí až po načtení odpovídajících hodnot z Cerba.
Pokud potvrzení do 20 sekund nepřijde, formulář zachová úpravy a dovolí další pokus.
Při nedostupném Cerbu zůstanou rozepsané hodnoty viditelné, ale úpravy a ukládání
se zablokují. Po obnovení spojení se rozepsané změny neztratí.
Tlačítko **Zahodit změny** načte aktuální uložené hodnoty, nikoli výchozí nastavení.

Pro tuto úpravu nahraďte oba exporty v167. Na Cerbu byl doplněn seznam povolených
nastavení pro Wattrouter, bojler a export po nabití. Samotná řídicí pravidla se nezměnila.
