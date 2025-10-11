module.exports = function(RED){
  function BK9100Node(cfg){
    RED.nodes.createNode(this, cfg);
    const node = this;

    const cards = Array.isArray(cfg.cards) ? cfg.cards : [];

    // Build matchers once
    const matchers = cards.map((c, index) => {
      const type = (c.type || "").trim();
      const label = c.label || "";
      const filt = (c.topic || "").trim();

      let kind = "exact";
      let re = null;
      let exact = null;

      if (filt) {
        if (filt.startsWith("/") && filt.endsWith("/")) {
          // regex delimiter style
          const body = filt.slice(1, -1);
          re = new RegExp(body);
          kind = "regex";
        } else if (filt.includes("*")) {
          // wildcard -> regex
          const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const rx = "^" + filt.split("*").map(esc).join(".*") + "$";
          re = new RegExp(rx);
          kind = "wildcard";
        } else {
          exact = filt;
          kind = "exact";
        }
      }

      return {
        index,
        type,
        label,
        kind,
        exact,
        re
      };
    });

    function findOutputForTopic(topic) {
      // Priority 1: explicit filter match
      for (const m of matchers) {
        if (m.kind === "regex"   && m.re.test(topic)) return m.index;
        if (m.kind === "wildcard"&& m.re.test(topic)) return m.index;
        if (m.kind === "exact"   && m.exact && topic === m.exact) return m.index;
      }
      // Priority 2: type equals topic (e.g., "KL1808")
      for (const m of matchers) {
        if (m.type && topic === m.type) return m.index;
      }
      return -1;
    }

    node.on("input", (msg, send, done) => {
      try {
        const topic = (msg && typeof msg.topic === "string") ? msg.topic : "";
        const idx = findOutputForTopic(topic);

        const outs = new Array(Math.max(1, cards.length)).fill(null);
        if (idx >= 0) {
          outs[idx] = msg; // forward unchanged
          node.status({fill:"green", shape:"dot", text:`→ out ${idx+1} (${cards[idx]?.type || "?"})`});
        } else {
          node.status({fill:"yellow", shape:"ring", text:"no topic match"});
          // nothing forwarded
        }
        send(outs);
        done && done();
      } catch (e){
        node.status({fill:"red", shape:"dot", text:"error"});
        node.error(e, msg);
        done && done(e);
      }
    });
  }
  RED.nodes.registerType("BK9100", BK9100Node);
};
