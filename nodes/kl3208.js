module.exports = function(RED) {
  function KL3208Node(cfg) {
    RED.nodes.createNode(this, cfg);
    const node = this;

    // interleaved mapping: data/control
    const START_INDEX = Number(cfg.startIndex || 1);
    const STEP        = Number(cfg.step || 2);

    // units
    const UNITS = (cfg.units === "F") ? "F" : "C";

    // per-channel sensor + optional custom ranges
    const sensors = [];
    const customMin = [];
    const customMax = [];
    for (let i=1; i<=8; i++) {
      sensors.push(cfg["s"+i] || "NTC10K");
      const minStr = cfg["s"+i+"min"];
      const maxStr = cfg["s"+i+"max"];
      customMin.push(minStr === "" || minStr === undefined ? null : Number(minStr));
      customMax.push(maxStr === "" || maxStr === undefined ? null : Number(maxStr));
    }

    // default preset ranges in °C
    const presetRangesC = {
      "NTC10K": { minC: -40,  maxC: 125 },
      "NTC20K": { minC: -40,  maxC: 125 },
      "PT1000": { minC: -50,  maxC: 200 },
      "PT100":  { minC: -200, maxC: 850 }
    };

    node.status({fill:"grey", shape:"ring", text:`waiting array (start=${START_INDEX}, step=${STEP}, units=${UNITS})`});

    function toSigned16(v) {
      let n = Number(v);
      if (!Number.isFinite(n)) return NaN;
      n = n & 0xFFFF;
      if (n > 0x7FFF) n = n - 0x10000;
      return n;
    }

    function cToF(c) { return (c * 9/5) + 32; }

    function getRangeCForChannel(chIdx) {
      const sensor = sensors[chIdx] || "NTC10K";

      // If "CUSTOM", must supply custom min/max (fall back to NTC10K if missing)
      if (sensor === "CUSTOM") {
        const minC = (customMin[chIdx] == null ? -40 : customMin[chIdx]);
        const maxC = (customMax[chIdx] == null ? 125  : customMax[chIdx]);
        return { minC, maxC, sensor };
      }

      // Otherwise use preset, but allow optional override if provided
      const preset = presetRangesC[sensor] || presetRangesC["NTC10K"];
      const minC = (customMin[chIdx] == null ? preset.minC : customMin[chIdx]);
      const maxC = (customMax[chIdx] == null ? preset.maxC : customMax[chIdx]);
      return { minC, maxC, sensor };
    }

    function convert(rawUnsigned, chIdx) {
      const rangeC = getRangeCForChannel(chIdx); // includes chosen sensor
      const sensor = rangeC.sensor;
      const rawSigned = toSigned16(rawUnsigned); // centi-°C (signed)
      if (!Number.isFinite(rawSigned)) {
        return {
          temp: null, units: UNITS,
          tempC: null, tempF: null,
          rawUnsigned: Number(rawUnsigned),
          rawSignedCenti: null,
          sensor,
          rangeC: { minC: rangeC.minC, maxC: rangeC.maxC },
          rangeF: { minF: Number(cToF(rangeC.minC).toFixed(2)), maxF: Number(cToF(rangeC.maxC).toFixed(2)) },
          state: "invalid"
        };
      }

      const tempC = rawSigned / 100.0;
      const tempF = cToF(tempC);
      const state = (tempC < rangeC.minC || tempC > rangeC.maxC) ? "out_of_range" : "ok";

      return {
        temp: UNITS === "F" ? Number(tempF.toFixed(2)) : Number(tempC.toFixed(2)),
        units: UNITS,
        tempC: Number(tempC.toFixed(2)),
        tempF: Number(tempF.toFixed(2)),
        rawUnsigned: Number(rawUnsigned),
        rawSignedCenti: Number(rawSigned),
        sensor,
        rangeC: { minC: rangeC.minC, maxC: rangeC.maxC },
        rangeF: { minF: Number(cToF(rangeC.minC).toFixed(2)), maxF: Number(cToF(rangeC.maxC).toFixed(2)) },
        state
      };
    }

    function arrayToOutputs(arr) {
      const outs = new Array(8).fill(null);
      for (let ch = 0; ch < 8; ch++) {
        const idx = START_INDEX + ch * STEP;
        if (idx < 0 || idx >= arr.length) {
          const r = getRangeCForChannel(ch);
          outs[ch] = {
            payload: {
              temp: null, units: UNITS,
              tempC: null, tempF: null,
              rawUnsigned: null, rawSignedCenti: null,
              sensor: r.sensor,
              rangeC: { minC: r.minC, maxC: r.maxC },
              rangeF: { minF: Number(cToF(r.minC).toFixed(2)), maxF: Number(cToF(r.maxC).toFixed(2)) },
              state: "missing"
            },
            index: idx, channel: ch+1
          };
          continue;
        }
        const raw = Number(arr[idx]);
        outs[ch] = { payload: convert(raw, ch), index: idx, channel: ch+1 };
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
            outs[ch] = { payload: convert(msg.payload, ch), index: Number(msg.index), channel: ch+1 };
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
