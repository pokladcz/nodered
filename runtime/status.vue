<template>
  <section class="winter-evidence" aria-label="Plan a diagnostika nabijeni">
    <h2>Plán a diagnostika nabíjení</h2>
    <p v-if="!p.chargePlan">Čekám na plán z Cerba. Chybějící data nejsou nulová výroba.</p>
    <div class="winter-evidence-grid">
      <div><h3>Zimní režim</h3><p><strong>{{ winter.enabled ? 'Povolen' : 'Vypnut' }}</strong> · {{ winter.phase || 'neznámý stav' }}</p>
        <p>{{ winter.reason || 'Čekám na zpětnou vazbu' }}</p>
        <p v-if="winter.ts">Poslední stav z Cerba: {{ time(winter.ts) }}.</p>
        <p v-if="p.bridge?.online === false" class="winter-evidence-error" role="alert">Spojení s Cerbem není potvrzené. Zobrazený stav nemusí být aktuální.</p>
        <p>Potvrzený spánek: {{ winter.confirmed === true ? 'ano' : 'ne' }}. Příkon baterie: {{ number(winter.batteryPowerW, 0) }} W.</p>
        <p>Nabíjecí tok nad nastaveným prahem: {{ winter.charging === true ? 'ano' : winter.charging === false ? 'ne' : 'neznámý' }}.</p>
        <p v-if="winter.graceUntil">Rozběh nabíjení do {{ time(winter.graceUntil) }}.</p>
        <p v-if="winter.fault" class="winter-evidence-error" role="alert">{{ winter.fault }}</p>
      </div>
      <div><h3>Uložení a záznamy</h3><p :class="{ 'winter-evidence-error': p.persistence?.ok === false }">Nastavení na disku Cerba: {{ p.persistence?.ok === true ? 'potvrzeno' : 'nepotvrzeno' }}.</p>
        <p v-if="p.persistence?.ts">Poslední potvrzení {{ time(p.persistence.ts) }}.</p>
        <p :class="{ 'winter-evidence-error': p.diagnostics?.ok === false }">Zápis diagnostiky na Proxmox: {{ p.diagnostics?.ok === true ? 'OK' : 'nepotvrzen' }}.</p>
        <p v-if="p.diagnostics?.error" role="alert">{{ p.diagnostics.error }}</p>
        <a href="/api/diagnostics/download" download>Stáhnout očištěnou diagnostiku</a>
        <p>Nejvýše 4 soubory po 1 MiB. Bez hesel, tokenů a HTTP hlaviček.</p>
      </div>
    </div>
    <template v-if="p.chargePlan">
      <h3>Metoda {{ p.chargePlan.method }} · následující vybrané intervaly</h3>
      <p :class="{ 'winter-evidence-error': !p.chargePlan.sourceFresh }">Cenová data: {{ p.chargePlan.sourceFresh ? 'čerstvá' : 'neplatná nebo zastaralá; cenové povolení je blokované' }}.</p>
      <p>{{ p.chargePlan.note }}</p>
      <p>Tabulka ukazuje cenový výběr, nikoli příkaz nabíjet ze sítě. SOC, noc, zima, přetížení a BMS rozhodují také.</p>
      <p v-for="d in p.chargePlan.days" :key="d.date">{{ d.date }}: vybráno {{ d.selectedIntervals }} z {{ d.availableIntervals }} dostupných čtvrthodin.</p>
      <div class="winter-evidence-table" tabindex="0" aria-label="Vybrane cenove intervaly">
        <table><thead><tr><th>Od (Praha)</th><th>Do</th><th>Kč/kWh</th><th>Cílové SOC</th><th>Nynější SOC pod cílem</th></tr></thead>
          <tbody><tr v-for="row in selected" :key="row.from" :class="{ 'winter-evidence-current': row.active }"><td>{{ time(row.from) }}</td><td>{{ time(row.to) }}</td><td>{{ number(row.finalKcKwh, 4) }}</td><td>{{ number(row.targetSoc, 0) }} %</td><td>{{ row.eligible ? 'ano' : 'ne / blokováno' }}</td></tr></tbody>
        </table>
      </div>
      <p v-if="!selected.length">Ve známých budoucích intervalech není nic vybráno. Zítřejší ceny mohou ještě chybět.</p>
    </template>
  </section>
</template>
<script>
export default {
  computed: {
    p() { return this.msg?.payload || {}; },
    winter() { return this.p.winterControl || {}; },
    selected() { return (this.p.chargePlan?.intervals || []).filter(row => row.selected); }
  },
  methods: {
    number(value, digits) { return value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? '—' : Number(value).toLocaleString('cs-CZ', { minimumFractionDigits: digits, maximumFractionDigits: digits }); },
    time(value) { const d = new Date(value); return Number.isFinite(d.getTime()) ? d.toLocaleString('cs-CZ', { timeZone: 'Europe/Prague', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }) : '—'; }
  }
};
</script>
<style>
.winter-evidence { padding: 16px; line-height: 1.5; color: inherit; }
.winter-evidence h2 { font-size: 1.35rem; margin: 0 0 16px; }
.winter-evidence h3 { font-size: 1.05rem; margin: 12px 0 6px; }
.winter-evidence p { margin: 6px 0 10px; max-width: 80ch; }
.winter-evidence-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px; }
.winter-evidence-error { color: #cf4747; font-weight: 700; }
.winter-evidence-table { overflow-x: auto; max-height: 420px; margin-top: 12px; }
.winter-evidence table { width: 100%; border-collapse: collapse; text-align: left; font-variant-numeric: tabular-nums; }
.winter-evidence th, .winter-evidence td { padding: 10px; border-bottom: 1px solid #80808060; white-space: nowrap; }
.winter-evidence-current { background: #438ab329; }
.winter-evidence a { color: #2879b0; text-decoration: underline; }
.winter-evidence a:focus-visible, .winter-evidence-table:focus-visible { outline: 3px solid #438ab3; outline-offset: 3px; }
@media (max-width: 640px) { .winter-evidence-grid { grid-template-columns: 1fr; gap: 8px; } .winter-evidence { padding: 10px; } }
</style>
