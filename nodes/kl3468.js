module.exports = function(RED) {
  function KL3468Node(cfg) {
    RED.nodes.createNode(this, cfg);
    const node = this;

    // Fixed hardware constants
    const RAW_MAX  = 32767;   // 16-bit Beckhoff raw
    const CARD_V   = 10.0;    // KL3468 measures 0..10 V

    // User config
    const RANGE       = cfg.range || "0.5-10V";
    const CUSTOM_MINV = Number(cfg.minV || 0.5);
    const CUSTOM_MAXV = Number(cfg.maxV || 10.0);
    const ADAPT_RAW   = Number(cfg.adaptRaw || 1648);
    const ADAPT_TOL   = Number(cfg.adaptTol || 80);
    const DECIMALS    = Number(cfg.decimals || 1);

    // Interleaved mapping
    const START_INDEX = Number(cfg.startIndex || 1); // first data word
    const STEP        = Number(cfg.step || 2);       // stride between data words

    node.status({fill:"grey", shape:"ring", text:"waiting array"});

    function pickRange() {
      if (RANGE === "0-10V")   return { minV: 0.0, maxV: 10.0 };
      if (RANGE === "2-10V")   return { minV: 2.0, maxV: 10.0 };
      if (RANGE === "custom")  return { minV: CUSTOM_MINV, maxV: CUSTOM_MAXV };
      return { minV: 0.5, maxV: 10.0 }; // default 0.5–10V
    }

    function rawToVolts(raw) {
      return (Number(raw) / RAW_MAX) * CARD_V;
    }

    function toPercent(v, minV, maxV) {
      if (maxV <= minV) return null;
      let p = ((v - minV) / (maxV - minV)) * 100.0;
      p = Math.max(0, Math.min(100, p));
      return Number(p.toFixed(DECIMALS));
    }

    function convertOne(raw) {
      const {minV, maxV} = pickRange();
      const adapting = Math.abs(Number(raw) - ADAPT_RAW) <= ADAPT_TOL;
      const volts = rawToVolts(raw);
      const percent = adapting ? null : toPercent(volts, minV, maxV);
      return {
        state: adapting ? "adapting" : "ok",
        raw: Number(raw),
        volts: Number(volts.toFixed(3)),
        percent,
        range: { minV, maxV },
        meta: {
          adaptRaw: ADAPT_RAW,
          adaptTol: ADAPT_TOL,
          decimals: DECIMALS,
          startIndex: START_INDEX,
          step: STEP
        }
      };
    }

    function arrayToOutputs(arr) {
      const outs = new Array(8).fill(null);
      for (let ch = 0; ch < 8; ch++) {
        const idx = START_INDEX + ch * STEP;
        if (idx < 0 || idx >= arr.length) {
          outs[ch] = { payload: { state:"missing", raw:null, volts:null, percent:null }, index: idx };
          continue;
        }
        const raw = Number(arr[idx]);
        if (!Number.isFinite(raw)) {
          outs[ch] = { payload: { state:"invalid", raw:arr[idx], volts:null, percent:null }, index: idx };
          continue;
        }
        outs[ch] = { payload: convertOne(raw), index: idx };
      }
      return outs;
    }

    function mapSingleIndexToChannel(i) {
      const diff = Number(i) - START_INDEX;
      if (STEP <= 0) return -1;
      if (diff < 0 || diff % STEP !== 0) return -1;
      const ch = diff / STEP;
      return (ch >= 0 && ch < 8) ? ch : -1;
    }

    node.on('input', (msg, send, done) => {
      try {
        if (Array.isArray(msg.payload)) {
          const outs = arrayToOutputs(msg.payload);
          node.status({fill:"green", shape:"dot", text:`array → ch 1..8 (start=${START_INDEX}, step=${STEP})`});
          send(outs); return done && done();
        }
        if (msg && msg.payload && Array.isArray(msg.payload.data)) {
          const outs = arrayToOutputs(msg.payload.data);
          node.status({fill:"green", shape:"dot", text:"data[] → ch 1..8"});
          send(outs); return done && done();
        }
        if (typeof msg.payload === 'number') {
          const ch = mapSingleIndexToChannel(msg.index);
          const outs = new Array(8).fill(null);
          if (ch >= 0) {
            outs[ch] = { payload: convertOne(msg.payload), index: Number(msg.index) };
            node.status({fill:"green", shape:"dot", text:`single → ch ${ch+1}`});
          } else {
            node.status({fill:"yellow", shape:"ring", text:`index ${msg.index} not in pattern`});
          }
          send(outs); return done && done();
        }
        node.status({fill:"red", shape:"ring", text:"expected array or number"});
        done && done();
      } catch (e) {
        node.status({fill:"red", shape:"dot", text:"error"});
        node.error(e, msg);
        done && done(e);
      }
    });
  }
  RED.nodes.registerType("KL3468", KL3468Node);
};
