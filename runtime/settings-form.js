export default {
  data() {
    return { draft: {}, editing: false, lastCfg: '', saveState: '', saveError: '', saveRequestId: null,
      saveStartedAt: 0, saveSnapshot: '', saveTimer: null, lastAckTs: null };
  },
  computed: {
    schema() { return Array.isArray(this.msg?.payload?.settingsSchema) ? this.msg.payload.settingsSchema : []; },
    groups() { return [...new Set(this.schema.map(f => f.group))]; },
    priceOk() { return this.msg?.payload?.priceStatus?.ok === true; },
    priceText() {
      const raw = this.msg?.payload?.currentPrice?.final;
      const n = raw === null || raw === undefined || raw === '' ? NaN : Number(raw);
      return Number.isFinite(n) ? new Intl.NumberFormat('cs-CZ', { minimumFractionDigits: 4, maximumFractionDigits: 4 }).format(n) + ' Kč/kWh' : 'Cena Enerspot není dostupná';
    },
    priceInfo() {
      const p = this.msg?.payload?.priceStatus || {};
      return p.ok ? 'Enerspot OK · ' + (p.count ?? '—') + ' intervalů · stáří ' + (p.ageMin ?? '—') + ' min' : (p.lastError || 'čekám na aktuální interval');
    },
    isSaving() { return this.saveState === 'pending'; },
    saveInfo() {
      if (this.isSaving) return 'Čekám na potvrzení zápisu na Cerbu…';
      if (this.saveState === 'error' || this.saveState === 'timeout') return this.saveError;
      const stateTs = this.msg?.payload?.settingsLastSaveTs || this.msg?.payload?.persistence?.ts;
      const ts = this.lastAckTs && !(Date.parse(stateTs) >= Date.parse(this.lastAckTs)) ? this.lastAckTs : stateTs;
      if (this.saveState === 'saved') return 'Uloženo na disku Cerba ' + new Date(ts).toLocaleString('cs-CZ');
      return ts ? 'Poslední potvrzení na disku ' + new Date(ts).toLocaleString('cs-CZ') : 'Zatím bez potvrzení uložení';
    }
  },
  mounted() { this.saveTimer = setInterval(() => this.checkSaveTimeout(), 1000); },
  beforeUnmount() { clearInterval(this.saveTimer); },
  watch: {
    msg: { immediate: true, deep: false, handler() {
      this.receiveSaveResult(); this.checkSaveTimeout();
      if (!this.editing && !this.isSaving) this.loadFromMsg();
    } }
  },
  methods: {
    fields(group) { return this.schema.filter(f => f.group === group); },
    loadFromMsg() {
      if (this.lastAckTs && !(Date.parse(this.msg?.payload?.persistence?.ts) >= Date.parse(this.lastAckTs))) return;
      const cfg = this.msg?.payload?.cfg;
      if (!cfg) return;
      const next = Object.fromEntries(this.schema.map(f => [f.key, cfg[f.key] === undefined ? f.def : cfg[f.key]]));
      const encoded = JSON.stringify(next);
      if (encoded !== this.lastCfg) { this.draft = next; this.lastCfg = encoded; }
    },
    reload() {
      if (this.isSaving) return;
      this.editing = false; this.lastCfg = ''; this.saveRequestId = null; this.saveState = ''; this.loadFromMsg();
    },
    checkSaveTimeout() {
      if (this.isSaving && Date.now() - this.saveStartedAt >= 15000) {
        this.saveState = 'timeout';
        this.saveError = 'Potvrzení zápisu z Cerba nedorazilo. Změny zůstávají ve formuláři; uložení není potvrzené.';
      }
    },
    receiveSaveResult() {
      const p = this.msg?.payload || {}, result = p.settingsSaveResult;
      if (!this.saveRequestId || result?.requestId !== this.saveRequestId) return;
      if (result.ok !== true) {
        this.saveState = 'error'; this.saveError = 'NEULOŽENO: ' + result.text; this.saveRequestId = null;
        return;
      }
      // An older in-flight state poll must not replace the just-acknowledged configuration.
      if (p.persistence?.ok !== true || !result.savedAt || Date.parse(p.persistence.ts) < Date.parse(result.savedAt) || !Number.isFinite(Date.parse(p.persistence.ts))) return;
      this.saveState = 'saved'; this.saveRequestId = null; this.lastAckTs = result.savedAt;
      if (JSON.stringify(this.draft) === this.saveSnapshot) { this.editing = false; this.lastCfg = ''; }
    },
    save() {
      if (this.isSaving) return;
      const out = {};
      for (const f of this.schema) {
        let value = this.draft[f.key];
        if (f.type === 'bool') value = !!value;
        else if (f.type === 'number') {
          value = Number(value); if (!Number.isFinite(value)) value = f.def;
          if (Number.isFinite(Number(f.min))) value = Math.max(Number(f.min), value);
          if (Number.isFinite(Number(f.max))) value = Math.min(Number(f.max), value);
        } else if (f.type === 'select') value = (f.options || []).find(o => String(o.value) === String(value))?.value ?? f.def;
        else value = String(value ?? f.def ?? '').trim();
        out[f.key] = value;
      }
      this.draft = { ...out }; this.editing = true; this.saveSnapshot = JSON.stringify(out);
      this.saveRequestId = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
      this.saveStartedAt = Date.now(); this.saveState = 'pending'; this.saveError = '';
      this.send({ payload: { action: 'save_settings', requestId: this.saveRequestId, settings: out } });
    }
  }
};
