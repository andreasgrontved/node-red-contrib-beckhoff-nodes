module.exports = function(RED) {
  function KL3468Node(cfg) {
    RED.nodes.createNode(this, cfg);
    const node = this;

    // Config
    const RAW_MAX     = Number(cfg.rawMax || 32767);
    const CARD_V      = Number(cfg.fullScaleV || 10.0);
    const RANGE       = cfg.range || "0.5-10V";
    const CUSTOM_MINV = Number(cfg.minV || 0.5);
    const CUSTOM_MAXV = Number(cfg.maxV || 10.0);
    const ADAPT_RAW   = Number(cfg.adaptRaw || 1648);
    const ADAPT_TOL   = Number(cfg.adaptTol || 80);
    const DECIMALS    = Number(cfg.decimals || 1);

    node.status({fill:"grey", shape:"ring", text:"waiting array from Modbus"});

    function pickRange() {
      if (RANGE === "0-10V")   return {minV:0.0, maxV:10.0};
      if (RANGE === "2-10V")   return {minV:2.0, maxV:10.0};
      if (RANGE === "custom")  return {minV:CUSTOM_MINV, maxV:CUSTOM_MAXV};
      // default
      return {minV:0.5, maxV:10.0};
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
        range: {minV, maxV},
        meta: {
          rawMax: RAW_MAX,
          fullScaleV: CARD_V,
          adaptRaw: ADAPT_RAW,
          adaptTol: ADAPT_TOL,
          decimals: DECIMALS
        }
      };
    }

    node.on('input', (msg, send, done) => {
      // Accept common shapes: array in msg.payload OR {data:[...]}
      let arr = null;

      if (Array.isArray(msg.payload)) {
        arr = msg.payload;
      } else if (msg && msg.payload && Array.isArray(msg.payload.data)) {
        arr = msg.payload.data;
      } else if (typeof msg.payload === 'number') {
        // Single value: try to dispatch by msg.index (0..7), else output[0]
        const idx = Number(msg.index || 0);
        const out = new Array(8).fill(null);
        out[idx] = Object.assign({}, msg, { payload: convertOne(msg.payload), index: idx });
        node.status({fill:"green", shape:"dot", text:`single ch ${idx+1}: ok`});
        send(out);
        if (done) done();
        return;
      } else {
        node.status({fill:"red", shape:"ring", text:"expect array in payload"});
        node.warn("KL3468: expected array (or {data:[...]}) from Modbus");
        if (done) done();
        return;
      }

      // Process up to 8 channels
      const outMsgs = new Array(8).fill(null);
      const count = Math.min(8, arr.length);

      for (let i = 0; i < count; i++) {
        const raw = Number(arr[i]);
        if (!Number.isFinite(raw)) {
          outMsgs[i] = { payload: { state:"invalid", raw: arr[i], percent:null }, index: i };
          continue;
        }
        const payloadObj = convertOne(raw);

        // Pass through topic & any metadata
        const o = {
          payload: payloadObj,
          index: i
        };
        if (msg.topic !== undefined) o.topic = msg.topic;
        if (msg.address !== undefined) o.address = msg.address;

        outMsgs[i] = o;
      }

      node.status({fill:"green", shape:"dot", text:`processed ${count}/8`});
      send(outMsgs);
      if (done) done();
    });
  }

  RED.nodes.registerType("KL3468", KL3468Node);
};
