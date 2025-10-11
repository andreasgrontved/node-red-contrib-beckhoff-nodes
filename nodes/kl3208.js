/**
 * KL3208 — 8-ch analog input (e.g., temperature/voltage), supports interleaved status+data
 * Inputs:
 *   - Config from BK9100 Rack: msg.config = {
 *       map: { startIndex, step, pattern },
 *       settings: { scalePreset, rawMin, rawMax, engMin, engMax, units, decimals, deadband, filterTau, alarmLow, alarmHigh }
 *     }
 *   - Data frame: msg.payload is an Array of register words (Number)
 * Outputs (8):
 *   - One per channel: { payload: <scaled value>, raw, dataWord, statusWord, units, channel, index, alarms:{low,high} }
 */
module.exports = function(RED){
  function KL3208Node(cfg){
    RED.nodes.createNode(this, cfg);
    const node = this;

    // Defaults (will be overridden by msg.config/map from the Rack)
    const CHANNELS = Number(cfg.channels || 8);
    let MAP = {
      startIndex: Number(cfg.startIndex || 1), // e.g., data at 1,3,5,...
      step: Number(cfg.step || 2),             // stride between data words
      pattern: cfg.pattern || "interleaved-status-data" // or "contiguous"
    };
    let SETTINGS = {
      scalePreset: cfg.scalePreset || "none",
      rawMin: Number(cfg.rawMin ?? 0),
      rawMax: Number(cfg.rawMax ?? 65535),
      engMin: Number(cfg.engMin ?? 0),
      engMax: Number(cfg.engMax ?? 10),
      units: cfg.units || "",
      decimals: Number(cfg.decimals ?? 2),
      deadband: Number(cfg.deadband ?? 0),
      filterTau: Number(cfg.filterTau ?? 0),
      alarmLow: (cfg.alarmLow === "" || cfg.alarmLow === undefined) ? null : Number(cfg.alarmLow),
      alarmHigh: (cfg.alarmHigh === "" || cfg.alarmHigh === undefined) ? null : Number(cfg.alarmHigh)
    };

    // Per-channel state for LPF + deadband
    const lpfState = new Array(CHANNELS).fill(null);
    const lastOut  = new Array(CHANNELS).fill(null);

    // Helpers
    function applyPreset(s){
      const out = { ...s };
      switch(out.scalePreset){
        case "0-10V":    out.rawMin=0; out.rawMax=65535; out.engMin=0; out.engMax=10; out.units="V"; break;
        case "0-5V":     out.rawMin=0; out.rawMax=65535; out.engMin=0; out.engMax=5;  out.units="V"; break;
        case "4-20mA":   out.rawMin=0; out.rawMax=65535; out.engMin=4; out.engMax=20; out.units="mA"; break;
        case "-50..150C":out.rawMin=0; out.rawMax=65535; out.engMin=-50; out.engMax=150; out.units="°C"; break;
        default: /* none */ break;
      }
      return out;
    }

    function scaleRaw(raw, s0){
      const s = applyPreset(s0);
      const frac = (Number(raw) - s.rawMin) / (s.rawMax - s.rawMin);
      let eng = s.engMin + frac * (s.engMax - s.engMin);
      if (Number.isFinite(s.decimals)) eng = Number(eng.toFixed(s.decimals));
      return { value: eng, units: s.units || "" };
    }

    function lpf(x, ch){
      const tau = Number(SETTINGS.filterTau || 0);
      if (!tau) return x;
      // Simple exponential smoother; for better accuracy use dt-aware alpha
      const prev = (lpfState[ch] == null) ? x : lpfState[ch];
      const alpha = 1 / Math.max(1, tau);
      const y = prev + alpha * (x - prev);
      lpfState[ch] = y;
      return y;
    }

    function applyDeadband(v, ch){
      const db = Number(SETTINGS.deadband || 0);
      const prev = lastOut[ch];
      if (prev == null || Math.abs(v - prev) >= db){
        lastOut[ch] = v;
      }
      return lastOut[ch];
    }

    function evaluateAlarms(v){
      const lo = SETTINGS.alarmLow;
      const hi = SETTINGS.alarmHigh;
      return {
        low:  (lo != null && v < lo) || false,
        high: (hi != null && v > hi) || false
      };
    }

    function calcDataIndex(ch){
      return MAP.startIndex + ch * MAP.step;
    }
    function calcStatusIndex(ch){
      if (MAP.pattern === "interleaved-status-data") return calcDataIndex(ch) - 1;
      return null;
    }

    node.on("input", (msg, send, done) => {
      try {
        // 1) Config updates from Rack
        if (msg && msg.config){
          if (msg.config.map){
            if (Number.isFinite(msg.config.map.startIndex)) MAP.startIndex = Number(msg.config.map.startIndex);
            if (Number.isFinite(msg.config.map.step))       MAP.step       = Number(msg.config.map.step);
            if (msg.config.map.pattern)                     MAP.pattern    = String(msg.config.map.pattern);
          }
          if (msg.config.settings){
            SETTINGS = { ...SETTINGS, ...msg.config.settings };
          }
          node.status({fill:"blue", shape:"dot", text:`map s=${MAP.startIndex} step=${MAP.step}`});
          done && done();
          return;
        }
        // Backward-compat: accept msg.map directly
        if (msg && msg.map){
          if (Number.isFinite(msg.map.startIndex)) MAP.startIndex = Number(msg.map.startIndex);
          if (Number.isFinite(msg.map.step))       MAP.step       = Number(msg.map.step);
          if (msg.map.pattern)                     MAP.pattern    = String(msg.map.pattern);
          node.status({fill:"blue", shape:"dot", text:`map s=${MAP.startIndex} step=${MAP.step}`});
          done && done();
          return;
        }

        // 2) Data frame
        const arr = Array.isArray(msg.payload) ? msg.payload : (Array.isArray(msg.registers) ? msg.registers : null);
        if (!arr){
          node.status({fill:"yellow", shape:"ring", text:"no data array"});
          done && done();
          return;
        }

        const outs = new Array(CHANNELS).fill(null);
        for (let ch = 0; ch < CHANNELS; ch++){
          const dataIdx   = calcDataIndex(ch);
          const statusIdx = calcStatusIndex(ch);

          const dataWord   = arr[dataIdx];
          const statusWord = (statusIdx != null ? arr[statusIdx] : undefined);

          const { value: eng, units } = scaleRaw(dataWord, SETTINGS);
          const filtered = lpf(eng, ch);
          const finalVal = applyDeadband(filtered, ch);
          const alarms   = evaluateAlarms(finalVal);

          outs[ch] = {
            payload: finalVal,
            raw: Number(dataWord),
            dataWord: Number(dataWord),
            statusWord: (statusWord == null ? null : Number(statusWord)),
            units,
            channel: ch,
            index: dataIdx,
            alarms
          };
        }
        node.status({fill:"green", shape:"dot", text:`ok ${CHANNELS}ch s=${MAP.startIndex} stp=${MAP.step}`});
        send(outs);
        done && done();
      } catch (e){
        node.status({fill:"red", shape:"dot", text:"error"});
        node.error(e, msg);
        done && done(e);
      }
    });
  }
  RED.nodes.registerType("KL3208", KL3208Node);
};
