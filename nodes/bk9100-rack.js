
module.exports = function(RED){
  function BK9100RackNode(cfg){
    RED.nodes.createNode(this, cfg);
    const node = this;

    const baseAddress = Number(cfg.baseAddress || 0);
    const cards = Array.isArray(cfg.cards) ? cfg.cards : [];

    function typeDefaults(type){
      if (type === "KL1808") {
        return { channels: 8, wordsPerChannel: 1, register: "discrete-inputs", pattern: "contiguous" };
      }
      if (type === "KL3468") {
        return { channels: 8, wordsPerChannel: 2, register: "input-registers", pattern: "interleaved-status-data" };
      }
      // KL3208
      return { channels: 8, wordsPerChannel: 2, register: "input-registers", pattern: "interleaved-status-data" };
    }

    function toFC(register){
      switch (register){
        case "coils": return 1;
        case "discrete-inputs": return 2;
        case "holding-registers": return 3;
        case "input-registers": return 4;
        default: return null;
      }
    }

    function computeSlices(){
      let cur = baseAddress;
      const out = [];
      for (const c of cards){
        const d = Object.assign({}, typeDefaults(c.type||"KL3208"), c);
        const quantity = Number(d.channels) * Number(d.wordsPerChannel);
        const start = cur;
        cur += quantity;

        // map hints for card nodes
        const map = (d.pattern === "interleaved-status-data")
          ? { startIndex: 1, step: 2, pattern: d.pattern }
          : { startIndex: 0, step: 1, pattern: d.pattern };

        out.push({
          type: d.type || "KL3208",
          label: d.label || "",
          channels: Number(d.channels),
          modbus: { register: d.register, start, quantity, fc: toFC(d.register) },
          map
        });
      }
      return out;
    }

    function sendAll(){
      const slices = computeSlices();
      const outs = slices.map(s => ({ payload: { command:"config", ...s }, config: s }));
      // ensure outputs length
      const max = Math.max(1, (node.outputs || slices.length));
      while (outs.length < max) outs.push(null);
      node.status({fill:"green", shape:"dot", text:`mapped ${slices.length} card(s) from ${baseAddress}`});
      node.send(outs);
    }

    // On deploy: emit once
    setTimeout(sendAll, 25);

    node.on("input", (msg, send, done) => {
      try {
        sendAll();
        done && done();
      } catch (e) {
        node.status({fill:"red", shape:"dot", text:"error"});
        node.error(e, msg);
        done && done(e);
      }
    });
  }
  RED.nodes.registerType("BK9100 Rack", BK9100RackNode);
};
