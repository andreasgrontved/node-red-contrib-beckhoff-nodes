module.exports = function(RED) {
  function KL3208Node(cfg) {
    RED.nodes.createNode(this, cfg);
    const node = this;

    // Interleaved mapping (data/ctrl like BK9100)
    const START_INDEX = Number(cfg.startIndex || 1);
    const STEP        = Number(cfg.step || 2);

    // Units preference
    const UNITS = (cfg.units === "F") ? "F" : "C";

    // Per-channel sensor types
    const sensors = [
      cfg.s1 || "NTC10K", cfg.s2 || "NTC10K", cfg.s3 || "NTC10K", cfg.s4 || "NTC10K",
      cfg.s5 || "NTC10K", cfg.s6 || "NTC10K", cfg.s7 || "NTC10K", cfg.s8 || "NTC10K"
    ];

    // Ranges used only for validity/out_of_range reporting (base in °C)
    const rangesC = {
      "NTC10K": { minC: -40, maxC: 125 },
      "NTC20K": { minC: -40, maxC: 125 },
      "PT1000": { minC: -50, maxC: 200 }
    };

    node.status({fill:"grey", shape:"ring", text:`waiting array (start=${START_INDEX}, step=${STEP}, units=${UNITS})`});

    function toSigned16(v) {
      let n = Number(v);
      if (!Number.isFinite(n)) return NaN;
      n = n & 0xFFFF;
      if (n > 0x7FFF) n = n - 0x10000;
      return n;
    }

    function cToF(c) {
      return (c * 9/5) + 32;
    }

    function convert(rawUnsigned, sensor) {
      const base = rangesC[sensor] || rangesC["NTC10K"];
      const rawSigned = toSigned16(rawUnsigned);   // centi-°C, signed
      if (!Number.isFinite(rawSigned)) {
        return {
          temp: null, units: UNITS,
          tempC: null, tempF: null,
          rawUnsigned: Number(rawUnsigned),
          rawSignedCenti: null,
          sensor, rangeC: base,
          rangeF: { minF: cToF(base.minC), maxF: cToF(base.maxC) },
          state: "invalid"
        };
      }

      const tempC = rawSigned / 100.0;
      const tempF = cToF(tempC);
      const state = (tempC < base.minC || tempC > base.maxC) ? "out_of_range" : "ok";

      // expose both temps; set "temp" to selected units for easy wiring
      const payload = {
        temp: UNITS === "F" ? Number(tempF.toFixed(2)) : Number(tempC.toFixed(2)),
        units: UNITS,
        tempC: Number(tempC.toFixed(2)),
        tempF: Number(tempF.toFixed(2)),
        rawUnsigned: Number(rawUnsigned),
        rawSignedCenti: Number(rawSigned),
        sensor,
        rangeC: { minC: base.minC, maxC: base.maxC },
        rangeF: { minF: Number(cToF(base.minC).toFixed(2)), maxF: Number(cToF(base.maxC).toFixed(2)) },
        state
      };

      return payload;
    }

    function arrayToOutputs(arr) {
      const outs = new Array(8).fill(null);
      for (let ch = 0; ch < 8; ch++) {
        const idx = START_INDEX + ch * STEP;
        const sensor = sensors[ch];
        if (idx < 0 || idx >= arr.length) {
          const base = rangesC[sensor] || rangesC["NTC10K"];
          outs[ch] = {
            payload: {
              temp: null, units: UNITS,
              tempC: null, tempF: null,
              rawUnsigned: null,
              rawSignedCenti: null,
              sensor,
              rangeC: base,
              rangeF: { minF: Number(cToF(base.minC).toFixed(2)), maxF: Number(cToF(base.maxC).toFixed(2)) },
              state: "missing"
            },
            index: idx,
            channel: ch+1
          };
          continue;
        }
        const raw = Number(arr[idx]);
        const payload = convert(raw, sensor);
        outs[ch] = { payload, index: idx, channel: ch+1 };
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
          node.status({fill:"green", shape:"dot", text:`array → ch 1..8 (${UNITS})`});
          send(outs); return done && done();
        }
        if (msg && msg.payload && Array.isArray(msg.payload.data)) {
          const outs = arrayToOutputs(msg.payload.data);
          node.status({fill:"green", shape:"dot", text:`data[] → ch 1..8 (${UNITS})`});
          send(outs); return done && done();
        }
        if (typeof msg.payload === 'number' && Number.isInteger(msg.index)) {
          const ch = mapSingleIndexToChannel(msg.index);
          const outs = new Array(8).fill(null);
          if (ch >= 0) {
            outs[ch] = {
              payload: convert(msg.payload, sensors[ch]),
              index: Number(msg.index),
              channel: ch+1
            };
            node.status({fill:"green", shape:"dot", text:`single → ch ${ch+1} (${UNITS})`});
          } else {
            node.status({fill:"yellow", shape:"ring", text:`index ${msg.index} not in pattern`});
          }
          send(outs); return done && done();
        }
        node.status({fill:"red", shape:"ring", text:"expected array or number+index"});
        done && done();
      } catch (e) {
        node.status({fill:"red", shape:"dot", text:"error"});
        node.error(e, msg);
        done && done(e);
      }
    });
  }
  RED.nodes.registerType("KL3208", KL3208Node);
};
